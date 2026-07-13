# WatchTogether

A Teleparty-style watch-party platform: groups sync video playback across
streaming services while adding chat, reactions, voice/video, and a watch-time
dashboard. Each member watches on **their own logged-in account** through the
platform's **native player** — we relay only playback control events and
metadata. **No DRM circumvention, no video re-streaming or proxying.**

All five build phases are implemented: playback sync across **Netflix, Prime
Video, Hotstar, and YouTube**; text chat, reactions, and soundbox; WebRTC
voice/video; and a watch-time analytics dashboard.

## Monorepo

| Path | What it is | Status |
|---|---|---|
| `backend/` | Go — AWS Lambda (SAM) REST + WebSocket APIs, DynamoDB | ✅ |
| `extension/` | Chrome MV3 extension — 4 platform adapters, sync engine, overlay, chat, WebRTC | ✅ |
| `dashboard/` | Vite + React + Tailwind — auth, watch-time analytics, show progress | ✅ |
| `docs/` | Architecture and WebSocket protocol specs | — |

See `docs/architecture.md` and `docs/ws-protocol.md` for design detail.

## How sync works

1. Each member runs the extension and opens the same Netflix title on their own
   account.
2. Play/pause/seek by any member is captured from the native player and relayed
   over a WebSocket to everyone else in the room, who apply it to their player.
3. The **host** (room creator) emits a position heartbeat every 5s; other
   clients gently seek if they drift more than ~1.5s. If the host leaves, the
   earliest-joined member is promoted.
4. Netflix ignores direct `<video>.currentTime` writes, so control goes through
   Netflix's player API from a MAIN-world page script (`extension/src/adapters/
   netflix/pageScript.ts`). If those hooks ever break, the overlay shows
   "sync unavailable" rather than crashing.

## Local development

No AWS needed — the backend runs entirely in-process with an in-memory store,
because `sam local` does not support WebSocket APIs.

```bash
# 1) Backend (REST on :8080, WebSocket on ws://localhost:8080/ws)
cd backend
JWT_SECRET=dev-secret make localdev

# 2) Extension (points at localhost by default)
cd extension
npm install
npm run build      # outputs dist/

# 3) Dashboard (optional; points at localhost:8080 by default)
cd dashboard
npm install
npm run dev        # http://localhost:5173
```

Load the extension: `chrome://extensions` → enable Developer mode → **Load
unpacked** → select `extension/dist`. Requires Chrome 116+. It activates on
Netflix, Prime Video, Hotstar, and YouTube watch pages.

To point the extension or dashboard at a deployed backend, create a `.env` in
the respective package:

```
# extension/.env
VITE_API_URL=https://xxxx.execute-api.us-east-1.amazonaws.com/prod
VITE_WS_URL=wss://xxxx.execute-api.us-east-1.amazonaws.com/prod

# dashboard/.env
VITE_API_URL=https://xxxx.execute-api.us-east-1.amazonaws.com/prod
```

### Manual end-to-end test (two people in sync)

1. Start `make localdev` and build + load the extension in **two Chrome
   profiles**.
2. Profile A: open the WatchTogether overlay (bottom-right), sign up / log in,
   open a Netflix title, click **Create room here**, and **Copy link**.
3. Profile B: log in, open the copied link (`.../watch/<id>?wt_room=<roomId>`) —
   the overlay joins the room automatically.
4. Play / pause / seek in A → B follows within ~1s; do the same in B → A
   follows. Let both play a couple of minutes and confirm drift stays small.
5. Close A's tab → B sees the member leave and host reassignment.

## Tests

```bash
cd backend && go test ./...      # relay, rooms, auth
cd extension && npm test         # drift-correction math (vitest)
```

## Deploying the backend (AWS SAM)

Requires the AWS SAM CLI and credentials.

```bash
cd backend
make deploy JWT_SECRET="$(openssl rand -hex 32)"
```

This provisions two Lambda functions (REST + WebSocket), an HTTP API, a
WebSocket API, and seven DynamoDB tables (`Users`, `Rooms`, `RoomMembers`,
`Connections`, `PlaybackEvents`, `WatchSessions`, `ShowProgress`). The stack
outputs the REST and `wss://` URLs to put in `extension/.env`.

## Features

- **Phase 1** — playback sync MVP (Netflix): rooms, play/pause/seek relay,
  host-heartbeat drift correction.
- **Phase 2** — Prime Video, Hotstar, and YouTube adapters behind one
  `PlatformAdapter` interface (add a platform: one entry in
  `extension/src/shared/platforms.ts` + one page-script backend).
- **Phase 3** — text chat, emoji reactions (floating bursts), and a soundbox
  (Web Audio-synthesized effects) over the existing WebSocket.
- **Phase 4** — WebRTC voice/video mesh with a draggable PiP overlay, mute,
  push-to-talk, and camera toggle; signaling relayed over the WebSocket.
- **Phase 5** — dashboard: watch-time analytics (totals, per-platform, weekly),
  room history, and per-show progress.

### Known limitations / next steps
- Streaming-site player hooks (Netflix player API; Prime/Hotstar `<video>`) are
  unofficial and need validation against each live site; they degrade to a
  "sync unavailable" state rather than crashing.
- WebRTC uses public STUN and a full mesh — add a TURN server for restrictive
  NATs and an SFU (LiveKit/mediasoup) for rooms larger than ~4-5.
- Chat/reactions are ephemeral; soundbox uses synthesized effects (S3-hosted
  custom clips are a later enhancement).

## Licensing note

The backend depends on `github.com/MelloB1989/karma` (**GPL-3.0**), currently
only in `backend/internal/config`. Linking GPL-3.0 code imposes GPL obligations
on distribution; the dependency is isolated to one file and can be swapped for
`os.Getenv` if that becomes a concern.
