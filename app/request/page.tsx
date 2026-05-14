"use client";

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import debounce from 'lodash.debounce';
import { Search, Music, Clock, Play, User, ListMusic, Loader2, ThumbsUp, History as HistoryIcon, RotateCcw, X, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { getSocket } from '@/lib/socket';

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
  playCount?: number;
}

interface AppSettings {
  requestCooldownSeconds: number;
  maxQueueSize: number;
  allowDuplicateRequests: boolean;
  defaultVolume: number;
}

export default function RequestPage() {
  const socket = getSocket();
  const [query, setQuery] = useState('');
  const [username, setUsername] = useState('');
  const [userId, setUserId] = useState<string>('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [results, setResults] = useState<Video[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [history, setHistory] = useState<QueueItem[]>([]);
  const [nowPlaying, setNowPlaying] = useState<any>(null);
  const [cooldown, setCooldown] = useState(0);
  const [settings, setSettings] = useState<AppSettings>({
    requestCooldownSeconds: 30,
    maxQueueSize: 100,
    allowDuplicateRequests: false,
    defaultVolume: 0.5,
  });
  const [votedSongs, setVotedSongs] = useState<string[]>([]);
  const [mobileTab, setMobileTab] = useState<'playing' | 'queue' | 'history'>('playing');

  useEffect(() => {
    try {
      const raw = localStorage.getItem('requestSettings');
      if (raw) setSettings(prev => ({ ...prev, ...JSON.parse(raw) }));

      const savedName = localStorage.getItem('requesterName');
      if (savedName) setUsername(savedName);

      let savedUserId = localStorage.getItem('ss_userId');
      if (!savedUserId) {
        savedUserId = 'user_' + Math.random().toString(36).substring(2, 11);
        localStorage.setItem('ss_userId', savedUserId);
      }
      setUserId(savedUserId);
    } catch { }
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.emit('sync-state');
    socket.emit('get-history');

    const onQueueUpdate = (updatedQueue: QueueItem[]) => setQueue(updatedQueue);
    const onHistoryUpdate = (updatedHistory: QueueItem[]) => {
      setHistory(updatedHistory);
    };
    const onPlayerStateSync = (state: any) => setNowPlaying(state);
    const onPlayerTick = (tick: any) => {
      setNowPlaying((prev: any) => prev ? { ...prev, ...tick } : null);
    };
    const onSettingsUpdate = (next: AppSettings) => {
      setSettings(next);
      localStorage.setItem('requestSettings', JSON.stringify(next));
    };

    socket.on('queue-update', onQueueUpdate);
    socket.on('history-update', onHistoryUpdate);
    socket.on('player-state-sync', onPlayerStateSync);
    socket.on('player-tick', onPlayerTick);
    socket.on('settings-update', onSettingsUpdate);
    socket.on('username-set-success', (name) => setNameError(null));
    socket.on('username-set-error', (err) => {
      setNameError(err);
      toast.error(err);
    });
    socket.on('success-toast', (msg) => {
      toast.success(msg);
      startCooldown();
    });
    socket.on('error-toast', (msg) => toast.error(msg));

    return () => {
      socket.off('queue-update', onQueueUpdate);
      socket.off('history-update', onHistoryUpdate);
      socket.off('player-state-sync', onPlayerStateSync);
      socket.off('player-tick', onPlayerTick);
      socket.off('settings-update', onSettingsUpdate);
    };
  }, [socket]);

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
      if (remaining > 0) setCooldown(remaining);
    }
  }, []);

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setInterval(() => setCooldown(prev => prev - 1), 1000);
      return () => clearInterval(timer);
    }
  }, [cooldown]);

  useEffect(() => {
    if (!userId || !socket) return;
    const timer = setTimeout(() => {
      socket.emit('set-username', { username: (username || "anonymous").trim(), userId });
    }, 500);
    return () => clearTimeout(timer);
  }, [socket, userId, username]);

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
    if (queue.length >= settings.maxQueueSize) return toast.error('Queue is full');
    if (cooldown > 0) return toast.error(`Wait ${cooldown}s`);
    if (nameError) return toast.error(nameError);
    socket?.emit('request-song', { ...video, requesterName: username || 'anonymous', userId });
  };

  const handleVote = (id: string) => {
    if (votedSongs.includes(id)) return;
    socket?.emit('vote-song', id);
    const next = [...votedSongs, id];
    setVotedSongs(next);
    localStorage.setItem('votedSongs', JSON.stringify(next));
  };

  return (
    <>
      <div className="max-w-screen-2xl mx-auto px-3 lg:px-4 py-4 lg:py-8 space-y-6 lg:space-y-12 pb-28 lg:pb-8">

        <section className={`${mobileTab === 'playing' ? 'block' : 'hidden lg:block'} space-y-4 lg:space-y-6`}>
          <h1 className="text-3xl lg:text-4xl font-bold italic">Request <span className="text-orange-500">Music</span></h1>

          <div className="bg-[#151619] border border-white/10 rounded-2xl p-5 flex items-center gap-4 focus-within:border-orange-500/50">
            <User className="w-6 h-6 text-white/40" />
            <input
              type="text"
              placeholder="Your Name (Optional)"
              className="bg-transparent border-none outline-none text-white font-bold flex-1"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40 group-focus-within:text-orange-500 transition-colors" />
            <input
              type="text"
              placeholder="Search YouTube videos..."
              className="w-full bg-[#151619] border border-white/10 rounded-2xl py-4 pl-12 pr-12 outline-none focus:border-orange-500/50 transition-all text-white font-medium"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                onClick={() => {
                  setQuery('');
                  setResults([]);
                }}
                className="absolute right-12 top-1/2 -translate-y-1/2 p-2 hover:bg-white/10 rounded-xl transition-all text-white/20 hover:text-white"
                title="Clear Search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            {isSearching && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
              </div>
            )}
          </div>

          <AnimatePresence>
            {results.length > 0 && (
              <div className="bg-[#151619] border border-white/10 rounded-[2rem] overflow-hidden mt-6 shadow-2xl">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto p-3 custom-scrollbar"
                >
                  {results.map((video) => (
                    <button
                      key={video.videoId}
                      onClick={() => handleRequest(video)}
                      className="w-full flex items-center gap-4 p-3 bg-white/[0.03] border border-white/5 rounded-2xl hover:bg-white/10 hover:border-orange-500/30 text-left group transition-all"
                    >
                      <div className="relative shrink-0">
                        <img src={video.thumbnail} className="w-24 h-14 object-cover rounded-xl shadow-lg" />
                        <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors rounded-xl" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-sm lg:text-base truncate group-hover:text-orange-500 transition-colors leading-tight mb-1">{video.title}</h4>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-white/20 font-black uppercase tracking-[0.2em]">YouTube</span>
                          <span className="w-1 h-1 rounded-full bg-white/10" />
                          <span className="text-[10px] text-orange-500/60 font-bold uppercase">Ready</span>
                        </div>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center group-hover:bg-orange-500 transition-all shrink-0">
                        <Play className="w-5 h-5 text-orange-500 group-hover:text-black group-hover:fill-current transition-colors" />
                      </div>
                    </button>
                  ))}
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Now Playing - Mobile Integrated */}
          <div className="lg:hidden pt-4">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/40 mb-4">
              <Play className="w-3 h-3" /> Currently Streaming
            </div>
            <div className="bg-[#151619] rounded-[2rem] border border-white/10 p-6 shadow-2xl relative overflow-hidden group">
              {nowPlaying ? (
                <div className="space-y-5">
                  <div className="aspect-video rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 relative">
                    <img src={nowPlaying.thumbnail} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-black italic uppercase text-white leading-tight">
                      {nowPlaying.title}
                    </h3>
                    <div className="flex items-center gap-3">
                      <div className="text-[9px] font-black text-orange-500 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-full uppercase tracking-widest flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-ping" /> Live
                      </div>
                      <div className="text-[9px] font-bold text-white/40 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full uppercase tracking-widest">
                        {nowPlaying.requesterName || 'anonymous'}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="aspect-video flex flex-col items-center justify-center text-white/5 italic text-sm">
                  <Music className="w-12 h-12 mb-3 opacity-10" />
                  <p>Stream Offline</p>
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Desktop Now Playing */}
          <section className="hidden lg:block space-y-6">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white/40">
              <Play className="w-4 h-4" /> Now Playing
            </div>
            <div className="bg-[#151619] rounded-[2.5rem] border border-white/10 p-8 shadow-2xl relative overflow-hidden group">
              {nowPlaying ? (
                <div className="space-y-6">
                  <div className="aspect-video rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10">
                    <img src={nowPlaying.thumbnail} className="w-full h-full object-cover" />
                  </div>
                  <h3 className="text-2xl font-black italic uppercase text-white group-hover:text-orange-500 transition-colors">
                    {nowPlaying.title}
                  </h3>
                  <div className="flex items-center gap-3">
                    <div className="text-[10px] font-black text-orange-500 bg-orange-500/10 border border-orange-500/20 px-3 py-1 rounded-full uppercase tracking-widest flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-orange-500 animate-ping" /> Live
                    </div>
                    <div className="text-[10px] font-bold text-white/40 bg-white/5 border border-white/10 px-3 py-1 rounded-full uppercase tracking-widest">
                      {nowPlaying.requesterName || 'anonymous'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="aspect-video flex flex-col items-center justify-center text-white/10 italic">
                  <Music className="w-16 h-16 mb-4 opacity-5" />
                  <p>System Idle</p>
                </div>
              )}
            </div>
          </section>

          {/* Queue */}
          <section className={`${mobileTab === 'queue' ? 'block' : 'hidden lg:block'} space-y-6`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white/40">
                <ListMusic className="w-4 h-4" /> Upcoming Queue
              </div>
              <span className="text-[10px] font-black bg-white/5 px-2 py-0.5 rounded-lg text-white/20 uppercase tracking-widest">
                {queue.length} Tracks
              </span>
            </div>
            <div className="space-y-3">
              {queue.map((item, index) => (
                <div key={item.id} className="flex items-center gap-3 lg:gap-4 p-3 lg:p-4 bg-white/[0.03] border border-white/5 rounded-2xl group hover:bg-white/[0.06] transition-all overflow-hidden">
                  <img src={item.thumbnail} className="w-16 lg:w-20 h-10 lg:h-12 object-cover rounded-lg shadow-lg shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-xs lg:text-base truncate group-hover:text-orange-500">{item.title}</h4>
                    <p className="text-[10px] font-bold text-white/40 uppercase truncate">{item.requesterName || 'anon'}</p>
                  </div>
                  <button onClick={() => handleVote(item.id)} className={`p-2.5 lg:p-3 rounded-xl shrink-0 transition-all ${votedSongs.includes(item.id) ? 'bg-orange-500 text-black shadow-lg shadow-orange-500/20' : 'bg-white/5 text-white/20 hover:text-white/40 hover:bg-white/10'}`}>
                    <ThumbsUp className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
                  </button>
                </div>
              ))}
              {queue.length === 0 && (
                <div className="py-20 flex flex-col items-center justify-center text-white/5 italic text-sm gap-4 bg-white/[0.01] rounded-[2rem] border border-dashed border-white/5">
                  <ListMusic className="w-12 h-12 opacity-5" />
                  <p>Queue is empty</p>
                </div>
              )}
            </div>
          </section>

          {/* History Tab */}
          <section className={`${mobileTab === 'history' ? 'block' : 'hidden'} space-y-6 lg:col-span-2`}>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white/40">
              <HistoryIcon className="w-4 h-4" /> Recently Played
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {history.map((item) => (
                <div key={item.id} className="flex items-center gap-3 lg:gap-4 p-3 lg:p-4 bg-white/[0.03] border border-white/5 rounded-2xl group hover:border-orange-500/30 transition-all overflow-hidden">
                  <img src={item.thumbnail} className="w-16 lg:w-20 h-10 lg:h-12 object-cover rounded-lg opacity-40 shrink-0 group-hover:opacity-60 transition-opacity" />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-xs lg:text-base truncate text-white/60 group-hover:text-white transition-colors">{item.title}</h4>
                    <div className="flex items-center gap-2">
                      <RotateCcw className="w-3 h-3 text-orange-500/40" />
                      <p className="text-[10px] font-bold text-white/20 uppercase">Played</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleRequest({ videoId: item.videoId, title: item.title, thumbnail: item.thumbnail })}
                    className="p-2.5 lg:p-3 bg-white/5 hover:bg-orange-500 text-white/20 hover:text-black rounded-xl transition-all shrink-0 group/btn"
                    title="Request Again"
                  >
                    <Plus className="w-3.5 h-3.5 lg:w-4 lg:h-4 group-hover/btn:scale-110 transition-transform" />
                  </button>
                </div>
              ))}
              {history.length === 0 && <p className="col-span-full text-center py-20 text-white/10 italic">No history yet</p>}
            </div>
          </section>
        </div>

        <AnimatePresence>
          {cooldown > 0 && (
            <motion.div initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }} className="fixed bottom-24 lg:bottom-8 left-1/2 -translate-x-1/2 z-[70]">
              <div className="bg-orange-500 text-black px-6 py-3 rounded-full font-black flex items-center gap-3 shadow-2xl shadow-orange-500/20 whitespace-nowrap">
                <Clock className="w-5 h-5" />
                COOLDOWN: {Math.floor(cooldown / 60)}:{Math.floor(cooldown % 60).toString().padStart(2, '0')}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-[#0a0a0a]/90 backdrop-blur-2xl border-t border-white/10 z-[60] flex items-center justify-around p-2 pb-safe shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        <button
          onClick={() => setMobileTab('playing')}
          className={`flex-1 flex flex-col items-center gap-1 py-2 transition-all ${mobileTab === 'playing' ? 'text-orange-500' : 'text-white/20'}`}
        >
          <Play className={`w-5 h-5 ${mobileTab === 'playing' ? 'fill-current' : ''}`} />
          <span className="text-[10px] font-black uppercase tracking-widest">Live</span>
        </button>
        <button
          onClick={() => setMobileTab('queue')}
          className={`flex-1 flex flex-col items-center gap-1 py-2 transition-all ${mobileTab === 'queue' ? 'text-orange-500' : 'text-white/20'}`}
        >
          <div className="relative">
            <ListMusic className="w-5 h-5" />
            {queue.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-500 text-black text-[8px] font-black rounded-full flex items-center justify-center">
                {queue.length}
              </span>
            )}
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest">Queue</span>
        </button>
        <button
          onClick={() => setMobileTab('history')}
          className={`flex-1 flex flex-col items-center gap-1 py-2 transition-all ${mobileTab === 'history' ? 'text-orange-500' : 'text-white/20'}`}
        >
          <HistoryIcon className="w-5 h-5" />
          <span className="text-[10px] font-black uppercase tracking-widest">Recent</span>
        </button>
      </div>
    </>
  );
}
