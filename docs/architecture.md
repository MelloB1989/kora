# WatchTogether — Architecture

Teleparty-style watch parties: each member watches on their **own logged-in account** through the
platform's **native player**. We relay playback control events and metadata only — no DRM
circumvention, no video re-streaming or proxying.

```
Browser Extension (Chrome MV3)
  ├─ Platform Adapter (Netflix first; Prime/Hotstar/YouTube later)
  │    pageScript.ts (MAIN world) ── window.postMessage ── NetflixAdapter (isolated world)
  ├─ Content script: sync engine (echo suppression, drift correction), overlay mount
  ├─ Overlay UI: React in shadow DOM (room panel, members, sync status, login)
  └─ Background service worker: owns the WebSocket, auth token, session persistence

Backend (Go, AWS Lambda, SAM)
  ├─ RestFunction  ── API Gateway HTTP API ── auth (JWT), room CRUD
  ├─ WsFunction    ── API Gateway WebSocket API ($connect/$disconnect/$default)
  │                   room join/leave, playback relay, host heartbeat → sync fanout
  └─ DynamoDB: Users, Rooms, RoomMembers, Connections (TTL), PlaybackEvents (TTL)

Dashboard (Vite + React + Tailwind) — Phase 5 placeholder
```

## Backend layout

Two Lambda binaries (`cmd/rest`, `cmd/ws`) share all logic in `internal/`:

- `internal/relay` — WS envelope (`protocol.go`), transport-agnostic router (`handler.go`),
  fanout behind a `Sender` interface (`fanout.go`: API Gateway Management API in prod,
  in-process in localdev/tests).
- `internal/rooms` — room create/join/leave/host-promotion business logic.
- `internal/store` — repository interfaces + DynamoDB (`dynamo.go`) and in-memory (`memory.go`) impls.
- `internal/httpapi` — `http.ServeMux` router served via Lambda proxy adapter *and* by localdev.
- `internal/auth` — HS256 JWT issue/verify (golang-jwt v5), bcrypt passwords.
- `internal/config` — env config (wraps `karma/config`; see licensing note in README).

`cmd/localdev` runs the same relay handler + REST router as a plain Go server with an in-memory
store, because `sam local` does not support WebSocket APIs.

## DynamoDB tables

| Table | PK | SK | GSIs / extras |
|---|---|---|---|
| Users | `userId` | — | `email-index` (login lookup) |
| Rooms | `roomId` | — | hostUserId, platform, contentId, title, status, createdAt |
| RoomMembers | `roomId` | `userId` | `user-index` (userId → rooms) |
| Connections | `connectionId` | — | `room-index` (roomId → connections, fanout); TTL 3h |
| PlaybackEvents | `roomId` | `ts#eventId` | TTL 24h; audit / late-join catch-up |

## Extension topology

- **Service worker owns the WebSocket** (survives SPA navigations, one socket per browser,
  token never leaves the SW). Chrome ≥ 116 required: WS activity resets the SW idle timer;
  20-second protocol pings + a 1-minute `chrome.alarms` check keep it alive; session state in
  `chrome.storage.session` lets a restarted SW reconnect and re-join.
- **Content script** talks to the SW over a long-lived `chrome.runtime.connect` Port and runs the
  sync engine: outbound (user actions → `playback_event`) and inbound (remote events → adapter,
  with echo suppression and drift correction).
- **Netflix control** happens in a MAIN-world page script via the unofficial
  `netflix.appContext.state.playerApp.getAPI().videoPlayer` API (direct `video.currentTime`
  writes don't stick on Netflix). Times there are **milliseconds**. All access is defensive;
  failure degrades to a visible "sync unavailable" state, never a crash.
- Room links: `https://www.netflix.com/watch/{contentId}?wt_room={roomId}` — the content script
  detects `wt_room` and offers to join. Manual room-code paste is the fallback.

See `docs/ws-protocol.md` for the wire protocol.
