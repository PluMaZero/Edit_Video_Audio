import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Play, Pause, Plus, Download, Upload, Scissors, Loader2, Settings } from 'lucide-react';
import { Clip, Track } from './types';
import Timeline from './components/Timeline';
import Player from './components/Player';
import { generateId, getVideoMetadata, getAudioMetadata, formatTime } from './utils';

type ResolutionOption = '720p' | '1080p' | 'source' | 'custom';

const App: React.FC = () => {
  const [tracks] = useState<Track[]>([
    { id: 'track-1', type: 'video', name: 'Video 1', color: 'blue', isMuted: false },
    { id: 'track-2', type: 'audio', name: 'Audio 1', color: 'green', isMuted: false },
    { id: 'track-3', type: 'audio', name: 'Audio 2', color: 'teal', isMuted: false },
  ]);
  
  const [clips, setClips] = useState<Clip[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(30); // Default timeline length
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  
  // Resolution State
  const [resolutionState, setResolutionState] = useState<ResolutionOption>('720p');
  const [customResolution, setCustomResolution] = useState({ width: 1280, height: 720 });

  const requestRef = useRef<number>();
  const previousTimeRef = useRef<number>();
  const clipboardRef = useRef<Clip | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Audio Engine Refs
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // === Resolution Logic ===
  const currentResolution = useMemo(() => {
    if (resolutionState === 'custom') {
      return customResolution;
    }
    if (resolutionState === '1080p') {
      return { width: 1920, height: 1080 };
    } 
    if (resolutionState === 'source') {
       // Find maximum dimensions from video clips
       let maxWidth = 0;
       let maxHeight = 0;
       let found = false;
       
       clips.forEach(clip => {
         if (clip.type === 'video' && clip.width && clip.height) {
           // Use the largest video resolution found
           // If multiple videos have different sizes, we pick the one with largest area to preserve quality
           if (clip.width * clip.height > maxWidth * maxHeight) {
             maxWidth = clip.width;
             maxHeight = clip.height;
             found = true;
           }
         }
       });
       
       if (found) {
           return { width: maxWidth, height: maxHeight };
       }
       // Default fallback if no video clips
       return { width: 1280, height: 720 };
    }
    // Default 720p
    return { width: 1280, height: 720 };
  }, [resolutionState, clips, customResolution]);

  // === Auto-adjust Total Duration ===
  useEffect(() => {
    // Calculate the end time of the last clip
    const maxClipEnd = clips.reduce((max, clip) => Math.max(max, clip.start + clip.duration), 0);
    
    // Set total duration to match exactly the end of content
    // Use a default (e.g. 30s) only if the timeline is completely empty
    const newDuration = maxClipEnd > 0 ? maxClipEnd : 30;
    
    setTotalDuration(newDuration);
  }, [clips]);

  // === Playback Engine ===
  const animate = (time: number) => {
    if (previousTimeRef.current !== undefined) {
      const deltaTime = (time - previousTimeRef.current) / 1000;
      setCurrentTime(prevTime => {
          const next = prevTime + deltaTime;
          
          // Stop condition
          if (next >= totalDuration) {
              if (isExporting) {
                  // If exporting, we need to stop exactly at end to finish recording
                  setIsPlaying(false);
                  return totalDuration;
              }
              setIsPlaying(false);
              return 0; // Loop or stop
          }
          return next;
      });
    }
    previousTimeRef.current = time;
    if (isPlaying) {
      requestRef.current = requestAnimationFrame(animate);
    }
  };

  useEffect(() => {
    if (isPlaying) {
      requestRef.current = requestAnimationFrame(animate);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      previousTimeRef.current = undefined;
    }
    return () => {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, totalDuration, isExporting]);

  // === Initialize Audio Context ===
  useEffect(() => {
     // Initialize AudioContext on mount (will be suspended until interaction)
     if (!audioCtxRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        const dest = ctx.createMediaStreamDestination();
        audioCtxRef.current = ctx;
        audioDestRef.current = dest;
     }
  }, []);

  // Resume AudioContext on user interaction
  const resumeAudioContext = () => {
      if (audioCtxRef.current?.state === 'suspended') {
          audioCtxRef.current.resume();
      }
  };

  // === Audio Sync Logic ===
  useEffect(() => {
    const audioClips = clips.filter(c => c.type === 'audio');
    const ctx = audioCtxRef.current;
    const dest = audioDestRef.current;
    
    // Create new audio elements and route them
    audioClips.forEach(clip => {
        if (!audioRefs.current.has(clip.id)) {
            const audio = new Audio(clip.source);
            audio.preload = 'auto';
            audio.crossOrigin = "anonymous";
            
            // Connect to Web Audio API graph
            if (ctx && dest) {
                try {
                    const source = ctx.createMediaElementSource(audio);
                    // Connect to speakers so user can hear
                    source.connect(ctx.destination);
                    // Connect to recorder destination so we can export
                    source.connect(dest);
                } catch (e) {
                    console.warn("Audio node connection error (likely already connected):", e);
                }
            }

            audioRefs.current.set(clip.id, audio);
        }
    });

    // Cleanup removed clips
    const currentIds = new Set(audioClips.map(c => c.id));
    audioRefs.current.forEach((audio, id) => {
        if (!currentIds.has(id)) {
            audio.pause();
            audioRefs.current.delete(id);
        }
    });

    // Sync play state
    audioClips.forEach(clip => {
        const audio = audioRefs.current.get(clip.id);
        if (!audio) return;

        const isActive = currentTime >= clip.start && currentTime < clip.start + clip.duration;
        
        if (isActive && isPlaying) {
             const seekTime = (currentTime - clip.start) + clip.offset;
             // Only sync if drift is noticeable or it's paused/ended
             if (Math.abs(audio.currentTime - seekTime) > 0.2 || audio.paused) {
                 audio.currentTime = seekTime;
                 audio.play().catch(() => {});
             }
        } else {
            if (!audio.paused) audio.pause();
        }
    });
  }, [clips, currentTime, isPlaying]);

  // === Keyboard Shortcuts (Copy/Paste) ===
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

        const isCtrl = e.ctrlKey || e.metaKey;

        // Copy
        if (isCtrl && e.key.toLowerCase() === 'c') {
            if (selectedClipId) {
                const clip = clips.find(c => c.id === selectedClipId);
                if (clip) clipboardRef.current = clip;
            }
        }

        // Paste
        if (isCtrl && e.key.toLowerCase() === 'v') {
            if (clipboardRef.current) {
                let start = currentTime;
                const selectedClip = clips.find(c => c.id === selectedClipId);
                if (selectedClip) start = selectedClip.start + selectedClip.duration;

                const newClip: Clip = {
                    ...clipboardRef.current,
                    id: generateId(),
                    start: start,
                    trackId: clipboardRef.current.trackId, 
                };
                
                setClips(prev => [...prev, newClip]);
                setSelectedClipId(newClip.id);
            }
        }
        
        // Delete
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (selectedClipId) handleDeleteClip(selectedClipId);
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clips, selectedClipId, currentTime]);

  // === Handlers ===

  const addClipFromFile = async (file: File, trackId: string, type: 'video' | 'audio') => {
    let duration = 0;
    let width = undefined;
    let height = undefined;

    try {
        if (type === 'video') {
            const meta = await getVideoMetadata(file);
            duration = meta.duration;
            width = meta.width;
            height = meta.height;
        } else {
            const meta = await getAudioMetadata(file);
            duration = meta.duration;
        }

        // Find insertion point (after last clip on track)
        // We need to access the current state of clips, so we'll use a functional update or rely on current closure if it's fresh enough.
        // For reliability in async, we calculate based on the current clips state which might be stale if multiple files added quickly.
        // Better: Calculate inside setClips to ensure order.
        
        setClips(prevClips => {
            const trackClips = prevClips.filter(c => c.trackId === trackId);
            const lastClip = trackClips.sort((a, b) => (a.start + a.duration) - (b.start + b.duration)).pop();
            const start = lastClip ? lastClip.start + lastClip.duration + 0.5 : 0;

            const newClip: Clip = {
                id: generateId(),
                trackId,
                source: URL.createObjectURL(file),
                file,
                type,
                start,
                duration: Math.min(duration, 10), // Default to max 10s for easier editing
                offset: 0,
                totalDuration: duration,
                name: file.name,
                width,
                height
            };
            
            return [...prevClips, newClip];
        });

    } catch (e) {
        console.error("Failed to load media", e);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, trackId: string, type: 'video' | 'audio') => {
    const file = e.target.files?.[0];
    if (!file) return;
    await addClipFromFile(file, trackId, type);
    // Reset input
    e.target.value = '';
  };

  const handleTrackDrop = async (trackId: string, files: FileList) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;

    Array.from(files).forEach(file => {
        const isVideo = file.type.startsWith('video/');
        const isAudio = file.type.startsWith('audio/');
        
        if (track.type === 'video' && isVideo) {
            addClipFromFile(file, trackId, 'video');
        } else if (track.type === 'audio' && isAudio) {
            addClipFromFile(file, trackId, 'audio');
        } else {
            // Optional: warn user about type mismatch
            console.warn(`Cannot drop ${file.type} onto ${track.type} track.`);
        }
    });
  };

  const handleClipUpdate = (clipId: string, updates: Partial<Clip>) => {
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, ...updates } : c));
  };

  const handleDeleteClip = (clipId: string) => {
    setClips(prev => prev.filter(c => c.id !== clipId));
    if (selectedClipId === clipId) setSelectedClipId(null);
  };
  
  const handleSplitClip = () => {
    if (!selectedClipId) return;
    const clip = clips.find(c => c.id === selectedClipId);
    if (!clip) return;

    // Check if playhead is within the clip boundaries (with a small buffer)
    if (currentTime <= clip.start + 0.05 || currentTime >= clip.start + clip.duration - 0.05) {
        return; // Too close to edge
    }

    const splitPointRelativeToClip = currentTime - clip.start;
    
    // Create first half
    const clip1: Clip = {
        ...clip,
        id: generateId(),
        duration: splitPointRelativeToClip
    };

    // Create second half
    const clip2: Clip = {
        ...clip,
        id: generateId(),
        start: currentTime,
        duration: clip.duration - splitPointRelativeToClip,
        offset: clip.offset + splitPointRelativeToClip
    };

    setClips(prev => {
        const others = prev.filter(c => c.id !== clip.id);
        return [...others, clip1, clip2];
    });
    
    // Select the second part
    setSelectedClipId(clip2.id);
  };

  const togglePlay = () => {
      resumeAudioContext();
      setIsPlaying(!isPlaying);
  };

  // === Export Logic ===
  const handleExport = () => {
    if (isExporting) return;
    
    resumeAudioContext();
    setIsPlaying(false);
    setCurrentTime(0);
    setIsExporting(true);
    recordedChunksRef.current = [];

    // Small timeout to allow state to settle and canvas to render frame 0
    setTimeout(() => {
        if (!canvasRef.current || !audioDestRef.current) return;

        // 1. Capture Video Stream from Canvas
        // Note: captureStream frame rate does not define resolution, the canvas size does.
        const canvasStream = canvasRef.current.captureStream(30); // 30 FPS
        
        // 2. Capture Audio Stream from Web Audio API Destination
        const audioTrack = audioDestRef.current.stream.getAudioTracks()[0];
        
        // 3. Combine
        const combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...(audioTrack ? [audioTrack] : [])
        ]);

        // 4. Initialize Recorder
        // Try to use MP4 if supported by the browser (Chrome 105+, Safari, etc.)
        let mimeType = 'video/webm;codecs=vp9';
        if (MediaRecorder.isTypeSupported('video/mp4')) {
             mimeType = 'video/mp4';
        } else if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E,mp4a.40.2')) {
             mimeType = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2';
        } else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) {
             mimeType = 'video/webm;codecs=h264';
        }

        // Adjust bitrate based on resolution
        // Approximation: Width * Height * 4 bits per pixel factor for decent quality
        // 720p ~= 5Mbps, 1080p ~= 8Mbps
        const pixelCount = currentResolution.width * currentResolution.height;
        let bitrate = 5000000; 
        if (pixelCount >= 1920 * 1080) {
            bitrate = 8000000;
        } else if (pixelCount < 1280 * 720) {
            // Lower bitrate for smaller resolutions to save space, but keep quality high
            bitrate = 3000000;
        }
        
        console.log(`Exporting: ${currentResolution.width}x${currentResolution.height} @ ${mimeType}, Bitrate: ${bitrate}`);

        const recorder = new MediaRecorder(combinedStream, {
            mimeType,
            videoBitsPerSecond: bitrate 
        });

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                recordedChunksRef.current.push(e.data);
            }
        };

        recorder.onstop = () => {
            const blob = new Blob(recordedChunksRef.current, { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            
            // Determine file extension based on actual mime type
            const isMp4 = mimeType.includes('mp4');
            const ext = isMp4 ? 'mp4' : 'webm';
            
            a.download = `video_export_${currentResolution.width}x${currentResolution.height}_${Date.now()}.${ext}`;
            a.click();
            URL.revokeObjectURL(url);
            
            // Reset state
            setIsExporting(false);
            setCurrentTime(0);
        };

        mediaRecorderRef.current = recorder;
        
        // 5. Start Recording & Playback
        recorder.start();
        setIsPlaying(true);
    }, 200);
  };

  // Watch for end of export
  useEffect(() => {
      if (isExporting && !isPlaying && currentTime >= totalDuration) {
          mediaRecorderRef.current?.stop();
      }
  }, [isExporting, isPlaying, currentTime, totalDuration]);


  return (
    <div className="h-screen w-screen bg-gray-950 flex flex-col text-white font-sans">
      {/* Header */}
      <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-md flex items-center justify-center">
                <span className="font-bold text-white">V</span>
            </div>
            <h1 className="font-semibold text-gray-200">React Editor</h1>
        </div>
        <div className="flex items-center gap-4">
             <div className="bg-gray-800 px-3 py-1 rounded text-sm font-mono text-blue-400 flex items-center gap-2">
                 <span>{formatTime(currentTime)}</span>
                 <span className="text-gray-600">/</span>
                 <div className="flex items-center gap-1">
                     <span className="text-gray-500 text-xs">END:</span>
                     <input 
                        type="number" 
                        value={Math.round(totalDuration * 10) / 10} 
                        readOnly
                        className="bg-transparent border-b border-transparent w-16 text-center focus:outline-none text-gray-400 cursor-default"
                        title="Auto-calculated end time"
                     />
                     <span className="text-gray-500 text-xs">s</span>
                 </div>
             </div>
             
             {/* Resolution Selector */}
             <div className="flex items-center gap-2 bg-gray-800 px-2 py-1 rounded border border-gray-700">
                <Settings size={14} className="text-gray-400"/>
                <select 
                    value={resolutionState} 
                    onChange={(e) => setResolutionState(e.target.value as ResolutionOption)}
                    disabled={isExporting}
                    className="bg-transparent text-xs text-gray-300 focus:outline-none cursor-pointer"
                >
                    <option value="720p">720p (HD)</option>
                    <option value="1080p">1080p (FHD)</option>
                    <option value="source">Source ({resolutionState === 'source' ? `${currentResolution.width}x${currentResolution.height}` : 'Auto'})</option>
                    <option value="custom">Custom</option>
                </select>
                
                {resolutionState === 'custom' && (
                    <div className="flex items-center gap-1 ml-2 border-l border-gray-700 pl-2">
                        <input 
                            type="number"
                            value={customResolution.width}
                            onChange={(e) => setCustomResolution(prev => ({...prev, width: parseInt(e.target.value) || 0}))}
                            className="bg-transparent border-b border-gray-600 w-10 text-xs text-center focus:outline-none text-gray-300"
                            placeholder="W"
                        />
                        <span className="text-xs text-gray-500">x</span>
                        <input 
                            type="number"
                            value={customResolution.height}
                            onChange={(e) => setCustomResolution(prev => ({...prev, height: parseInt(e.target.value) || 0}))}
                            className="bg-transparent border-b border-gray-600 w-10 text-xs text-center focus:outline-none text-gray-300"
                            placeholder="H"
                        />
                    </div>
                )}
             </div>

             <button 
                onClick={handleExport}
                disabled={isExporting}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm transition-colors ${isExporting ? 'bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
            >
                {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {isExporting ? 'Exporting...' : 'Export'}
             </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-grow flex overflow-hidden">
         <div className="flex-grow flex flex-col">
            <div className="flex-grow bg-gray-950 p-4 flex items-center justify-center relative">
                <div className="aspect-video h-full max-h-[50vh] shadow-lg">
                    <Player 
                        currentTime={currentTime} 
                        clips={clips} 
                        tracks={tracks}
                        isPlaying={isPlaying}
                        canvasRef={canvasRef}
                        width={currentResolution.width}
                        height={currentResolution.height}
                    />
                </div>
            </div>
            
            {/* Toolbar */}
            <div className="h-12 bg-gray-900 border-y border-gray-800 flex items-center justify-center gap-6">
                <button onClick={() => setCurrentTime(0)} className="text-gray-400 hover:text-white" disabled={isExporting}>
                    Back
                </button>
                <button 
                    onClick={togglePlay}
                    disabled={isExporting}
                    className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-black hover:bg-gray-200 transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1"/>}
                </button>
                
                <div className="w-px h-6 bg-gray-800 mx-2"></div>
                
                <button 
                    onClick={handleSplitClip}
                    disabled={!selectedClipId || isExporting}
                    className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-gray-800 text-gray-300 disabled:opacity-30 disabled:hover:bg-transparent"
                    title="Split Clip at Playhead"
                >
                    <Scissors size={16} />
                    <span className="text-xs">Split</span>
                </button>

                <div className="w-px h-6 bg-gray-800 mx-2"></div>

                <button onClick={() => setClips([])} className="text-gray-400 hover:text-red-400 text-xs" disabled={isExporting}>
                    Clear All
                </button>
            </div>

            {/* Timeline */}
            <div className="h-[40vh] flex flex-col">
                 <div className="bg-gray-900 border-b border-gray-800 p-2 flex gap-4 overflow-x-auto">
                    {tracks.map(track => (
                        <div key={track.id} className="relative group">
                            <label className={`flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-md cursor-pointer border border-gray-700 hover:border-gray-600 transition-all ${isExporting ? 'pointer-events-none opacity-50' : ''}`}>
                                <Plus size={14} className={track.type === 'video' ? 'text-blue-400' : 'text-green-400'} />
                                <span className="text-xs font-medium">Add to {track.name}</span>
                                <input 
                                    type="file" 
                                    accept={track.type === 'video' ? "video/*" : "audio/*"} 
                                    className="hidden" 
                                    onChange={(e) => handleFileUpload(e, track.id, track.type)}
                                    disabled={isExporting}
                                />
                            </label>
                        </div>
                    ))}
                 </div>
                 
                 <div className="flex-grow overflow-hidden relative">
                    <Timeline 
                        tracks={tracks} 
                        clips={clips} 
                        currentTime={currentTime} 
                        duration={totalDuration}
                        onSeek={(t) => !isExporting && setCurrentTime(t)}
                        onClipUpdate={handleClipUpdate}
                        onDeleteClip={handleDeleteClip}
                        selectedClipId={selectedClipId}
                        onSelectClip={setSelectedClipId}
                        onTrackDrop={handleTrackDrop}
                    />
                 </div>
            </div>
         </div>
      </div>
    </div>
  );
};

export default App;