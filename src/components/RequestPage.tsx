import React, { useState, useEffect, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import axios from 'axios';
import debounce from 'lodash.debounce';
import { Search, Music, Clock, Play, User, ListMusic, Loader2, ThumbsUp } from 'lucide-react';
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
  requesterName: string;
  timestamp: string;
  votes: number;
}

interface AppSettings {
  requestCooldownSeconds: number;
  maxQueueSize: number;
  allowDuplicateRequests: boolean;
  defaultVolume: number;
}

const formatTime = (seconds: number) => {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export default function RequestPage({ socket }: RequestPageProps) {
  const [query, setQuery] = useState('');
  const [username, setUsername] = useState('');
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
  const [votedSongs, setVotedSongs] = useState<string[]>([]);
  const [mobileTab, setMobileTab] = useState<'playing' | 'queue'>('playing');

  useEffect(() => {
    try {
      const raw = localStorage.getItem('requestSettings');
      if (raw) {
        const saved = JSON.parse(raw);
        setSettings(prev => ({ ...prev, ...saved }));
      }

      const savedName = localStorage.getItem('requesterName');
      if (savedName) {
        setUsername(savedName);
      }
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

  useEffect(() => {
    const saved = localStorage.getItem('votedSongs');
    if (saved) setVotedSongs(JSON.parse(saved));
  }, []);

  const handleVote = (id: string) => {
    if (votedSongs.includes(id)) return;
    socket.emit('vote-song', id);
    const next = [...votedSongs, id];
    setVotedSongs(next);
    localStorage.setItem('votedSongs', JSON.stringify(next));
  };

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
    }, 800),
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
    socket.emit('request-song', { ...video, requesterName: username || 'anonymous' });
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

        {/* Username Input */}
        <div className="bg-[#151619] border border-white/10 rounded-2xl p-4 lg:p-5 flex items-center gap-4 focus-within:border-orange-500/50 transition-all">
          <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center shrink-0">
            <User className="w-6 h-6 text-white/40" />
          </div>
          <div className="flex-1 min-w-0">
            <label className="text-[10px] lg:text-xs uppercase font-black text-white/75 tracking-widest block mb-1">Your Name (Optional)</label>
            <input
              type="text"
              placeholder="anonymous"
              className="w-full bg-transparent border-none outline-none text-white font-bold p-0 focus:ring-0 placeholder:text-white/20 text-base lg:text-lg"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                localStorage.setItem('requesterName', e.target.value);
              }}
            />
          </div>
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
                  className="flex items-center gap-4 p-3 lg:p-4 bg-[#151619] border border-white/10 rounded-2xl hover:bg-white/5 hover:border-white/20 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                >
                  <img
                    src={video.thumbnail}
                    alt=""
                    className="w-24 lg:w-32 h-14 lg:h-18 object-cover rounded-xl shrink-0 shadow-md"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`;
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold truncate group-hover:text-orange-500 transition-colors text-base lg:text-lg">{video.title}</h4>
                    <p className="text-xs text-white/40 mt-1 uppercase tracking-wider font-bold">YouTube Video</p>
                  </div>
                  <div className="px-2 lg:px-4 shrink-0">
                    <Play className="w-5 h-5 lg:w-6 lg:h-6 text-orange-500 transform group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <div className="space-y-6 lg:space-y-0">
        {/* Mobile Tab Switcher */}
        <div className="flex lg:hidden bg-[#151619] border border-white/10 p-1 rounded-2xl">
          <button
            onClick={() => setMobileTab('playing')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all ${mobileTab === 'playing' ? 'bg-orange-500 text-black shadow-lg shadow-orange-500/20' : 'text-white/40'}`}
          >
            <Play className="w-4 h-4" />
            Playing
          </button>
          <button
            onClick={() => setMobileTab('queue')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all ${mobileTab === 'queue' ? 'bg-orange-500 text-black shadow-lg shadow-orange-500/20' : 'text-white/40'}`}
          >
            <ListMusic className="w-4 h-4" />
            Queue ({queue.length})
          </button>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Now Playing */}
          <section className={`space-y-4 lg:space-y-6 ${mobileTab === 'playing' ? 'block animate-in fade-in slide-in-from-bottom-2 duration-300' : 'hidden lg:block'}`}>
            <div className="hidden lg:flex items-center gap-2 text-xs lg:text-sm font-bold uppercase tracking-widest text-white/40">
              <Play className="w-4 h-4" /> Now Playing
            </div>

            <div className="bg-[#151619] rounded-[2rem] border border-white/10 p-5 lg:p-8 overflow-hidden relative shadow-2xl group transition-all">
              {/* Background Glow */}
              {nowPlaying && (
                <div className="absolute inset-0 opacity-10 blur-3xl -z-10 group-hover:opacity-20 transition-opacity duration-1000">
                  <img src={nowPlaying.thumbnail} alt="" className="w-full h-full object-cover scale-150" />
                </div>
              )}

              {nowPlaying ? (
                <div className="flex flex-col gap-5 lg:gap-6">
                  <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black/40 shrink-0 shadow-[0_20px_50px_rgba(0,0,0,0.5)] ring-1 ring-white/10 relative group/image">
                    <img
                      src={nowPlaying.thumbnail || `https://img.youtube.com/vi/${nowPlaying.videoId}/maxresdefault.jpg`}
                      className="w-full h-full object-cover transition-transform duration-700 group-hover/image:scale-105"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${nowPlaying.videoId}/mqdefault.jpg`;
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 lg:opacity-80" />
                    
                    {nowPlaying.playing && (
                      <div className="absolute bottom-4 left-4 flex items-end gap-1">
                        <motion.div animate={{ height: [8, 20, 8] }} transition={{ repeat: Infinity, duration: 0.8 }} className="w-1.5 bg-orange-500 rounded-full" />
                        <motion.div animate={{ height: [12, 24, 12] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.2 }} className="w-1.5 bg-orange-500 rounded-full" />
                        <motion.div animate={{ height: [8, 16, 8] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.4 }} className="w-1.5 bg-orange-500 rounded-full" />
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1 w-full min-w-0 flex flex-col justify-center space-y-4 lg:space-y-5 text-left">
                    <div className="space-y-2.5">
                      <h3 className="text-xl lg:text-2xl font-black line-clamp-2 leading-tight uppercase tracking-tight italic text-white drop-shadow-lg transition-colors group-hover:text-orange-500/90">
                        {nowPlaying.title || 'Loading...'}
                      </h3>
                      
                      <div className="flex flex-wrap items-center gap-2 lg:gap-3 justify-start">
                        <div className="text-[10px] lg:text-xs font-black text-orange-500 bg-orange-500/10 border border-orange-500/20 px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-orange-500 animate-ping" />
                          Live Now
                        </div>
                        <div className={`text-[10px] lg:text-xs font-bold ${nowPlaying.requesterName === 'Admin' ? 'text-orange-500 bg-orange-500/10 border-orange-500/20' : 'text-white/40 bg-white/5 border-white/10'} border px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-2`}>
                          <User className="w-3 h-3" />
                          {nowPlaying.requesterName === 'Admin' ? 'Added by Admin' : (nowPlaying.requesterName || 'anonymous')}
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-2 pt-2 lg:pt-4">
                      <div className="h-1.5 lg:h-2 bg-white/5 rounded-full overflow-hidden relative cursor-not-allowed">
                        <div 
                          className="absolute top-0 left-0 h-full bg-gradient-to-r from-orange-600 to-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.5)] transition-all duration-1000 ease-linear rounded-full"
                          style={{ width: `${Math.min(100, ((nowPlaying.currentTime || 0) / (nowPlaying.duration || 1)) * 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] lg:text-xs font-bold text-white/40 uppercase tracking-widest">
                        <span className="font-mono">{formatTime(nowPlaying.currentTime)}</span>
                        <span className="font-mono">{formatTime(nowPlaying.duration)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="aspect-video rounded-xl lg:rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col items-center justify-center text-white/20 transition-all hover:bg-white/[0.04]">
                  <Music className="w-10 h-10 lg:w-16 lg:h-16 mb-4 opacity-50" />
                  <p className="text-xs lg:text-sm font-black uppercase tracking-widest">System Idle</p>
                  <p className="text-[10px] lg:text-xs font-medium text-white/10 mt-1">Awaiting playback sequence</p>
                </div>
              )}
            </div>
          </section>

          {/* Queue */}
          <section className={`space-y-4 lg:space-y-6 ${mobileTab === 'queue' ? 'block animate-in fade-in slide-in-from-bottom-2 duration-300' : 'hidden lg:block'}`}>
            <div className="hidden lg:flex items-center gap-2 text-xs lg:text-sm font-bold uppercase tracking-widest text-white/40 px-2">
              <ListMusic className="w-4 h-4" /> Upcoming Queue
            </div>

            <div className="space-y-3">
              {queue.length > 0 ? (
                queue.map((item, index) => (
                  <div key={item.id} className="flex items-center gap-3 p-3 bg-white/[0.03] hover:bg-white/[0.06] rounded-2xl transition-all group/item border border-white/5 shadow-sm">
                    {/* Image Container - Better sizing for mobile */}
                    <div className="relative shrink-0">
                      <img
                        src={item.thumbnail}
                        alt=""
                        className="w-16 h-10 sm:w-20 sm:h-12 object-cover rounded-lg shadow-lg ring-1 ring-white/10 transition-transform group-hover/item:scale-105"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`;
                        }}
                      />
                      {/* Mobile-only Index Badge */}
                      <div className="absolute -top-1.5 -left-1.5 bg-orange-500 text-black w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black italic shadow-lg lg:hidden">
                        {index + 1}
                      </div>
                    </div>

                    {/* Metadata - Improved spacing */}
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <h4 className="font-bold truncate text-sm sm:text-base group-hover/item:text-orange-500 transition-colors leading-snug">
                        {item.title}
                      </h4>

                      <div className="flex items-center gap-2 mt-1">
                        <div className={`flex items-center gap-1 text-[10px] font-bold ${item.requesterName === 'Admin' ? 'text-orange-500' : 'text-white/30'} uppercase tracking-wider shrink-0`}>
                          <User className="w-2.5 h-2.5" />
                          <span className="truncate max-w-[80px] sm:max-w-[120px]">
                            {item.requesterName === 'Admin' ? 'Added by Admin' : (item.requesterName || 'anon')}
                          </span>
                        </div>
                        <span className="text-white/10 text-[10px]">•</span>
                        <div className="text-[10px] font-black text-orange-500/60 uppercase tracking-widest whitespace-nowrap">
                          {item.votes} {item.votes === 1 ? 'vote' : 'votes'}
                        </div>
                      </div>
                    </div>

                    {/* Vote Button - Larger touch target for mobile */}
                    <button
                      onClick={() => handleVote(item.id)}
                      disabled={votedSongs.includes(item.id)}
                      className={`p-3 rounded-xl shrink-0 transition-all ${votedSongs.includes(item.id)
                        ? 'bg-orange-500 text-black shadow-lg shadow-orange-500/20'
                        : 'bg-white/5 text-white/40 hover:text-white hover:bg-white/10 active:scale-95'
                        }`}
                    >
                      <ThumbsUp className={`w-4 h-4 ${votedSongs.includes(item.id) ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                ))
              ) : (
                <div className="py-12 border-2 border-dashed border-white/5 rounded-[2rem] flex flex-col items-center justify-center text-white/20 text-center px-6">
                  <Music className="w-10 h-10 mb-3 opacity-20" />
                  <p className="text-sm font-bold uppercase tracking-widest">Queue Empty</p>
                  <p className="text-xs text-white/10 mt-1">Request a song to start the party!</p>
                </div>
              )}
            </div>
          </section>
        </div>
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
