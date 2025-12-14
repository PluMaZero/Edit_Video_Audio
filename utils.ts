export const formatTime = (seconds: number): string => {
  const m = Math.floor(Math.abs(seconds) / 60);
  const s = Math.floor(Math.abs(seconds) % 60);
  const ms = Math.floor((Math.abs(seconds) % 1) * 100);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 9);
};

export const PIXELS_PER_SECOND = 100;

export const getClipStyle = (clipStart: number, clipDuration: number, pixelsPerSecond: number) => {
  return {
    left: `${clipStart * pixelsPerSecond}px`,
    width: `${clipDuration * pixelsPerSecond}px`,
  };
};

export const getVideoMetadata = async (file: File): Promise<{ duration: number; width: number; height: number }> => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src);
      resolve({ 
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight
      });
    };
    video.src = URL.createObjectURL(file);
  });
};

export const getAudioMetadata = async (file: File): Promise<{ duration: number }> => {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      window.URL.revokeObjectURL(audio.src);
      resolve({ duration: audio.duration });
    };
    audio.src = URL.createObjectURL(file);
  });
};