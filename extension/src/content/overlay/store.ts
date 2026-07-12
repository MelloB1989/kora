// Zustand store backing the overlay UI. Fed by SwToCs Port messages and by
// the SyncEngine status; actions send CsToSw messages back to the worker.

import { create } from "zustand";
import type { PlatformAdapter } from "../../adapters/PlatformAdapter";
import type { MemberInfo, RoomInfo } from "../../shared/protocol";
import type { PlatformId } from "../../shared/platforms";
import type { ConnState, SwToCs } from "../../shared/messages";
import type { SwPort } from "../port";
import { playSound } from "../soundbox";
import type { SyncStatus } from "../syncEngine";

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  ts: number;
  mine: boolean;
}

export interface Burst {
  id: string;
  emoji: string;
}

const MAX_MESSAGES = 200;
let seq = 0;
const uid = () => `${Date.now()}-${seq++}`;

export interface OverlayState {
  // auth
  authed: boolean;
  userId?: string;
  displayName?: string;
  authError?: string;
  // connection + room
  conn: ConnState;
  room?: RoomInfo;
  members: MemberInfo[];
  joinUrl?: string;
  roomError?: string;
  sync: SyncStatus;
  // social
  messages: ChatMessage[];
  bursts: Burst[];
  // ui
  collapsed: boolean;
  contentId: string | null;
  platform: PlatformId | null;
  tab: "room" | "chat";

  toggleCollapsed: () => void;
  setTab: (tab: "room" | "chat") => void;
  removeBurst: (id: string) => void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
  authed: false,
  conn: "disconnected",
  members: [],
  sync: { state: "idle" },
  messages: [],
  bursts: [],
  collapsed: false,
  contentId: null,
  platform: null,
  tab: "room",
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
  setTab: (tab) => set({ tab }),
  removeBurst: (id) => set((s) => ({ bursts: s.bursts.filter((b) => b.id !== id) })),
}));

// applyMessage folds a worker message into the store.
export function applyMessage(msg: SwToCs): void {
  const set = useOverlayStore.setState;
  switch (msg.kind) {
    case "session":
      set({
        authed: msg.session.authed,
        userId: msg.session.userId,
        displayName: msg.session.displayName,
        authError: undefined,
      });
      break;
    case "authError":
      set({ authError: msg.message });
      break;
    case "conn":
      set({ conn: msg.state });
      break;
    case "roomState":
      set({ room: msg.room, members: msg.members, roomError: undefined });
      break;
    case "createdRoom":
      set({ joinUrl: msg.joinUrl });
      break;
    case "memberJoined":
      set((s) => ({
        members: s.members.some((m) => m.userId === msg.member.userId)
          ? s.members
          : [...s.members, msg.member],
      }));
      break;
    case "memberLeft":
      set((s) => ({ members: s.members.filter((m) => m.userId !== msg.userId) }));
      break;
    case "hostChanged":
      set((s) => ({
        room: s.room ? { ...s.room, hostUserId: msg.userId } : s.room,
        members: s.members.map((m) => ({ ...m, isHost: m.userId === msg.userId })),
      }));
      break;
    case "roomError":
      set({ roomError: `${msg.code}: ${msg.message}` });
      break;
    case "chat":
      pushMessage({
        id: uid(),
        senderId: msg.senderId,
        senderName: msg.senderName,
        text: msg.text,
        ts: msg.ts,
        mine: false,
      });
      break;
    case "reaction":
      pushBurst(msg.emoji);
      break;
    case "soundbox":
      playSound(msg.soundId);
      break;
  }
}

function pushMessage(m: ChatMessage): void {
  useOverlayStore.setState((s) => ({ messages: [...s.messages, m].slice(-MAX_MESSAGES) }));
}

function pushBurst(emoji: string): void {
  const b = { id: uid(), emoji };
  useOverlayStore.setState((s) => ({ bursts: [...s.bursts, b] }));
}

export function setSyncStatus(sync: SyncStatus): void {
  useOverlayStore.setState({ sync });
}

export function setContentId(contentId: string | null): void {
  useOverlayStore.setState({ contentId });
}

export function setPlatform(platform: PlatformId): void {
  useOverlayStore.setState({ platform });
}

// Bound action creators used by components (need the live port + adapter).
export interface OverlayActions {
  login: (email: string, password: string) => void;
  signup: (email: string, password: string, displayName: string) => void;
  logout: () => void;
  createRoom: () => void;
  joinRoom: (roomId: string) => void;
  leaveRoom: () => void;
  sendChat: (text: string) => void;
  sendReaction: (emoji: string) => void;
  sendSoundbox: (soundId: string) => void;
}

export function makeActions(port: SwPort, adapter: PlatformAdapter): OverlayActions {
  return {
    login: (email, password) => port.send({ kind: "login", email, password }),
    signup: (email, password, displayName) =>
      port.send({ kind: "signup", email, password, displayName }),
    logout: () => port.send({ kind: "logout" }),
    createRoom: async () => {
      const contentId = adapter.getContentId();
      if (!contentId) {
        useOverlayStore.setState({ roomError: "Open a title first, then create a room." });
        return;
      }
      const title =
        (await adapter.getTitle().catch(() => null)) ??
        document.title.replace(/\s*[-|].*$/, "").trim();
      port.send({ kind: "createRoom", platform: adapter.platform, contentId, title });
    },
    joinRoom: (roomId) => port.send({ kind: "joinRoom", roomId }),
    leaveRoom: () => {
      port.send({ kind: "leaveRoom" });
      useOverlayStore.setState({ room: undefined, members: [], joinUrl: undefined, messages: [] });
    },
    // The backend relays to others only, so echo our own action locally.
    sendChat: (text) => {
      const t = text.trim();
      if (!t) return;
      port.send({ kind: "chat", text: t });
      const { userId, displayName } = useOverlayStore.getState();
      pushMessage({
        id: uid(),
        senderId: userId ?? "",
        senderName: displayName ?? "You",
        text: t,
        ts: Date.now(),
        mine: true,
      });
    },
    sendReaction: (emoji) => {
      port.send({ kind: "reaction", emoji });
      pushBurst(emoji);
    },
    sendSoundbox: (soundId) => {
      port.send({ kind: "soundbox", soundId });
      playSound(soundId);
    },
  };
}
