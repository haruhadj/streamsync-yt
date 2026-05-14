"use client";

import { usePathname } from "next/navigation";
import { Music2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socket";

export default function Navbar() {
  const pathname = usePathname();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    if (socket.connected) setIsConnected(true);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  if (pathname === "/overlay") return null;

  return (
    <nav className="border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-screen-2xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
            <Music2 className="w-5 h-5 text-black" />
          </div>
          <span className="font-bold text-xl tracking-tight">
            StreamSync<span className="text-orange-500">YT</span>
          </span>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-full">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"
              }`}
            />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/40">
              {isConnected ? "System Live" : "System Offline"}
            </span>
          </div>
        </div>
      </div>
    </nav>
  );
}
