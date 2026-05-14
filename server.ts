import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();
const prismaAny = prisma as any;
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Adjust this to your Next.js URL in production
    methods: ["GET", "POST"]
  },
});

const logger = {
  info: (msg: string, ...args: any[]) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, ...args),
};

const PORT = Number(process.env.BACKEND_PORT) || 3001;

// Custom Socket type with admin flag
interface AuthenticatedSocket extends Socket {
  isAdmin?: boolean;
}

interface AppSettings {
  requestCooldownSeconds: number;
  maxQueueSize: number;
  allowDuplicateRequests: boolean;
  defaultVolume: number;
  themeColor: string;
}

interface PlayerState {
  videoId: string;
  title: string;
  thumbnail: string;
  playing: boolean;
  currentTime: number;
  duration?: number;
  requesterName?: string;
}

let appSettings: AppSettings = {
  requestCooldownSeconds: 30,
  maxQueueSize: 100,
  allowDuplicateRequests: false,
  defaultVolume: 0.5,
  themeColor: "#f97316",
};

const requesterLastRequestAt = new Map<string, number>();
const userIdToName = new Map<string, string>();
const nameToUserId = new Map<string, string>();
let currentPlayerState: PlayerState | null = null;
let masterSocketId: string | null = null;

async function getRequestsWithPlayCounts(requests: any[]) {
  const videoIds = [...new Set(requests.map(r => r.videoId))];
  const stats = await (prisma as any).songStats.findMany({
    where: { videoId: { in: videoIds } }
  });
  const statsMap = new Map(stats.map((s: any) => [s.videoId, s.playCount]));
  
  return requests.map(r => ({
    ...r,
    playCount: statsMap.get(r.videoId) || 0
  }));
}

async function getSortedQueue() {
  const requests = await prisma.request.findMany({
    where: { status: "pending" },
    orderBy: { order: "asc" },
  });

  if (requests.length <= 3) {
    return getRequestsWithPlayCounts(requests);
  }

  const protectedZone = requests.slice(0, 3);
  const pool = requests.slice(3);

  const scoredPool = pool.map(req => {
    const minutesWaiting = (Date.now() - new Date(req.timestamp).getTime()) / (1000 * 60);
    const score = (req.votes * 50) + minutesWaiting;
    return { ...req, score };
  });

  scoredPool.sort((a: any, b: any) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  const sortedQueue = [...protectedZone, ...scoredPool];
  return getRequestsWithPlayCounts(sortedQueue);
}

async function triggerSkip() {
  const current = await prisma.request.findFirst({
    where: { status: "playing" },
  });
  if (current) {
    await prisma.request.update({
      where: { id: current.id },
      data: { status: "played" },
    });
  }

  const sortedQueue = await getSortedQueue();
  const next = sortedQueue.length > 0 ? sortedQueue[0] : null;

  if (next) {
    await prisma.request.update({
      where: { id: next.id },
      data: { status: "playing" },
    });

    await (prisma as any).songStats.upsert({
      where: { videoId: next.videoId },
      update: { playCount: { increment: 1 } },
      create: { videoId: next.videoId, playCount: 1 }
    });

    const stats = await (prisma as any).songStats.findUnique({
      where: { videoId: next.videoId }
    });

    currentPlayerState = {
      videoId: next.videoId,
      title: next.title,
      thumbnail: next.thumbnail || "",
      playing: true,
      currentTime: 0,
      duration: 0,
      requesterName: next.requesterName,
    } as any;
  } else {
    currentPlayerState = null;
  }

  const updatedQueue = await getSortedQueue();
  const historyRaw = await prisma.request.findMany({
    where: { status: "played" },
    orderBy: { timestamp: "desc" },
    take: 100 // Fetch more to ensure we have 50 unique after deduplication
  });

  const uniqueHistoryRaw = [];
  const seenIds = new Set();
  for (const item of historyRaw) {
    if (!seenIds.has(item.videoId)) {
      seenIds.add(item.videoId);
      uniqueHistoryRaw.push(item);
      if (uniqueHistoryRaw.length >= 50) break;
    }
  }

  const history = await getRequestsWithPlayCounts(uniqueHistoryRaw);

  io.emit("queue-update", updatedQueue);
  io.emit("history-update", history);
  io.emit("player-state-sync", currentPlayerState);
  io.emit("active-track-update", next);
}

function sanitizeSettings(raw: Partial<AppSettings>): AppSettings {
  return {
    requestCooldownSeconds: Math.max(0, Math.min(3600, Math.floor(raw.requestCooldownSeconds ?? appSettings.requestCooldownSeconds))),
    maxQueueSize: Math.max(1, Math.min(500, Math.floor(raw.maxQueueSize ?? appSettings.maxQueueSize))),
    allowDuplicateRequests: typeof raw.allowDuplicateRequests === "boolean" ? raw.allowDuplicateRequests : appSettings.allowDuplicateRequests,
    defaultVolume: Math.max(0, Math.min(1, raw.defaultVolume ?? appSettings.defaultVolume)),
    themeColor: typeof raw.themeColor === "string" ? raw.themeColor : appSettings.themeColor,
  };
}

async function loadPersistedSettings() {
  if (!prismaAny.appSetting) return;
  const rows = await prismaAny.appSetting.findMany();
  if (!rows.length) return;

  const parsed: Partial<AppSettings> = {};
  for (const row of rows) {
    if (row.key === "requestCooldownSeconds") parsed.requestCooldownSeconds = Number(row.value);
    if (row.key === "maxQueueSize") parsed.maxQueueSize = Number(row.value);
    if (row.key === "allowDuplicateRequests") parsed.allowDuplicateRequests = row.value === "true";
    if (row.key === "defaultVolume") parsed.defaultVolume = Number(row.value);
    if (row.key === "themeColor") parsed.themeColor = row.value;
  }

  Object.assign(appSettings, sanitizeSettings(parsed));
}

async function persistSettings(settings: AppSettings) {
  if (!prismaAny.appSetting) return;
  const entries = [
    { key: "requestCooldownSeconds", value: String(settings.requestCooldownSeconds) },
    { key: "maxQueueSize", value: String(settings.maxQueueSize) },
    { key: "allowDuplicateRequests", value: String(settings.allowDuplicateRequests) },
    { key: "defaultVolume", value: String(settings.defaultVolume) },
    { key: "themeColor", value: settings.themeColor },
  ];

  for (const entry of entries) {
    await prismaAny.appSetting.upsert({
      where: { key: entry.key },
      create: entry,
      update: { value: entry.value },
    });
  }
}

app.use(express.json());

io.on("connection", async (socket) => {
  const clientIp = socket.handshake.headers["x-forwarded-for"] || socket.handshake.address;
  const ipString = Array.isArray(clientIp) ? clientIp[0] : (clientIp as string);

  console.log("New client connected:", socket.id, "from", ipString);

  // Check if banned
  const isBanned = await prisma.bannedIp.findUnique({ where: { ip: ipString } });
  if (isBanned) {
    if (!isBanned.expiresAt || isBanned.expiresAt > new Date()) {
      socket.emit("error-toast", "Your IP is banned.");
      socket.disconnect();
      return;
    } else {
      await prisma.bannedIp.delete({ where: { ip: ipString } });
    }
  }

  socket.emit("settings-update", appSettings);
  socket.emit("master-update", masterSocketId);

  const adminGuard = (handler: Function) => {
    return (...args: any[]) => {
      if ((socket as any).isAdmin) return handler(...args);
      socket.emit("error-toast", "Unauthorized: Admin access required.");
    };
  };

  socket.on("admin-auth", (password: string) => {
    if (password === (process.env.ADMIN_PASSWORD || "admin")) {
      (socket as any).isAdmin = true;
      socket.emit("auth-success");
    } else {
      socket.emit("error-toast", "Invalid Admin Password");
    }
  });

  socket.on("get-history", async () => {
    const historyRaw = await prisma.request.findMany({
      where: { status: "played" },
      orderBy: { timestamp: "desc" },
      take: 100
    });
    const uniqueHistoryRaw = [];
    const seenIds = new Set();
    for (const item of historyRaw) {
      if (!seenIds.has(item.videoId)) {
        seenIds.add(item.videoId);
        uniqueHistoryRaw.push(item);
        if (uniqueHistoryRaw.length >= 50) break;
      }
    }
    const history = await getRequestsWithPlayCounts(uniqueHistoryRaw);
    socket.emit("history-update", history);
  });

  socket.on("sync-state", async () => {
    const currentQueue = await getSortedQueue();
    const activeTrackRaw = await prisma.request.findFirst({ where: { status: "playing" } });
    const activeTrack = activeTrackRaw ? (await getRequestsWithPlayCounts([activeTrackRaw]))[0] : null;
    
    socket.emit("queue-update", currentQueue);
    socket.emit("settings-update", appSettings);
    socket.emit("master-update", masterSocketId);
    if (activeTrack) socket.emit("active-track-update", activeTrack);
    if (currentPlayerState) socket.emit("player-state-sync", currentPlayerState);
  });

  socket.on("request-song", async (data) => {
    const { videoId, title, thumbnail, requesterName, userId } = data;
    const now = Date.now();
    const finalRequesterName = (userId ? userIdToName.get(userId) : null) || requesterName || "anonymous";

    // Blacklist check
    const isBlacklisted = await prisma.blacklist.findUnique({ where: { videoId } });
    if (isBlacklisted) return socket.emit("error-toast", "This song is blacklisted.");

    // Cooldown check
    if (appSettings.requestCooldownSeconds > 0) {
      const lastAt = requesterLastRequestAt.get(ipString) ?? 0;
      if (Math.floor((now - lastAt) / 1000) < appSettings.requestCooldownSeconds) {
        return socket.emit("error-toast", "Please wait before requesting again.");
      }
    }

    try {
      const maxOrder = await prisma.request.findFirst({ where: { status: "pending" }, orderBy: { order: "desc" } });
      const nextOrder = (maxOrder?.order ?? 0) + 1;

      const newReq = await prisma.request.create({
        data: { videoId, title, thumbnail, requesterName: finalRequesterName, requesterIp: ipString, order: nextOrder }
      });

      const playing = await prisma.request.findFirst({ where: { status: "playing" } });
      if (!playing) {
        await prisma.request.update({ where: { id: newReq.id }, data: { status: "playing" } });
        currentPlayerState = { videoId, title, thumbnail: thumbnail || "", playing: true, currentTime: 0, requesterName: finalRequesterName };
        io.emit("active-track-update", newReq);
        io.emit("player-state-sync", currentPlayerState);
      }

      const queue = await getSortedQueue();
      requesterLastRequestAt.set(ipString, now);
      io.emit("queue-update", queue);
      socket.emit("success-toast", "Song added!");
    } catch (err) {
      console.error(err);
      socket.emit("error-toast", "Failed to add song.");
    }
  });

  socket.on("vote-song", async (requestId) => {
    try {
      await prisma.$transaction([
        prisma.vote.create({ data: { requestId, ip: ipString } }),
        prisma.request.update({ where: { id: requestId }, data: { votes: { increment: 1 } } })
      ]);
      const queue = await getSortedQueue();
      io.emit("queue-update", queue);
    } catch (err) {}
  });

  socket.on("admin-player-tick", adminGuard((tick: any) => {
    if (currentPlayerState) {
      currentPlayerState.currentTime = tick.currentTime;
      currentPlayerState.duration = tick.duration;
    }
    io.emit("player-tick", tick);
  }));

  socket.on("admin-skip", adminGuard(async () => {
    await triggerSkip();
  }));

  socket.on("admin-delete-request", adminGuard(async (id: string) => {
    await prisma.request.delete({ where: { id } });
    const queue = await getSortedQueue();
    io.emit("queue-update", queue);
  }));

  socket.on("admin-clear-queue", adminGuard(async () => {
    await prisma.request.deleteMany({ where: { status: "pending" } });
    io.emit("queue-update", []);
  }));

  socket.on("admin-ban-video", adminGuard(async ({ videoId, title }: { videoId: string; title: string }) => {
    try {
      await prisma.blacklist.upsert({
        where: { videoId },
        create: { videoId, reason: "Banned by admin" },
        update: {}
      });
      const playing = await prisma.request.findFirst({ where: { status: "playing" } });
      if (playing && playing.videoId === videoId) {
        await triggerSkip();
      }
      socket.emit("success-toast", "Video banned successfully");
      const blacklist = await prisma.blacklist.findMany();
      io.emit("blacklist-update", blacklist);
    } catch (err) {
      socket.emit("error-toast", "Failed to ban video");
    }
  }));

  socket.on("admin-unban-video", adminGuard(async (videoId: string) => {
    try {
      await prisma.blacklist.delete({ where: { videoId } });
      socket.emit("success-toast", "Video unbanned");
      const blacklist = await prisma.blacklist.findMany();
      io.emit("blacklist-update", blacklist);
    } catch (err) {
      socket.emit("error-toast", "Failed to unban video");
    }
  }));

  socket.on("admin-get-blacklist", adminGuard(async () => {
    const blacklist = await prisma.blacklist.findMany();
    socket.emit("blacklist-update", blacklist);
  }));

  socket.on("admin-get-history", adminGuard(async () => {
    const historyRaw = await prisma.request.findMany({
      where: { status: "played" },
      orderBy: { timestamp: "desc" },
      take: 100
    });
    const uniqueHistoryRaw = [];
    const seenIds = new Set();
    for (const item of historyRaw) {
      if (!seenIds.has(item.videoId)) {
        seenIds.add(item.videoId);
        uniqueHistoryRaw.push(item);
        if (uniqueHistoryRaw.length >= 50) break;
      }
    }
    const history = await getRequestsWithPlayCounts(uniqueHistoryRaw);
    socket.emit("history-update", history);
  }));

  socket.on("admin-clear-history", adminGuard(async () => {
    await prisma.request.deleteMany({ where: { status: "played" } });
    io.emit("history-update", []);
    socket.emit("success-toast", "History cleared");
  }));

  socket.on("admin-delete-history-video", adminGuard(async (videoId: string) => {
    await prisma.request.deleteMany({ where: { videoId, status: "played" } });
    const historyRaw = await prisma.request.findMany({
      where: { status: "played" },
      orderBy: { timestamp: "desc" },
      take: 100
    });
    const uniqueHistoryRaw = [];
    const seenIds = new Set();
    for (const item of historyRaw) {
      if (!seenIds.has(item.videoId)) {
        seenIds.add(item.videoId);
        uniqueHistoryRaw.push(item);
        if (uniqueHistoryRaw.length >= 50) break;
      }
    }
    const history = await getRequestsWithPlayCounts(uniqueHistoryRaw);
    io.emit("history-update", history);
    socket.emit("success-toast", "Video removed from history");
  }));

  socket.on("admin-reorder-queue", adminGuard(async (orderedIds: string[]) => {
    try {
      for (let i = 0; i < orderedIds.length; i++) {
        await prisma.request.update({ where: { id: orderedIds[i] }, data: { order: i } });
      }
      const queue = await getSortedQueue();
      io.emit("queue-update", queue);
    } catch (err) {}
  }));

  socket.on("admin-claim-master", adminGuard(({ force }: { force?: boolean } = {}) => {
    if (!masterSocketId || force) {
      masterSocketId = socket.id;
      io.emit("master-update", masterSocketId);
      socket.emit("success-toast", "Master control claimed");
    }
  }));

  socket.on("admin-release-master", adminGuard(() => {
    if (masterSocketId === socket.id) {
      masterSocketId = null;
      io.emit("master-update", null);
      socket.emit("success-toast", "Master control released");
    }
  }));

  socket.on("admin-add-song", adminGuard(async (data: any) => {
    try {
      const { videoId, title, thumbnail, requesterName } = data;
      const maxOrder = await prisma.request.findFirst({ where: { status: "pending" }, orderBy: { order: "desc" } });
      const nextOrder = (maxOrder?.order ?? 0) + 1;
      const newReq = await prisma.request.create({
        data: { videoId, title, thumbnail, requesterName, requesterIp: socket.handshake.address, order: nextOrder }
      });
      const queue = await getSortedQueue();
      io.emit("queue-update", queue);
      socket.emit("success-toast", "Song added to queue");
      
      const playing = await prisma.request.findFirst({ where: { status: "playing" } });
      if (!playing) {
        await prisma.request.update({ where: { id: newReq.id }, data: { status: "playing" } });
        currentPlayerState = { videoId, title, thumbnail: thumbnail || "", playing: true, currentTime: 0, requesterName };
        io.emit("active-track-update", newReq);
        io.emit("player-state-sync", currentPlayerState);
      }
    } catch (err) {
      socket.emit("error-toast", "Failed to add song");
    }
  }));

  socket.on("admin-play-now", adminGuard(async (data: any) => {
    try {
      const { videoId, title, thumbnail, requesterName } = data;
      const playing = await prisma.request.findFirst({ where: { status: "playing" } });
      if (playing) {
        await prisma.request.update({ where: { id: playing.id }, data: { status: "played" } });
      }
      const newReq = await prisma.request.create({
        data: { videoId, title, thumbnail, requesterName, requesterIp: socket.handshake.address, order: -1, status: "playing" }
      });
      currentPlayerState = { videoId, title, thumbnail: thumbnail || "", playing: true, currentTime: 0, requesterName };
      io.emit("active-track-update", newReq);
      io.emit("player-state-sync", currentPlayerState);
      socket.emit("success-toast", "Playing now");
      const queue = await getSortedQueue();
      io.emit("queue-update", queue);
    } catch (err) {
      socket.emit("error-toast", "Failed to play now");
    }
  }));

  socket.on("admin-update-settings", adminGuard(async (newSettings: any) => {
    appSettings = { ...appSettings, ...newSettings };
    await persistSettings(appSettings);
    io.emit("settings-update", appSettings);
    socket.emit("success-toast", "Settings updated");
  }));

  socket.on("admin-reset-play-counts", adminGuard(async () => {
    await prisma.songStats.deleteMany();
    socket.emit("success-toast", "Play counts reset");
  }));

  socket.on("admin-ban-user", adminGuard(async (ip: string) => {
    await prisma.bannedIp.upsert({
      where: { ip },
      create: { ip, reason: "Banned by admin" },
      update: {}
    });
    socket.emit("success-toast", "User IP banned");
  }));

  socket.on("set-username", ({ username, userId }: { username: string, userId: string }) => {
    userIdToName.set(userId, username);
    socket.emit("username-set-success", username);
  });

  socket.on("disconnect", () => {
    if (masterSocketId === socket.id) {
      masterSocketId = null;
      io.emit("master-update", null);
    }
  });
});

async function startServer() {
  await loadPersistedSettings();
  httpServer.listen(PORT, "0.0.0.0", () => {
    logger.info(`Socket Server running on port ${PORT}`);
  });
}

startServer();
