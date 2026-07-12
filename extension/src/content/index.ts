// Content-script entrypoint (isolated world). Wires the service-worker Port,
// the Netflix adapter + sync engine, and the React overlay together, and
// handles Netflix's SPA navigation and ?wt_room= join links.

import { createAdapter } from "../adapters/createAdapter";
import type { PlatformAdapter } from "../adapters/PlatformAdapter";
import type { SwToCs } from "../shared/messages";
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

mountOverlay(makeActions(port, adapter));

// A room id captured from a ?wt_room= link, joined once we're authed.
let pendingRoomId: string | null = readRoomParam();

port.onMessage((msg: SwToCs) => {
  applyMessage(msg);
  if (msg.kind === "session" && msg.session.authed && msg.session.userId) {
    engine.setIdentity(msg.session.userId);
    if (pendingRoomId) {
      makeActions(port, adapter).joinRoom(pendingRoomId);
      pendingRoomId = null;
    }
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
