// Call state for the voice/video overlay. MediaStream objects are held here
// by reference (they aren't serialized); the MeshManager drives updates via
// the setters below and the VideoTiles component reads them.

import { create } from "zustand";

export interface Tile {
  userId: string;
  name: string;
  stream: MediaStream;
  isLocal: boolean;
}

// Controls the overlay invokes; implemented in content/index.ts against the
// MeshManager.
export interface CallControls {
  toggleMute: () => void;
  toggleCamera: () => void;
  leaveCall: () => void;
  pushToTalk: (down: boolean) => void;
}

export interface CallController extends CallControls {
  startCall: (video: boolean) => void;
}

export interface CallState {
  inCall: boolean;
  connecting: boolean;
  muted: boolean;
  cameraOn: boolean;
  hasVideo: boolean;
  error?: string;
  tiles: Tile[];
}

export const useCallStore = create<CallState>(() => ({
  inCall: false,
  connecting: false,
  muted: false,
  cameraOn: true,
  hasVideo: false,
  tiles: [],
}));

export const callActions = {
  setLocalStream(stream: MediaStream | null, name: string, userId: string): void {
    useCallStore.setState((s) => {
      const others = s.tiles.filter((t) => !t.isLocal);
      return {
        tiles: stream ? [{ userId, name, stream, isLocal: true }, ...others] : others,
        hasVideo: (stream?.getVideoTracks().length ?? 0) > 0,
      };
    });
  },
  addRemote(userId: string, name: string, stream: MediaStream): void {
    useCallStore.setState((s) => ({
      tiles: [...s.tiles.filter((t) => t.userId !== userId), { userId, name, stream, isLocal: false }],
    }));
  },
  removeRemote(userId: string): void {
    useCallStore.setState((s) => ({ tiles: s.tiles.filter((t) => t.userId !== userId) }));
  },
  reset(): void {
    useCallStore.setState({ inCall: false, connecting: false, tiles: [], error: undefined });
  },
};
