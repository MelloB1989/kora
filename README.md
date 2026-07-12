# WatchTogether

A Teleparty-style watch-party platform: groups sync video playback across
streaming services while adding chat, reactions, voice/video, and a watch-time
dashboard. Each member watches on **their own logged-in account** through the
platform's **native player** — we relay only playback control events and
metadata. **No DRM circumvention, no video re-streaming or proxying.**

This repository contains **Phase 1**: playback sync for **Netflix**, with the
full monorepo scaffolded for later phases (multi-platform, chat/reactions,
voice/video, dashboard).

## Monorepo

| Path | What it is | Status |
|---|---|---|
| `backend/` | Go — AWS Lambda (SAM) REST + WebSocket APIs, DynamoDB | Phase 1 ✅ |
| `extension/` | Chrome MV3 extension — Netflix adapter, sync engine, overlay | Phase 1 ✅ |
| `dashboard/` | Vite + React + Tailwind web app | Placeholder (Phase 5) |
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
```

Load the extension: `chrome://extensions` → enable Developer mode → **Load
unpacked** → select `extension/dist`. Requires Chrome 116+.

To point the extension at a deployed backend instead, create `extension/.env`:

```
VITE_API_URL=https://xxxx.execute-api.us-east-1.amazonaws.com/prod
VITE_WS_URL=wss://xxxx.execute-api.us-east-1.amazonaws.com/prod
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
WebSocket API, and five DynamoDB tables (`Users`, `Rooms`, `RoomMembers`,
`Connections`, `PlaybackEvents`). The stack outputs the REST and `wss://` URLs
to put in `extension/.env`.

## Roadmap

- **Phase 1 (done)** — Netflix playback sync MVP.
- **Phase 2** — Prime Video, Hotstar, YouTube adapters behind the same
  `PlatformAdapter` interface.
- **Phase 3** — text chat + reactions/soundbox over the existing WebSocket.
- **Phase 4** — WebRTC voice/video (PiP), signaled over the WebSocket.
- **Phase 5** — dashboard: watch-time analytics and per-show progress.

## Licensing note

The backend depends on `github.com/MelloB1989/karma` (**GPL-3.0**), currently
only in `backend/internal/config`. Linking GPL-3.0 code imposes GPL obligations
on distribution; the dependency is isolated to one file and can be swapped for
`os.Getenv` if that becomes a concern.
