// MAIN-world page script. Runs in the page's JS context (not the isolated
// content-script world) so it can reach Netflix's unofficial player API:
//
//   netflix.appContext.state.playerApp.getAPI().videoPlayer
//
// Direct writes to <video>.currentTime don't stick on Netflix, so seek/play/
// pause must go through this API. All positions here are MILLISECONDS; the
// content-side NetflixAdapter converts to/from seconds.
//
// Communication with the isolated content script is a request/response +
// event protocol over window.postMessage. Everything is defensively guarded:
// if the API can't be resolved, we emit an "unavailable" event so the UI can
// show "sync unavailable" instead of crashing.

import {
  PAGE_SOURCE_CONTENT,
  PAGE_SOURCE_PAGE,
  type PageEvent,
  type PagePlayerState,
  type PageRequest,
} from "../../shared/messages";
import type { PlaybackAction } from "../../shared/protocol";

interface NetflixPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  isPaused(): boolean;
  seek(ms: number): void;
  play(): void;
  pause(): void;
}

declare global {
  interface Window {
    netflix?: {
      appContext?: {
        state?: {
          playerApp?: {
            getAPI?: () => {
              videoPlayer: {
                getAllPlayerSessionIds(): string[];
                getVideoPlayerBySessionId(id: string): NetflixPlayer | null;
              };
            };
          };
        };
      };
    };
  }
}

function emit(event: PageEvent): void {
  window.postMessage(event, "*");
}

function resolvePlayer(): NetflixPlayer | null {
  try {
    const videoPlayer = window.netflix?.appContext?.state?.playerApp?.getAPI?.().videoPlayer;
    if (!videoPlayer) return null;
    const sessionId = videoPlayer
      .getAllPlayerSessionIds()
      .find((id) => id.startsWith("watch-"));
    if (!sessionId) return null;
    return videoPlayer.getVideoPlayerBySessionId(sessionId);
  } catch {
    return null;
  }
}

function readState(): PagePlayerState | null {
  const p = resolvePlayer();
  if (!p) return null;
  try {
    return {
      currentTime: p.getCurrentTime() / 1000,
      paused: p.isPaused(),
      duration: p.getDuration() / 1000,
    };
  } catch {
    return null;
  }
}

// --- request/response handler ---
window.addEventListener("message", (e) => {
  const msg = e.data as PageRequest | undefined;
  if (!msg || msg.source !== PAGE_SOURCE_CONTENT || typeof msg.id !== "number") return;

  const respond = (result: unknown) =>
    emit({ source: PAGE_SOURCE_PAGE, id: msg.id, ok: true, result });
  const fail = (error: string) =>
    emit({ source: PAGE_SOURCE_PAGE, id: msg.id, ok: false, error });

  const player = resolvePlayer();
  const c = msg.command;

  try {
    switch (c.cmd) {
      case "getState": {
        const state = readState();
        state ? respond(state) : fail("player-unavailable");
        break;
      }
      case "getContentId":
        respond(contentIdFromUrl(location.href));
        break;
      case "getTitle":
        respond(readTitle());
        break;
      case "play":
        if (!player) return fail("player-unavailable");
        player.play();
        respond(true);
        break;
      case "pause":
        if (!player) return fail("player-unavailable");
        player.pause();
        respond(true);
        break;
      case "seek":
        if (!player) return fail("player-unavailable");
        player.seek(Math.round(c.seconds * 1000));
        respond(true);
        break;
    }
  } catch (err) {
    fail(String(err));
  }
});

function contentIdFromUrl(url: string): string | null {
  const m = url.match(/\/watch\/(\d+)/);
  return m ? m[1] : null;
}

function readTitle(): string | null {
  const el = document.querySelector<HTMLElement>('[data-uia="video-title"]');
  return el?.textContent?.trim() || document.title || null;
}

// --- user-action detection via the underlying <video> element ---
let attachedVideo: HTMLVideoElement | null = null;
let lastSeekEmit = 0;

function wireVideo(video: HTMLVideoElement): void {
  if (video === attachedVideo) return;
  attachedVideo = video;

  const stateWith = (): PagePlayerState =>
    readState() ?? { currentTime: video.currentTime, paused: video.paused, duration: video.duration };

  const emitUser = (action: PlaybackAction) =>
    emit({ source: PAGE_SOURCE_PAGE, id: 0, event: "userAction", action, state: stateWith() });

  video.addEventListener("play", () => emitUser("play"));
  video.addEventListener("pause", () => emitUser("pause"));
  video.addEventListener("seeked", () => {
    const now = Date.now();
    if (now - lastSeekEmit < 250) return; // debounce scrub bursts
    lastSeekEmit = now;
    emitUser("seek");
  });
}

// Poll for the player + <video> to appear (SPA navigation, slow loads).
let ready = false;
const started = Date.now();
const poll = setInterval(() => {
  const video = document.querySelector<HTMLVideoElement>("video");
  if (resolvePlayer() && video) {
    if (!ready) {
      ready = true;
      emit({ source: PAGE_SOURCE_PAGE, id: 0, event: "ready" });
    }
    wireVideo(video);
  } else if (!ready && Date.now() - started > 30_000) {
    clearInterval(poll);
    emit({ source: PAGE_SOURCE_PAGE, id: 0, event: "unavailable", reason: "player-not-found" });
  }
}, 500);

export {};
