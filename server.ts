import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
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

const PORT = 3000;

interface AppSettings {
  requestCooldownSeconds: number;
  maxQueueSize: number;
  allowDuplicateRequests: boolean;
  defaultVolume: number;
}

interface PlayerState {
  videoId: string;
  title: string;
  thumbnail: string;
  playing: boolean;
  currentTime: number;
  requesterName?: string;
}

const appSettings: AppSettings = {
  requestCooldownSeconds: 180,
  maxQueueSize: 100,
  allowDuplicateRequests: false,
  defaultVolume: 0.5,
};

const requesterLastRequestAt = new Map<string, number>();
let currentPlayerState: PlayerState | null = null;

function sanitizeSettings(raw: Partial<AppSettings>): AppSettings {
  return {
    requestCooldownSeconds: Math.max(0, Math.min(3600, Math.floor(raw.requestCooldownSeconds ?? appSettings.requestCooldownSeconds))),
    maxQueueSize: Math.max(1, Math.min(500, Math.floor(raw.maxQueueSize ?? appSettings.maxQueueSize))),
    allowDuplicateRequests: typeof raw.allowDuplicateRequests === "boolean" ? raw.allowDuplicateRequests : appSettings.allowDuplicateRequests,
    defaultVolume: Math.max(0, Math.min(1, raw.defaultVolume ?? appSettings.defaultVolume)),
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

// YouTube Search Proxy
app.get("/api/youtube/search", async (req, res) => {
  const { q } = req.query;
  const API_KEY = process.env.YOUTUBE_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: "YOUTUBE_API_KEY is not configured" });
  }

  try {
    const response = await axios.get(
      `https://www.googleapis.com/youtube/v3/search`,
      {
        params: {
          part: "snippet",
          q,
          type: "video",
          maxResults: 10,
          key: API_KEY,
        },
      }
    );

    const items = response.data.items.map((item: any) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails.medium.url,
    }));

    res.json(items);
  } catch (error: any) {
    console.error("YouTube Search Error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch from YouTube" });
  }
});

// Queue Management via Socket.io
io.on("connection", async (socket) => {
  const clientIp = socket.handshake.address;
  console.log("New client connected:", socket.id, "from", clientIp);
  socket.emit("settings-update", appSettings);

  // Send initial queue
  const queue = await prisma.request.findMany({
    where: { status: "pending" },
    orderBy: [
      { votes: "desc" },
      { timestamp: "asc" }
    ],
  });
  socket.emit("queue-update", queue);

  const activeTrack = await prisma.request.findFirst({
    where: { status: "playing" },
  });
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
      requesterName: activeTrack.requesterName,
    };
    socket.emit("player-state-sync", currentPlayerState);
  }

  socket.on("admin-auth", (password: string) => {
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
    if (password === ADMIN_PASSWORD) {
      socket.emit("auth-success");
    } else {
      socket.emit("error-toast", "Invalid Admin Password");
    }
  });

  socket.on("request-song", async (data) => {
    const { videoId, title, thumbnail, requesterName } = data;
    const now = Date.now();

    if (appSettings.requestCooldownSeconds > 0) {
      const lastRequestAt = requesterLastRequestAt.get(clientIp) ?? 0;
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
      const newRequest = await prisma.request.create({
        data: {
          videoId,
          title,
          thumbnail,
          requesterName: requesterName || "anonymous",
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
            playing: true,
            currentTime: 0,
            requesterName: newRequest.requesterName,
          };
          io.emit("active-track-update", newRequest);
          io.emit("player-state-sync", currentPlayerState);
      }

      const updatedQueue = await prisma.request.findMany({
        where: { status: "pending" },
        orderBy: [
          { votes: "desc" },
          { timestamp: "asc" }
        ],
      });
      requesterLastRequestAt.set(clientIp, now);
      io.emit("queue-update", updatedQueue);
      socket.emit("success-toast", "Song added to queue!");
    } catch (err) {
      console.error(err);
      socket.emit("error-toast", "Failed to add song.");
    }
  });

  socket.on("vote-song", async (requestId) => {
    try {
      await prisma.request.update({
        where: { id: requestId },
        data: { votes: { increment: 1 } }
      });
      const updatedQueue = await prisma.request.findMany({
        where: { status: "pending" },
        orderBy: [
          { votes: "desc" },
          { timestamp: "asc" }
        ],
      });
      io.emit("queue-update", updatedQueue);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on("admin-player-state", (state) => {
    // state: { videoId, title, thumbnail, playing, currentTime }
    currentPlayerState = state;
    socket.broadcast.emit("player-state-sync", state);
  });

  socket.on("admin-skip", async () => {
    const current = await prisma.request.findFirst({
      where: { status: "playing" },
    });
    if (current) {
      await prisma.request.update({
        where: { id: current.id },
        data: { status: "played" },
      });
    }

    const next = await prisma.request.findFirst({
      where: { status: "pending" },
      orderBy: { timestamp: "asc" },
    });

    if (next) {
      await prisma.request.update({
        where: { id: next.id },
        data: { status: "playing" },
      });
      currentPlayerState = {
        videoId: next.videoId,
        title: next.title,
        thumbnail: next.thumbnail || "",
        playing: true,
        currentTime: 0,
        requesterName: next.requesterName,
      };
    } else {
      currentPlayerState = null;
    }

    const updatedQueue = await prisma.request.findMany({
      where: { status: "pending" },
      orderBy: [
        { votes: "desc" },
        { timestamp: "asc" }
      ],
    });
    io.emit("queue-update", updatedQueue);
    io.emit("player-state-sync", currentPlayerState);
    io.emit("active-track-update", next);
  });

  socket.on("admin-delete-request", async (requestId) => {
    await prisma.request.delete({ where: { id: requestId } });
    const updatedQueue = await prisma.request.findMany({
      where: { status: "pending" },
      orderBy: [
        { votes: "desc" },
        { timestamp: "asc" }
      ],
    });
    io.emit("queue-update", updatedQueue);
  });

  socket.on("admin-reorder-queue", async (newQueueIds: string[]) => {
    // Simple way for the sake of demo: we don't have a 'priority' field, 
    // so we'd need to update timestamps or add a 'rank' field.
    // Let's just assume we update the timestamps in bulk for this demo.
    for (let i = 0; i < newQueueIds.length; i++) {
        await prisma.request.update({
            where: { id: newQueueIds[i] },
            data: { timestamp: new Date(Date.now() + i) }
        });
    }
    const updatedQueue = await prisma.request.findMany({
      where: { status: "pending" },
      orderBy: [
        { votes: "desc" },
        { timestamp: "asc" }
      ],
    });
    io.emit("queue-update", updatedQueue);
  });

  socket.on("admin-clear-queue", async () => {
    await prisma.request.deleteMany({ where: { status: "pending" } });
    io.emit("queue-update", []);
  });

  socket.on("admin-ban-user", async (ip) => {
      // Banning logic disabled as requesterIp is removed
      socket.emit("error-toast", "IP banning is currently disabled.");
  });

  socket.on("admin-ban-video", async (data: { videoId: string, title: string }) => {
      await prisma.blacklist.upsert({
          where: { videoId: data.videoId },
          update: {},
          create: { videoId: data.videoId, reason: data.title }
      });
      // Delete if in queue
      await prisma.request.deleteMany({
          where: { videoId: data.videoId, status: "pending" }
      });
      const updatedQueue = await prisma.request.findMany({
          where: { status: "pending" },
          orderBy: [
            { votes: "desc" },
            { timestamp: "asc" }
          ],
      });
      io.emit("queue-update", updatedQueue);
      socket.emit("success-toast", "Video has been blacklisted.");
  });

  socket.on("admin-add-song", async (data) => {
    const { videoId, title, thumbnail } = data;
    try {
      await prisma.request.create({
        data: {
          videoId,
          title,
          thumbnail,
          requesterName: "Admin",
        },
      });

      const updatedQueue = await prisma.request.findMany({
        where: { status: "pending" },
        orderBy: [
          { votes: "desc" },
          { timestamp: "asc" }
        ],
      });
      io.emit("queue-update", updatedQueue);
      socket.emit("success-toast", "Song added by Admin!");
    } catch (err) {
      console.error(err);
      socket.emit("error-toast", "Failed to add song.");
    }
  });

  socket.on("admin-play-now", async (data) => {
    const { videoId, title, thumbnail } = data;
    try {
      // Mark current as played
      await prisma.request.updateMany({
          where: { status: "playing" },
          data: { status: "played" }
      });

      // Create new as playing
      const newTrack = await prisma.request.create({
          data: {
          videoId,
          title,
          thumbnail,
          status: "playing",
          requesterName: "Admin"
      }
    });

      currentPlayerState = {
          videoId: newTrack.videoId,
          title: newTrack.title,
          playing: true,
          currentTime: 0,
          requesterName: newTrack.requesterName,
      };

      io.emit("active-track-update", newTrack);
      io.emit("player-state-sync", currentPlayerState);
      socket.emit("success-toast", "Playing now!");
    } catch (err) {
      console.error(err);
      socket.emit("error-toast", "Failed to play now.");
    }
  });

  socket.on("admin-get-history", async () => {
    const history = await prisma.request.findMany({
      where: { status: "played" },
      orderBy: { timestamp: "desc" },
      take: 50
    });
    socket.emit("history-update", history);
  });

  socket.on("admin-update-settings", (settings: Partial<AppSettings>) => {
    const nextSettings = sanitizeSettings(settings);

    Object.assign(appSettings, nextSettings);
    persistSettings(nextSettings).catch((error) => {
      console.error("Failed to persist settings:", error);
    });
    io.emit("settings-update", appSettings);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
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
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
