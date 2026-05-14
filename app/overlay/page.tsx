"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Music2 } from 'lucide-react';
import { getSocket } from '@/lib/socket';

export default function OverlayPage() {
  const socket = getSocket();
  const [nowPlaying, setNowPlaying] = useState<any | null>(null);
  const [queue, setQueue] = useState<any[]>([]);

  useEffect(() => {
    if (!socket) return;
    socket.emit('sync-state');
    
    const onPlayerStateSync = (state: any) => setNowPlaying(state);
    const onQueueUpdate = (updatedQueue: any[]) => setQueue(updatedQueue);
    const onPlayerTick = (tick: any) => {
      setNowPlaying((prev: any) => prev ? { ...prev, ...tick } : null);
    };

    socket.on('player-state-sync', onPlayerStateSync);
    socket.on('queue-update', onQueueUpdate);
    socket.on('player-tick', onPlayerTick);

    return () => {
      socket.off('player-state-sync', onPlayerStateSync);
      socket.off('queue-update', onQueueUpdate);
      socket.off('player-tick', onPlayerTick);
    };
  }, [socket]);

  const topQueue = queue.slice(0, 5);

  return (
    <div className="fixed inset-0 pointer-events-none p-12 flex flex-col items-center justify-center gap-10 overflow-hidden bg-transparent">
      <AnimatePresence mode="wait">
        {nowPlaying && (
          <motion.div
            key={nowPlaying.videoId}
            initial={{ y: 20, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -20, opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
            className="flex items-center gap-8 bg-[#151619]/95 backdrop-blur-3xl border border-white/20 p-7 rounded-[3rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.8)] overflow-hidden relative max-w-2xl w-full"
          >
            <div className="absolute -inset-20 bg-orange-500/20 blur-[120px] rounded-full mix-blend-screen animate-pulse" />
            
            <div className="relative w-36 h-36 rounded-[2rem] overflow-hidden shadow-2xl ring-2 ring-white/10 shrink-0">
              <img 
                src={nowPlaying.thumbnail} 
                className="w-full h-full object-cover scale-110"
                alt=""
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
              <div className="absolute bottom-4 left-4 p-2 bg-orange-500 text-black rounded-xl shadow-lg">
                <Music2 className="w-6 h-6" />
              </div>
            </div>

            <div className="flex flex-col gap-3 min-w-0 pr-6 flex-1">
              <div className="flex items-center gap-3">
                 <div className="flex gap-1.5 items-end h-4">
                    {[0,1,2].map(i => (
                        <motion.div 
                            key={i}
                            animate={{ height: ['40%', '100%', '40%'] }}
                            transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1 }}
                            className="w-1.5 bg-orange-500 rounded-full"
                        />
                    ))}
                 </div>
                 <span className="text-[12px] font-black uppercase tracking-[0.4em] text-orange-500">Now Playing</span>
              </div>
              
              <h2 className="text-3xl font-black italic tracking-tighter text-white leading-tight line-clamp-2 drop-shadow-2xl">
                {nowPlaying.title}
              </h2>
              
              <div className="flex items-center gap-4 text-xs font-bold text-white/50 uppercase tracking-[0.2em]">
                <span className="text-white/80 px-3 py-1 bg-white/5 rounded-full border border-white/10">Requested by {nowPlaying.requesterName || 'anonymous'}</span>
              </div>
            </div>

            <div className="absolute inset-x-0 bottom-0 h-2 bg-white/5">
                <motion.div 
                    className="h-full bg-orange-500 shadow-[0_0_20px_rgba(249,115,22,0.8)]"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, ((nowPlaying.currentTime || 0) / (nowPlaying.duration || 1)) * 100)}%` }}
                    transition={{ type: 'tween', ease: 'linear' }}
                />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {topQueue.length > 0 && (
          <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="flex flex-col items-center gap-5 w-full max-w-xl">
            <div className="flex items-center gap-6 w-full opacity-60">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                <span className="text-[11px] font-black uppercase tracking-[0.5em] text-white/60 whitespace-nowrap">Upcoming Tracklist</span>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
            </div>

            <div className="flex flex-col gap-3 w-full">
              {topQueue.map((item, index) => (
                <motion.div key={item.id} initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: index * 0.1 }} className="flex items-center gap-5 bg-[#151619]/80 backdrop-blur-xl border border-white/10 p-3.5 pr-6 rounded-[1.5rem] w-full group shadow-xl">
                  <span className="text-sm font-black text-orange-500/40 w-6 italic pl-2">{index + 1}</span>
                  <img src={item.thumbnail} className="w-24 h-14 object-cover rounded-xl shadow-lg ring-1 ring-white/10" alt="" />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold text-white truncate group-hover:text-orange-500 transition-colors">{item.title}</h3>
                    <p className="text-[10px] font-bold text-orange-500/80 uppercase tracking-widest truncate">{item.requesterName || 'anonymous'}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
