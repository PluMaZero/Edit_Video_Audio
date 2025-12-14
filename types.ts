export interface Clip {
  id: string;
  trackId: string;
  source: string; // URL.createObjectURL
  file: File;
  type: 'video' | 'audio';
  start: number; // Start time on the timeline (seconds)
  duration: number; // Duration of the clip on timeline (seconds) (trimmed duration)
  offset: number; // Start time within the source media (seconds) (trim start)
  totalDuration: number; // Total duration of the source file
  name: string;
  thumbnail?: string;
  width?: number; // Video width
  height?: number; // Video height
}

export interface Track {
  id: string;
  type: 'video' | 'audio';
  name: string;
  color: string;
  isMuted: boolean;
}

export type DragMode = 'move' | 'trim-start' | 'trim-end' | null;

export interface DragState {
  isDragging: boolean;
  mode: DragMode;
  clipId: string | null;
  startX: number;
  originalStart: number;
  originalDuration: number;
  originalOffset: number;
}