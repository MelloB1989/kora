// Platform registry shared by the content script (URL detection, join-link
// building) and the MAIN-world page script (player-backend selection).
// Adding a platform is: one entry here + one backend in pageScript backends.

export type PlatformId = "netflix" | "prime" | "hotstar" | "youtube";

export interface PlatformSpec {
  id: PlatformId;
  label: string;
  /** Which page-script backend drives the player. */
  backend: "netflix" | "youtube" | "video";
  /** True when the current location is a watchable player page. */
  isWatchPage(url: URL): boolean;
  /** Stable content id for progress tracking / join links, or null. */
  contentId(url: URL): string | null;
  /** Build a shareable link that lands on the same content with the room id. */
  watchUrl(contentId: string, roomId: string): string;
}

export const PLATFORMS: Record<PlatformId, PlatformSpec> = {
  netflix: {
    id: "netflix",
    label: "Netflix",
    backend: "netflix",
    isWatchPage: (u) => u.hostname.endsWith("netflix.com") && /\/watch\/\d+/.test(u.pathname),
    contentId: (u) => u.pathname.match(/\/watch\/(\d+)/)?.[1] ?? null,
    watchUrl: (id, room) => `https://www.netflix.com/watch/${id}?wt_room=${room}`,
  },
  youtube: {
    id: "youtube",
    label: "YouTube",
    backend: "youtube",
    isWatchPage: (u) => u.hostname.endsWith("youtube.com") && u.pathname === "/watch" && u.searchParams.has("v"),
    contentId: (u) => u.searchParams.get("v"),
    watchUrl: (id, room) => `https://www.youtube.com/watch?v=${id}&wt_room=${room}`,
  },
  prime: {
    id: "prime",
    label: "Prime Video",
    backend: "video",
    isWatchPage: (u) =>
      u.hostname.endsWith("primevideo.com") || (u.hostname.endsWith("amazon.com") && u.pathname.includes("/gp/video")),
    // Prime's watch id is an ASIN; best-effort extraction, may be null.
    contentId: (u) =>
      u.searchParams.get("gti") ?? u.pathname.match(/\/detail\/([A-Z0-9]{10,})/)?.[1] ?? null,
    watchUrl: (id, room) => `https://www.primevideo.com/detail/${id}?wt_room=${room}`,
  },
  hotstar: {
    id: "hotstar",
    label: "Hotstar",
    backend: "video",
    isWatchPage: (u) => u.hostname.includes("hotstar.com") && /\/(watch|\d+)/.test(u.pathname),
    contentId: (u) => u.pathname.match(/\/(\d{6,})/)?.[1] ?? null,
    watchUrl: (id, room) => `https://www.hotstar.com/watch/${id}?wt_room=${room}`,
  },
};

export function detectPlatform(url: string = location.href): PlatformSpec | null {
  const u = new URL(url);
  for (const spec of Object.values(PLATFORMS)) {
    if (spec.isWatchPage(u) || matchesHost(spec, u)) return spec;
  }
  return null;
}

// Host match (not necessarily on a watch page yet) — the content script still
// mounts so the user can navigate to a title.
function matchesHost(spec: PlatformSpec, u: URL): boolean {
  switch (spec.id) {
    case "netflix":
      return u.hostname.endsWith("netflix.com");
    case "youtube":
      return u.hostname.endsWith("youtube.com");
    case "prime":
      return u.hostname.endsWith("primevideo.com") || u.hostname.endsWith("amazon.com");
    case "hotstar":
      return u.hostname.includes("hotstar.com");
  }
}
