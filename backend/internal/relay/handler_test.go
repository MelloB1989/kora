package relay

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/MelloB1989/kora/backend/internal/auth"
	"github.com/MelloB1989/kora/backend/internal/models"
	"github.com/MelloB1989/kora/backend/internal/rooms"
	"github.com/MelloB1989/kora/backend/internal/store"
)

// fakeSender records every frame per connection.
type fakeSender struct {
	mu   sync.Mutex
	sent map[string][]Envelope
	gone map[string]bool
}

func newFakeSender() *fakeSender {
	return &fakeSender{sent: map[string][]Envelope{}, gone: map[string]bool{}}
}

func (f *fakeSender) Send(_ context.Context, connectionID string, data []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.gone[connectionID] {
		return ErrGone
	}
	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		return err
	}
	f.sent[connectionID] = append(f.sent[connectionID], env)
	return nil
}

func (f *fakeSender) frames(connectionID string) []Envelope {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Envelope(nil), f.sent[connectionID]...)
}

func (f *fakeSender) lastOfType(connectionID, typ string) *Envelope {
	frames := f.frames(connectionID)
	for i := len(frames) - 1; i >= 0; i-- {
		if frames[i].Type == typ {
			return &frames[i]
		}
	}
	return nil
}

type fixture struct {
	h      *Handler
	store  *store.Memory
	sender *fakeSender
	am     *auth.Manager
	rooms  *rooms.Service
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	mem := store.NewMemory()
	sender := newFakeSender()
	am := auth.NewManager("test-secret", time.Hour)
	rs := rooms.NewService(mem)
	return &fixture{
		h:      NewHandler(mem, rs, am, sender, nil),
		store:  mem,
		sender: sender,
		am:     am,
		rooms:  rs,
	}
}

// connect creates a user, issues a token, and simulates $connect.
func (fx *fixture) connect(t *testing.T, connID, userID, name string) {
	t.Helper()
	token, err := fx.am.IssueToken(&models.User{UserID: userID, DisplayName: name})
	if err != nil {
		t.Fatal(err)
	}
	if err := fx.h.HandleConnect(context.Background(), connID, token); err != nil {
		t.Fatalf("connect %s: %v", connID, err)
	}
}

func (fx *fixture) join(t *testing.T, connID, roomID string) {
	t.Helper()
	fx.message(t, connID, Envelope{V: 1, Type: TypeJoinRoom, Payload: mustJSON(JoinRoomPayload{RoomID: roomID})})
}

func (fx *fixture) message(t *testing.T, connID string, env Envelope) {
	t.Helper()
	data, err := json.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}
	if err := fx.h.HandleMessage(context.Background(), connID, data); err != nil {
		t.Fatalf("message %s type=%s: %v", connID, env.Type, err)
	}
}

func (fx *fixture) createRoom(t *testing.T, hostUserID string) *models.Room {
	t.Helper()
	room, err := fx.rooms.Create(context.Background(), hostUserID, models.PlatformNetflix, "81234567", "Test Show")
	if err != nil {
		t.Fatal(err)
	}
	return room
}

func TestConnectRejectsBadToken(t *testing.T) {
	fx := newFixture(t)
	if err := fx.h.HandleConnect(context.Background(), "c1", "not-a-jwt"); err == nil {
		t.Fatal("expected bad token to be rejected")
	}
}

func TestJoinRoomSendsRoomStateAndBroadcastsMemberJoined(t *testing.T) {
	fx := newFixture(t)
	room := fx.createRoom(t, "u_host")
	fx.connect(t, "c1", "u_host", "Host")
	fx.connect(t, "c2", "u_guest", "Guest")
	fx.join(t, "c1", room.RoomID)
	fx.join(t, "c2", room.RoomID)

	state := fx.sender.lastOfType("c2", TypeRoomState)
	if state == nil {
		t.Fatal("joiner did not receive room_state")
	}
	var p RoomStatePayload
	if err := json.Unmarshal(state.Payload, &p); err != nil {
		t.Fatal(err)
	}
	if p.Room.RoomID != room.RoomID || len(p.Members) != 2 {
		t.Fatalf("bad room_state: %+v", p)
	}
	hostFound := false
	for _, m := range p.Members {
		if m.UserID == "u_host" && m.IsHost {
			hostFound = true
		}
	}
	if !hostFound {
		t.Fatalf("host not flagged in members: %+v", p.Members)
	}

	if fx.sender.lastOfType("c1", TypeMemberJoined) == nil {
		t.Fatal("existing member did not receive member_joined")
	}
	if fx.sender.lastOfType("c2", TypeMemberJoined) != nil {
		t.Fatal("joiner received their own member_joined")
	}
}

func TestJoinUnknownRoomReturnsError(t *testing.T) {
	fx := newFixture(t)
	fx.connect(t, "c1", "u1", "A")
	fx.join(t, "c1", "r_nope")
	errFrame := fx.sender.lastOfType("c1", TypeError)
	if errFrame == nil {
		t.Fatal("expected error frame")
	}
	var p ErrorPayload
	_ = json.Unmarshal(errFrame.Payload, &p)
	if p.Code != CodeRoomNotFound {
		t.Fatalf("expected ROOM_NOT_FOUND, got %s", p.Code)
	}
}

func TestPlaybackEventRelayExcludesSenderAndStampsSenderID(t *testing.T) {
	fx := newFixture(t)
	room := fx.createRoom(t, "u_a")
	fx.connect(t, "ca", "u_a", "A")
	fx.connect(t, "cb", "u_b", "B")
	fx.connect(t, "cc", "u_c", "C")
	fx.join(t, "ca", room.RoomID)
	fx.join(t, "cb", room.RoomID)
	fx.join(t, "cc", room.RoomID)

	fx.message(t, "cb", Envelope{
		V: 1, Type: TypePlaybackEvent, Seq: 7, Ts: 1000,
		SenderID: "u_spoofed", // must be overwritten by the server
		Payload:  mustJSON(PlaybackPayload{Action: "pause", CurrentTime: 42.5, MediaTimestamp: 1000}),
	})

	for _, conn := range []string{"ca", "cc"} {
		ev := fx.sender.lastOfType(conn, TypePlaybackEvent)
		if ev == nil {
			t.Fatalf("%s did not receive playback_event", conn)
		}
		if ev.SenderID != "u_b" {
			t.Fatalf("senderId not stamped: got %q", ev.SenderID)
		}
		if ev.Seq != 7 {
			t.Fatalf("seq not preserved: got %d", ev.Seq)
		}
	}
	if fx.sender.lastOfType("cb", TypePlaybackEvent) != nil {
		t.Fatal("sender received their own event (echo)")
	}

	// Event was persisted for late-join catch-up.
	last, err := fx.store.LatestPlaybackEvent(context.Background(), room.RoomID)
	if err != nil || last.Action != "pause" || last.CurrentTime != 42.5 {
		t.Fatalf("event not persisted: %+v err=%v", last, err)
	}
}

func TestNonHostHeartbeatDroppedHostHeartbeatRelayedAsSync(t *testing.T) {
	fx := newFixture(t)
	room := fx.createRoom(t, "u_host")
	fx.connect(t, "ch", "u_host", "Host")
	fx.connect(t, "cg", "u_guest", "Guest")
	fx.join(t, "ch", room.RoomID)
	fx.join(t, "cg", room.RoomID)

	hb := mustJSON(HeartbeatPayload{CurrentTime: 100, Paused: false, MediaTimestamp: 5000})

	fx.message(t, "cg", Envelope{V: 1, Type: TypeHeartbeat, Payload: hb})
	if fx.sender.lastOfType("ch", TypeSync) != nil {
		t.Fatal("non-host heartbeat was relayed")
	}

	fx.message(t, "ch", Envelope{V: 1, Type: TypeHeartbeat, Payload: hb})
	sync := fx.sender.lastOfType("cg", TypeSync)
	if sync == nil {
		t.Fatal("host heartbeat was not relayed as sync")
	}
	if sync.SenderID != "u_host" {
		t.Fatalf("sync senderId: got %q", sync.SenderID)
	}
}

func TestLateJoinerGetsLastPlaybackState(t *testing.T) {
	fx := newFixture(t)
	room := fx.createRoom(t, "u_a")
	fx.connect(t, "ca", "u_a", "A")
	fx.join(t, "ca", room.RoomID)
	fx.message(t, "ca", Envelope{
		V: 1, Type: TypePlaybackEvent,
		Payload: mustJSON(PlaybackPayload{Action: "seek", CurrentTime: 300, MediaTimestamp: 9000}),
	})

	fx.connect(t, "cb", "u_b", "B")
	fx.join(t, "cb", room.RoomID)
	state := fx.sender.lastOfType("cb", TypeRoomState)
	var p RoomStatePayload
	_ = json.Unmarshal(state.Payload, &p)
	if p.Playback == nil || p.Playback.CurrentTime != 300 {
		t.Fatalf("late joiner missing playback state: %+v", p.Playback)
	}
}

func TestHostDisconnectPromotesEarliestMember(t *testing.T) {
	fx := newFixture(t)
	room := fx.createRoom(t, "u_host")
	fx.connect(t, "ch", "u_host", "Host")
	fx.connect(t, "c2", "u_second", "Second")
	fx.connect(t, "c3", "u_third", "Third")

	// Deterministic join order via the handler clock.
	base := time.Now()
	i := 0
	fx.h.now = func() time.Time { i++; return base.Add(time.Duration(i) * time.Second) }

	fx.join(t, "ch", room.RoomID)
	fx.join(t, "c2", room.RoomID)
	fx.join(t, "c3", room.RoomID)

	if err := fx.h.HandleDisconnect(context.Background(), "ch"); err != nil {
		t.Fatal(err)
	}

	updated, err := fx.store.GetRoom(context.Background(), room.RoomID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.HostUserID != "u_second" {
		t.Fatalf("expected earliest member promoted, got %q", updated.HostUserID)
	}
	for _, conn := range []string{"c2", "c3"} {
		if fx.sender.lastOfType(conn, TypeMemberLeft) == nil {
			t.Fatalf("%s missing member_left", conn)
		}
		hc := fx.sender.lastOfType(conn, TypeHostChanged)
		if hc == nil {
			t.Fatalf("%s missing host_changed", conn)
		}
		var p HostChangedPayload
		_ = json.Unmarshal(hc.Payload, &p)
		if p.UserID != "u_second" {
			t.Fatalf("host_changed userId: %q", p.UserID)
		}
	}

	if _, err := fx.store.GetConnection(context.Background(), "ch"); err == nil {
		t.Fatal("disconnected connection row not deleted")
	}
}

func TestLastMemberLeavingEndsRoom(t *testing.T) {
	fx := newFixture(t)
	room := fx.createRoom(t, "u_solo")
	fx.connect(t, "c1", "u_solo", "Solo")
	fx.join(t, "c1", room.RoomID)
	if err := fx.h.HandleDisconnect(context.Background(), "c1"); err != nil {
		t.Fatal(err)
	}
	updated, _ := fx.store.GetRoom(context.Background(), room.RoomID)
	if updated.Status != models.RoomStatusEnded {
		t.Fatalf("empty room not ended: %s", updated.Status)
	}
}

func TestGoneConnectionIsPruned(t *testing.T) {
	fx := newFixture(t)
	room := fx.createRoom(t, "u_a")
	fx.connect(t, "ca", "u_a", "A")
	fx.connect(t, "cb", "u_b", "B")
	fx.join(t, "ca", room.RoomID)
	fx.join(t, "cb", room.RoomID)

	fx.sender.gone["cb"] = true
	fx.message(t, "ca", Envelope{
		V: 1, Type: TypePlaybackEvent,
		Payload: mustJSON(PlaybackPayload{Action: "play", CurrentTime: 1, MediaTimestamp: 1}),
	})

	if _, err := fx.store.GetConnection(context.Background(), "cb"); err == nil {
		t.Fatal("gone connection row was not pruned")
	}
}

func TestPingPong(t *testing.T) {
	fx := newFixture(t)
	fx.connect(t, "c1", "u1", "A")
	fx.message(t, "c1", Envelope{V: 1, Type: TypePing})
	if fx.sender.lastOfType("c1", TypePong) == nil {
		t.Fatal("no pong")
	}
}
