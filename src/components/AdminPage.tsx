import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { Socket } from 'socket.io-client';
import axios from 'axios';
import debounce from 'lodash.debounce';

import ReactPlayer from 'react-player';

const PlayerFallback = () => {
  useEffect(() => {
    console.log('[Admin] Player placeholder mounted');
    return () => console.log('[Admin] Player placeholder unmounted');
  }, []);
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-white/10 gap-4 bg-black">
      <Loader2 className="w-12 h-12 animate-spin opacity-20" />
      <p className="text-[10px] font-bold uppercase tracking-widest opacity-20">Loading Player...</p>
    </div>
  );
};
import {
  Trash2, ListMusic, LayoutGrid, GripVertical,
  Ban, Music2, Search, History,
  SkipForward, Loader2, UserMinus, RotateCcw, Plus, Play, ShieldCheck, Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import toast from 'react-hot-toast';

interface AdminPageProps {
  socket: Socket;
}

interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  thumbnail: string;
  requesterName: string;
  status: string;
  votes: number;
  playCount?: number;
}

interface AppSettings {
  requestCooldownSeconds: number;
  maxQueueSize: number;
  allowDuplicateRequests: boolean;
  defaultVolume: number;
}

interface VideoResult {
  videoId: string;
  title: string;
  thumbnail: string;
}

function SortableItem({ item, onDelete, onBanVideo }: {
  item: QueueItem;
  onDelete: (id: string) => void;
  onBanVideo: (videoId: string, title: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 0,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-[#151619] border border-white/10 rounded-2xl transition-all ${isDragging ? 'shadow-2xl shadow-black ring-1 ring-orange-500/50' : 'hover:border-white/20'}`}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-white/20 hover:text-white/40 transition-colors shrink-0">
        <GripVertical className="w-5 h-5" />
      </div>
      <img src={item.thumbnail} alt="" className="w-14 sm:w-16 h-8 sm:h-10 object-cover rounded-lg shrink-0" />
      <div className="flex-1 min-w-0">
        <h4 className="font-medium truncate text-xs sm:text-sm">{item.title}</h4>
        <div className="flex items-center gap-2 mt-0.5">
          <p className={`text-[10px] uppercase font-bold ${item.requesterName === 'Admin' ? 'text-orange-500' : 'text-white/75'} tracking-widest truncate`}>
            {item.requesterName === 'Admin' ? 'Admin' : (item.requesterName || 'anonymous')}
          </p>
          <span className="text-white/10 text-[10px]">•</span>
          <p className="text-[10px] font-black text-orange-500 whitespace-nowrap">{item.votes} votes</p>
          {(item.playCount ?? 0) >= 1 && (
            <>
              <span className="text-white/10 text-[10px]">•</span>
              <div className="flex items-center gap-1 text-orange-500/80">
                <RotateCcw className="w-2.5 h-2.5" />
                <span className="text-[10px] font-black uppercase tracking-widest">{item.playCount}x Played</span>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 lg:opacity-0 lg:group-hover:opacity-100 transition-all shrink-0">
        <button
          onClick={() => onBanVideo(item.videoId, item.title)}
          title="Ban Video"
          className="p-2 text-white/40 lg:text-white/20 hover:text-orange-500 hover:bg-orange-500/10 rounded-xl transition-all"
        >
          <Ban className="w-4 h-4" />
        </button>
        <button
          onClick={() => onDelete(item.id)}
          title="Remove"
          className="p-2 text-white/40 lg:text-white/20 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function AdminPage({ socket }: AdminPageProps) {
  const ReactPlayerAny = ReactPlayer as any;
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSocketAuthenticated, setIsSocketAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [activeTab, setActiveTab] = useState<'main' | 'history'>('main');
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [history, setHistory] = useState<QueueItem[]>([]);
  const [blacklist, setBlacklist] = useState<any[]>([]);
  const [isBlacklistModalOpen, setIsBlacklistModalOpen] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<QueueItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [volume, setVolume] = useState(0.5);
  const [sidebarWidth, setSidebarWidth] = useState(500);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [mobileActiveTab, setMobileActiveTab] = useState<'playback' | 'queue'>('playback');
  const [masterSocketId, setMasterSocketId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  const isMaster = socket.id ? (socket.id === masterSocketId) : false;

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<VideoResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [settings, setSettings] = useState<AppSettings>({
    requestCooldownSeconds: 180,
    maxQueueSize: 100,
    allowDuplicateRequests: false,
    defaultVolume: 0.5,
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const playerRef = useRef<any>(null);
  const lastSkippedId = useRef<string | null>(null);

  const isMasterRef = useRef(isMaster);
  useEffect(() => {
    isMasterRef.current = isMaster;
  }, [isMaster]);

  const isSocketAuthenticatedRef = useRef(isSocketAuthenticated);
  useEffect(() => {
    isSocketAuthenticatedRef.current = isSocketAuthenticated;
  }, [isSocketAuthenticated]);

  const currentVideoRef = useRef(currentVideo);
  useEffect(() => {
    currentVideoRef.current = currentVideo;
  }, [currentVideo]);


  // Keep-alive hack: Play nearly silent audio to prevent background throttling
  useEffect(() => {
    let ctx: AudioContext | null = null;
    let osc: OscillatorNode | null = null;

    const startKeepAlive = () => {
      if (ctx) return;
      try {
        ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.001; // nearly silent
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
      } catch (e) {
        console.error("Keep-alive audio failed:", e);
      }
    };

    // Start on first interaction or when player is ready
    const handleInteraction = () => {
      startKeepAlive();
      setHasInteracted(true);
    };

    window.addEventListener('click', handleInteraction, { once: true });
    window.addEventListener('keydown', handleInteraction, { once: true });
    return () => {
      osc?.stop();
      ctx?.close();
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, []);

  // Media Session API for background control
  useEffect(() => {
    if ('mediaSession' in navigator && currentVideo) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentVideo.title,
        artist: currentVideo.requesterName || 'StreamSync',
        artwork: [{ src: currentVideo.thumbnail || '', sizes: '512x512' }]
      });
      navigator.mediaSession.setActionHandler('play', () => {
        setIsPlaying(true);
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        setIsPlaying(false);
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => handleSkip());
    }
  }, [currentVideo]);

  useEffect(() => {
    const auth = localStorage.getItem('adminAuth') === 'true';
    const savedPassword = localStorage.getItem('adminPassword');
    if (auth) {
      setIsAuthenticated(true);
      if (savedPassword) {
        setPasswordInput(savedPassword);
      }
    }
  }, []);



  useEffect(() => {
    try {
      const raw = localStorage.getItem('adminSettings');
      if (!raw) return;
      const saved = JSON.parse(raw);
      setSettings(prev => ({ ...prev, ...saved }));
      if (typeof saved.defaultVolume === 'number') {
        setVolume(saved.defaultVolume);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('sidebarWidth');
    if (saved) setSidebarWidth(parseInt(saved, 10));
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    socket.on('queue-update', (updatedQueue: QueueItem[]) => {
      setQueue(updatedQueue);
    });

    socket.on('active-track-update', (track: QueueItem | null) => {
      console.log('[Admin] Received active-track-update:', track);
      setCurrentVideo(track);
      setIsPlaying(true);
      if (track?.videoId && playerRef.current) {
        console.log('[Admin] ReactPlayer will load video via props update');
      }
    });

    socket.on('history-update', (updatedHistory: QueueItem[]) => {
      const unique = new Map<string, QueueItem>();
      updatedHistory.forEach(item => {
        if (!unique.has(item.videoId)) {
          unique.set(item.videoId, item);
        }
      });
      setHistory(Array.from(unique.values()));
    });

    socket.on('settings-update', (nextSettings: AppSettings) => {
      setSettings(nextSettings);
      setVolume(nextSettings.defaultVolume);
      localStorage.setItem('adminSettings', JSON.stringify(nextSettings));
    });

    socket.on('master-update', (id: string | null) => {
      setMasterSocketId(id);
    });

    socket.on('blacklist-update', (updatedBlacklist: any[]) => {
      setBlacklist(updatedBlacklist);
    });

    socket.on('player-state-sync', (state: any) => {
      if (!isMaster) {
        console.log('[Admin] Received player-state-sync (Non-Master):', state);
        setCurrentVideo(state);
        setIsPlaying(state.playing);
      }
    });

    socket.on('player-tick', (tick: { currentTime: number; duration: number }) => {
      if (!isMaster && playerRef.current) {
        // Non-masters could optionally sync their player, but for now we'll just track it
        // and maybe update a progress bar if we add one to the Admin UI
      }
    });

    socket.on('success-toast', (msg) => toast.success(msg));
    socket.on('error-toast', (msg) => toast.error(msg));

    socket.on('auth-success', () => {
      setIsAuthenticated(true);
      setIsSocketAuthenticated(true);
      localStorage.setItem('adminAuth', 'true');
      // Store the current password input for auto-reauth on refresh
      if (passwordInput) {
        localStorage.setItem('adminPassword', passwordInput);
      }
      toast.success('Authenticated successfully');
    });

    socket.on('disconnect', () => {
      setIsSocketAuthenticated(false);
    });

    return () => {
      socket.off('queue-update');
      socket.off('active-track-update');
      socket.off('history-update');
      socket.off('settings-update');
      socket.off('success-toast');
      socket.off('error-toast');
      socket.off('auth-success');
      socket.off('disconnect');
    };
  }, [socket, passwordInput]);

  // Auto-authenticate on socket connection if we have a saved password
  useEffect(() => {
    const savedPassword = localStorage.getItem('adminPassword');
    if (isAuthenticated && savedPassword && !isSocketAuthenticated) {
      socket.emit('admin-auth', savedPassword);
    }
  }, [socket, isAuthenticated, isSocketAuthenticated]);

  useEffect(() => {
    if (isHistoryModalOpen && isAuthenticated) {
      socket.emit('admin-get-history');
    }
  }, [isHistoryModalOpen, socket, isAuthenticated]);

  useEffect(() => {
    if (isBlacklistModalOpen && isAuthenticated) {
      socket.emit('admin-get-blacklist');
    }
  }, [isBlacklistModalOpen, socket, isAuthenticated]);

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    socket.emit('admin-auth', passwordInput);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setIsSocketAuthenticated(false);
    localStorage.removeItem('adminAuth');
    localStorage.removeItem('adminPassword');
    setPasswordInput('');
  };

  const handleEnded = useCallback(() => {
    if (!currentVideo || lastSkippedId.current === currentVideo.id) return;
    lastSkippedId.current = currentVideo.id;
    console.log('[Admin] Ending song:', currentVideo.title);
    socket.emit('admin-skip');
  }, [currentVideo, socket]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setQueue((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        const newArray = arrayMove<QueueItem>(items, oldIndex, newIndex);
        socket.emit('admin-reorder-queue', newArray.map(i => i.id));
        return newArray;
      });
    }
  };

  const handleSkip = () => {
    socket.emit('admin-skip');
  };

  const handleDelete = (id: string) => {
    socket.emit('admin-delete-request', id);
  };

  const handleClearAll = useCallback(() => {
    setConfirmDialog({
      isOpen: true,
      title: 'Clear Queue',
      message: 'Are you sure you want to clear the entire queue?',
      onConfirm: () => {
        console.log("[Admin] Initiating Clear Queue...");
        socket.emit('admin-clear-queue');
      }
    });
  }, [socket]);

  const handleDeleteHistoryVideo = (videoId: string, title: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Remove from History',
      message: `Remove "${title}" from playback history?`,
      onConfirm: () => {
        socket.emit('admin-delete-history-video', videoId);
      }
    });
  };

  const handleClearHistory = useCallback(() => {
    setConfirmDialog({
      isOpen: true,
      title: 'Clear History',
      message: 'Permanently clear all playback history?',
      onConfirm: () => {
        console.log("[Admin] Initiating Clear History...");
        socket.emit('admin-clear-history');
      }
    });
  }, [socket]);

  const handleBanVideo = (videoId: string, title: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Ban Video',
      message: `Blacklist this video?\n${title}`,
      onConfirm: () => {
        socket.emit('admin-ban-video', { videoId, title });
      }
    });
  };

  const handleBanUser = (ip: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Ban User',
      message: `Ban requester IP: ${ip}?`,
      onConfirm: () => {
        socket.emit('admin-ban-user', ip);
      }
    });
  };

  const handleUnbanVideo = (videoId: string) => {
    socket.emit('admin-unban-video', videoId);
  };

  const handleSaveSettings = () => {
    setIsSavingSettings(true);
    socket.emit('admin-update-settings', settings);
    setTimeout(() => setIsSavingSettings(false), 300);
    toast.success('Settings updated');
    setIsSettingsModalOpen(false);
  };

  const handleResetPlayCounts = () => {
    setConfirmDialog({
      isOpen: true,
      title: 'Reset Play Counts',
      message: 'Are you sure you want to reset ALL song play counts? This cannot be undone.',
      onConfirm: () => {
        socket.emit('admin-reset-play-counts');
      }
    });
  };

  // Search Logic
  const performSearch = useCallback(
    debounce(async (val: string) => {
      if (!val) {
        setSearchResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const response = await axios.get('/api/youtube/search', { params: { q: val } });
        setSearchResults(response.data);
      } catch (err) {
        toast.error("Failed to search YouTube");
      } finally {
        setIsSearching(false);
      }
    }, 800),
    []
  );

  useEffect(() => {
    if (isSearchModalOpen) {
      performSearch(searchQuery);
    }
  }, [searchQuery, isSearchModalOpen, performSearch]);

  const handleAdminAdd = (video: VideoResult) => {
    socket.emit('admin-add-song', { ...video, requesterName: 'Admin' });
  };

  const handlePlayNow = (video: VideoResult) => {
    socket.emit('admin-play-now', { ...video, requesterName: 'Admin' });
  };

  useEffect(() => {
    if (currentVideo) {
      console.log('[Admin] Player Status:', {
        master: isMaster,
        playing: isPlaying,
        interacted: hasInteracted,
        video: currentVideo.title
      });
    }
  }, [isPlaying, hasInteracted, currentVideo, isMaster]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (!currentVideo || !isSocketAuthenticated) return;

    // Occasional full state sync (every 5 seconds)
    const stateSyncInterval = setInterval(() => {
      if (!playerRef.current || !isMaster) return;
      const curr = playerRef.current?.getCurrentTime?.() ?? 0;
      const duration = playerRef.current?.getDuration?.() ?? 0;

      if (duration > 0) {
        socket.emit('admin-player-state', {
          videoId: currentVideo.videoId,
          title: currentVideo.title,
          thumbnail: currentVideo.thumbnail,
          requesterName: currentVideo.requesterName,
          playing: isPlaying,
          currentTime: curr,
          duration: duration,
        });
      }
    }, 5000);

    return () => {
      clearInterval(stateSyncInterval);
    };
  }, [socket, currentVideo, isPlaying, isSocketAuthenticated, isMaster]);



  if (!isAuthenticated) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#151619] border border-white/10 rounded-[2rem] sm:rounded-[2.5rem] p-8 sm:p-12 space-y-8 shadow-2xl"
        >
          <div className="text-center space-y-2">
            <div className="w-14 h-14 sm:w-16 sm:h-16 bg-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-6 rotate-3">
              <LayoutGrid className="w-7 h-7 sm:w-8 sm:h-8 text-black" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-black italic tracking-tighter">ADMIN ACCESS</h1>
            <p className="text-[10px] sm:text-sm text-white/40 uppercase font-bold tracking-[0.2em]">Authorized Personnel Only</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-black text-white/20 tracking-widest ml-4">Access Passphrase</label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 outline-none focus:border-orange-500/50 focus:ring-4 focus:ring-orange-500/10 transition-all text-center tracking-[0.3em] sm:tracking-[0.5em] font-black text-lg"
                autoFocus
              />
            </div>
            <button className="w-full py-4 bg-orange-500 text-black rounded-2xl font-black uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-orange-500/20">
              Authenticate
            </button>
          </form>
        </motion.div>
        <AnimatePresence>
          {isSettingsModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsSettingsModalOpen(false)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />

              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-md bg-[#151619] border border-white/10 rounded-[2rem] p-6 lg:p-8 space-y-6 shadow-2xl overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold flex items-center gap-3 italic">
                    <LayoutGrid className="w-6 h-6 text-orange-500" />
                    Settings
                  </h3>
                  <button
                    onClick={() => setIsSettingsModalOpen(false)}
                    className="p-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all"
                  >
                    <Plus className="w-5 h-5 rotate-45 text-white/40" />
                  </button>
                </div>

                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Request Cooldown (seconds)</label>
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      value={settings.requestCooldownSeconds}
                      onChange={(e) => setSettings(prev => ({ ...prev, requestCooldownSeconds: Number(e.target.value || 0) }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-500/50"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Max Queue Size</label>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={settings.maxQueueSize}
                      onChange={(e) => setSettings(prev => ({ ...prev, maxQueueSize: Number(e.target.value || 1) }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-500/50"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Sidebar Width (px)</label>
                    <input
                      type="number"
                      min={300}
                      max={1200}
                      value={sidebarWidth}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 300;
                        setSidebarWidth(val);
                        localStorage.setItem('sidebarWidth', val.toString());
                      }}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-500/50 transition-all"
                    />
                  </div>

                  <div className="h-px bg-white/5 my-2" />

                  <button
                    onClick={handleResetPlayCounts}
                    className="w-full p-3 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/20 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all"
                  >
                    Reset All Play Counts
                  </button>

                  <button
                    onClick={handleSaveSettings}
                    disabled={isSavingSettings}
                    className="w-full p-4 bg-orange-500 text-black rounded-xl text-xs font-black uppercase tracking-[0.2em] hover:brightness-110 transition-all disabled:opacity-60 shadow-lg shadow-orange-500/20"
                  >
                    {isSavingSettings ? 'Saving...' : 'Save Settings'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div
      className="max-w-screen-2xl mx-auto px-4 py-4 lg:py-8 grid gap-8 pb-24 lg:pb-8"
      style={{
        display: 'grid',
        gridTemplateColumns: typeof window !== 'undefined' && window.innerWidth > 1024 ? `1fr ${sidebarWidth}px` : '1fr'
      }}
    >
      {/* Mobile Bottom Navigation */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-[#0a0a0a]/95 backdrop-blur-xl border-t border-white/10 z-[60] flex items-center justify-around p-2 pb-safe">
        <button
          onClick={() => setMobileActiveTab('playback')}
          className={`flex-1 flex flex-col items-center gap-1 py-2 transition-all ${mobileActiveTab === 'playback' ? 'text-orange-500' : 'text-white/20'}`}
        >
          <Play className={`w-5 h-5 ${mobileActiveTab === 'playback' ? 'fill-current' : ''}`} />
          <span className="text-[10px] font-black uppercase tracking-widest">Player</span>
        </button>
        <button
          onClick={() => setMobileActiveTab('queue')}
          className={`flex-1 flex flex-col items-center gap-1 py-2 transition-all ${mobileActiveTab === 'queue' ? 'text-orange-500' : 'text-white/20'}`}
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
      </div>

      {/* Primary Player Section */}
      <section className={`${mobileActiveTab === 'playback' ? 'block' : 'hidden lg:block'} space-y-6`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="space-y-1">
            <h2 className="text-2xl lg:text-3xl font-bold flex items-center gap-3 italic">
              <LayoutGrid className="w-6 h-6 lg:w-7 lg:h-7 text-orange-500" />
              Admin <span className="text-orange-500">Center</span>
            </h2>
            <p className="text-xs lg:text-sm text-white/40">Real-time playback control and queue management.</p>
          </div>
          <div className="flex bg-[#151619] border border-white/10 p-1.5 rounded-2xl overflow-x-auto no-scrollbar shrink-0">
            <button
              onClick={() => setActiveTab('main')}
              className={`px-4 lg:px-6 py-2.5 font-bold text-xs uppercase tracking-widest rounded-xl transition-all whitespace-nowrap ${activeTab === 'main' ? 'bg-orange-500 text-black shadow-lg shadow-orange-500/20' : 'text-white/40 hover:bg-white/5'}`}
            >
              Main
            </button>
            <button
              onClick={() => setIsSearchModalOpen(true)}
              className={`px-4 lg:px-6 py-2.5 font-bold text-xs uppercase tracking-widest rounded-xl transition-all whitespace-nowrap ${isSearchModalOpen ? 'bg-orange-500 text-black shadow-lg shadow-orange-500/20' : 'text-white/40 hover:bg-white/5'}`}
            >
              Search
            </button>
            <button
              onClick={() => setIsHistoryModalOpen(true)}
              className={`px-4 lg:px-6 py-2.5 font-bold text-xs uppercase tracking-widest rounded-xl transition-all whitespace-nowrap ${isHistoryModalOpen ? 'bg-orange-500 text-black shadow-lg shadow-orange-500/20' : 'text-white/40 hover:bg-white/5'}`}
            >
              History
            </button>
            <button
              onClick={() => setIsBlacklistModalOpen(true)}
              className={`px-4 lg:px-6 py-2.5 font-bold text-xs uppercase tracking-widest rounded-xl transition-all whitespace-nowrap ${isBlacklistModalOpen ? 'bg-orange-500 text-black shadow-lg shadow-orange-500/20' : 'text-white/40 hover:bg-white/5'}`}
            >
              Banned
            </button>
            <button
              onClick={handleLogout}
              className="px-4 lg:px-6 py-2.5 text-white/20 hover:text-red-500 font-bold text-xs uppercase tracking-widest rounded-xl transition-all whitespace-nowrap"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="bg-black aspect-video rounded-[1.5rem] lg:rounded-[2.5rem] overflow-hidden border border-white/10 relative shadow-2xl shadow-orange-500/5">
          {currentVideo?.videoId ? (
            <Suspense fallback={<PlayerFallback />}>
              <ReactPlayerAny
                key={currentVideo.videoId}
                src={`https://www.youtube.com/watch?v=${currentVideo.videoId}`}
                ref={(player: any) => {
                  playerRef.current = player;
                  if (player) console.log('[Admin] ReactPlayer ref assigned');
                }}
                width="100%"
                height="100%"
                playing={isMaster && isPlaying && hasInteracted}
                controls={true}
                progressInterval={500}
                volume={volume}
                muted={!hasInteracted}
                playsinline={true}
                onReady={() => console.log('[Admin] ReactPlayer Ready')}
                onStart={() => console.log('[Admin] ReactPlayer Started')}
                onProgress={(progress: any) => {
                  if (isMasterRef.current && isSocketAuthenticatedRef.current) {
                    const duration = playerRef.current?.getDuration?.() ?? 0;
                    if (duration > 0) {
                      socket.emit('admin-player-tick', {
                        currentTime: progress.playedSeconds,
                        duration: duration,
                      });
                    }
                  }
                }}
                onDuration={(duration: number) => {
                  if (isMasterRef.current && isSocketAuthenticatedRef.current && currentVideoRef.current) {
                    socket.emit('admin-player-tick', {
                      currentTime: playerRef.current?.getCurrentTime?.() ?? 0,
                      duration: duration,
                    });
                  }
                }}
                onPlay={() => {
                  console.log('[Admin] ReactPlayer Play');
                  setIsPlaying(true);
                }}
                onPause={() => {
                  console.log('[Admin] ReactPlayer Pause');
                  setIsPlaying(false);
                }}
                onEnded={() => {
                  console.log('[Admin] ReactPlayer Ended');
                  handleEnded();
                }}
                onError={(e: any) => console.error('[Admin] ReactPlayer Error:', e)}
                config={{
                  youtube: {
                    playerVars: {
                      rel: 0,
                      origin: typeof window !== 'undefined' ? window.location.origin : '',
                      iv_load_policy: 3,
                      modestbranding: 1
                    }
                  }
                }}
              />
              {!isMaster && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center text-center p-6 space-y-4">
                  <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center">
                    <ShieldCheck className="w-6 h-6 text-white/20" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-black uppercase tracking-widest text-white/40">Remote Mode</h4>
                    <p className="text-[10px] text-white/20 font-medium max-w-[200px]">Playback is disabled on this tab to prevent audio conflicts. Controls remain active.</p>
                  </div>
                </div>
              )}
            </Suspense>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-white/10 gap-4">
              <Music2 className="w-16 h-16 opacity-10 animate-pulse" />
              <p className="text-xs font-bold uppercase tracking-widest opacity-20">Waiting for track...</p>
            </div>
          )}

          {/* Interaction Overlay to satisfy browser autoplay policies */}
          {!hasInteracted && currentVideo && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm cursor-pointer group"
              onClick={() => {
                setHasInteracted(true);
                setIsPlaying(true);
              }}
            >
              <div className="text-center p-8 bg-[#151619] border border-orange-500/50 rounded-[2.5rem] shadow-2xl transition-transform group-hover:scale-105 active:scale-95">
                <div className="w-16 h-16 bg-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-6 rotate-3 shadow-lg shadow-orange-500/20 animate-bounce">
                  <Play className="w-8 h-8 text-black fill-current" />
                </div>
                <h3 className="text-xl lg:text-2xl font-bold italic mb-2 tracking-tight">READY TO STREAM</h3>
                <p className="text-[10px] text-white/40 uppercase font-black tracking-[0.2em]">Click anywhere to enable audio sync</p>
              </div>
            </motion.div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch justify-between bg-[#151619] border border-white/10 rounded-[2rem] lg:rounded-3xl p-5 lg:p-6 gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 lg:w-14 lg:h-14 bg-orange-500/10 rounded-2xl flex items-center justify-center shrink-0">
              <Music2 className="w-6 h-6 lg:w-7 lg:h-7 text-orange-500" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold italic line-clamp-1 text-sm lg:text-lg">{currentVideo?.title || 'No track active'}</h3>
              <p className="text-xs lg:text-[13px] uppercase font-black text-white/75 tracking-widest truncate">
                {currentVideo?.requesterName === 'Admin' ? 'Added by Admin' : `Requested by ${currentVideo?.requesterName || 'anonymous'}`}
              </p>
              {(currentVideo?.playCount ?? 0) >= 1 && (
                <div className="flex items-center gap-1.5 text-orange-500/100 mt-1">
                  <RotateCcw className="w-3 h-3" />
                  <span className="text-[10px] font-black uppercase tracking-widest">{currentVideo?.playCount}x Played Total</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => currentVideo && handleBanVideo(currentVideo.videoId, currentVideo.title)}
              className="px-4 lg:px-6 py-3 lg:py-4 bg-white/5 hover:bg-orange-500/10 border border-white/10 hover:border-orange-500/50 rounded-2xl flex items-center justify-center gap-3 transition-all group"
              title="Ban Current Video"
            >
              <Ban className="w-4 h-4 lg:w-5 lg:h-5 text-white/40 group-hover:text-orange-500" />
            </button>
            <button
              onClick={handleSkip}
              className="px-6 lg:px-8 py-3 lg:py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl flex items-center justify-center sm:justify-start gap-3 transition-all group shrink-0"
            >
              <span className="text-[10px] lg:text-xs font-black uppercase tracking-widest text-white/40 group-hover:text-white transition-colors">Skip Track</span>
              <SkipForward className="w-4 h-4 lg:w-5 lg:h-5 text-orange-500" />
            </button>
          </div>
        </div>
        {/* Quick Tools */}
        <div className="p-6 bg-white/[0.02] border border-white/5 rounded-3xl space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-white/40">Master Player Control</h3>
            <div className={`w-2 h-2 rounded-full ${isMaster ? 'bg-green-500 animate-pulse' : 'bg-white/10'}`} />
          </div>

          <button
            onClick={() => {
              if (isMaster) {
                socket.emit('admin-release-master');
              } else if (masterSocketId) {
                setConfirmDialog({
                  isOpen: true,
                  title: 'Take Over Master',
                  message: 'Another tab is currently the Master. Take over playback control?',
                  onConfirm: () => {
                    socket.emit('admin-claim-master', { force: true });
                  }
                });
              } else {
                socket.emit('admin-claim-master');
              }
            }}
            className={`w-full p-4 rounded-xl border transition-all flex items-center justify-between group ${isMaster ? 'bg-orange-500/10 border-orange-500/50 text-orange-500' : 'bg-white/5 border-white/10 text-white/40 hover:border-white/20'}`}
          >
            <div className="flex items-center gap-3">
              <ShieldCheck className={`w-5 h-5 ${isMaster ? 'text-orange-500' : 'text-white/20'}`} />
              <span className="text-xs font-black uppercase tracking-widest flex items-center gap-2">
                {isMaster ? 'Master Active' : (masterSocketId ? 'Take Over Master' : 'Claim Master')}
                {isMaster && isPlaying && (
                  <motion.span
                    animate={{ opacity: [0.2, 1, 0.2] }}
                    transition={{ repeat: Infinity, duration: 1 }}
                    className="w-1.5 h-1.5 bg-orange-500 rounded-full"
                  />
                )}
              </span>
            </div>
            <div className={`w-10 h-5 rounded-full relative transition-colors ${isMaster ? 'bg-orange-500' : 'bg-white/10'}`}>
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${isMaster ? 'left-6' : 'left-1'}`} />
            </div>
          </button>

          {isMaster && (
            <p className="text-[10px] text-orange-500/60 font-medium italic text-center px-2">
              Authoritative sync active. Only one master should be active per session.
            </p>
          )}

          {!isMaster && masterSocketId && (
            <p className="text-[10px] text-white/20 font-medium italic text-center px-2">
              Another tab is currently the Master Player.
            </p>
          )}
        </div>
      </section>

      {/* Sidebar Queue Management */}
      <aside className={`${mobileActiveTab === 'queue' ? 'block' : 'hidden lg:block'} space-y-6 lg:mt-0`}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg lg:text-xl font-bold flex items-center gap-2">
            <ListMusic className="w-5 h-5 lg:w-6 lg:h-6 text-orange-500" />
            Live Queue
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className="p-2 text-white/40 hover:text-orange-500 bg-white/5 border border-white/10 rounded-xl transition-all"
              title="Settings"
            >
              <LayoutGrid className="w-4 h-4 lg:w-5 lg:h-5" />
            </button>
            <button
              onClick={handleClearAll}
              className="text-[10px] lg:text-xs font-black uppercase tracking-[0.2em] px-4 py-2 border border-white/10 rounded-xl hover:bg-red-500 hover:text-white transition-all"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="space-y-4 max-h-[400px] lg:max-h-[calc(100vh-600px)] overflow-y-auto pr-2 custom-scrollbar">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={queue}
              strategy={verticalListSortingStrategy}
            >
              {queue.length > 0 ? (
                queue.map((item) => (
                  <div key={item.id}>
                    <SortableItem
                      item={item}
                      onDelete={handleDelete}
                      onBanVideo={handleBanVideo}
                    />
                  </div>
                ))
              ) : (
                <div className="py-20 border-2 border-dashed border-white/5 rounded-3xl flex flex-col items-center justify-center text-white/10 text-center px-8">
                  <Music2 className="w-12 h-12 mb-4 opacity-5" />
                  <p className="text-sm font-medium">Empty Queue</p>
                  <p className="text-xs">Incoming requests will appear here instantly.</p>
                </div>
              )}
            </SortableContext>
          </DndContext>
        </div>
      </aside>

      {/* Tabs Content - Floating Bottom or separate section? Let's use the bottom of main */}
      <div className="lg:col-span-2 space-y-8">
        {/* YouTube Discovery Modal */}
        <AnimatePresence>
          {isSearchModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsSearchModalOpen(false)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />

              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-5xl bg-[#151619] border border-white/10 rounded-[2rem] lg:rounded-[3rem] p-6 lg:p-10 space-y-8 shadow-2xl overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="text-xl lg:text-3xl font-bold flex items-center gap-3 italic">
                      <Search className="w-6 h-6 lg:w-8 lg:h-8 text-orange-500" />
                      YouTube Discovery
                    </h3>
                    <p className="text-xs lg:text-sm text-white/40">Find and add songs directly to the live queue.</p>
                  </div>
                  <button
                    onClick={() => setIsSearchModalOpen(false)}
                    className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl transition-all group"
                  >
                    <Plus className="w-6 h-6 rotate-45 text-white/40 group-hover:text-white transition-colors" />
                  </button>
                </div>

                <div className="relative group">
                  <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none text-white/40 group-focus-within:text-orange-500 transition-colors">
                    <Search className="w-6 h-6" />
                  </div>
                  <input
                    type="text"
                    placeholder="Search for videos..."
                    className="w-full bg-white/5 border border-white/10 rounded-[1.5rem] py-4 lg:py-5 pl-14 pr-6 outline-none focus:border-orange-500/50 focus:ring-4 focus:ring-orange-500/10 transition-all text-base lg:text-xl font-medium"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                  {isSearching && (
                    <div className="absolute right-6 top-1/2 -translate-y-1/2">
                      <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
                    </div>
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-5 max-h-[50vh] lg:max-h-[60vh] overflow-y-auto custom-scrollbar pr-4 -mr-4">
                  <AnimatePresence mode="popLayout">
                    {searchResults.map((video) => (
                      <motion.div
                        key={video.videoId}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        layout
                        className="flex items-center gap-4 p-4 bg-white/[0.03] border border-white/5 rounded-[1.5rem] group hover:border-orange-500/30 hover:bg-white/[0.05] transition-all"
                      >
                        <div className="relative shrink-0">
                          <img src={video.thumbnail} alt="" className="w-28 lg:w-36 h-16 lg:h-20 object-cover rounded-xl shadow-lg" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center">
                            <Music2 className="w-6 h-6 text-white" />
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold line-clamp-2 text-sm lg:text-base group-hover:text-orange-500 transition-colors italic mb-3">{video.title}</h4>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handlePlayNow(video)}
                              className="flex-[2] py-2 bg-white text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg"
                            >
                              Play Now
                            </button>
                            <button
                              onClick={() => handleAdminAdd(video)}
                              className="flex-[2] py-2 bg-orange-500 text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-orange-500/20"
                            >
                              Add Queue
                            </button>
                            <button
                              onClick={() => handleBanVideo(video.videoId, video.title)}
                              className="flex-1 py-2 bg-white/5 hover:bg-orange-500/10 text-white/20 hover:text-orange-500 border border-white/10 rounded-xl transition-all flex items-center justify-center"
                              title="Ban Video"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {!isSearching && searchQuery && searchResults.length === 0 && (
                    <div className="col-span-2 py-20 text-center text-white/20 italic">
                      No results found for "{searchQuery}"
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isHistoryModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsHistoryModalOpen(false)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />

              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-5xl bg-[#151619] border border-white/10 rounded-[2rem] lg:rounded-[3rem] p-6 lg:p-10 space-y-8 shadow-2xl overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 lg:w-12 lg:h-12 bg-orange-500/10 rounded-xl flex items-center justify-center">
                      <History className="w-5 h-5 lg:w-6 lg:h-6 text-orange-500" />
                    </div>
                    <div>
                      <h3 className="text-xl lg:text-3xl font-bold italic leading-tight">Playback History</h3>
                      <p className="text-xs lg:text-sm text-white/40 uppercase font-black tracking-widest">Review past sessions</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {history.length > 0 && (
                      <button
                        onClick={() => {
                          console.log("[Admin] Clicked Clear History");
                          handleClearHistory();
                        }}
                        className="px-4 py-2 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                      >
                        Clear History
                      </button>
                    )}
                    <button
                      onClick={() => setIsHistoryModalOpen(false)}
                      className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl transition-all group"
                    >
                      <Plus className="w-6 h-6 rotate-45 text-white/40 group-hover:text-white transition-colors" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6 max-h-[50vh] lg:max-h-[60vh] overflow-y-auto custom-scrollbar pr-4 -mr-4">
                  <AnimatePresence mode="popLayout">
                    {history.length > 0 ? (
                      history.map((item, index) => (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={{ delay: index * 0.03 }}
                          className="flex items-center gap-4 p-4 bg-white/[0.03] border border-white/5 rounded-[1.5rem] group hover:border-orange-500/30 hover:bg-white/[0.05] transition-all relative overflow-hidden"
                        >
                          <div className="relative shrink-0 overflow-hidden rounded-xl shadow-lg">
                            <img
                              src={item.thumbnail}
                              alt=""
                              className="w-24 lg:w-32 h-14 lg:h-18 object-cover opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-500"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <RotateCcw className="w-6 h-6 text-white" />
                            </div>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex flex-col gap-1 mb-3">
                              <h4 className="font-bold line-clamp-2 text-sm lg:text-base text-white/80 italic group-hover:text-white transition-colors">
                                {item.title}
                              </h4>
                              {(item.playCount ?? 0) >= 1 && (
                                <div className="flex items-center gap-1.5 text-orange-500/100">
                                  <Clock className="w-3 h-3" />
                                  <span className="text-[10px] font-black uppercase tracking-widest">{item.playCount}x Played</span>
                                </div>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handlePlayNow({ videoId: item.videoId, title: item.title, thumbnail: item.thumbnail })}
                                className="flex-[2] py-2 bg-white text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg"
                              >
                                Play Now
                              </button>
                              <button
                                onClick={() => handleAdminAdd({ videoId: item.videoId, title: item.title, thumbnail: item.thumbnail })}
                                className="flex-[2] py-2 bg-orange-500 text-black rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-orange-500/20"
                              >
                                Add Queue
                              </button>
                              <div className="flex gap-1 shrink-0">
                                <button
                                  onClick={() => {
                                    console.log("[Admin] Clicked Ban Video for", item.videoId);
                                    handleBanVideo(item.videoId, item.title);
                                  }}
                                  className="p-2 bg-white/5 hover:bg-orange-500/10 text-white/20 hover:text-orange-500 rounded-xl transition-all border border-white/5"
                                  title="Ban Video"
                                >
                                  <Ban className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => {
                                    console.log("[Admin] Clicked Remove from history for", item.videoId);
                                    handleDeleteHistoryVideo(item.videoId, item.title);
                                  }}
                                  className="p-2 bg-white/5 hover:bg-red-500/10 text-white/20 hover:text-red-500 rounded-xl transition-all border border-white/5"
                                  title="Remove from history"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      ))
                    ) : (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="col-span-1 sm:col-span-2 py-20 flex flex-col items-center justify-center text-center space-y-4"
                      >
                        <div className="w-20 h-20 bg-white/[0.02] rounded-full flex items-center justify-center">
                          <History className="w-10 h-10 text-white/10 animate-pulse" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-white/20 text-lg italic font-medium">No playback history yet</p>
                          <p className="text-xs uppercase tracking-widest text-white/5 font-black">Your journey starts here</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isBlacklistModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsBlacklistModalOpen(false)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />

              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-2xl bg-[#151619] border border-white/10 rounded-[2rem] lg:rounded-[3rem] p-6 lg:p-10 space-y-8 shadow-2xl overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 lg:w-12 lg:h-12 bg-orange-500/10 rounded-xl flex items-center justify-center">
                      <Ban className="w-5 h-5 lg:w-6 lg:h-6 text-orange-500" />
                    </div>
                    <div>
                      <h3 className="text-xl lg:text-3xl font-bold italic leading-tight">Blacklisted Videos</h3>
                      <p className="text-xs lg:text-sm text-white/40 uppercase font-black tracking-widest">Restricted content</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsBlacklistModalOpen(false)}
                    className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl transition-all group"
                  >
                    <Plus className="w-6 h-6 rotate-45 text-white/40 group-hover:text-white transition-colors" />
                  </button>
                </div>

                <div className="space-y-3 max-h-[50vh] lg:max-h-[60vh] overflow-y-auto custom-scrollbar pr-4 -mr-4">
                  {blacklist.length > 0 ? (
                    blacklist.map((item) => (
                      <div
                        key={item.videoId}
                        className="flex items-center justify-between p-4 bg-white/[0.03] border border-white/5 rounded-2xl group hover:border-orange-500/30 transition-all"
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <img src={`https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`} alt="" className="w-20 h-12 object-cover rounded-lg" />
                          <div className="min-w-0">
                            <h4 className="font-bold truncate text-sm text-white/80 italic">{item.reason || 'No title'}</h4>
                            <p className="text-[10px] text-white/20 font-mono tracking-widest">{item.videoId}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleUnbanVideo(item.videoId)}
                          className="px-4 py-2 bg-orange-500/10 hover:bg-orange-500 text-orange-500 hover:text-white border border-orange-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shrink-0"
                        >
                          Unban
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="py-20 flex flex-col items-center justify-center text-center space-y-4">
                      <div className="w-20 h-20 bg-white/[0.02] rounded-full flex items-center justify-center">
                        <Ban className="w-10 h-10 text-white/5" />
                      </div>
                      <p className="text-white/20 text-lg italic font-medium">No videos blacklisted</p>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Settings Modal */}
        <AnimatePresence>
          {isSettingsModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsSettingsModalOpen(false)}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              />

              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-md bg-[#151619] border border-white/10 rounded-[2rem] p-6 lg:p-8 space-y-6 shadow-2xl overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold flex items-center gap-3 italic">
                    <LayoutGrid className="w-6 h-6 text-orange-500" />
                    Settings
                  </h3>
                  <button
                    onClick={() => setIsSettingsModalOpen(false)}
                    className="p-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all"
                  >
                    <Plus className="w-5 h-5 rotate-45 text-white/40" />
                  </button>
                </div>

                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Request Cooldown (seconds)</label>
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      value={settings.requestCooldownSeconds}
                      onChange={(e) => setSettings(prev => ({ ...prev, requestCooldownSeconds: Number(e.target.value || 0) }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-500/50"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Max Queue Size</label>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={settings.maxQueueSize}
                      onChange={(e) => setSettings(prev => ({ ...prev, maxQueueSize: Number(e.target.value || 1) }))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-500/50"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Sidebar Width (px)</label>
                    <input
                      type="number"
                      min={300}
                      max={1200}
                      value={sidebarWidth}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 300;
                        setSidebarWidth(val);
                        localStorage.setItem('sidebarWidth', val.toString());
                      }}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-orange-500/50 transition-all"
                    />
                  </div>

                  <div className="h-px bg-white/5 my-2" />

                  <button
                    onClick={handleResetPlayCounts}
                    className="w-full p-3 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/20 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all"
                  >
                    Reset All Play Counts
                  </button>

                  <button
                    onClick={handleSaveSettings}
                    disabled={isSavingSettings}
                    className="w-full p-4 bg-orange-500 text-black rounded-xl text-xs font-black uppercase tracking-[0.2em] hover:brightness-110 transition-all disabled:opacity-60 shadow-lg shadow-orange-500/20"
                  >
                    {isSavingSettings ? 'Saving...' : 'Save Settings'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Custom Confirm Modal */}
      <AnimatePresence>
        {confirmDialog.isOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-[#151619] border border-white/10 rounded-[2rem] p-6 lg:p-8 space-y-6 shadow-2xl overflow-hidden"
            >
              <div className="space-y-2">
                <h3 className="text-xl font-bold italic">{confirmDialog.title}</h3>
                <p className="text-sm text-white/60 whitespace-pre-wrap">{confirmDialog.message}</p>
              </div>
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white/60 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    confirmDialog.onConfirm();
                    setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                  }}
                  className="flex-1 py-3 bg-orange-500 hover:bg-orange-400 text-black rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-orange-500/20"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
