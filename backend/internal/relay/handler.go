package relay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/MelloB1989/kora/backend/internal/auth"
	"github.com/MelloB1989/kora/backend/internal/models"
	"github.com/MelloB1989/kora/backend/internal/rooms"
	"github.com/MelloB1989/kora/backend/internal/store"
)

// ErrGone signals that a connection no longer exists at the transport layer
// (API Gateway GoneException). Broadcast prunes the stale row and moves on.
var ErrGone = errors.New("connection gone")

// Sender delivers a frame to one connection. Implementations: API Gateway
// Management API (prod), in-process registry (localdev), recording fake (tests).
type Sender interface {
	Send(ctx context.Context, connectionID string, data []byte) error
}

const (
	connectionTTL   = 3 * time.Hour // API GW caps connections at 2h; TTL is the backstop
	eventTTL        = 24 * time.Hour
	fanoutParallel  = 8
	maxRelayPayload = 8 * 1024 // cap chat/reaction/soundbox payloads
)

// Handler routes WebSocket events. It is transport-agnostic: API Gateway
// Lambda events and the localdev server both feed into the same three methods.
type Handler struct {
	store store.Store
	rooms *rooms.Service
	auth  *auth.Manager
	send  Sender
	log   *slog.Logger
	now   func() time.Time
}

func NewHandler(s store.Store, rs *rooms.Service, am *auth.Manager, sender Sender, log *slog.Logger) *Handler {
	if log == nil {
		log = slog.Default()
	}
	return &Handler{store: s, rooms: rs, auth: am, send: sender, log: log, now: time.Now}
}

// HandleConnect authenticates the JWT passed as the ?token= query parameter
// and registers the connection. An error return means "reject with 401".
func (h *Handler) HandleConnect(ctx context.Context, connectionID, token string) error {
	claims, err := h.auth.VerifyToken(token)
	if err != nil {
		return fmt.Errorf("connect auth: %w", err)
	}
	now := h.now().UTC()
	return h.store.PutConnection(ctx, &models.Connection{
		ConnectionID: connectionID,
		UserID:       claims.UserID,
		DisplayName:  claims.DisplayName,
		ConnectedAt:  now,
		ExpiresAt:    now.Add(connectionTTL).Unix(),
	})
}

// HandleDisconnect removes the connection and, if it was in a room, handles
// membership cleanup and host promotion.
func (h *Handler) HandleDisconnect(ctx context.Context, connectionID string) error {
	conn, err := h.store.GetConnection(ctx, connectionID)
	if errors.Is(err, store.ErrNotFound) {
		return nil // already cleaned up (e.g. pruned after GoneException)
	}
	if err != nil {
		return err
	}
	if conn.RoomID != "" {
		if err := h.leaveRoom(ctx, conn); err != nil {
			h.log.Error("disconnect leave_room cleanup", "err", err, "roomId", conn.RoomID)
		}
	}
	return h.store.DeleteConnection(ctx, connectionID)
}

// HandleMessage decodes one client frame and routes it on the envelope type.
func (h *Handler) HandleMessage(ctx context.Context, connectionID string, data []byte) error {
	conn, err := h.store.GetConnection(ctx, connectionID)
	if err != nil {
		return fmt.Errorf("unknown connection %s: %w", connectionID, err)
	}

	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		return h.sendError(ctx, connectionID, CodeBadMessage, "malformed JSON envelope")
	}

	switch env.Type {
	case TypePing:
		return h.reply(ctx, connectionID, Envelope{V: ProtocolVersion, Type: TypePong, Ts: h.now().UnixMilli()})
	case TypeJoinRoom:
		return h.handleJoin(ctx, conn, env)
	case TypeLeaveRoom:
		if conn.RoomID == "" {
			return h.sendError(ctx, connectionID, CodeNotInRoom, "not in a room")
		}
		if err := h.leaveRoom(ctx, conn); err != nil {
			return err
		}
		return h.store.SetConnectionRoom(ctx, connectionID, "")
	case TypePlaybackEvent:
		return h.handlePlayback(ctx, conn, env)
	case TypeHeartbeat:
		return h.handleHeartbeat(ctx, conn, env)
	case TypeChat, TypeReaction, TypeSoundbox:
		return h.handleRoomRelay(ctx, conn, env)
	case TypeSignal:
		return h.handleSignal(ctx, conn, env)
	default:
		return h.sendError(ctx, connectionID, CodeBadMessage, "unknown message type "+env.Type)
	}
}

func (h *Handler) handleJoin(ctx context.Context, conn *models.Connection, env Envelope) error {
	var p JoinRoomPayload
	if err := json.Unmarshal(env.Payload, &p); err != nil || p.RoomID == "" {
		return h.sendError(ctx, conn.ConnectionID, CodeBadMessage, "join_room requires payload.roomId")
	}

	room, err := h.rooms.GetActive(ctx, p.RoomID)
	switch {
	case errors.Is(err, store.ErrNotFound):
		return h.sendError(ctx, conn.ConnectionID, CodeRoomNotFound, "room not found")
	case errors.Is(err, rooms.ErrRoomEnded):
		return h.sendError(ctx, conn.ConnectionID, CodeRoomEnded, "room has ended")
	case err != nil:
		return err
	}

	if err := h.store.PutMember(ctx, &models.RoomMember{
		RoomID:      room.RoomID,
		UserID:      conn.UserID,
		DisplayName: conn.DisplayName,
		JoinedAt:    h.now().UTC(),
	}); err != nil {
		return err
	}
	if err := h.store.SetConnectionRoom(ctx, conn.ConnectionID, room.RoomID); err != nil {
		return err
	}
	conn.RoomID = room.RoomID

	members, err := h.store.ListMembers(ctx, room.RoomID)
	if err != nil {
		return err
	}
	infos := make([]MemberInfo, 0, len(members))
	for _, m := range members {
		infos = append(infos, MemberInfo{UserID: m.UserID, DisplayName: m.DisplayName, IsHost: m.UserID == room.HostUserID})
	}

	var playback *PlaybackedState
	if last, err := h.store.LatestPlaybackEvent(ctx, room.RoomID); err == nil {
		playback = &PlaybackedState{
			Action:         last.Action,
			CurrentTime:    last.CurrentTime,
			Paused:         last.Paused || last.Action == "pause",
			MediaTimestamp: last.MediaTimestamp,
		}
	}

	if err := h.reply(ctx, conn.ConnectionID, Envelope{
		V: ProtocolVersion, Type: TypeRoomState, RoomID: room.RoomID, Ts: h.now().UnixMilli(),
		Payload: mustJSON(RoomStatePayload{
			Room: RoomInfo{
				RoomID: room.RoomID, HostUserID: room.HostUserID, Platform: room.Platform,
				ContentID: room.ContentID, Title: room.Title, Status: room.Status,
			},
			Members:  infos,
			Playback: playback,
		}),
	}); err != nil {
		return err
	}

	return h.broadcast(ctx, room.RoomID, conn.ConnectionID, Envelope{
		V: ProtocolVersion, Type: TypeMemberJoined, RoomID: room.RoomID, Ts: h.now().UnixMilli(),
		Payload: mustJSON(MemberInfo{UserID: conn.UserID, DisplayName: conn.DisplayName, IsHost: conn.UserID == room.HostUserID}),
	})
}

func (h *Handler) handlePlayback(ctx context.Context, conn *models.Connection, env Envelope) error {
	if conn.RoomID == "" {
		return h.sendError(ctx, conn.ConnectionID, CodeNotInRoom, "join a room first")
	}
	var p PlaybackPayload
	if err := json.Unmarshal(env.Payload, &p); err != nil || p.Action == "" {
		return h.sendError(ctx, conn.ConnectionID, CodeBadMessage, "bad playback_event payload")
	}

	now := h.now().UTC()
	eventID := models.NewID("e")
	if err := h.store.PutPlaybackEvent(ctx, &models.PlaybackEvent{
		RoomID:         conn.RoomID,
		SortKey:        models.EventSortKey(now, eventID),
		EventID:        eventID,
		SenderID:       conn.UserID,
		Action:         p.Action,
		CurrentTime:    p.CurrentTime,
		Paused:         p.Action == "pause",
		MediaTimestamp: p.MediaTimestamp,
		ContentID:      p.ContentID,
		ExpiresAt:      now.Add(eventTTL).Unix(),
	}); err != nil {
		h.log.Error("persist playback event", "err", err)
	}

	return h.broadcast(ctx, conn.RoomID, conn.ConnectionID, Envelope{
		V: ProtocolVersion, Type: TypePlaybackEvent, RoomID: conn.RoomID,
		SenderID: conn.UserID, Ts: env.Ts, Seq: env.Seq,
		Payload: mustJSON(p),
	})
}

// handleHeartbeat rebroadcasts the HOST's position as a sync correction.
// Non-host heartbeats are silently dropped (host-authority trust model).
func (h *Handler) handleHeartbeat(ctx context.Context, conn *models.Connection, env Envelope) error {
	if conn.RoomID == "" {
		return h.sendError(ctx, conn.ConnectionID, CodeNotInRoom, "join a room first")
	}
	room, err := h.rooms.Get(ctx, conn.RoomID)
	if err != nil {
		return err
	}
	if room.HostUserID != conn.UserID {
		return nil
	}
	var p HeartbeatPayload
	if err := json.Unmarshal(env.Payload, &p); err != nil {
		return h.sendError(ctx, conn.ConnectionID, CodeBadMessage, "bad heartbeat payload")
	}
	return h.broadcast(ctx, conn.RoomID, conn.ConnectionID, Envelope{
		V: ProtocolVersion, Type: TypeSync, RoomID: conn.RoomID,
		SenderID: conn.UserID, Ts: env.Ts, Seq: env.Seq,
		Payload: mustJSON(p),
	})
}

// handleRoomRelay rebroadcasts a social-layer message (chat/reaction/soundbox)
// to the rest of the room, stamping the sender's identity. Payloads are
// relayed verbatim and not persisted (ephemeral for the MVP).
func (h *Handler) handleRoomRelay(ctx context.Context, conn *models.Connection, env Envelope) error {
	if conn.RoomID == "" {
		return h.sendError(ctx, conn.ConnectionID, CodeNotInRoom, "join a room first")
	}
	if len(env.Payload) > maxRelayPayload {
		return h.sendError(ctx, conn.ConnectionID, CodeBadMessage, "payload too large")
	}
	return h.broadcast(ctx, conn.RoomID, conn.ConnectionID, Envelope{
		V: ProtocolVersion, Type: env.Type, RoomID: conn.RoomID,
		SenderID: conn.UserID, SenderName: conn.DisplayName,
		Ts: env.Ts, Seq: env.Seq, Payload: env.Payload,
	})
}

// handleSignal relays a WebRTC signaling frame to a single target member's
// connections (mesh peers exchange SDP/ICE this way). Falls back to nothing
// if the target isn't present.
func (h *Handler) handleSignal(ctx context.Context, conn *models.Connection, env Envelope) error {
	if conn.RoomID == "" {
		return h.sendError(ctx, conn.ConnectionID, CodeNotInRoom, "join a room first")
	}
	if env.Target == "" {
		return h.sendError(ctx, conn.ConnectionID, CodeBadMessage, "webrtc_signal requires target")
	}
	conns, err := h.store.ListRoomConnections(ctx, conn.RoomID)
	if err != nil {
		return err
	}
	out := Envelope{
		V: ProtocolVersion, Type: TypeSignal, RoomID: conn.RoomID,
		SenderID: conn.UserID, SenderName: conn.DisplayName,
		Target: env.Target, Ts: env.Ts, Payload: env.Payload,
	}
	data, err := json.Marshal(out)
	if err != nil {
		return err
	}
	for _, c := range conns {
		if c.UserID != env.Target || c.ConnectionID == conn.ConnectionID {
			continue
		}
		if err := h.send.Send(ctx, c.ConnectionID, data); errors.Is(err, ErrGone) {
			_ = h.store.DeleteConnection(ctx, c.ConnectionID)
		}
	}
	return nil
}

// leaveRoom removes membership, notifies the room, and promotes a new host
// if the leaver was hosting. The connection row itself is untouched.
func (h *Handler) leaveRoom(ctx context.Context, conn *models.Connection) error {
	roomID := conn.RoomID
	if err := h.store.DeleteMember(ctx, roomID, conn.UserID); err != nil {
		return err
	}

	if err := h.broadcast(ctx, roomID, conn.ConnectionID, Envelope{
		V: ProtocolVersion, Type: TypeMemberLeft, RoomID: roomID, Ts: h.now().UnixMilli(),
		Payload: mustJSON(MemberLeftPayload{UserID: conn.UserID}),
	}); err != nil {
		h.log.Error("broadcast member_left", "err", err)
	}

	room, err := h.rooms.Get(ctx, roomID)
	if err != nil {
		return err
	}
	if room.HostUserID != conn.UserID {
		return nil
	}

	// Host left: promote the earliest-joined remaining member.
	members, err := h.store.ListMembers(ctx, roomID)
	if err != nil {
		return err
	}
	if len(members) == 0 {
		return h.store.UpdateRoomStatus(ctx, roomID, models.RoomStatusEnded)
	}
	next := members[0]
	for _, m := range members[1:] {
		if m.JoinedAt.Before(next.JoinedAt) {
			next = m
		}
	}
	if err := h.store.UpdateRoomHost(ctx, roomID, next.UserID); err != nil {
		return err
	}
	return h.broadcast(ctx, roomID, conn.ConnectionID, Envelope{
		V: ProtocolVersion, Type: TypeHostChanged, RoomID: roomID, Ts: h.now().UnixMilli(),
		Payload: mustJSON(HostChangedPayload{UserID: next.UserID}),
	})
}

// broadcast fans a frame out to every connection in the room except the
// sender, pruning connections the transport reports as gone.
func (h *Handler) broadcast(ctx context.Context, roomID, excludeConnectionID string, env Envelope) error {
	conns, err := h.store.ListRoomConnections(ctx, roomID)
	if err != nil {
		return err
	}
	data, err := json.Marshal(env)
	if err != nil {
		return err
	}

	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(fanoutParallel)
	for _, c := range conns {
		if c.ConnectionID == excludeConnectionID {
			continue
		}
		g.Go(func() error {
			err := h.send.Send(gctx, c.ConnectionID, data)
			if errors.Is(err, ErrGone) {
				h.log.Info("pruning gone connection", "connectionId", c.ConnectionID)
				return h.store.DeleteConnection(gctx, c.ConnectionID)
			}
			if err != nil {
				// One bad receiver must not fail the whole fanout.
				h.log.Error("fanout send", "err", err, "connectionId", c.ConnectionID)
			}
			return nil
		})
	}
	return g.Wait()
}

func (h *Handler) reply(ctx context.Context, connectionID string, env Envelope) error {
	data, err := json.Marshal(env)
	if err != nil {
		return err
	}
	return h.send.Send(ctx, connectionID, data)
}

func (h *Handler) sendError(ctx context.Context, connectionID, code, message string) error {
	return h.reply(ctx, connectionID, Envelope{
		V: ProtocolVersion, Type: TypeError, Ts: h.now().UnixMilli(),
		Payload: mustJSON(ErrorPayload{Code: code, Message: message}),
	})
}
