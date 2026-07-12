// Isolated-world adapter shared by every platform. Injects the MAIN-world
// page script, drives the player over the postMessage RPC bridge, and owns
// echo suppression (programmatically-applied remote events must not be
// re-broadcast as if the local user triggered them). Platform-specific logic
// lives in shared/platforms.ts (URL/id detection) and the page-script backends
// (player control) — this class is platform-agnostic.

import { extensionUrl } from "../shared/browser";
import {
  PAGE_SOURCE_CONTENT,
  PAGE_SOURCE_PAGE,
  type PageCommand,
  type PageEvent,
  type PagePlayerState,
} from "../shared/messages";
import type { PlatformSpec } from "../shared/platforms";
import type { PlaybackAction } from "../shared/protocol";
import type { PlatformAdapter, PlaybackState, UserActionEvent } from "./PlatformAdapter";

interface Suppression {
  action: PlaybackAction;
  targetTime: number;
  until: number;
}

const SUPPRESS_MS = 2500;
const RPC_TIMEOUT_MS = 5000;

export class BridgeAdapter implements PlatformAdapter {
  readonly platform: PlatformSpec["id"];

  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly userCbs = new Set<(e: UserActionEvent) => void>();
  private readonly unavailCbs = new Set<(reason: string) => void>();
  private readonly suppressions: Suppression[] = [];
  private readyResolve: (() => void) | null = null;
  private attached = false;
  private listener = (e: MessageEvent) => this.onMessage(e);

  constructor(private readonly spec: PlatformSpec) {
    this.platform = spec.id;
  }

  isWatchPage(url: string): boolean {
    try {
      return this.spec.isWatchPage(new URL(url));
    } catch {
      return false;
    }
  }

  getContentId(): string | null {
    try {
      return this.spec.contentId(new URL(location.href));
    } catch {
      return null;
    }
  }

  async attach(): Promise<void> {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener("message", this.listener);
    const script = document.createElement("script");
    script.src = extensionUrl("pageScript.js");
    script.type = "text/javascript";
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();

    await new Promise<void>((resolve) => {
      this.readyResolve = resolve;
      setTimeout(resolve, 31_000); // don't hang forever; getState surfaces failure
    });
  }

  detach(): void {
    window.removeEventListener("message", this.listener);
    this.pending.clear();
    this.userCbs.clear();
    this.unavailCbs.clear();
    this.attached = false;
  }

  async getState(): Promise<PlaybackState> {
    const s = (await this.rpc({ cmd: "getState" })) as PagePlayerState;
    return { currentTime: s.currentTime, paused: s.paused, duration: s.duration };
  }

  async getTitle(): Promise<string | null> {
    return (await this.rpc({ cmd: "getTitle" })) as string | null;
  }

  async play(): Promise<void> {
    this.suppress("play", 0);
    await this.rpc({ cmd: "play" });
  }

  async pause(): Promise<void> {
    this.suppress("pause", 0);
    await this.rpc({ cmd: "pause" });
  }

  async seek(seconds: number): Promise<void> {
    this.suppress("seek", seconds);
    await this.rpc({ cmd: "seek", seconds });
  }

  onUserAction(cb: (e: UserActionEvent) => void): () => void {
    this.userCbs.add(cb);
    return () => this.userCbs.delete(cb);
  }

  onUnavailable(cb: (reason: string) => void): () => void {
    this.unavailCbs.add(cb);
    return () => this.unavailCbs.delete(cb);
  }

  // --- echo suppression ---
  private suppress(action: PlaybackAction, targetTime: number): void {
    this.suppressions.push({ action, targetTime, until: Date.now() + SUPPRESS_MS });
  }

  private consumeSuppression(action: PlaybackAction, currentTime: number): boolean {
    const now = Date.now();
    for (let i = 0; i < this.suppressions.length; i++) {
      const s = this.suppressions[i];
      if (s.until < now) {
        this.suppressions.splice(i--, 1);
        continue;
      }
      const timeMatch = action === "seek" ? Math.abs(currentTime - s.targetTime) < 1 : true;
      if (s.action === action && timeMatch) {
        this.suppressions.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  // --- postMessage RPC + events ---
  private rpc(command: PageCommand): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      window.postMessage({ source: PAGE_SOURCE_CONTENT, id, command }, "*");
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`page RPC timeout: ${command.cmd}`));
      }, RPC_TIMEOUT_MS);
    });
  }

  private onMessage(e: MessageEvent): void {
    const msg = e.data as PageEvent | undefined;
    if (!msg || msg.source !== PAGE_SOURCE_PAGE) return;

    if ("ok" in msg) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
      return;
    }

    switch (msg.event) {
      case "ready":
        this.readyResolve?.();
        this.readyResolve = null;
        break;
      case "unavailable":
        for (const cb of this.unavailCbs) cb(msg.reason);
        break;
      case "userAction": {
        if (this.consumeSuppression(msg.action, msg.state.currentTime)) return;
        const evt: UserActionEvent = {
          action: msg.action,
          state: { currentTime: msg.state.currentTime, paused: msg.state.paused, duration: msg.state.duration },
        };
        for (const cb of this.userCbs) cb(evt);
        break;
      }
    }
  }
}
