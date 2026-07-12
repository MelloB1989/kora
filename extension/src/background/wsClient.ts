// Reconnecting WebSocket client owned by the service worker. Browser-agnostic
// (no chrome.* usage) so it is unit-testable and Firefox-portable.

import { WS_URL } from "../shared/config";
import { PROTOCOL_VERSION, type Envelope } from "../shared/protocol";

export type WsStatus = "disconnected" | "connecting" | "connected";

interface WsClientOptions {
  getToken: () => string | null;
  onMessage: (env: Envelope) => void;
  onStatus: (status: WsStatus) => void;
  // Called after a (re)connect so the caller can re-send join_room, etc.
  onOpen: () => void;
}

const PING_INTERVAL_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;

export class WsClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private backoff = 1_000;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;

  constructor(private readonly opts: WsClientOptions) {}

  get status(): WsStatus {
    if (!this.ws) return "disconnected";
    if (this.ws.readyState === WebSocket.OPEN) return "connected";
    if (this.ws.readyState === WebSocket.CONNECTING) return "connecting";
    return "disconnected";
  }

  connect(): void {
    const token = this.opts.getToken();
    if (!token) return;
    this.closedByUs = false;
    this.clearReconnect();
    this.opts.onStatus("connecting");

    const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.backoff = 1_000;
      this.opts.onStatus("connected");
      this.startPing();
      this.opts.onOpen();
    });
    ws.addEventListener("message", (e) => {
      try {
        this.opts.onMessage(JSON.parse(e.data as string) as Envelope);
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.addEventListener("close", () => {
      this.stopPing();
      this.opts.onStatus("disconnected");
      if (!this.closedByUs) this.scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      // 'close' fires next and handles reconnection.
      ws.close();
    });
  }

  disconnect(): void {
    this.closedByUs = true;
    this.clearReconnect();
    this.stopPing();
    this.ws?.close();
    this.ws = null;
    this.opts.onStatus("disconnected");
  }

  // send stamps the protocol version and a monotonic per-connection seq.
  send<P>(type: string, payload?: P, roomId?: string): void {
    if (this.status !== "connected") return;
    const env: Envelope<P> = {
      v: PROTOCOL_VERSION,
      type,
      roomId,
      ts: Date.now(),
      seq: ++this.seq,
      payload,
    };
    this.ws!.send(JSON.stringify(env));
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send("ping"), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    const delay = Math.min(this.backoff, MAX_BACKOFF_MS);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
