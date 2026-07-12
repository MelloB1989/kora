// Package rooms holds room lifecycle business logic shared by the REST API
// and the WebSocket relay.
package rooms

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/MelloB1989/kora/backend/internal/models"
	"github.com/MelloB1989/kora/backend/internal/store"
)

var (
	ErrNotHost   = errors.New("caller is not the room host")
	ErrRoomEnded = errors.New("room has ended")
)

type Service struct {
	store store.Store
	now   func() time.Time
}

func NewService(s store.Store) *Service {
	return &Service{store: s, now: time.Now}
}

func (s *Service) Create(ctx context.Context, hostUserID, platform, contentID, title string) (*models.Room, error) {
	r := &models.Room{
		RoomID:     models.NewID("r"),
		HostUserID: hostUserID,
		Platform:   platform,
		ContentID:  contentID,
		Title:      title,
		Status:     models.RoomStatusActive,
		CreatedAt:  s.now().UTC(),
	}
	if err := s.store.PutRoom(ctx, r); err != nil {
		return nil, err
	}
	return r, nil
}

func (s *Service) Get(ctx context.Context, roomID string) (*models.Room, error) {
	return s.store.GetRoom(ctx, roomID)
}

// GetActive returns the room only if it is joinable.
func (s *Service) GetActive(ctx context.Context, roomID string) (*models.Room, error) {
	r, err := s.store.GetRoom(ctx, roomID)
	if err != nil {
		return nil, err
	}
	if r.Status != models.RoomStatusActive {
		return nil, ErrRoomEnded
	}
	return r, nil
}

func (s *Service) End(ctx context.Context, roomID, callerUserID string) error {
	r, err := s.store.GetRoom(ctx, roomID)
	if err != nil {
		return err
	}
	if r.HostUserID != callerUserID {
		return ErrNotHost
	}
	return s.store.UpdateRoomStatus(ctx, roomID, models.RoomStatusEnded)
}

// JoinURL builds the shareable link that lands a friend on the same title
// with the room id in the query string (picked up by the extension).
func JoinURL(r *models.Room) string {
	switch r.Platform {
	case models.PlatformNetflix:
		return fmt.Sprintf("https://www.netflix.com/watch/%s?wt_room=%s", r.ContentID, r.RoomID)
	default:
		return ""
	}
}
