// Content-script entrypoint (isolated world). Wires the service-worker Port,
// the platform adapter + sync engine, the WebRTC mesh, and the React overlay
// together, and handles SPA navigation and ?wt_room= join links.

import { createAdapter } from "../adapters/createAdapter";
import type { PlatformAdapter } from "../adapters/PlatformAdapter";
import type { SwToCs } from "../shared/messages";
import { callActions, useCallStore, type CallController } from "./overlay/callStore";
import { mountOverlay } from "./overlay/mount";
import {
  applyMessage,
  makeActions,
  setContentId,
  setPlatform,
  setSyncStatus,
  useOverlayStore,
} from "./overlay/store";
import { SwPort } from "./port";
import { SyncEngine } from "./syncEngine";
import { MeshManager } from "./webrtc";

const maybeAdapter = createAdapter();
// Not a supported streaming site — stay dormant.
if (!maybeAdapter) throw new Error("wt: unsupported site");
const adapter: PlatformAdapter = maybeAdapter;

const port = new SwPort();
port.connect();
port.send({ kind: "getSession" });

setPlatform(adapter.platform);
const engine = new SyncEngine(adapter, port, setSyncStatus);
engine.start();

// --- WebRTC mesh + call controller ---
let myUserId = "";
let myName = "You";
const memberName = (userId: string): string =>
  useOverlayStore.getState().members.find((m) => m.userId === userId)?.displayName ?? "Guest";

const mesh = new MeshManager(
  (target, payload) => port.send({ kind: "signal", target, payload }),
  {
    onRemoteStream: (userId, stream) => callActions.addRemote(userId, memberName(userId), stream),
    onRemoteGone: (userId) => callActions.removeRemote(userId),
    onLocalStream: (stream) => callActions.setLocalStream(stream, myName, myUserId),
  },
);

const call: CallController = {
  startCall: async (video) => {
    useCallStore.setState({ connecting: true, error: undefined });
    try {
      await mesh.startCall(video);
      useCallStore.setState({ inCall: true, connecting: false, cameraOn: video, hasVideo: mesh.hasVideo() });
    } catch (e) {
      useCallStore.setState({ connecting: false, error: `Mic/camera unavailable: ${(e as Error).message}` });
    }
  },
  leaveCall: () => {
    mesh.stopCall();
    callActions.reset();
  },
  toggleMute: () => {
    const muted = !useCallStore.getState().muted;
    mesh.setMuted(muted);
    useCallStore.setState({ muted });
  },
  toggleCamera: () => {
    const cameraOn = !useCallStore.getState().cameraOn;
    mesh.setCameraEnabled(cameraOn);
    useCallStore.setState({ cameraOn });
  },
  pushToTalk: (down) => {
    // While held, force-unmute; on release restore the mute toggle state.
    mesh.setMuted(down ? false : useCallStore.getState().muted);
  },
};

mountOverlay(makeActions(port, adapter), call);

// Keep the mesh's peer set in step with room membership.
useOverlayStore.subscribe((state) => {
  mesh.setMembers(state.members.map((m) => m.userId));
});

// A room id captured from a ?wt_room= link, joined once we're authed.
let pendingRoomId: string | null = readRoomParam();

port.onMessage((msg: SwToCs) => {
  applyMessage(msg);
  switch (msg.kind) {
    case "session":
      if (msg.session.authed && msg.session.userId) {
        myUserId = msg.session.userId;
        myName = msg.session.displayName ?? "You";
        engine.setIdentity(myUserId);
        mesh.setIdentity(myUserId);
        if (pendingRoomId) {
          makeActions(port, adapter).joinRoom(pendingRoomId);
          pendingRoomId = null;
        }
      }
      break;
    case "memberLeft":
      mesh.memberLeft(msg.userId);
      break;
    case "remoteSignal":
      void mesh.handleSignal(msg.senderId, msg.payload);
      break;
  }
});

// --- adapter attach + SPA navigation handling ---
let attachedForUrl: string | null = null;

async function syncToUrl(): Promise<void> {
  const url = location.href;
  const onWatch = adapter.isWatchPage(url);
  setContentId(onWatch ? adapter.getContentId() : null);

  if (onWatch && attachedForUrl === null) {
    attachedForUrl = url;
    try {
      await adapter.attach();
    } catch {
      setSyncStatus({ state: "unavailable", detail: "attach-failed" });
    }
  }

  const room = readRoomParam();
  if (room && room !== pendingRoomId) {
    // A new join link on an already-loaded page.
    if (useOverlayStore.getState().authed) {
      makeActions(port, adapter).joinRoom(room);
    } else {
      pendingRoomId = room;
    }
  }
}

void syncToUrl();
let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    void syncToUrl();
  }
}, 1000);

function readRoomParam(): string | null {
  return new URLSearchParams(location.search).get("wt_room");
}
