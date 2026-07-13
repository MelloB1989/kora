// WebSocket wire protocol — mirror of backend/internal/relay/protocol.go and
// docs/ws-protocol.md. Keep the three in sync.

export const PROTOCOL_VERSION = 1;

export const ClientType = {
  JoinRoom: "join_room",
  LeaveRoom: "leave_room",
  PlaybackEvent: "playback_event",
  Heartbeat: "heartbeat",
  Ping: "ping",
  Chat: "chat",
  Reaction: "reaction",
  Soundbox: "soundbox",
  Signal: "webrtc_signal",
} as const;

export const ServerType = {
  RoomState: "room_state",
  MemberJoined: "member_joined",
  MemberLeft: "member_left",
  PlaybackEvent: "playback_event",
  Sync: "sync",
  HostChanged: "host_changed",
  Error: "error",
  Pong: "pong",
  Chat: "chat",
  Reaction: "reaction",
  Soundbox: "soundbox",
  Signal: "webrtc_signal",
} as const;

export type PlaybackAction = "play" | "pause" | "seek";

export interface Envelope<P = unknown> {
  v: number;
  type: string;
  roomId?: string;
  senderId?: string;
  senderName?: string;
  target?: string;
  ts?: number;
  seq?: number;
  payload?: P;
}

export interface ChatPayload {
  text: string;
}

export interface ReactionPayload {
  emoji: string;
}

export interface SoundboxPayload {
  soundId: string;
}

// WebRTC signaling payload (SDP offer/answer or ICE candidate).
export interface SignalPayload {
  kind: "offer" | "answer" | "candidate";
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface JoinRoomPayload {
  roomId: string;
}

export interface PlaybackPayload {
  action: PlaybackAction;
  currentTime: number; // seconds
  duration?: number; // seconds
  mediaTimestamp: number; // epoch ms when currentTime was read
  contentId?: string;
}

export interface HeartbeatPayload {
  currentTime: number;
  duration?: number;
  paused: boolean;
  mediaTimestamp: number;
}

export interface MemberInfo {
  userId: string;
  displayName: string;
  isHost: boolean;
}

export interface RoomInfo {
  roomId: string;
  hostUserId: string;
  platform: string;
  contentId: string;
  title?: string;
  status: string;
}

export interface PlaybackedState {
  action?: PlaybackAction;
  currentTime: number;
  paused: boolean;
  mediaTimestamp: number;
}

export interface RoomStatePayload {
  room: RoomInfo;
  members: MemberInfo[];
  playback?: PlaybackedState;
}

export interface HostChangedPayload {
  userId: string;
}

export interface MemberLeftPayload {
  userId: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}
