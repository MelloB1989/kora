# WatchTogether WebSocket Protocol (v1)

Transport: API Gateway WebSocket API (prod) or the localdev server (`ws://localhost:8080/ws`).
Authentication: JWT passed as `?token=` query parameter on connect. Bad/missing token → connection refused (401).

Routing is application-level: every frame is a JSON envelope and the server dispatches on `type`
(API Gateway only defines `$connect` / `$disconnect` / `$default`).

## Envelope

```json
{
  "v": 1,
  "type": "playback_event",
  "roomId": "r_9f2k7q",
  "senderId": "u_ab12cd",
  "ts": 1752350000123,
  "seq": 42,
  "payload": {}
}
```

- `v` — protocol version, currently `1`.
- `type` — message type (below).
- `roomId` — required on `join_room`; server-stamped on relayed messages.
- `senderId` — **server-stamped** on relay from the JWT identity; values sent by clients are ignored.
- `ts` — sender wall-clock, epoch milliseconds.
- `seq` — per-sender monotonic counter. Receivers drop messages whose `seq` is ≤ the last seen
  value for that sender (stale/reordered event rejection).
- `payload` — type-specific body.

## Client → Server

| type | payload | notes |
|---|---|---|
| `join_room` | `{"roomId": "r_..."}` | Identity comes from the JWT bound at connect. Server replies `room_state`, broadcasts `member_joined`. |
| `leave_room` | `{}` | Leaves the current room. |
| `playback_event` | `{"action": "play"\|"pause"\|"seek", "currentTime": 1234.56, "mediaTimestamp": 1752350000123, "contentId": "81234567"}` | `currentTime` in **seconds** (player position when the action happened); `mediaTimestamp` is the wall clock (ms) at the moment `currentTime` was read — used for latency compensation. Any member may send; relayed to all *other* members. |
| `heartbeat` | `{"currentTime": 1234.56, "paused": false, "mediaTimestamp": ...}` | **Host only**, every 5s while playing. Non-host heartbeats are silently dropped. Rebroadcast to others as `sync`. |
| `ping` | `{}` | Keepalive. Server replies `pong`. Send every ~20s. |

## Server → Client

| type | payload | notes |
|---|---|---|
| `room_state` | `{"room": {...}, "members": [{"userId","displayName","isHost"}], "playback": {...}\|null}` | Sent to the joiner after `join_room`. `playback` is the latest known heartbeat/event, if any. |
| `member_joined` | `{"userId","displayName","isHost"}` | |
| `member_left` | `{"userId"}` | |
| `playback_event` | as client payload | Relayed; `senderId` stamped. Never echoed back to the sender. |
| `sync` | as `heartbeat` payload | Relayed host heartbeat. Clients treat it as drift *correction*, not a command. |
| `host_changed` | `{"userId"}` | Host disconnected; earliest-joined remaining member promoted. |
| `error` | `{"code","message"}` | Codes: `ROOM_NOT_FOUND`, `NOT_IN_ROOM`, `NOT_HOST`, `BAD_MESSAGE`, `ROOM_ENDED`. |
| `pong` | `{}` | |

## Trust model (MVP)

Host-authority for state, peer-relay for events: any member can play/pause/seek the room
(`playback_event`), but only the host's `heartbeat` drives drift correction (`sync`), so all
clients converge on the host's clock. Host = room creator; on host disconnect the server promotes
the earliest-joined remaining member and broadcasts `host_changed`.

## Drift correction (client behavior)

On `sync` while playing: `expected = currentTime + (nowWallClock - mediaTimestamp) / 1000`.

- drift ≤ 1.5 s → ignore
- 1.5 s < drift ≤ 4 s → seek to `expected + 0.25` (lead covers seek latency)
- drift > 4 s → seek and show a "resyncing" indicator

Play/pause mismatch with the host → apply the host's state. After applying any remote event,
suppress corrections for 3 s (don't fight in-flight seeks).

## Connection lifecycle

API Gateway WebSockets have a **2-hour hard cap** and a **10-minute idle timeout**. Clients must
ping every ~20 s and silently reconnect + re-`join_room` on any close (movies exceed 2 h).
