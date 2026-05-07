import React, { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { Music2 } from 'lucide-react';

interface OverlayPageProps {
  socket: Socket;
}

interface PlayerState {
  videoId: string;
  title: string;
  playing: boolean;
  currentTime: number;
}

export default function OverlayPage({ socket }: OverlayPageProps) {
  const [nowPlaying, setNowPlaying] = useState<any | null>(null);

  useEffect(() => {
    socket.on('player-state-sync', (state: any) => {
      setNowPlaying(state);
    });

    return () => {
      socket.off('player-state-sync');
    };
  }, [socket]);

  return (
    <div className="fixed inset-0 pointer-events-none p-8 flex items-end justify-start overflow-hidden bg-transparent">
      <AnimatePresence mode="wait">
        {nowPlaying && (
          <motion.div
            key={nowPlaying.videoId}
            initial={{ x: -100, opacity: 0, scale: 0.8 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            exit={{ x: -50, opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
            transition={{ type: 'spring', damping: 20, stiffness: 100 }}
            className="flex items-center gap-6 bg-[#151619]/95 backdrop-blur-xl border border-white/10 p-5 rounded-[2rem] shadow-2xl shadow-black/50 overflow-hidden relative group"
          >
            {/* Animated Glow Background */}
            <div className="absolute -inset-20 bg-orange-500/10 blur-[100px] rounded-full mix-blend-screen" />
            
            {/* Thumbnail */}
            <div className="relative w-24 h-24 rounded-2xl overflow-hidden shadow-xl ring-1 ring-white/10 shrink-0">
              <img 
                src={nowPlaying.thumbnail || `https://img.youtube.com/vi/${nowPlaying.videoId}/mqdefault.jpg`} 
                className="w-full h-full object-cover scale-110 group-hover:scale-125 transition-transform duration-700"
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${nowPlaying.videoId}/mqdefault.jpg`;
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-2 left-2 p-1 bg-orange-500 text-black rounded-lg">
                <Music2 className="w-4 h-4" />
              </div>
            </div>

            {/* Song Info */}
            <div className="flex flex-col gap-2 min-w-0 pr-4">
              <div className="flex items-center gap-2">
                 <div className="flex gap-1 items-end h-3">
                    {[0,1,2].map(i => (
                        <motion.div 
                            key={i}
                            animate={{ height: ['40%', '100%', '40%'] }}
                            transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1 }}
                            className="w-1 bg-orange-500 rounded-full"
                        />
                    ))}
                 </div>
                 <span className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-500">Now Playing</span>
              </div>
              
              <h2 className="text-xl font-black italic tracking-tighter text-white leading-none line-clamp-1 drop-shadow-md">
                {nowPlaying.title}
              </h2>
              
              <div className="flex items-center gap-3 text-xs font-bold text-white/40 uppercase tracking-widest">
                <span>YouTube Media</span>
                <span className="w-1 h-1 rounded-full bg-white/20" />
                <span className="text-white/60">Live Request</span>
              </div>
            </div>

            {/* Progress indicator border */}
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/5">
                <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 60, ease: 'linear' }} // Mock for visuals
                    className="h-full bg-orange-500"
                />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
