package rooms

import (
	"context"
	"errors"
	"testing"

	"github.com/MelloB1989/kora/backend/internal/models"
	"github.com/MelloB1989/kora/backend/internal/store"
)

func TestCreateAndGetActive(t *testing.T) {
	s := NewService(store.NewMemory())
	room, err := s.Create(context.Background(), "u_1", models.PlatformNetflix, "81234567", "Show")
	if err != nil {
		t.Fatal(err)
	}
	if room.Status != models.RoomStatusActive || room.HostUserID != "u_1" {
		t.Fatalf("bad room: %+v", room)
	}
	if _, err := s.GetActive(context.Background(), room.RoomID); err != nil {
		t.Fatal(err)
	}
}

func TestEndRequiresHost(t *testing.T) {
	s := NewService(store.NewMemory())
	room, _ := s.Create(context.Background(), "u_host", models.PlatformNetflix, "1", "")
	if err := s.End(context.Background(), room.RoomID, "u_other"); !errors.Is(err, ErrNotHost) {
		t.Fatalf("expected ErrNotHost, got %v", err)
	}
	if err := s.End(context.Background(), room.RoomID, "u_host"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetActive(context.Background(), room.RoomID); !errors.Is(err, ErrRoomEnded) {
		t.Fatalf("expected ErrRoomEnded, got %v", err)
	}
}

func TestJoinURL(t *testing.T) {
	url := JoinURL(&models.Room{Platform: models.PlatformNetflix, ContentID: "81234567", RoomID: "r_abc"})
	want := "https://www.netflix.com/watch/81234567?wt_room=r_abc"
	if url != want {
		t.Fatalf("got %q want %q", url, want)
	}
}
