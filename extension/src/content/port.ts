// Manages a long-lived Port to the service worker, transparently reconnecting
// when the SW is idle-killed and restarted (the Port fires onDisconnect).

import { runtime } from "../shared/browser";
import { PORT_NAME, type CsToSw, type SwToCs } from "../shared/messages";

export class SwPort {
  private port: chrome.runtime.Port | null = null;
  private readonly listeners = new Set<(msg: SwToCs) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    const port = runtime.connect({ name: PORT_NAME });
    this.port = port;
    port.onMessage.addListener((msg) => {
      for (const l of this.listeners) l(msg as SwToCs);
    });
    port.onDisconnect.addListener(() => {
      this.port = null;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
      // Re-sync state after the SW comes back.
      this.send({ kind: "getSession" });
    }, 500);
  }

  send(msg: CsToSw): void {
    try {
      this.port?.postMessage(msg);
    } catch {
      this.scheduleReconnect();
    }
  }

  onMessage(fn: (msg: SwToCs) => void): void {
    this.listeners.add(fn);
  }
}
