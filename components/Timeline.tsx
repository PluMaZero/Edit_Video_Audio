import React, { useRef, useState, useEffect } from 'react';
import { Clip, Track, DragState, DragMode } from '../types';
import { formatTime, PIXELS_PER_SECOND, getClipStyle } from '../utils';
import { Scissors, Volume2, Video, GripVertical } from 'lucide-react';

const SNAP_GRID = 0.02;

interface TimelineProps {
  tracks: Track[];
  clips: Clip[];
  currentTime: number;
  duration: number; // Total timeline duration
  selectedClipId: string | null;
  onSeek: (time: number) => void;
  onClipUpdate: (clipId: string, updates: Partial<Clip>) => void;
  onDeleteClip: (clipId: string) => void;
  onSelectClip: (clipId: string | null) => void;
  onTrackDrop: (trackId: string, files: FileList) => void;
}

const Timeline: React.FC<TimelineProps> = ({
  tracks,
  clips,
  currentTime,
  selectedClipId,
  onSeek,
  onClipUpdate,
  onDeleteClip,
  onSelectClip,
  onTrackDrop,
  duration
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom] = useState(1); // Future feature: zoom level
  const scale = PIXELS_PER_SECOND * zoom;
  
  // Drag State
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    mode: null,
    clipId: null,
    startX: 0,
    originalStart: 0,
    originalDuration: 0,
    originalOffset: 0,
  });

  const [draggingOverTrack, setDraggingOverTrack] = useState<string | null>(null);

  const handleMouseDown = (e: React.MouseEvent, clip: Clip, mode: DragMode) => {
    e.stopPropagation();
    // Select the clip when interaction starts
    onSelectClip(clip.id);
    
    setDragState({
      isDragging: true,
      mode,
      clipId: clip.id,
      startX: e.clientX,
      originalStart: clip.start,
      originalDuration: clip.duration,
      originalOffset: clip.offset,
    });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!dragState.isDragging || !dragState.clipId) return;

    const deltaX = e.clientX - dragState.startX;
    const deltaSeconds = deltaX / scale;
    
    // Find clip
    const clip = clips.find(c => c.id === dragState.clipId);
    if (!clip) return;

    let updates: Partial<Clip> = {};

    if (dragState.mode === 'move') {
      const rawNewStart = Math.max(0, dragState.originalStart + deltaSeconds);
      // Snap start time to grid
      const newStart = Math.round(rawNewStart / SNAP_GRID) * SNAP_GRID;
      updates = { start: newStart };
    } 
    else if (dragState.mode === 'trim-start') {
      // Trimming the left side:
      // Start increases, Duration decreases, Offset increases
      
      // Calculate intended start position based on mouse delta
      let rawNewStart = dragState.originalStart + deltaSeconds;
      
      // Snap the intended start to grid
      const newStart = Math.round(rawNewStart / SNAP_GRID) * SNAP_GRID;
      
      // Calculate the effective delta based on the snapped start
      let finalDelta = newStart - dragState.originalStart;

      // Apply constraints
      // Limit 1: Cannot make duration less than 0.1s
      // Limit 2: Cannot trim past the beginning of source (offset cannot be negative)
      const maxDelta = dragState.originalDuration - 0.1;
      const minDelta = -dragState.originalOffset;
      
      finalDelta = Math.min(Math.max(finalDelta, minDelta), maxDelta);
      
      updates = {
        start: dragState.originalStart + finalDelta,
        duration: dragState.originalDuration - finalDelta,
        offset: dragState.originalOffset + finalDelta
      };
    } 
    else if (dragState.mode === 'trim-end') {
        // Trimming the right side:
        // Duration changes
        
        let rawNewDuration = dragState.originalDuration + deltaSeconds;
        // Snap duration to grid
        let newDuration = Math.round(rawNewDuration / SNAP_GRID) * SNAP_GRID;
        
        // Min duration check
        newDuration = Math.max(0.1, newDuration);
        
        // Limit: Duration + Offset cannot exceed TotalDuration
        // Note: We prioritize the file limit over snapping if we hit the end of the file
        if (dragState.originalOffset + newDuration <= clip.totalDuration) {
             updates = { duration: newDuration };
        } else {
             updates = { duration: clip.totalDuration - dragState.originalOffset };
        }
    }

    onClipUpdate(clip.id, updates);
  };

  const handleMouseUp = () => {
    setDragState(prev => ({ ...prev, isDragging: false, clipId: null, mode: null }));
  };

  // Add global event listeners for drag
  useEffect(() => {
    if (dragState.isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState]);

  const handleTimelineClick = (e: React.MouseEvent) => {
      if (dragState.isDragging) return;
      
      // Deselect if clicking on empty timeline area
      onSelectClip(null);

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      // Calculate x position relative to the scrollable container content
      const x = e.clientX - rect.left + (containerRef.current?.scrollLeft || 0);
      
      // Removed the "- 64" offset subtraction which was causing incorrect positioning
      // The rect.left already accounts for the sidebar offset relative to the viewport.
      const time = Math.max(0, x / scale); 
      
      // Snap seek time to grid
      const snappedTime = Math.round(time / SNAP_GRID) * SNAP_GRID;
      onSeek(snappedTime);
  };

  // Drag and Drop handlers for Track Lanes
  const handleTrackDragOver = (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggingOverTrack !== trackId) {
        setDraggingOverTrack(trackId);
    }
  };

  const handleTrackDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingOverTrack(null);
  };

  const handleTrackDrop = (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingOverTrack(null);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onTrackDrop(trackId, e.dataTransfer.files);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 select-none">
      {/* Time Ruler */}
      <div className="h-8 bg-gray-950 border-b border-gray-800 flex sticky top-0 z-20">
        <div className="w-16 flex-shrink-0 bg-gray-900 border-r border-gray-800"></div>
        <div 
            className="flex-grow relative overflow-hidden cursor-pointer"
            ref={containerRef}
            onClick={handleTimelineClick}
        >
           {/* Simple ticks based on duration */}
           {/* We render ticks up to duration + buffer, or just dynamic based on width */}
           <div style={{ width: `${duration * scale}px`, height: '100%' }}>
             {Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => (
               <div 
                key={i} 
                className="absolute top-0 bottom-0 border-l border-gray-700 text-[10px] text-gray-500 pl-1 pt-1"
                style={{ left: `${i * scale}px` }}
               >
                   {formatTime(i)}
               </div>
             ))}
           </div>
           
           {/* Playhead */}
            <div 
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none"
                style={{ left: `${currentTime * scale}px`, height: '100vh' }} 
            >
                <div className="w-3 h-3 -ml-1.5 bg-red-500 transform rotate-45 -mt-1.5"></div>
            </div>
        </div>
      </div>

      {/* Tracks Container */}
      <div className="flex-grow overflow-y-auto overflow-x-auto relative">
        <div className="inline-block" style={{ width: `${Math.max(duration * scale, 100)}px` }}>
            {tracks.map((track) => (
            <div key={track.id} className="flex h-24 border-b border-gray-800 relative group">
                {/* Track Header */}
                <div className="w-16 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col items-center justify-center gap-2 z-10 sticky left-0">
                    {track.type === 'video' ? <Video size={16} className="text-blue-400"/> : <Volume2 size={16} className="text-green-400"/>}
                    <span className="text-xs text-gray-500 truncate w-12 text-center">{track.name}</span>
                </div>

                {/* Track Lane */}
                <div 
                    className={`relative flex-grow h-full transition-colors duration-200 
                        ${draggingOverTrack === track.id ? 'bg-gray-800/80 border-2 border-dashed border-blue-500' : 'bg-gray-900/50'}`}
                    onDragOver={(e) => handleTrackDragOver(e, track.id)}
                    onDragLeave={handleTrackDragLeave}
                    onDrop={(e) => handleTrackDrop(e, track.id)}
                >
                    {clips.filter(c => c.trackId === track.id).map(clip => {
                        const isSelected = selectedClipId === clip.id;
                        const isDragging = dragState.clipId === clip.id;
                        
                        return (
                        <div
                            key={clip.id}
                            className={`absolute h-20 top-2 rounded-md overflow-hidden border border-opacity-50 group-hover:border-opacity-100 flex flex-col
                                ${clip.type === 'video' ? 'bg-blue-900/40 border-blue-500' : 'bg-green-900/40 border-green-500'}
                                ${isDragging ? 'opacity-80 ring-2 ring-white z-30 shadow-lg' : (isSelected ? 'ring-2 ring-yellow-400 z-20' : 'z-10')}
                            `}
                            style={getClipStyle(clip.start, clip.duration, scale)}
                            onMouseDown={(e) => handleMouseDown(e, clip, 'move')}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                if(confirm('Delete clip?')) onDeleteClip(clip.id);
                            }}
                        >
                            {/* Visual representation */}
                            <div className="flex-grow flex items-center px-2 overflow-hidden select-none pointer-events-none">
                                {clip.type === 'video' ? (
                                    <div className="flex w-full gap-1 opacity-50">
                                         {/* Mock Filmstrip */}
                                         {Array.from({length: Math.ceil(clip.duration)}).map((_, i) => (
                                             <div key={i} className="h-12 w-16 bg-gray-800 rounded-sm flex-shrink-0 border border-gray-700"></div>
                                         ))}
                                    </div>
                                ) : (
                                    // Mock Waveform
                                    <div className="w-full h-8 flex items-end justify-between gap-[1px] opacity-60">
                                         {Array.from({length: 40}).map((_, i) => (
                                             <div key={i} className="w-1 bg-green-400" style={{ height: `${Math.random() * 100}%`}}></div>
                                         ))}
                                    </div>
                                )}
                            </div>
                            
                            {/* Label */}
                            <div className="absolute top-0 left-0 right-0 bg-black/40 px-2 py-0.5 text-[10px] text-white truncate pointer-events-none">
                                {clip.name}
                            </div>

                            {/* Handles */}
                            <div 
                                className="absolute left-0 top-0 bottom-0 w-4 cursor-ew-resize hover:bg-white/20 flex items-center justify-center group/handle"
                                onMouseDown={(e) => handleMouseDown(e, clip, 'trim-start')}
                            >
                                <div className="w-1 h-8 bg-white/30 rounded-full group-hover/handle:bg-white"></div>
                            </div>
                            <div 
                                className="absolute right-0 top-0 bottom-0 w-4 cursor-ew-resize hover:bg-white/20 flex items-center justify-center group/handle"
                                onMouseDown={(e) => handleMouseDown(e, clip, 'trim-end')}
                            >
                                <div className="w-1 h-8 bg-white/30 rounded-full group-hover/handle:bg-white"></div>
                            </div>
                        </div>
                    )})}
                </div>
            </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default Timeline;