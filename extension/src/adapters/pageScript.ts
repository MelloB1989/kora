// MAIN-world page script, shared by all platforms. Runs in the page's JS
// context so it can reach site-specific player APIs (Netflix, YouTube) that
// aren't visible to the isolated content script. Direct <video>.currentTime
// writes don't stick on some sites, so control goes through the richest API
// available per platform, with a generic <video> backend as the fallback.
//
// Positions crossing the bridge are always SECONDS. Communication with the
// isolated content script is a request/response + event protocol over
// window.postMessage. Everything is defensively guarded: if the player can't
// be resolved we emit an "unavailable" event so the UI shows a clear state
// instead of crashing.

import {
  PAGE_SOURCE_CONTENT,
  PAGE_SOURCE_PAGE,
  type PageEvent,
  type PagePlayerState,
  type PageRequest,
} from "../shared/messages";
import { detectPlatform } from "../shared/platforms";
import type { PlaybackAction } from "../shared/protocol";

// A player backend abstracts one platform's control surface. All time values
// exposed here are in SECONDS.
interface PlayerBackend {
  /** True once the player is controllable. */
  ready(): boolean;
  getState(): PagePlayerState | null;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  /** The underlying <video> element, used for user-action DOM events. */
  videoEl(): HTMLVideoElement | null;
  title(): string | null;
}

function mainVideo(): HTMLVideoElement | null {
  // Prefer the largest playing video (skips tiny ad/preview elements).
  const vids = [...document.querySelectorAll("video")];
  if (vids.length === 0) return null;
  return vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
}

// ---- Netflix backend: unofficial player API (positions in ms) ----
interface NetflixPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  isPaused(): boolean;
  seek(ms: number): void;
  play(): void;
  pause(): void;
}

function netflixPlayer(): NetflixPlayer | null {
  try {
    const w = window as unknown as {
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
    };
    const vp = w.netflix?.appContext?.state?.playerApp?.getAPI?.().videoPlayer;
    if (!vp) return null;
    const sid = vp.getAllPlayerSessionIds().find((id) => id.startsWith("watch-"));
    return sid ? vp.getVideoPlayerBySessionId(sid) : null;
  } catch {
    return null;
  }
}

const netflixBackend: PlayerBackend = {
  ready: () => netflixPlayer() !== null,
  getState() {
    const p = netflixPlayer();
    if (!p) return null;
    try {
      return { currentTime: p.getCurrentTime() / 1000, paused: p.isPaused(), duration: p.getDuration() / 1000 };
    } catch {
      return null;
    }
  },
  play: () => netflixPlayer()?.play(),
  pause: () => netflixPlayer()?.pause(),
  seek: (s) => netflixPlayer()?.seek(Math.round(s * 1000)),
  videoEl: () => mainVideo(),
  title: () => document.querySelector<HTMLElement>('[data-uia="video-title"]')?.textContent?.trim() ?? null,
};

// ---- YouTube backend: #movie_player API (positions in seconds) ----
interface YtPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number; // 1 playing, 2 paused
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
}

function ytPlayer(): YtPlayer | null {
  const el = document.getElementById("movie_player") as unknown as YtPlayer | null;
  return el && typeof el.getCurrentTime === "function" ? el : null;
}

const youtubeBackend: PlayerBackend = {
  ready: () => ytPlayer() !== null,
  getState() {
    const p = ytPlayer();
    if (!p) return null;
    try {
      return { currentTime: p.getCurrentTime(), paused: p.getPlayerState() === 2, duration: p.getDuration() };
    } catch {
      return null;
    }
  },
  play: () => ytPlayer()?.playVideo(),
  pause: () => ytPlayer()?.pauseVideo(),
  seek: (s) => ytPlayer()?.seekTo(s, true),
  videoEl: () => document.querySelector<HTMLVideoElement>(".html5-main-video") ?? mainVideo(),
  title: () => document.querySelector<HTMLElement>("h1.ytd-watch-metadata")?.textContent?.trim() ?? null,
};

// ---- Generic <video> backend (Prime, Hotstar, fallback) ----
const videoBackend: PlayerBackend = {
  ready: () => mainVideo() !== null,
  getState() {
    const v = mainVideo();
    return v ? { currentTime: v.currentTime, paused: v.paused, duration: v.duration || 0 } : null;
  },
  play: () => void mainVideo()?.play(),
  pause: () => mainVideo()?.pause(),
  seek: (s) => {
    const v = mainVideo();
    if (v) v.currentTime = s;
  },
  videoEl: () => mainVideo(),
  title: () => document.title || null,
};

function selectBackend(): PlayerBackend {
  const spec = detectPlatform(location.href);
  switch (spec?.backend) {
    case "netflix":
      return netflixBackend;
    case "youtube":
      return youtubeBackend;
    default:
      return videoBackend;
  }
}

let backend = selectBackend();

function emit(event: PageEvent): void {
  window.postMessage(event, "*");
}

// ---- request/response handler ----
window.addEventListener("message", (e) => {
  const msg = e.data as PageRequest | undefined;
  if (!msg || msg.source !== PAGE_SOURCE_CONTENT || typeof msg.id !== "number") return;

  const ok = (result: unknown) => emit({ source: PAGE_SOURCE_PAGE, id: msg.id, ok: true, result });
  const fail = (error: string) => emit({ source: PAGE_SOURCE_PAGE, id: msg.id, ok: false, error });

  try {
    switch (msg.command.cmd) {
      case "getState": {
        const s = backend.getState();
        s ? ok(s) : fail("player-unavailable");
        break;
      }
      case "getTitle":
        ok(backend.title());
        break;
      case "play":
        backend.play();
        ok(true);
        break;
      case "pause":
        backend.pause();
        ok(true);
        break;
      case "seek":
        backend.seek(msg.command.seconds);
        ok(true);
        break;
    }
  } catch (err) {
    fail(String(err));
  }
});

// ---- user-action detection via the underlying <video> element ----
let wiredVideo: HTMLVideoElement | null = null;
let lastSeekEmit = 0;

function wireVideo(video: HTMLVideoElement): void {
  if (video === wiredVideo) return;
  wiredVideo = video;

  const state = (): PagePlayerState =>
    backend.getState() ?? { currentTime: video.currentTime, paused: video.paused, duration: video.duration || 0 };
  const emitUser = (action: PlaybackAction) =>
    emit({ source: PAGE_SOURCE_PAGE, id: 0, event: "userAction", action, state: state() });

  video.addEventListener("play", () => emitUser("play"));
  video.addEventListener("pause", () => emitUser("pause"));
  video.addEventListener("seeked", () => {
    const now = Date.now();
    if (now - lastSeekEmit < 250) return; // debounce scrub bursts
    lastSeekEmit = now;
    emitUser("seek");
  });
}

// ---- readiness poll (handles SPA nav + slow player load) ----
let ready = false;
const started = Date.now();
const poll = setInterval(() => {
  backend = selectBackend(); // re-evaluate after SPA navigation
  const video = backend.videoEl();
  if (backend.ready() && video) {
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
