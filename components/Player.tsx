import React, { useEffect, useRef, useCallback } from 'react';
import { Clip, Track } from '../types';

interface PlayerProps {
  currentTime: number;
  tracks: Track[];
  clips: Clip[];
  isPlaying: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>; // Exposed to parent
  width: number;
  height: number;
}

const Player: React.FC<PlayerProps> = ({ currentTime, clips, isPlaying, canvasRef, width, height }) => {
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  
  // Store latest props in ref to access in event handlers without dependency cycles
  const propsRef = useRef({ currentTime, clips, isPlaying, width, height });
  propsRef.current = { currentTime, clips, isPlaying, width, height };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { currentTime, clips, width: canvasWidth, height: canvasHeight } = propsRef.current;

    // Ensure canvas internal resolution matches the requested resolution
    if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
    }

    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Find active video
    const activeVideoClip = clips.find(
      clip => 
        clip.type === 'video' && 
        currentTime >= clip.start && 
        currentTime < clip.start + clip.duration
    );

    if (activeVideoClip) {
      const videoEl = videoRefs.current.get(activeVideoClip.id);
      if (videoEl) {
        // Draw if we have data
        if (videoEl.readyState >= 2) {
            // Simple stretch fill. For letterboxing, we'd need more logic.
            ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        }
      }
    } else {
        // No signal
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${Math.floor(canvas.height / 20)}px sans-serif`; // Scale font
        ctx.fillStyle = '#555';
        ctx.textAlign = 'center';
        ctx.fillText('No Signal', canvas.width / 2, canvas.height / 2);
    }
  }, [canvasRef]);

  // Manage Video Elements Lifecycle
  useEffect(() => {
    const videoClips = clips.filter(c => c.type === 'video');
    const currentIds = new Set(videoClips.map(c => c.id));

    // Cleanup old videos
    videoRefs.current.forEach((video, id) => {
      if (!currentIds.has(id)) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        videoRefs.current.delete(id);
      }
    });

    // Create new videos
    videoClips.forEach(clip => {
      if (!videoRefs.current.has(clip.id)) {
        const video = document.createElement('video');
        video.src = clip.source;
        video.muted = true;
        video.preload = 'auto';
        video.setAttribute('playsinline', 'true');
        
        // Listeners to ensure frame updates when seeking/loading
        // This is crucial for the "paused" state to show the correct frame
        video.addEventListener('loadeddata', draw);
        video.addEventListener('seeked', draw);
        
        videoRefs.current.set(clip.id, video);
      }
    });
  }, [clips, draw]);

  // Playback & Synchronization Logic
  useEffect(() => {
    const activeVideoClip = clips.find(
      clip => 
        clip.type === 'video' && 
        currentTime >= clip.start && 
        currentTime < clip.start + clip.duration
    );

    // Pause all non-active videos to save resources
    videoRefs.current.forEach((video, id) => {
        if (activeVideoClip?.id !== id) {
            video.pause();
        }
    });

    if (activeVideoClip) {
        const videoEl = videoRefs.current.get(activeVideoClip.id);
        if (videoEl) {
            const seekTime = (currentTime - activeVideoClip.start) + activeVideoClip.offset;
            
            if (isPlaying) {
                // If playing, generally let it flow, but sync if drifted
                if (Math.abs(videoEl.currentTime - seekTime) > 0.5) {
                    videoEl.currentTime = seekTime;
                }
                if (videoEl.paused) {
                    videoEl.play().catch(e => console.error("Play error", e));
                }
            } else {
                // If paused, enforce precise frame
                videoEl.pause();
                
                // Only seek if time is different enough to matter (frame accuracy)
                if (Math.abs(videoEl.currentTime - seekTime) > 0.01) {
                    videoEl.currentTime = seekTime; 
                    // 'seeked' event will trigger draw() once ready
                } else {
                    // If time is already correct, force a draw to ensure canvas isn't stale
                    // (e.g. if we just switched clips or paused exactly here)
                    requestAnimationFrame(draw);
                }
            }
        }
    } else {
        // No active clip, ensure we draw the "No Signal" screen immediately
        draw();
    }
    
    // If playing, we need a loop to paint frames as video plays
    let animationFrameId: number;
    if (isPlaying) {
        const renderLoop = () => {
            draw();
            animationFrameId = requestAnimationFrame(renderLoop);
        };
        animationFrameId = requestAnimationFrame(renderLoop);
    }

    return () => {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };

  }, [currentTime, clips, isPlaying, draw]);

  return (
    <div className="w-full h-full flex items-center justify-center bg-black rounded-lg overflow-hidden shadow-2xl border border-gray-800">
      <canvas 
        ref={canvasRef} 
        width={width} 
        height={height} 
        className="max-w-full max-h-full aspect-video object-contain"
      />
    </div>
  );
};

export default Player;