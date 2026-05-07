{
  "project_name": "StreamSync-DirectYT",
  "stack": {
    "frontend": "Next.js 14+ (App Router), TypeScript, Tailwind CSS",
    "backend": "Standalone Node.js + Socket.io (to be hosted on Raspberry Pi)",
    "database": "PostgreSQL with Prisma ORM",
    "player_api": "Official YouTube IFrame Player API"
  },
  "pages": {
    "/admin": {
      "role": "Master Output",
      "features": [
        "Initialize YouTube IFrame Player API.",
        "Auto-play next song in queue when current song ends.",
        "Broadcast 'player-tick' (currentTime, duration) via socket every 500ms.",
        "Full CRUD for queue: delete, reorder, clear.",
        "One-click 'Ban Video' button that adds videoID to PostgreSQL blacklist."
      ]
    },
    "/request": {
      "role": "Public Remote",
      "features": [
        "Real-time 'Now Playing' UI with synchronized progress bar from Admin data.",
        "YouTube Search proxying through Next.js API (hide API key).",
        "Add song to queue via socket 'request-song' event.",
        "Display read-only queue with 'Requested By' metadata."
      ]
    },
    "/overlay": {
      "role": "OBS Source",
      "features": [
        "Transparent background.",
        "Animated 'Now Playing' toast using Framer Motion.",
        "Auto-hide overlay when no music is playing."
      ]
    }
  },
  "backend_spec": {
    "socket_events": [
      "request-song",
      "admin-skip",
      "sync-state",
      "broadcast-tick",
      "update-queue"
    ],
    "postgres_tables": [
      "Requests (id, videoId, title, requesterIp, createdAt)",
      "Blacklist (videoId, title, reason)"
    ]
  },
  "constraints": [
    "Do not use Firebase; use PostgreSQL.",
    "Use dynamic imports for the YouTube player to avoid SSR issues.",
    "The Socket URL must be an environment variable for Cloudflare Tunneling."
  ]
}