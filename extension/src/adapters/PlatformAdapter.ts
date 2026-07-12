// Common interface every streaming-platform adapter implements. All platforms
// are served by BridgeAdapter (MAIN-world page script) behind this shape.

import type { PlatformId } from "../shared/platforms";
import type { PlaybackAction } from "../shared/protocol";

export interface PlaybackState {
  currentTime: number; // seconds
  paused: boolean;
  duration: number;
}

export interface UserActionEvent {
  action: PlaybackAction;
  state: PlaybackState;
}

export interface PlatformAdapter {
  readonly platform: PlatformId;

  /** True if the given URL is a player/watch page for this platform. */
  isWatchPage(url: string): boolean;

  /** Platform content id from the current URL, or null if not on a watch page. */
  getContentId(): string | null;

  getTitle(): Promise<string | null>;
  getState(): Promise<PlaybackState>;

  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;

  /** Subscribe to user-initiated play/pause/seek. Returns an unsubscribe fn. */
  onUserAction(cb: (e: UserActionEvent) => void): () => void;

  /** Called when a remote adapter becomes unavailable (selectors broke, etc.). */
  onUnavailable(cb: (reason: string) => void): () => void;

  /** Inject the page bridge and resolve once the player is reachable. */
  attach(): Promise<void>;
  detach(): void;
}
