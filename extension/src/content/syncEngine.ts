// Ties a PlatformAdapter to the service-worker Port: local user actions go
// out as playback events; remote events and host syncs are applied to the
// local player. When this client is the host it emits periodic heartbeats.

import type { PlatformAdapter } from "../adapters/PlatformAdapter";
import type { SwToCs } from "../shared/messages";
import { decideSync } from "./drift";
import type { SwPort } from "./port";

const HEARTBEAT_MS = 5000;
// After applying a remote event, ignore drift corrections briefly so we don't
// fight an in-flight seek (docs/ws-protocol.md).
const CORRECTION_COOLDOWN_MS = 3000;

export interface SyncStatus {
  state: "idle" | "in-sync" | "drifted" | "unavailable";
  detail?: string;
}

export class SyncEngine {
  private myUserId = "";
  private hostUserId = "";
  private inRoom = false;
  private cooldownUntil = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private unsubUser: (() => void) | null = null;
  private unsubUnavail: (() => void) | null = null;
  private lastSeq = new Map<string, number>();

  constructor(
    private readonly adapter: PlatformAdapter,
    private readonly port: SwPort,
    private readonly onStatus: (s: SyncStatus) => void,
  ) {}

  setIdentity(userId: string): void {
    this.myUserId = userId;
  }

  start(): void {
    this.unsubUser = this.adapter.onUserAction((e) => {
      if (!this.inRoom) return;
      this.port.send({
        kind: "playback",
        action: e.action,
        currentTime: e.state.currentTime,
        mediaTimestamp: Date.now(),
        contentId: this.adapter.getContentId() ?? undefined,
      });
    });
    this.unsubUnavail = this.adapter.onUnavailable((reason) => {
      this.onStatus({ state: "unavailable", detail: reason });
    });
    this.port.onMessage((msg) => void this.onPortMessage(msg));
  }

  stop(): void {
    this.unsubUser?.();
    this.unsubUnavail?.();
    this.stopHeartbeat();
  }

  private isHost(): boolean {
    return this.myUserId !== "" && this.myUserId === this.hostUserId;
  }

  // Drop stale/reordered events per sender (seq is monotonic per sender).
  private fresh(senderId: string, seq?: number): boolean {
    if (seq == null) return true;
    const last = this.lastSeq.get(senderId) ?? -1;
    if (seq <= last) return false;
    this.lastSeq.set(senderId, seq);
    return true;
  }

  private async onPortMessage(msg: SwToCs): Promise<void> {
    switch (msg.kind) {
      case "roomState":
        this.inRoom = true;
        this.hostUserId = msg.room.hostUserId;
        this.updateHeartbeat();
        if (msg.playback) {
          await this.applyRemote(msg.playback.action ?? "seek", msg.playback.currentTime);
          if (msg.playback.paused) await this.safe(() => this.adapter.pause());
        }
        this.onStatus({ state: "in-sync" });
        break;

      case "hostChanged":
        this.hostUserId = msg.userId;
        this.updateHeartbeat();
        break;

      case "remotePlayback":
        if (msg.senderId === this.myUserId) return;
        if (!this.fresh(msg.senderId, msg.seq)) return;
        await this.applyRemote(msg.action, msg.currentTime);
        break;

      case "remoteSync":
        if (msg.senderId === this.myUserId) return;
        if (!this.fresh(msg.senderId, msg.seq)) return;
        await this.applySync(msg.currentTime, msg.paused, msg.mediaTimestamp);
        break;

      case "conn":
        if (msg.state === "disconnected") this.onStatus({ state: "idle" });
        break;

      case "roomError":
        this.inRoom = false;
        this.stopHeartbeat();
        break;
    }
  }

  private async applyRemote(action: string, currentTime: number): Promise<void> {
    this.cooldownUntil = Date.now() + CORRECTION_COOLDOWN_MS;
    if (action === "seek") await this.safe(() => this.adapter.seek(currentTime));
    else if (action === "play") await this.safe(() => this.adapter.play());
    else if (action === "pause") await this.safe(() => this.adapter.pause());
  }

  private async applySync(hostTime: number, hostPaused: boolean, hostMediaTs: number): Promise<void> {
    if (Date.now() < this.cooldownUntil) return;
    let local;
    try {
      local = await this.adapter.getState();
    } catch {
      this.onStatus({ state: "unavailable", detail: "player-unreachable" });
      return;
    }
    const decision = decideSync({
      hostCurrentTime: hostTime,
      hostPaused,
      hostMediaTimestamp: hostMediaTs,
      localCurrentTime: local.currentTime,
      localPaused: local.paused,
      now: Date.now(),
    });
    switch (decision.kind) {
      case "none":
        this.onStatus({ state: "in-sync" });
        break;
      case "play":
        this.cooldownUntil = Date.now() + CORRECTION_COOLDOWN_MS;
        await this.safe(() => this.adapter.play());
        break;
      case "pause":
        this.cooldownUntil = Date.now() + CORRECTION_COOLDOWN_MS;
        await this.safe(() => this.adapter.pause());
        break;
      case "seek":
        this.cooldownUntil = Date.now() + CORRECTION_COOLDOWN_MS;
        this.onStatus({ state: "drifted", detail: decision.hard ? "resyncing" : undefined });
        await this.safe(() => this.adapter.seek(decision.to));
        break;
    }
  }

  private updateHeartbeat(): void {
    if (this.isHost()) this.startHeartbeat();
    else this.stopHeartbeat();
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(async () => {
      try {
        const s = await this.adapter.getState();
        this.port.send({
          kind: "heartbeat",
          currentTime: s.currentTime,
          paused: s.paused,
          mediaTimestamp: Date.now(),
        });
      } catch {
        /* transient player unavailability; next tick retries */
      }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async safe(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch {
      this.onStatus({ state: "unavailable", detail: "player-unreachable" });
    }
  }
}
