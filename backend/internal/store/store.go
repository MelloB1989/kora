// Package store defines the persistence interface and its DynamoDB and
// in-memory implementations. All business logic depends only on Store, so
// prod (Lambda + DynamoDB), localdev, and tests share the same code paths.
package store

import (
	"context"
	"errors"

	"github.com/MelloB1989/kora/backend/internal/models"
)

var (
	ErrNotFound      = errors.New("not found")
	ErrAlreadyExists = errors.New("already exists")
)

type Store interface {
	// Users
	PutUser(ctx context.Context, u *models.User) error // fails with ErrAlreadyExists on userId collision
	GetUser(ctx context.Context, userID string) (*models.User, error)
	GetUserByEmail(ctx context.Context, email string) (*models.User, error)

	// Rooms
	PutRoom(ctx context.Context, r *models.Room) error
	GetRoom(ctx context.Context, roomID string) (*models.Room, error)
	UpdateRoomStatus(ctx context.Context, roomID, status string) error
	UpdateRoomHost(ctx context.Context, roomID, hostUserID string) error

	// Room members
	PutMember(ctx context.Context, m *models.RoomMember) error
	DeleteMember(ctx context.Context, roomID, userID string) error
	ListMembers(ctx context.Context, roomID string) ([]models.RoomMember, error)

	// WebSocket connections
	PutConnection(ctx context.Context, c *models.Connection) error
	GetConnection(ctx context.Context, connectionID string) (*models.Connection, error)
	DeleteConnection(ctx context.Context, connectionID string) error
	SetConnectionRoom(ctx context.Context, connectionID, roomID string) error
	ListRoomConnections(ctx context.Context, roomID string) ([]models.Connection, error)

	// Playback events (24h TTL audit / late-join catch-up)
	PutPlaybackEvent(ctx context.Context, e *models.PlaybackEvent) error
	LatestPlaybackEvent(ctx context.Context, roomID string) (*models.PlaybackEvent, error)
}
