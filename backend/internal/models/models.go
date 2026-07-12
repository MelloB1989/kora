// Package models defines the entities persisted in DynamoDB.
package models

import (
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"strings"
	"time"
)

const (
	PlatformNetflix = "netflix"

	RoomStatusActive = "active"
	RoomStatusEnded  = "ended"
)

type User struct {
	UserID       string    `dynamodbav:"userId" json:"userId"`
	Email        string    `dynamodbav:"email" json:"email"`
	PasswordHash string    `dynamodbav:"passwordHash" json:"-"`
	DisplayName  string    `dynamodbav:"displayName" json:"displayName"`
	AvatarURL    string    `dynamodbav:"avatarUrl,omitempty" json:"avatarUrl,omitempty"`
	CreatedAt    time.Time `dynamodbav:"createdAt" json:"createdAt"`
}

type Room struct {
	RoomID     string    `dynamodbav:"roomId" json:"roomId"`
	HostUserID string    `dynamodbav:"hostUserId" json:"hostUserId"`
	Platform   string    `dynamodbav:"platform" json:"platform"`
	ContentID  string    `dynamodbav:"contentId" json:"contentId"`
	Title      string    `dynamodbav:"title,omitempty" json:"title,omitempty"`
	Status     string    `dynamodbav:"status" json:"status"`
	CreatedAt  time.Time `dynamodbav:"createdAt" json:"createdAt"`
}

type RoomMember struct {
	RoomID      string    `dynamodbav:"roomId" json:"roomId"`
	UserID      string    `dynamodbav:"userId" json:"userId"`
	DisplayName string    `dynamodbav:"displayName" json:"displayName"`
	JoinedAt    time.Time `dynamodbav:"joinedAt" json:"joinedAt"`
}

// Connection maps an API Gateway WebSocket connection to a user and,
// once joined, a room. ExpiresAt is a DynamoDB TTL (API Gateway hard-caps
// connections at 2h; we keep rows 3h as a backstop against missed disconnects).
type Connection struct {
	ConnectionID string    `dynamodbav:"connectionId" json:"connectionId"`
	UserID       string    `dynamodbav:"userId" json:"userId"`
	DisplayName  string    `dynamodbav:"displayName" json:"displayName"`
	RoomID       string    `dynamodbav:"roomId,omitempty" json:"roomId,omitempty"`
	ConnectedAt  time.Time `dynamodbav:"connectedAt" json:"connectedAt"`
	ExpiresAt    int64     `dynamodbav:"expiresAt" json:"expiresAt"`
}

// PlaybackEvent is an audit/catch-up record of a relayed playback action.
// SortKey is "<zero-padded epoch ms>#<eventId>" so a Query with
// ScanIndexForward=false returns the latest event first.
type PlaybackEvent struct {
	RoomID         string  `dynamodbav:"roomId" json:"roomId"`
	SortKey        string  `dynamodbav:"sk" json:"-"`
	EventID        string  `dynamodbav:"eventId" json:"eventId"`
	SenderID       string  `dynamodbav:"senderId" json:"senderId"`
	Action         string  `dynamodbav:"action" json:"action"`
	CurrentTime    float64 `dynamodbav:"currentTime" json:"currentTime"`
	Paused         bool    `dynamodbav:"paused" json:"paused"`
	MediaTimestamp int64   `dynamodbav:"mediaTimestamp" json:"mediaTimestamp"`
	ContentID      string  `dynamodbav:"contentId,omitempty" json:"contentId,omitempty"`
	ExpiresAt      int64   `dynamodbav:"expiresAt" json:"-"`
}

func EventSortKey(ts time.Time, eventID string) string {
	return fmt.Sprintf("%013d#%s", ts.UnixMilli(), eventID)
}

// NewID returns a URL-safe random identifier like "u_4kx9q2w7m3".
func NewID(prefix string) string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err) // crypto/rand failure is unrecoverable
	}
	enc := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:]))
	return prefix + "_" + enc[:10]
}
