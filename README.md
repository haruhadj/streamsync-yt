<div align="center">
  <img width="1200" height="475" alt="StreamSync-DirectYT Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
  
  # 🎵 StreamSync-DirectYT
  
  **The ultimate YouTube music request system for streamers.**  
  Designed for speed, reliability, and seamless OBS integration.
  
  [![Tech Stack](https://img.shields.io/badge/Stack-React%20%7C%20Express%20%7C%20Socket.io%20%7C%20Prisma-orange)](https://github.com/admin/streamsync-yt)
  [![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
  [![Platform](https://img.shields.io/badge/Platform-Raspberry%20Pi%20Ready-green)](https://www.raspberrypi.org/)

</div>

---

## 🚀 Overview

**StreamSync-DirectYT** is a high-performance music request system that allows your audience to search and request YouTube songs directly into your stream's queue. It features a master admin controller, a public request remote, and a beautiful, transparent OBS overlay.

## ✨ Key Features

### 🛠️ Admin Dashboard (`/admin`)
- **Master Player Control**: Integrated YouTube Player with auto-play and advanced background playback support (includes silent audio keep-alive).
- **Master Mode Sovereignty**: Exclusive sync control system to ensure only one active "Master" player exists across multiple sessions.
- **Queue Management**: Full CRUD operations with smooth Drag-and-Drop reordering using `@dnd-kit`.
- **Live Sync**: Broadcasts player state (currentTime, duration, status) every 500ms to all clients for perfect synchronization.
- **Safety Controls**: One-click "Ban Video" and "Ban IP" features with persistent SQLite blacklists.
- **Advanced Settings**: Real-time configuration of request cooldowns, max queue size, and default volume.

### 📱 Public Request Remote (`/request`)
- **Real-time Sync**: Displays the currently playing track with a synchronized progress bar and "Live Now" status.
- **Smart Search**: YouTube Search proxying with **Invidious Fallback** and API key rotation to bypass quota limits.
- **Search Caching**: Persistent SQLite cache for search results to ensure instant responses for popular queries.
- **Engagement Features**: Voting system to promote songs and "Play Counts" to track popular requests over time.
- **Mobile First**: Fully responsive design optimized for mobile requestors during live streams.

### 📺 OBS Overlay (`/overlay`)
- **Glassmorphism Design**: Modern, premium aesthetic with transparent backgrounds that fits any stream layout.
- **Smart Transitions**: Animated "Now Playing" toasts using Framer Motion.
- **Dynamic Visibility**: Automatically hides when no music is playing.

---

## 🛠️ Tech Stack

- **Frontend**: React (Vite), TypeScript, Tailwind CSS 4.0, Framer Motion, Lucide Icons.
- **Backend**: Standalone Node.js server, Express, Socket.io for real-time bi-directional communication.
- **Database**: SQLite (via Prisma ORM) for persistent queue, settings, search cache, and blacklist management.
- **APIs**: Official YouTube Data API v3 (multi-key support) + Invidious API fallback.

---

## ⚙️ Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [pnpm](https://pnpm.io/) (recommended) or npm
- YouTube Data API Key(s) (from [Google Cloud Console](https://console.cloud.google.com/))

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/admin/streamsync-yt.git
   cd streamsync-yt
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Set up Environment Variables:**
   Create a `.env` file in the root directory:
   ```env
   DATABASE_URL="file:./dev.db"
   YOUTUBE_API_KEY="key1,key2" # Supports multiple keys for rotation
   ADMIN_PASSWORD="your_secure_password"
   INVIDIOUS_URL="http://your-invidious-instance" # Optional fallback
   ```

4. **Initialize Database:**
   ```bash
   pnpm prisma migrate dev --name init
   ```

5. **Run in Development Mode:**
   ```bash
   pnpm dev
   ```
   *The server will start on `http://localhost:3000`*

---

## 📡 Deployment

This project is optimized to run on a **Raspberry Pi** using a **Cloudflare Tunnel** (zrok or cloudflared) to expose the local server to your audience securely.

1. **Build for Production:**
   ```bash
   pnpm build
   ```
2. **Start Production Server:**
   ```bash
   pnpm dev # Runs server.ts which serves the built frontend
   ```

---

<div align="center">
  Built with ❤️ for the streaming community.
</div>
