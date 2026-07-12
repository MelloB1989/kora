// Zustand store backing the overlay UI. Fed by SwToCs Port messages and by
// the SyncEngine status; actions send CsToSw messages back to the worker.

import { create } from "zustand";
import type { MemberInfo, RoomInfo } from "../../shared/protocol";
import type { ConnState, SwToCs } from "../../shared/messages";
import type { SwPort } from "../port";
import type { SyncStatus } from "../syncEngine";

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
  // ui
  collapsed: boolean;
  contentId: string | null;

  toggleCollapsed: () => void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
  authed: false,
  conn: "disconnected",
  members: [],
  sync: { state: "idle" },
  collapsed: false,
  contentId: null,
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
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
  }
}

export function setSyncStatus(sync: SyncStatus): void {
  useOverlayStore.setState({ sync });
}

export function setContentId(contentId: string | null): void {
  useOverlayStore.setState({ contentId });
}

// Bound action creators used by components (need the live port + adapter).
export interface OverlayActions {
  login: (email: string, password: string) => void;
  signup: (email: string, password: string, displayName: string) => void;
  logout: () => void;
  createRoom: () => void;
  joinRoom: (roomId: string) => void;
  leaveRoom: () => void;
}

export function makeActions(port: SwPort, getContentId: () => string | null): OverlayActions {
  return {
    login: (email, password) => port.send({ kind: "login", email, password }),
    signup: (email, password, displayName) =>
      port.send({ kind: "signup", email, password, displayName }),
    logout: () => port.send({ kind: "logout" }),
    createRoom: () => {
      const contentId = getContentId();
      if (!contentId) {
        useOverlayStore.setState({ roomError: "Open a Netflix title first." });
        return;
      }
      const title = document.title.replace(/\s*[-|].*$/, "").trim();
      port.send({ kind: "createRoom", contentId, title });
    },
    joinRoom: (roomId) => port.send({ kind: "joinRoom", roomId }),
    leaveRoom: () => {
      port.send({ kind: "leaveRoom" });
      useOverlayStore.setState({ room: undefined, members: [], joinUrl: undefined });
    },
  };
}
