// Internal message types passed over the Port between the content script and
// the service worker, and over window.postMessage between the content script
// (isolated world) and the page script (MAIN world).

import type {
  MemberInfo,
  PlaybackAction,
  PlaybackedState,
  RoomInfo,
  SignalPayload,
} from "./protocol";

// ---- Content script → Service worker (Port) ----
export type CsToSw =
  | { kind: "login"; email: string; password: string }
  | { kind: "signup"; email: string; password: string; displayName: string }
  | { kind: "logout" }
  | { kind: "getSession" }
  | { kind: "createRoom"; platform: string; contentId: string; title: string }
  | { kind: "joinRoom"; roomId: string }
  | { kind: "leaveRoom" }
  // Local playback action to broadcast to the room.
  | { kind: "playback"; action: PlaybackAction; currentTime: number; mediaTimestamp: number; contentId?: string }
  // Host-only periodic position report.
  | { kind: "heartbeat"; currentTime: number; paused: boolean; mediaTimestamp: number }
  // Social layer.
  | { kind: "chat"; text: string }
  | { kind: "reaction"; emoji: string }
  | { kind: "soundbox"; soundId: string }
  // WebRTC signaling to one target member.
  | { kind: "signal"; target: string; payload: SignalPayload };

// ---- Service worker → Content script (Port) ----
export type ConnState = "disconnected" | "connecting" | "connected";

export interface SessionInfo {
  authed: boolean;
  userId?: string;
  displayName?: string;
}

export type SwToCs =
  | { kind: "session"; session: SessionInfo }
  | { kind: "authError"; message: string }
  | { kind: "conn"; state: ConnState }
  | { kind: "roomState"; room: RoomInfo; members: MemberInfo[]; playback?: PlaybackedState }
  | { kind: "roomError"; code: string; message: string }
  | { kind: "createdRoom"; roomId: string; joinUrl: string }
  | { kind: "memberJoined"; member: MemberInfo }
  | { kind: "memberLeft"; userId: string }
  | { kind: "hostChanged"; userId: string }
  // A remote playback action to apply to the local player.
  | { kind: "remotePlayback"; senderId: string; action: PlaybackAction; currentTime: number; mediaTimestamp: number; seq?: number }
  // A host sync correction (drift check).
  | { kind: "remoteSync"; senderId: string; currentTime: number; paused: boolean; mediaTimestamp: number; seq?: number }
  // Social layer (relayed from other members).
  | { kind: "chat"; senderId: string; senderName: string; text: string; ts: number }
  | { kind: "reaction"; senderId: string; senderName: string; emoji: string }
  | { kind: "soundbox"; senderId: string; senderName: string; soundId: string }
  // WebRTC signaling from a peer.
  | { kind: "remoteSignal"; senderId: string; senderName: string; payload: SignalPayload };

export const PORT_NAME = "wt-port";

// ---- Content script (isolated) ↔ Page script (MAIN world) ----
export const PAGE_SOURCE_CONTENT = "wt-content";
export const PAGE_SOURCE_PAGE = "wt-page";

// Request/response RPC over window.postMessage. cmd is a player operation.
export type PageCommand =
  | { cmd: "getState" }
  | { cmd: "play" }
  | { cmd: "pause" }
  | { cmd: "seek"; seconds: number }
  | { cmd: "getTitle" };

export interface PageRequest {
  source: typeof PAGE_SOURCE_CONTENT;
  id: number;
  command: PageCommand;
}

export interface PagePlayerState {
  currentTime: number; // seconds
  paused: boolean;
  duration: number;
}

// Response to a request, or an unsolicited event (id === 0).
export type PageEvent =
  | { source: typeof PAGE_SOURCE_PAGE; id: number; ok: true; result: unknown }
  | { source: typeof PAGE_SOURCE_PAGE; id: number; ok: false; error: string }
  | { source: typeof PAGE_SOURCE_PAGE; id: 0; event: "userAction"; action: PlaybackAction; state: PagePlayerState }
  | { source: typeof PAGE_SOURCE_PAGE; id: 0; event: "ready" }
  | { source: typeof PAGE_SOURCE_PAGE; id: 0; event: "unavailable"; reason: string };
