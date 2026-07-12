// Package relay implements the WebSocket message protocol and routing.
// The wire format is documented in docs/ws-protocol.md and mirrored in
// extension/src/shared/protocol.ts — keep the three in sync.
package relay

import "encoding/json"

const ProtocolVersion = 1

// Client → server message types.
const (
	TypeJoinRoom      = "join_room"
	TypeLeaveRoom     = "leave_room"
	TypePlaybackEvent = "playback_event"
	TypeHeartbeat     = "heartbeat"
	TypePing          = "ping"
)

// Server → client message types.
const (
	TypeRoomState    = "room_state"
	TypeMemberJoined = "member_joined"
	TypeMemberLeft   = "member_left"
	TypeSync         = "sync" // relayed host heartbeat
	TypeHostChanged  = "host_changed"
	TypeError        = "error"
	TypePong         = "pong"
)

// Error codes carried by TypeError payloads.
const (
	CodeRoomNotFound = "ROOM_NOT_FOUND"
	CodeRoomEnded    = "ROOM_ENDED"
	CodeNotInRoom    = "NOT_IN_ROOM"
	CodeNotHost      = "NOT_HOST"
	CodeBadMessage   = "BAD_MESSAGE"
)

// Envelope wraps every frame in both directions. SenderID is server-stamped
// on relay (client-supplied values are ignored). Seq is a per-sender
// monotonic counter used by receivers to drop stale/reordered events.
type Envelope struct {
	V        int             `json:"v"`
	Type     string          `json:"type"`
	RoomID   string          `json:"roomId,omitempty"`
	SenderID string          `json:"senderId,omitempty"`
	Ts       int64           `json:"ts,omitempty"`
	Seq      int64           `json:"seq,omitempty"`
	Payload  json.RawMessage `json:"payload,omitempty"`
}

type JoinRoomPayload struct {
	RoomID string `json:"roomId"`
}

// PlaybackPayload carries play/pause/seek actions. CurrentTime is in seconds;
// MediaTimestamp is the sender's wall clock (epoch ms) at the instant
// CurrentTime was read, enabling latency compensation on receivers.
type PlaybackPayload struct {
	Action         string  `json:"action"` // play | pause | seek
	CurrentTime    float64 `json:"currentTime"`
	MediaTimestamp int64   `json:"mediaTimestamp"`
	ContentID      string  `json:"contentId,omitempty"`
}

// HeartbeatPayload is the host's periodic position report, rebroadcast to
// non-hosts as TypeSync for drift correction.
type HeartbeatPayload struct {
	CurrentTime    float64 `json:"currentTime"`
	Paused         bool    `json:"paused"`
	MediaTimestamp int64   `json:"mediaTimestamp"`
}

type MemberInfo struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
	IsHost      bool   `json:"isHost"`
}

type RoomInfo struct {
	RoomID     string `json:"roomId"`
	HostUserID string `json:"hostUserId"`
	Platform   string `json:"platform"`
	ContentID  string `json:"contentId"`
	Title      string `json:"title,omitempty"`
	Status     string `json:"status"`
}

// RoomStatePayload is sent to a client right after a successful join.
type RoomStatePayload struct {
	Room     RoomInfo         `json:"room"`
	Members  []MemberInfo     `json:"members"`
	Playback *PlaybackedState `json:"playback,omitempty"`
}

// PlaybackedState is the last known playback position (for late joiners).
type PlaybackedState struct {
	Action         string  `json:"action,omitempty"`
	CurrentTime    float64 `json:"currentTime"`
	Paused         bool    `json:"paused"`
	MediaTimestamp int64   `json:"mediaTimestamp"`
}

type HostChangedPayload struct {
	UserID string `json:"userId"`
}

type MemberLeftPayload struct {
	UserID string `json:"userId"`
}

type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err) // all payload types are marshalable by construction
	}
	return b
}
