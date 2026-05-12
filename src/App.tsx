import React, { useEffect, useState, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { Toaster } from 'react-hot-toast';
import AdminPage from './components/AdminPage';
import RequestPage from './components/RequestPage';
import OverlayPage from './components/OverlayPage';
import { Music2, ShieldCheck, Monitor } from 'lucide-react';

// Socket singleton
let socketInstance: Socket | null = null;
const getSocket = () => {
  if (!socketInstance) {
    // If VITE_SOCKET_URL is set, use it. Otherwise, default to current host.
    // This is crucial for internet/tunneling support.
    const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;
    console.log(`[Socket] Connecting to: ${socketUrl}`);
    socketInstance = io(socketUrl);
  }
  return socketInstance;
};

function AppContent() {
  const socket = getSocket();
  const location = useLocation();
  const [isConnected, setIsConnected] = useState(socket.connected);
  const isOverlay = location.pathname === '/overlay';

  useEffect(() => {
    function onConnect() { setIsConnected(true); }
    function onDisconnect() { setIsConnected(false); }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);


  return (
      <div className={`min-h-screen ${isOverlay ? 'bg-transparent' : 'bg-[#0a0a0a]'} text-white font-sans selection:bg-orange-500/30`}>
        <Toaster position="bottom-right" toastOptions={{
          style: {
            background: '#151619',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.1)',
          }
        }} />

        {/* Navigation - Only show on main pages, hide on overlay */}
        <Routes>
          <Route path="/overlay" element={null} />
          <Route path="*" element={
            <nav className="border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-50">
              <div className="max-w-screen-2xl mx-auto px-4 h-16 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
                    <Music2 className="w-5 h-5 text-black" />
                  </div>
                  <span className="font-bold text-xl tracking-tight">StreamSync<span className="text-orange-500">YT</span></span>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-full">
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/40">
                      {isConnected ? 'System Live' : 'System Offline'}
                    </span>
                  </div>
                </div>
              </div>
            </nav>
          } />
        </Routes>

        <main>
          <Routes>
            <Route path="/" element={<RequestPage socket={socket} />} />
            <Route path="/request" element={<RequestPage socket={socket} />} />
            <Route path="/admin" element={<AdminPage socket={socket} />} />
            <Route path="/overlay" element={<OverlayPage socket={socket} />} />
          </Routes>
        </main>
      </div>
  );
}

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}
