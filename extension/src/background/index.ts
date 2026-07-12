// Service worker: owns the WebSocket, auth token, and current-room state.
// Content scripts connect over a Port and drive it with CsToSw messages;
// the worker translates WS frames into SwToCs messages back to every Port.

import { alarms, local, runtime, session } from "../shared/browser";
import {
  PORT_NAME,
  type ConnState,
  type CsToSw,
  type SwToCs,
} from "../shared/messages";
import {
  ClientType,
  ServerType,
  type ChatPayload,
  type Envelope,
  type ErrorPayload,
  type HeartbeatPayload,
  type HostChangedPayload,
  type MemberInfo,
  type MemberLeftPayload,
  type PlaybackPayload,
  type ReactionPayload,
  type RoomStatePayload,
  type SoundboxPayload,
} from "../shared/protocol";
import * as api from "./api";
import { WsClient, type WsStatus } from "./wsClient";

const TOKEN_KEY = "wt_token";
const IDENTITY_KEY = "wt_identity";
const ROOM_KEY = "wt_room"; // session storage: rejoin target after SW restart

let token: string | null = null;
let identity: { userId: string; displayName: string } | null = null;
let currentRoomId: string | null = null;

const ports = new Set<chrome.runtime.Port>();

const ws = new WsClient({
  getToken: () => token,
  onMessage: handleWsFrame,
  onStatus: (s) => broadcast({ kind: "conn", state: s as ConnState }),
  onOpen: () => {
    // Rejoin the room we were in before a reconnect / SW restart.
    if (currentRoomId) ws.send(ClientType.JoinRoom, { roomId: currentRoomId }, currentRoomId);
  },
});

// ---- startup: restore persisted auth + room, reconnect if possible ----
void (async () => {
  const stored = await local.get([TOKEN_KEY, IDENTITY_KEY]);
  token = (stored[TOKEN_KEY] as string) ?? null;
  identity = (stored[IDENTITY_KEY] as typeof identity) ?? null;
  const sess = await session.get(ROOM_KEY);
  currentRoomId = (sess[ROOM_KEY] as string) ?? null;
  if (token) ws.connect();
})();

// Keepalive: a periodic wake that also restores the socket if it dropped.
alarms.create("wt-keepalive", { periodInMinutes: 1 });
alarms.onAlarm.addListener((a) => {
  if (a.name === "wt-keepalive" && token && ws.status !== "connected") ws.connect();
});

runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener((msg: CsToSw) => void handleCsMessage(port, msg));
  // Push current state to the freshly connected content script.
  port.postMessage(sessionMessage());
  port.postMessage({ kind: "conn", state: ws.status as ConnState } satisfies SwToCs);
});

function sessionMessage(): SwToCs {
  return {
    kind: "session",
    session: identity
      ? { authed: true, userId: identity.userId, displayName: identity.displayName }
      : { authed: false },
  };
}

function broadcast(msg: SwToCs): void {
  for (const p of ports) {
    try {
      p.postMessage(msg);
    } catch {
      ports.delete(p);
    }
  }
}

async function persistAuth(): Promise<void> {
  if (token && identity) {
    await local.set({ [TOKEN_KEY]: token, [IDENTITY_KEY]: identity });
  } else {
    await local.remove([TOKEN_KEY, IDENTITY_KEY]);
  }
}

async function setRoom(roomId: string | null): Promise<void> {
  currentRoomId = roomId;
  if (roomId) await session.set({ [ROOM_KEY]: roomId });
  else await session.remove(ROOM_KEY);
}

// ---- content-script → worker ----
async function handleCsMessage(port: chrome.runtime.Port, msg: CsToSw): Promise<void> {
  switch (msg.kind) {
    case "getSession":
      port.postMessage(sessionMessage());
      port.postMessage({ kind: "conn", state: ws.status as ConnState } satisfies SwToCs);
      break;

    case "login":
    case "signup":
      try {
        const res =
          msg.kind === "login"
            ? await api.login(msg.email, msg.password)
            : await api.signup(msg.email, msg.password, msg.displayName);
        token = res.token;
        identity = { userId: res.user.userId, displayName: res.user.displayName };
        await persistAuth();
        broadcast(sessionMessage());
        ws.connect();
      } catch (e) {
        port.postMessage({ kind: "authError", message: (e as Error).message } satisfies SwToCs);
      }
      break;

    case "logout":
      token = null;
      identity = null;
      await persistAuth();
      await setRoom(null);
      ws.disconnect();
      broadcast(sessionMessage());
      break;

    case "createRoom":
      if (!token) return;
      try {
        const res = await api.createRoom(token, msg.contentId, msg.title);
        await setRoom(res.room.roomId);
        ws.send(ClientType.JoinRoom, { roomId: res.room.roomId }, res.room.roomId);
        broadcast({ kind: "createdRoom", roomId: res.room.roomId, joinUrl: res.joinUrl });
      } catch (e) {
        broadcast({ kind: "roomError", code: "CREATE_FAILED", message: (e as Error).message });
      }
      break;

    case "joinRoom":
      await setRoom(msg.roomId);
      if (ws.status === "connected") ws.send(ClientType.JoinRoom, { roomId: msg.roomId }, msg.roomId);
      else ws.connect(); // onOpen will join currentRoomId
      break;

    case "leaveRoom":
      if (currentRoomId) ws.send(ClientType.LeaveRoom, {}, currentRoomId);
      await setRoom(null);
      break;

    case "playback":
      if (!currentRoomId) return;
      ws.send<PlaybackPayload>(
        ClientType.PlaybackEvent,
        {
          action: msg.action,
          currentTime: msg.currentTime,
          mediaTimestamp: msg.mediaTimestamp,
          contentId: msg.contentId,
        },
        currentRoomId,
      );
      break;

    case "heartbeat":
      if (!currentRoomId) return;
      ws.send<HeartbeatPayload>(
        ClientType.Heartbeat,
        { currentTime: msg.currentTime, paused: msg.paused, mediaTimestamp: msg.mediaTimestamp },
        currentRoomId,
      );
      break;

    case "chat":
      if (currentRoomId) ws.send(ClientType.Chat, { text: msg.text }, currentRoomId);
      break;
    case "reaction":
      if (currentRoomId) ws.send(ClientType.Reaction, { emoji: msg.emoji }, currentRoomId);
      break;
    case "soundbox":
      if (currentRoomId) ws.send(ClientType.Soundbox, { soundId: msg.soundId }, currentRoomId);
      break;
  }
}

// ---- worker → content script (WS frame translation) ----
function handleWsFrame(env: Envelope): void {
  switch (env.type) {
    case ServerType.RoomState: {
      const p = env.payload as RoomStatePayload;
      broadcast({ kind: "roomState", room: p.room, members: p.members, playback: p.playback });
      break;
    }
    case ServerType.MemberJoined:
      broadcast({ kind: "memberJoined", member: env.payload as MemberInfo });
      break;
    case ServerType.MemberLeft:
      broadcast({ kind: "memberLeft", userId: (env.payload as MemberLeftPayload).userId });
      break;
    case ServerType.HostChanged:
      broadcast({ kind: "hostChanged", userId: (env.payload as HostChangedPayload).userId });
      break;
    case ServerType.PlaybackEvent: {
      const p = env.payload as PlaybackPayload;
      broadcast({
        kind: "remotePlayback",
        senderId: env.senderId ?? "",
        action: p.action,
        currentTime: p.currentTime,
        mediaTimestamp: p.mediaTimestamp,
        seq: env.seq,
      });
      break;
    }
    case ServerType.Sync: {
      const p = env.payload as HeartbeatPayload;
      broadcast({
        kind: "remoteSync",
        senderId: env.senderId ?? "",
        currentTime: p.currentTime,
        paused: p.paused,
        mediaTimestamp: p.mediaTimestamp,
        seq: env.seq,
      });
      break;
    }
    case ServerType.Chat: {
      const p = env.payload as ChatPayload;
      broadcast({
        kind: "chat",
        senderId: env.senderId ?? "",
        senderName: env.senderName ?? "",
        text: p.text,
        ts: env.ts ?? Date.now(),
      });
      break;
    }
    case ServerType.Reaction: {
      const p = env.payload as ReactionPayload;
      broadcast({ kind: "reaction", senderId: env.senderId ?? "", senderName: env.senderName ?? "", emoji: p.emoji });
      break;
    }
    case ServerType.Soundbox: {
      const p = env.payload as SoundboxPayload;
      broadcast({ kind: "soundbox", senderId: env.senderId ?? "", senderName: env.senderName ?? "", soundId: p.soundId });
      break;
    }
    case ServerType.Error: {
      const p = env.payload as ErrorPayload;
      broadcast({ kind: "roomError", code: p.code, message: p.message });
      break;
    }
    // pong: no-op
  }
}

// Referenced to satisfy noUnusedLocals until the SFU/voice work lands.
export type { WsStatus };
