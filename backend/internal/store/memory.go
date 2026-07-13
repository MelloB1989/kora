package store

import (
	"context"
	"sort"
	"strings"
	"sync"

	"github.com/MelloB1989/kora/backend/internal/models"
)

// Memory is a threadsafe in-memory Store for tests and the localdev server.
type Memory struct {
	mu          sync.RWMutex
	users       map[string]models.User
	usersByMail map[string]string // email -> userId
	rooms       map[string]models.Room
	members     map[string]map[string]models.RoomMember // roomId -> userId -> member
	conns       map[string]models.Connection
	events      map[string][]models.PlaybackEvent // roomId -> events (append order)
	sessions    map[string][]models.WatchSession  // userId -> sessions
	progress    map[string]models.ShowProgress    // userId#sk -> progress
}

var _ Store = (*Memory)(nil)

func NewMemory() *Memory {
	return &Memory{
		users:       map[string]models.User{},
		usersByMail: map[string]string{},
		rooms:       map[string]models.Room{},
		members:     map[string]map[string]models.RoomMember{},
		conns:       map[string]models.Connection{},
		events:      map[string][]models.PlaybackEvent{},
		sessions:    map[string][]models.WatchSession{},
		progress:    map[string]models.ShowProgress{},
	}
}

func normEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }

func (s *Memory) PutUser(_ context.Context, u *models.User) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[u.UserID]; ok {
		return ErrAlreadyExists
	}
	if _, ok := s.usersByMail[normEmail(u.Email)]; ok {
		return ErrAlreadyExists
	}
	s.users[u.UserID] = *u
	s.usersByMail[normEmail(u.Email)] = u.UserID
	return nil
}

func (s *Memory) GetUser(_ context.Context, userID string) (*models.User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	u, ok := s.users[userID]
	if !ok {
		return nil, ErrNotFound
	}
	return &u, nil
}

func (s *Memory) GetUserByEmail(_ context.Context, email string) (*models.User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	id, ok := s.usersByMail[normEmail(email)]
	if !ok {
		return nil, ErrNotFound
	}
	u := s.users[id]
	return &u, nil
}

func (s *Memory) PutRoom(_ context.Context, r *models.Room) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rooms[r.RoomID] = *r
	return nil
}

func (s *Memory) GetRoom(_ context.Context, roomID string) (*models.Room, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.rooms[roomID]
	if !ok {
		return nil, ErrNotFound
	}
	return &r, nil
}

func (s *Memory) UpdateRoomStatus(_ context.Context, roomID, status string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.rooms[roomID]
	if !ok {
		return ErrNotFound
	}
	r.Status = status
	s.rooms[roomID] = r
	return nil
}

func (s *Memory) UpdateRoomHost(_ context.Context, roomID, hostUserID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.rooms[roomID]
	if !ok {
		return ErrNotFound
	}
	r.HostUserID = hostUserID
	s.rooms[roomID] = r
	return nil
}

func (s *Memory) UpdateRoomProgress(_ context.Context, roomID string, position, duration float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.rooms[roomID]
	if !ok {
		return ErrNotFound
	}
	r.LastPosition = position
	if duration > 0 {
		r.Duration = duration
	}
	s.rooms[roomID] = r
	return nil
}

func (s *Memory) PutMember(_ context.Context, m *models.RoomMember) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.members[m.RoomID] == nil {
		s.members[m.RoomID] = map[string]models.RoomMember{}
	}
	s.members[m.RoomID][m.UserID] = *m
	return nil
}

func (s *Memory) GetMember(_ context.Context, roomID, userID string) (*models.RoomMember, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	m, ok := s.members[roomID][userID]
	if !ok {
		return nil, ErrNotFound
	}
	return &m, nil
}

func (s *Memory) DeleteMember(_ context.Context, roomID, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.members[roomID], userID)
	return nil
}

func (s *Memory) ListMembers(_ context.Context, roomID string) ([]models.RoomMember, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]models.RoomMember, 0, len(s.members[roomID]))
	for _, m := range s.members[roomID] {
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].JoinedAt.Before(out[j].JoinedAt) })
	return out, nil
}

func (s *Memory) PutConnection(_ context.Context, c *models.Connection) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.conns[c.ConnectionID] = *c
	return nil
}

func (s *Memory) GetConnection(_ context.Context, connectionID string) (*models.Connection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c, ok := s.conns[connectionID]
	if !ok {
		return nil, ErrNotFound
	}
	return &c, nil
}

func (s *Memory) DeleteConnection(_ context.Context, connectionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.conns, connectionID)
	return nil
}

func (s *Memory) SetConnectionRoom(_ context.Context, connectionID, roomID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.conns[connectionID]
	if !ok {
		return ErrNotFound
	}
	c.RoomID = roomID
	s.conns[connectionID] = c
	return nil
}

func (s *Memory) ListRoomConnections(_ context.Context, roomID string) ([]models.Connection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []models.Connection
	for _, c := range s.conns {
		if c.RoomID == roomID {
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ConnectionID < out[j].ConnectionID })
	return out, nil
}

func (s *Memory) PutPlaybackEvent(_ context.Context, e *models.PlaybackEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events[e.RoomID] = append(s.events[e.RoomID], *e)
	return nil
}

func (s *Memory) LatestPlaybackEvent(_ context.Context, roomID string) (*models.PlaybackEvent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	evs := s.events[roomID]
	if len(evs) == 0 {
		return nil, ErrNotFound
	}
	// Highest sort key = latest (mirrors the DynamoDB Query descending).
	best := evs[0]
	for _, e := range evs[1:] {
		if e.SortKey > best.SortKey {
			best = e
		}
	}
	return &best, nil
}

func (s *Memory) PutWatchSession(_ context.Context, ws *models.WatchSession) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[ws.UserID] = append(s.sessions[ws.UserID], *ws)
	return nil
}

func (s *Memory) ListWatchSessions(_ context.Context, userID string) ([]models.WatchSession, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := append([]models.WatchSession(nil), s.sessions[userID]...)
	// Newest first.
	sort.Slice(out, func(i, j int) bool { return out[i].SortKey > out[j].SortKey })
	return out, nil
}

func (s *Memory) UpsertShowProgress(_ context.Context, p *models.ShowProgress) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.progress[p.UserID+"|"+p.SortKey] = *p
	return nil
}

func (s *Memory) ListShowProgress(_ context.Context, userID string) ([]models.ShowProgress, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []models.ShowProgress
	for _, p := range s.progress {
		if p.UserID == userID {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}
