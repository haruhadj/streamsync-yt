import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();
const prismaAny = prisma as any;
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const logger = {
  info: (msg: string, ...args: any[]) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, ...args),
};

const PORT = 3000;

app.set("trust proxy", true);

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

const appSettings: AppSettings = {
  requestCooldownSeconds: 180,
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

  // Calculate scores for the pool: Score = (Votes * 50) + (Minutes Waiting)
  const scoredPool = pool.map(req => {
    const minutesWaiting = (Date.now() - new Date(req.timestamp).getTime()) / (1000 * 60);
    const score = (req.votes * 50) + minutesWaiting;
    return { ...req, score };
  });

  // Sort pool by score descending, then timestamp ascending
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

  // Get the sorted queue and pick the first one as next
  const sortedQueue = await getSortedQueue();
  const next = sortedQueue.length > 0 ? sortedQueue[0] : null;

  if (next) {
    await prisma.request.update({
      where: { id: next.id },
      data: { status: "playing" },
    });

    // Increment play count
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
      playCount: stats?.playCount || 1
    } as any;
  } else {
    currentPlayerState = null;
  }

  // Refresh queue after skip
  const updatedQueue = await getSortedQueue();

  const historyRaw = await prisma.request.findMany({
    where: { status: "played" },
    orderBy: { timestamp: "desc" },
    take: 50
  });
  const history = await getRequestsWithPlayCounts(historyRaw);

  io.emit("queue-update", updatedQueue);
  io.emit("history-update", history);
  io.emit("player-state-sync", currentPlayerState);
  io.emit("active-track-update", next ? { ...next, playCount: (currentPlayerState as any).playCount } : null);
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
  if (!prismaAny.appSetting) {
    console.warn("Prisma client is not regenerated yet; settings DB persistence is temporarily disabled.");
    return;
  }
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
  const entries: Array<{ key: string; value: string }> = [
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

async function searchInvidious(q: string) {
  const INVIDIOUS_URL = process.env.INVIDIOUS_URL || "http://127.0.0.1:3000";
  logger.info(`Invidious API fetching for: "${q}"`);
  
  try {
    const response = await axios.get(`${INVIDIOUS_URL}/api/v1/search`, {
      params: { q, type: "video" },
      timeout: 5000,
    });

    return response.data
      .filter((item: any) => item.type === "video")
      .map((item: any) => ({
        videoId: item.videoId,
        title: item.title,
        thumbnail: item.videoThumbnails?.find((t: any) => t.quality === "medium")?.url || item.videoThumbnails?.[0]?.url || "",
      }));
  } catch (error: any) {
    logger.error("Invidious Search Error:", error.message);
    throw error;
  }
}

async function checkInvidiousHealth() {
  const INVIDIOUS_URL = process.env.INVIDIOUS_URL || "http://127.0.0.1:3000";
  try {
    await axios.get(`${INVIDIOUS_URL}/api/v1/stats`, { timeout: 3000 });
    logger.info("Invidious instance is healthy.");
  } catch (error: any) {
    logger.warn(`Invidious instance check failed: ${error.message}`);
  }
}

// YouTube Search Proxy
app.get("/api/youtube/search", async (req, res) => {
  const { q } = req.query as { q: string };
  const API_KEYS = (process.env.YOUTUBE_API_KEY || "").split(",").map(k => k.trim()).filter(k => k.length > 0);

  if (API_KEYS.length === 0) {
    return res.status(500).json({ error: "YOUTUBE_API_KEY is not configured" });
  }

  if (!q || q.trim().length === 0) {
    return res.json([]);
  }

  const normalizedQuery = q.toLowerCase().trim();

  try {
    // 1. Check Cache
    if (prismaAny.searchCache) {
      const cacheEntry = await prismaAny.searchCache.findUnique({
        where: { query: normalizedQuery }
      });

      if (cacheEntry) {
        const age = Date.now() - new Date(cacheEntry.timestamp).getTime();
        const oneDay = 24 * 60 * 60 * 1000;
        if (age < oneDay) {
          console.log(`[YouTube API] Cache hit for: "${normalizedQuery}"`);
          return res.json(JSON.parse(cacheEntry.results));
        }
      }
    }

    // 2. Call YouTube API (with rotation)
    let items: any[] = [];
    let success = false;

    for (let i = 0; i < API_KEYS.length; i++) {
      const currentKey = API_KEYS[i];
      try {
        console.log(`[YouTube API] Fetching from API (Key ${i + 1}/${API_KEYS.length}) for: "${normalizedQuery}"`);
        const response = await axios.get(
          `https://www.googleapis.com/youtube/v3/search`,
          {
            params: {
              part: "snippet",
              q,
              type: "video",
              maxResults: 10,
              key: currentKey,
            },
            timeout: 5000,
          }
        );

        items = response.data.items.map((item: any) => ({
          videoId: item.id.videoId,
          title: item.snippet.title,
          thumbnail: item.snippet.thumbnails.medium.url,
        }));
        success = true;
        break;
      } catch (error: any) {
        const errorData = error.response?.data;
        const isQuotaError = error.response?.status === 403 || errorData?.error?.code === 403 || errorData?.error?.message?.toLowerCase().includes("quota");
        
        console.error(`[YouTube API] Key ${i + 1} Error:`, isQuotaError ? "Quota Exceeded" : (errorData || error.message));

        if (i < API_KEYS.length - 1 && (isQuotaError || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT')) {
          console.log(`[YouTube API] Rotating to next API key...`);
          continue;
        } else {
          // If we reach here, it's either the last key or a non-quota error
          if (isQuotaError || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            console.log(`[YouTube API] All keys exhausted or connection failed, trying Invidious...`);
            try {
              items = await searchInvidious(q);
              success = true; // Consider Invidious success as success
            } catch (invError) {
              console.error("Invidious fallback also failed.");
              throw error; // Re-throw last YouTube error
            }
            break;
          } else {
            throw error;
          }
        }
      }
    }

    // 3. Save to Cache
    if (success && items.length > 0 && prismaAny.searchCache) {
      await prismaAny.searchCache.upsert({
        where: { query: normalizedQuery },
        update: {
          results: JSON.stringify(items),
          timestamp: new Date()
        },
        create: {
          query: normalizedQuery,
          results: JSON.stringify(items)
        }
      }).catch(err => console.error("Cache Save Error:", err));
    }

    res.json(items);
  } catch (error: any) {
    // 4. Fallback to Historical Search on Error
    try {
      const historyItems = await prisma.request.findMany({
        where: {
          OR: [
            { title: { contains: q } },
            { videoId: q }
          ]
        },
        take: 10,
        distinct: ['videoId']
      });

      if (historyItems.length > 0) {
        console.log(`[YouTube API] Returning ${historyItems.length} items from history fallback.`);
        return res.json(historyItems.map(h => ({
          videoId: h.videoId,
          title: h.title,
          thumbnail: h.thumbnail
        })));
      }
    } catch (fallbackErr) {
      console.error("Fallback Search Error:", fallbackErr);
    }

    res.status(500).json({ error: "Failed to fetch from YouTube or Invidious" });
  }
});

// Queue Management via Socket.io
io.on("connection", async (socket) => {
  const clientIp = socket.handshake.headers["x-forwarded-for"] || socket.handshake.address;
  const ipString = Array.isArray(clientIp) ? clientIp[0] : (clientIp as string);

  console.log("New client connected:", socket.id, "from", ipString);

  // Check if banned
  const isBanned = await prisma.bannedIp.findUnique({ where: { ip: ipString } });
  if (isBanned) {
    if (!isBanned.expiresAt || isBanned.expiresAt > new Date()) {
      console.log(`Banned IP tried to connect: ${ipString}`);
      socket.emit("error-toast", "Your IP is banned.");
      socket.disconnect();
      return;
    } else {
      // Auto-unban if expired
      await prisma.bannedIp.delete({ where: { ip: ipString } });
    }
  }

  socket.emit("settings-update", appSettings);
  socket.emit("master-update", masterSocketId);

  // Admin Guard Wrapper
  const adminGuard = (handler: Function) => {
    return (...args: any[]) => {
      if ((socket as any).isAdmin) {
        return handler(...args);
      } else {
        console.warn(`[AdminGuard] Unauthorized access attempt by socket ${socket.id}`);
        socket.emit("error-toast", "Unauthorized: Admin access required.");
      }
    };
  };

  socket.on("admin-claim-master", adminGuard((data?: { force?: boolean }) => {
    if (masterSocketId && masterSocketId !== socket.id && !data?.force) {
      const existingMaster = io.sockets.sockets.get(masterSocketId);
      if (existingMaster && existingMaster.connected) {
        return socket.emit("error-toast", "Another tab is already the Master. Use 'Take Over' to claim it.");
      }
    }
    masterSocketId = socket.id;
    io.emit("master-update", masterSocketId);
    socket.emit("success-toast", "You are now the Master Player.");
  }));

  socket.on("admin-release-master", adminGuard(() => {
    if (masterSocketId === socket.id) {
      masterSocketId = null;
      io.emit("master-update", masterSocketId);
      socket.emit("success-toast", "Master Player released.");
    }
  }));

  // Send initial queue
  const queue = await getSortedQueue();
  socket.emit("queue-update", queue);

  socket.on("sync-state", async () => {
    console.log(`[Sync] Socket ${socket.id} requested state sync`);
    const currentQueue = await getSortedQueue();
    const activeTrackRaw = await prisma.request.findFirst({
        where: { status: "playing" },
    });
    const activeTrack = activeTrackRaw ? (await getRequestsWithPlayCounts([activeTrackRaw]))[0] : null;
    
    socket.emit("queue-update", currentQueue);
    socket.emit("settings-update", appSettings);
    socket.emit("master-update", masterSocketId);
    if (activeTrack) socket.emit("active-track-update", activeTrack);
    if (currentPlayerState) socket.emit("player-state-sync", currentPlayerState);
  });

  const activeTrackRaw = await prisma.request.findFirst({
    where: { status: "playing" },
  });
  const activeTrack = activeTrackRaw ? (await getRequestsWithPlayCounts([activeTrackRaw]))[0] : null;
  socket.emit("active-track-update", activeTrack);

  // Send current player state (we'll assume the first admin handles this)
  if (currentPlayerState) {
    socket.emit("player-state-sync", currentPlayerState);
  } else if (activeTrack) {
    currentPlayerState = {
      videoId: activeTrack.videoId,
      title: activeTrack.title,
      thumbnail: activeTrack.thumbnail || "",
      playing: true,
      currentTime: 0,
      duration: 0,
      requesterName: activeTrack.requesterName,
    };
    socket.emit("player-state-sync", currentPlayerState);
  }

  socket.on("admin-auth", (password: string) => {
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
    if (password === ADMIN_PASSWORD) {
      (socket as any).isAdmin = true;
      socket.emit("auth-success");
    } else {
      socket.emit("error-toast", "Invalid Admin Password");
    }
  });

  socket.on("set-username", ({ username, userId }: { username: string, userId: string }) => {
    if (!userId) return;
    
    // If empty, allow it as 'anonymous' but don't claim it uniquely in the map
    // or we can just treat 'anonymous' as any other name.
    // Let's treat it as a claimable name but allow 'anonymous' to be multiple if we want.
    // Actually, user wants UNIQUE names.
    const nameToClaim = (username || "anonymous").trim();
    const normalized = nameToClaim.toLowerCase();
    
    const existingUserId = nameToUserId.get(normalized);
    console.log(`[User] Claiming: "${nameToClaim}" (normalized: "${normalized}"), Existing owner: ${existingUserId || 'none'}, My ID: ${userId}`);
    
    if (normalized !== "anonymous" && existingUserId && existingUserId !== userId) {
      console.log(`[User] Claim REJECTED: "${nameToClaim}" is already taken by ${existingUserId}`);
      socket.emit("username-set-error", "This name is already taken. Please choose another.");
      return;
    }

    // Release old name
    const currentClaimedName = userIdToName.get(userId);
    if (currentClaimedName) {
      nameToUserId.delete(currentClaimedName.toLowerCase());
    }

    // Claim new name
    userIdToName.set(userId, nameToClaim);
    if (normalized !== "anonymous") {
      nameToUserId.set(normalized, userId);
    }
    
    socket.emit("username-set-success", nameToClaim);
    console.log(`[User] ${userId} claimed name: ${nameToClaim}`);
  });

  socket.on("request-song", async (data) => {
    const { videoId, title, thumbnail, requesterName, userId } = data;
    const now = Date.now();

    // Use the server-side name if available, fallback to provided name (which should have been set-username'd)
    const finalRequesterName = (userId ? userIdToName.get(userId) : null) || requesterName || "anonymous";

    if (appSettings.requestCooldownSeconds > 0) {
      const lastRequestAt = requesterLastRequestAt.get(ipString) ?? 0;
      const secondsSinceLastRequest = Math.floor((now - lastRequestAt) / 1000);
      if (secondsSinceLastRequest < appSettings.requestCooldownSeconds) {
        const remaining = appSettings.requestCooldownSeconds - secondsSinceLastRequest;
        return socket.emit("error-toast", `Please wait ${remaining}s before requesting again.`);
      }
    }

    // Check if blacklisted
    const isBlacklisted = await prisma.blacklist.findUnique({ where: { videoId } });
    if (isBlacklisted) {
      return socket.emit("error-toast", "This song is blacklisted.");
    }

    const pendingQueueCount = await prisma.request.count({
      where: { status: "pending" },
    });
    if (pendingQueueCount >= appSettings.maxQueueSize) {
      return socket.emit("error-toast", "Queue is full. Please try again later.");
    }

    if (!appSettings.allowDuplicateRequests) {
      const duplicate = await prisma.request.findFirst({
        where: {
          videoId,
          status: { in: ["pending", "playing"] },
        },
      });
      if (duplicate) {
        return socket.emit("error-toast", "This song is already in queue.");
      }
    }

    try {
      // Find max order to place at the end
      const maxOrderRequest = await prisma.request.findFirst({
        where: { status: "pending" },
        orderBy: { order: "desc" },
      });
      const nextOrder = (maxOrderRequest?.order ?? 0) + 1;

      const newRequest = await prisma.request.create({
        data: {
          videoId,
          title,
          thumbnail,
          requesterName: finalRequesterName,
          requesterIp: ipString,
          order: nextOrder,
        },
      });

      // Auto-promote if nothing is playing
      const currentPlaying = await prisma.request.findFirst({
          where: { status: "playing" }
      });

      if (!currentPlaying) {
          await prisma.request.update({
              where: { id: newRequest.id },
              data: { status: "playing" }
          });
          currentPlayerState = {
            videoId: newRequest.videoId,
            title: newRequest.title,
            thumbnail: newRequest.thumbnail || "",
            playing: true,
            currentTime: 0,
            duration: 0,
            requesterName: newRequest.requesterName,
          };
          io.emit("active-track-update", newRequest);
          io.emit("player-state-sync", currentPlayerState);
      }

      const updatedQueue = await getSortedQueue();
      requesterLastRequestAt.set(ipString, now);
      io.emit("queue-update", updatedQueue);
      socket.emit("success-toast", "Song added to queue!");
    } catch (err) {
      console.error(err);
      socket.emit("error-toast", "Failed to add song.");
    }
  });

  socket.on("vote-song", async (requestId) => {
    try {
      // Check for duplicate vote
      const existingVote = await prisma.vote.findUnique({
        where: {
          requestId_ip: {
            requestId,
            ip: ipString,
          },
        },
      });

      if (existingVote) {
        return socket.emit("error-toast", "You have already voted for this song.");
      }

      await prisma.$transaction([
        prisma.vote.create({
          data: { requestId, ip: ipString },
        }),
        prisma.request.update({
          where: { id: requestId },
          data: { votes: { increment: 1 } },
        }),
      ]);

      const updatedQueue = await getSortedQueue();
      io.emit("queue-update", updatedQueue);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("admin-player-state", adminGuard((state: any) => {
    // state: { videoId, title, thumbnail, playing, currentTime, duration }
    currentPlayerState = state;
    socket.broadcast.emit("player-state-sync", state);
  }));

  let lastTickLogAt = 0;
  socket.on("admin-player-tick", adminGuard((tick: { currentTime: number; duration: number }) => {
    if (currentPlayerState) {
      currentPlayerState.currentTime = tick.currentTime;
      currentPlayerState.duration = tick.duration;
    }
    
    // Log once every 5 seconds to avoid spam
    const now = Date.now();
    if (now - lastTickLogAt > 5000) {
      console.log(`[Tick] ${currentPlayerState?.title || 'Unknown'}: ${Math.floor(tick.currentTime)}/${Math.floor(tick.duration || 0)}s`);
      lastTickLogAt = now;
    }


    io.emit("player-tick", tick);
  }));
  
  socket.on("admin-skip", adminGuard(async () => {
    await triggerSkip();
  }));
  
  socket.on("admin-delete-request", adminGuard(async (requestId: string) => {
    console.log(`[Admin] Deleting request: ${requestId}`);
    try {
      await prisma.$transaction([
        prisma.vote.deleteMany({ where: { requestId } }),
        prisma.request.delete({ where: { id: requestId } })
      ]);
      const updatedQueue = await getSortedQueue();
      io.emit("queue-update", updatedQueue);
      socket.emit("success-toast", "Request removed.");
    } catch (err) {
      console.error("[Admin] Error deleting request:", err);
      socket.emit("error-toast", "Failed to delete request.");
    }
  }));
  
  socket.on("admin-reorder-queue", adminGuard(async (newQueueIds: string[]) => {
    // Perform updates in transaction to ensure consistency
    await prisma.$transaction(
      newQueueIds.map((id, index) => 
        prisma.request.update({
          where: { id },
          data: { order: index }
        })
      )
    );

    const updatedQueue = await getSortedQueue();
    io.emit("queue-update", updatedQueue);
  }));
  
  socket.on("admin-clear-queue", adminGuard(async () => {
    console.log("[Admin] Clearing all pending requests from queue...");
    try {
      await prisma.$transaction(async (tx) => {
        const pending = await tx.request.findMany({ where: { status: "pending" }, select: { id: true } });
        const ids = pending.map(r => r.id);
        if (ids.length > 0) {
          await tx.vote.deleteMany({ where: { requestId: { in: ids } } });
          await tx.request.deleteMany({ where: { id: { in: ids } } });
        }
      });
      console.log(`[Admin] Queue cleared.`);
      io.emit("queue-update", []);
      socket.emit("success-toast", "Queue cleared successfully.");
    } catch (err) {
      console.error("[Admin] Error clearing queue:", err);
      socket.emit("error-toast", "Failed to clear queue.");
    }
  }));
  
  socket.on("admin-ban-user", adminGuard(async (ipToBan: string) => {
      await prisma.bannedIp.upsert({
          where: { ip: ipToBan },
          update: {},
          create: { ip: ipToBan, reason: "Banned by Admin" }
      });
      socket.emit("success-toast", `IP ${ipToBan} has been banned.`);
  }));
  
  socket.on("admin-ban-video", adminGuard(async (data: { videoId: string, title: string }) => {
      await prisma.blacklist.upsert({
          where: { videoId: data.videoId },
          update: {},
          create: { videoId: data.videoId, reason: data.title }
      });
      
      // Delete if in queue (all pending instances)
      await prisma.request.deleteMany({
          where: { videoId: data.videoId, status: "pending" }
      });

      // If it's currently playing, skip it
      if (currentPlayerState && currentPlayerState.videoId === data.videoId) {
          await triggerSkip();
      } else {
          // Refresh queue since we deleted pending items
      const updatedQueue = await getSortedQueue();
      io.emit("queue-update", updatedQueue);
      }

      // Also refresh blacklist for anyone watching
      const blacklist = await prisma.blacklist.findMany();
      io.emit("blacklist-update", blacklist);
      
      socket.emit("success-toast", "Video has been blacklisted.");
  }));

  socket.on("admin-get-blacklist", adminGuard(async () => {
    const blacklist = await prisma.blacklist.findMany();
    socket.emit("blacklist-update", blacklist);
  }));

  socket.on("admin-unban-video", adminGuard(async (videoId: string) => {
    await prisma.blacklist.delete({ where: { videoId } });
    const blacklist = await prisma.blacklist.findMany();
    io.emit("blacklist-update", blacklist);
    socket.emit("success-toast", "Video removed from blacklist.");
  }));
  
  socket.on("admin-add-song", adminGuard(async (data: any) => {
    const { videoId, title, thumbnail } = data;

    // Check if blacklisted
    const isBlacklisted = await prisma.blacklist.findUnique({ where: { videoId } });
    if (isBlacklisted) {
      return socket.emit("error-toast", "This song is blacklisted.");
    }

    try {
      const maxOrderRequest = await prisma.request.findFirst({
        where: { status: "pending" },
        orderBy: { order: "desc" },
      });
      const nextOrder = (maxOrderRequest?.order ?? 0) + 1;

      await prisma.request.create({
        data: {
          videoId,
          title,
          thumbnail,
          requesterName: "Admin",
          requesterIp: ipString,
          order: nextOrder,
        },
      });
  
      const updatedQueue = await getSortedQueue();
      io.emit("queue-update", updatedQueue);
      socket.emit("success-toast", "Song added by Admin!");
    } catch (err) {
      console.error(err);
      socket.emit("error-toast", "Failed to add song.");
    }
  }));
  
  socket.on("admin-play-now", adminGuard(async (data: any) => {
    const { videoId, title, thumbnail } = data;

    // Check if blacklisted
    const isBlacklisted = await prisma.blacklist.findUnique({ where: { videoId } });
    if (isBlacklisted) {
      return socket.emit("error-toast", "This song is blacklisted.");
    }

    try {
      await prisma.request.updateMany({
          where: { status: "playing" },
          data: { status: "played" }
      });

      const maxOrderRequest = await prisma.request.findFirst({
        where: { status: "pending" },
        orderBy: { order: "desc" },
      });
      const nextOrder = (maxOrderRequest?.order ?? 0) + 1;
  
      const newTrack = await prisma.request.create({
          data: {
          videoId,
          title,
          thumbnail,
          status: "playing",
          requesterName: "Admin",
          requesterIp: ipString,
          order: nextOrder,
      }
    });
  
      currentPlayerState = {
          videoId: newTrack.videoId,
          title: newTrack.title,
          thumbnail: newTrack.thumbnail || "",
          playing: true,
          currentTime: 0,
          duration: 0,
          requesterName: newTrack.requesterName,
      };
  
      io.emit("active-track-update", newTrack);
      io.emit("player-state-sync", currentPlayerState);
      
      const historyRaw = await prisma.request.findMany({
        where: { status: "played" },
        orderBy: { timestamp: "desc" },
        take: 50
      });
      const history = await getRequestsWithPlayCounts(historyRaw);
      io.emit("history-update", history);
      socket.emit("success-toast", "Playing now!");
    } catch (err) {
      console.error(err);
      socket.emit("error-toast", "Failed to play now.");
    }
  }));
  
  socket.on("admin-delete-history-video", adminGuard(async (videoId: string) => {
    console.log(`[Admin] Deleting history for videoId: ${videoId}`);
    try {
      await prisma.$transaction(async (tx) => {
        const toDelete = await tx.request.findMany({ where: { videoId, status: "played" }, select: { id: true } });
        const ids = toDelete.map(r => r.id);
        if (ids.length > 0) {
          await tx.vote.deleteMany({ where: { requestId: { in: ids } } });
          await tx.request.deleteMany({ where: { id: { in: ids } } });
        }
      });
      
      const historyRaw = await prisma.request.findMany({
        where: { status: "played" },
        orderBy: { timestamp: "desc" },
        take: 50
      });
      const history = await getRequestsWithPlayCounts(historyRaw);
      io.emit("history-update", history);
      socket.emit("success-toast", "Video removed from history.");
    } catch (err) {
      console.error("[Admin] Error deleting history video:", err);
      socket.emit("error-toast", "Failed to remove video from history.");
    }
  }));
 
  socket.on("admin-clear-history", adminGuard(async () => {
    console.log("[Admin] Clearing all playback history...");
    try {
      await prisma.$transaction(async (tx) => {
        const toDelete = await tx.request.findMany({ where: { status: "played" }, select: { id: true } });
        const ids = toDelete.map(r => r.id);
        if (ids.length > 0) {
          await tx.vote.deleteMany({ where: { requestId: { in: ids } } });
          await tx.request.deleteMany({ where: { id: { in: ids } } });
        }
      });
      
      io.emit("history-update", []);
      socket.emit("success-toast", "Playback history cleared.");
    } catch (err) {
      console.error("[Admin] Error clearing history:", err);
      socket.emit("error-toast", "Failed to clear history.");
    }
  }));

  socket.on("admin-get-history", adminGuard(async () => {
    const historyRaw = await prisma.request.findMany({
      where: { status: "played" },
      orderBy: { timestamp: "desc" },
      take: 50
    });
    const history = await getRequestsWithPlayCounts(historyRaw);
    socket.emit("history-update", history);
  }));

  socket.on("get-history", async () => {
    const historyRaw = await prisma.request.findMany({
      where: { status: "played" },
      orderBy: { timestamp: "desc" },
      take: 50
    });
    const history = await getRequestsWithPlayCounts(historyRaw);
    socket.emit("history-update", history);
  });
  
  socket.on("admin-update-settings", adminGuard((settings: Partial<AppSettings>) => {
    const nextSettings = sanitizeSettings(settings);
  
    Object.assign(appSettings, nextSettings);
    persistSettings(nextSettings).catch((error) => {
      console.error("Failed to persist settings:", error);
    });
    io.emit("settings-update", appSettings);
  }));

  socket.on("admin-reset-play-counts", adminGuard(async () => {
    try {
      await (prisma as any).songStats.deleteMany();
    } catch (err) {
      console.error("[Admin] Error resetting play counts:", err);
      return socket.emit("error-toast", "Failed to reset play counts.");
    }
    
    // Refresh queue and history to reflect reset counts
    const [queueRaw, historyRaw] = await Promise.all([
      prisma.request.findMany({
        where: { status: "pending" },
        orderBy: [{ order: "asc" }, { votes: "desc" }, { timestamp: "asc" }],
      }),
      prisma.request.findMany({
        where: { status: "played" },
        orderBy: { timestamp: "desc" },
        take: 50
      })
    ]);

    const [updatedQueue, updatedHistory] = await Promise.all([
      getRequestsWithPlayCounts(queueRaw),
      getRequestsWithPlayCounts(historyRaw)
    ]);

    io.emit("queue-update", updatedQueue);
    io.emit("history-update", updatedHistory);
    
    if (currentPlayerState) {
      (currentPlayerState as any).playCount = 1;
      io.emit("player-state-sync", currentPlayerState);
    }
    
    socket.emit("success-toast", "All song play counts have been reset.");
  }));

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    if (masterSocketId === socket.id) {
      masterSocketId = null;
      io.emit("master-update", masterSocketId);
    }
  });
});

async function startServer() {
  await loadPersistedSettings();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    logger.info(`Server running on http://0.0.0.0:${PORT}`);
    
    // Start health checks
    checkInvidiousHealth();
    setInterval(checkInvidiousHealth, 10 * 60 * 1000); // Every 10 minutes
  });
}

startServer();
