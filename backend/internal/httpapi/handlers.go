package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/MelloB1989/kora/backend/internal/auth"
	"github.com/MelloB1989/kora/backend/internal/models"
	"github.com/MelloB1989/kora/backend/internal/rooms"
	"github.com/MelloB1989/kora/backend/internal/store"
)

type signupRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authResponse struct {
	Token string       `json:"token"`
	User  *models.User `json:"user"`
}

func (a *API) handleSignup(w http.ResponseWriter, r *http.Request) {
	var req signupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if _, err := mail.ParseAddress(req.Email); err != nil {
		writeError(w, http.StatusBadRequest, "invalid email")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	if req.DisplayName == "" {
		writeError(w, http.StatusBadRequest, "displayName is required")
		return
	}

	// Check-then-put is racy without a transaction, but an email collision
	// in the race window is harmless at MVP scale: login resolves by GSI
	// query which returns one row.
	if _, err := a.store.GetUserByEmail(r.Context(), req.Email); err == nil {
		writeError(w, http.StatusConflict, "email already registered")
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hashing failed")
		return
	}
	u := &models.User{
		UserID:       models.NewID("u"),
		Email:        req.Email,
		PasswordHash: hash,
		DisplayName:  req.DisplayName,
		CreatedAt:    time.Now().UTC(),
	}
	if err := a.store.PutUser(r.Context(), u); err != nil {
		if errors.Is(err, store.ErrAlreadyExists) {
			writeError(w, http.StatusConflict, "email already registered")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not create user")
		return
	}

	token, err := a.auth.IssueToken(u)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not issue token")
		return
	}
	writeJSON(w, http.StatusCreated, authResponse{Token: token, User: u})
}

func (a *API) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	u, err := a.store.GetUserByEmail(r.Context(), strings.ToLower(strings.TrimSpace(req.Email)))
	if err != nil || !auth.CheckPassword(u.PasswordHash, req.Password) {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	token, err := a.auth.IssueToken(u)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not issue token")
		return
	}
	writeJSON(w, http.StatusOK, authResponse{Token: token, User: u})
}

type createRoomRequest struct {
	Platform  string `json:"platform"`
	ContentID string `json:"contentId"`
	Title     string `json:"title"`
}

type roomResponse struct {
	Room    *models.Room        `json:"room"`
	Members []models.RoomMember `json:"members,omitempty"`
	JoinURL string              `json:"joinUrl,omitempty"`
}

func (a *API) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFrom(r.Context())
	var req createRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Platform != models.PlatformNetflix {
		writeError(w, http.StatusBadRequest, "unsupported platform (Phase 1 supports: netflix)")
		return
	}
	if strings.TrimSpace(req.ContentID) == "" {
		writeError(w, http.StatusBadRequest, "contentId is required")
		return
	}

	room, err := a.rooms.Create(r.Context(), claims.UserID, req.Platform, req.ContentID, strings.TrimSpace(req.Title))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create room")
		return
	}
	writeJSON(w, http.StatusCreated, roomResponse{Room: room, JoinURL: rooms.JoinURL(room)})
}

func (a *API) handleGetRoom(w http.ResponseWriter, r *http.Request) {
	room, err := a.rooms.Get(r.Context(), r.PathValue("roomId"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "room not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load room")
		return
	}
	members, err := a.store.ListMembers(r.Context(), room.RoomID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load members")
		return
	}
	writeJSON(w, http.StatusOK, roomResponse{Room: room, Members: members, JoinURL: rooms.JoinURL(room)})
}

func (a *API) handleEndRoom(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFrom(r.Context())
	err := a.rooms.End(r.Context(), r.PathValue("roomId"), claims.UserID)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "room not found")
	case errors.Is(err, rooms.ErrNotHost):
		writeError(w, http.StatusForbidden, "only the host can end the room")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "could not end room")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"status": "ended"})
	}
}
