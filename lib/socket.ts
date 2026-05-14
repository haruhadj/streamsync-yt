import { io, Socket } from "socket.io-client";

let socketInstance: Socket | null = null;

export const getSocket = () => {
  if (typeof window === "undefined") return null;

  if (!socketInstance) {
    let socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || '';
    
    // Auto-detect if accessing via local network IP
    if (!socketUrl || socketUrl.includes('localhost')) {
      const hostname = window.location.hostname;
      // If we're on a local IP, use that IP with port 3001
      if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
        socketUrl = `http://${hostname}:3001`;
      } else {
        // Fallback to localhost:3001 if not provided
        socketUrl = socketUrl || 'http://localhost:3001';
      }
    }

    console.log(`[Socket] Connecting to: ${socketUrl}`);
    socketInstance = io(socketUrl, {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
  }
  return socketInstance;
};
