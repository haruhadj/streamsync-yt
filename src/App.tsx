import React, { useEffect, useState, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
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
    socketInstance = io();
  }
  return socketInstance;
};

export default function App() {
  const socket = getSocket();

  return (
    <Router>
      <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-orange-500/30">
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
              <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
                    <Music2 className="w-5 h-5 text-black" />
                  </div>
                  <span className="font-bold text-xl tracking-tight">StreamSync<span className="text-orange-500">YT</span></span>
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
    </Router>
  );
}
