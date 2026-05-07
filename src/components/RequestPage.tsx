import React, { useState, useEffect, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import axios from 'axios';
import debounce from 'lodash.debounce';
import { Search, Music, Clock, Play, User, ListMusic, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

interface RequestPageProps {
  socket: Socket;
}

interface Video {
  videoId: string;
  title: string;
  thumbnail: string;
}

interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  thumbnail: string;
  requesterIp: string;
  timestamp: string;
}

interface AppSettings {
  requestCooldownSeconds: number;
  maxQueueSize: number;
  allowDuplicateRequests: boolean;
  defaultVolume: number;
}

export default function RequestPage({ socket }: RequestPageProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Video[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [nowPlaying, setNowPlaying] = useState<any>(null);
  const [cooldown, setCooldown] = useState(0);
  const [settings, setSettings] = useState<AppSettings>({
    requestCooldownSeconds: 180,
    maxQueueSize: 100,
    allowDuplicateRequests: false,
    defaultVolume: 0.5,
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem('requestSettings');
      if (!raw) return;
      const saved = JSON.parse(raw);
      setSettings(prev => ({ ...prev, ...saved }));
    } catch {
      // ignore invalid local data
    }
  }, []);

  // Sync now playing and queue
  useEffect(() => {
    socket.on('queue-update', (updatedQueue: QueueItem[]) => {
      setQueue(updatedQueue);
    });

    socket.on('player-state-sync', (state) => {
      setNowPlaying(state);
    });

    socket.on('success-toast', (msg) => {
      toast.success(msg);
      startCooldown();
    });

    socket.on('error-toast', (msg) => {
      toast.error(msg);
    });

    socket.on('settings-update', (nextSettings: AppSettings) => {
      setSettings(nextSettings);
      localStorage.setItem('requestSettings', JSON.stringify(nextSettings));
    });

    return () => {
      socket.off('queue-update');
      socket.off('player-state-sync');
      socket.off('success-toast');
      socket.off('error-toast');
      socket.off('settings-update');
    };
  }, [socket, settings.requestCooldownSeconds]);

  const startCooldown = () => {
    const duration = settings.requestCooldownSeconds;
    if (duration <= 0) return;
    setCooldown(duration);
    localStorage.setItem('requestCooldown', (Date.now() + duration * 1000).toString());
  };

  useEffect(() => {
    const expiry = localStorage.getItem('requestCooldown');
    if (expiry) {
      const remaining = Math.round((parseInt(expiry) - Date.now()) / 1000);
      if (remaining > 0) {
        setCooldown(remaining);
      }
    }
  }, []);

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setInterval(() => {
        setCooldown(prev => prev - 1);
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [cooldown]);

  const searchYouTube = useCallback(
    debounce(async (val: string) => {
      if (!val) {
        setResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const response = await axios.get('/api/youtube/search', { params: { q: val } });
        setResults(response.data);
      } catch (err) {
        toast.error("Failed to search YouTube");
      } finally {
        setIsSearching(false);
      }
    }, 500),
    []
  );

  useEffect(() => {
    searchYouTube(query);
  }, [query, searchYouTube]);

  const handleRequest = (video: Video) => {
    if (queue.length >= settings.maxQueueSize) {
      toast.error('Queue is full. Please try again later.');
      return;
    }

    if (!settings.allowDuplicateRequests) {
      const exists = queue.some(item => item.videoId === video.videoId);
      if (exists) {
        toast.error('This song is already in queue.');
        return;
      }
    }

    if (cooldown > 0) {
      toast.error(`Please wait ${cooldown}s before requesting again.`);
      return;
    }
    socket.emit('request-song', video);
    setQuery('');
    setResults([]);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 lg:py-8 space-y-8 lg:space-y-12 pb-32">
      {/* Search Header */}
      <section className="space-y-4 lg:space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-center lg:text-left">Request <span className="text-orange-500">Music</span></h1>
          <p className="text-sm lg:text-base text-white/60 text-center lg:text-left">Search and add songs to the live stream queue.</p>
        </div>

        <div className="relative group">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-white/40 group-focus-within:text-orange-500 transition-colors">
            <Search className="w-5 h-5" />
          </div>
          <input
            type="text"
            placeholder="Search YouTube videos..."
            className="w-full bg-[#151619] border border-white/10 rounded-2xl py-3 lg:py-4 pl-12 pr-4 outline-none focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/10 transition-all text-base lg:text-lg"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {isSearching && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
            </div>
          )}
        </div>

        <AnimatePresence>
          {results.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="grid gap-2 lg:gap-3"
            >
              {results.map((video) => (
                <button
                  key={video.videoId}
                  onClick={() => handleRequest(video)}
                  disabled={cooldown > 0}
                  className="flex items-center gap-3 lg:gap-4 p-2 lg:p-3 bg-[#151619] border border-white/10 rounded-xl hover:bg-white/5 hover:border-white/20 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <img 
                    src={video.thumbnail} 
                    alt="" 
                    className="w-20 lg:w-24 h-12 lg:h-14 object-cover rounded-md shrink-0" 
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`;
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium truncate group-hover:text-orange-500 transition-colors text-sm lg:text-base">{video.title}</h4>
                    <p className="text-[10px] lg:text-xs text-white/40 mt-0.5 lg:mt-1 uppercase tracking-wider font-semibold">YouTube Video</p>
                  </div>
                  <div className="px-2 lg:px-4 shrink-0">
                    <Play className="w-4 h-4 lg:w-5 lg:h-5 text-orange-500 opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-1" />
                  </div>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
        {/* Now Playing */}
        <section className="space-y-4 lg:space-y-6">
          <div className="flex items-center gap-2 text-xs lg:text-sm font-bold uppercase tracking-widest text-white/40">
            <Play className="w-4 h-4" /> Now Playing
          </div>

          <div className="bg-[#151619] rounded-[2rem] border border-white/10 p-4 lg:p-6 overflow-hidden relative">
            {nowPlaying ? (
              <div className="space-y-4">
                <div className="aspect-video rounded-xl lg:rounded-2xl overflow-hidden bg-black/40">
                  <img 
                    src={nowPlaying.thumbnail || `https://img.youtube.com/vi/${nowPlaying.videoId}/maxresdefault.jpg`} 
                    className="w-full h-full object-cover" 
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${nowPlaying.videoId}/mqdefault.jpg`;
                    }}
                  />
                </div>
                <div>
                  <h3 className="text-lg lg:text-xl font-bold line-clamp-2 leading-tight uppercase tracking-tight">{nowPlaying.title || 'Loading...'}</h3>
                </div>
              </div>
            ) : (
              <div className="aspect-video rounded-xl lg:rounded-2xl bg-white/5 flex flex-col items-center justify-center text-white/20">
                <Music className="w-10 h-10 lg:w-12 lg:h-12 mb-4 animate-pulse" />
                <p className="text-xs lg:text-sm font-medium">Nothing is playing right now</p>
              </div>
            )}
          </div>
        </section>

        {/* Queue */}
        <section className="space-y-4 lg:space-y-6">
          <div className="flex items-center gap-2 text-xs lg:text-sm font-bold uppercase tracking-widest text-white/40">
            <ListMusic className="w-4 h-4" /> Upcoming Queue
          </div>

          <div className="space-y-2 lg:space-y-3">
            {queue.length > 0 ? (
              queue.map((item, index) => (
                <div key={item.id} className="flex items-center gap-3 lg:gap-4 p-3 lg:p-4 bg-white/5 rounded-xl lg:rounded-2xl border border-white/5">
                  <span className="text-[10px] lg:text-xs font-bold text-orange-500/50 w-4 lg:w-5">{(index + 1).toString().padStart(2, '0')}</span>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium truncate text-xs lg:text-sm">{item.title}</h4>
                    <div className="flex items-center gap-2 mt-0.5 lg:mt-1 text-[9px] lg:text-[10px] uppercase font-bold text-white/30 tracking-widest">
                      <User className="w-2.5 h-2.5 lg:w-3 lg:h-3" /> Requested by IP {item.requesterIp.slice(-4)}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-12 border-2 border-dashed border-white/5 rounded-[2rem] flex flex-col items-center justify-center text-white/20 text-center px-6">
                <p className="text-sm font-medium">The queue is empty</p>
                <p className="text-xs">Be the first to request a song!</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Floating Cooldown UI */}
      <AnimatePresence>
        {cooldown > 0 && (
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-6 lg:bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-none w-full max-w-xs lg:max-w-none px-4 lg:px-0"
          >
            <div className="bg-orange-500 text-black px-4 lg:px-6 py-2.5 lg:py-3 rounded-full font-bold flex items-center justify-center gap-3 shadow-2xl shadow-orange-500/20 text-xs lg:text-base">
              <Clock className="w-4 h-4 lg:w-5 lg:h-5 animate-pulse" />
              <span className="truncate">Request Cooldown: {Math.floor(cooldown / 60)}:{Math.floor(cooldown % 60).toString().padStart(2, '0')}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
