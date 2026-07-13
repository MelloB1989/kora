// Package httpapi implements the REST API (auth + room CRUD). The router is
// a plain http.ServeMux so the same code serves API Gateway (via the Lambda
// proxy adapter in cmd/rest) and the localdev server.
package httpapi

import (
	"net/http"

	"github.com/MelloB1989/kora/backend/internal/auth"
	"github.com/MelloB1989/kora/backend/internal/rooms"
	"github.com/MelloB1989/kora/backend/internal/store"
)

type API struct {
	store store.Store
	auth  *auth.Manager
	rooms *rooms.Service
}

func New(s store.Store, am *auth.Manager, rs *rooms.Service) *API {
	return &API{store: s, auth: am, rooms: rs}
}

// Router returns the fully wired handler. allowedOrigin is the CORS
// Access-Control-Allow-Origin value ("*" for the MVP).
func (a *API) Router(allowedOrigin string) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("POST /v1/auth/signup", a.handleSignup)
	mux.HandleFunc("POST /v1/auth/login", a.handleLogin)

	mux.Handle("POST /v1/rooms", a.requireAuth(a.handleCreateRoom))
	mux.Handle("GET /v1/rooms/{roomId}", a.requireAuth(a.handleGetRoom))
	mux.Handle("DELETE /v1/rooms/{roomId}", a.requireAuth(a.handleEndRoom))

	// Dashboard (Phase 5)
	mux.Handle("GET /v1/me", a.requireAuth(a.handleMe))
	mux.Handle("GET /v1/me/sessions", a.requireAuth(a.handleMySessions))
	mux.Handle("GET /v1/me/progress", a.requireAuth(a.handleMyProgress))
	mux.Handle("GET /v1/me/stats", a.requireAuth(a.handleMyStats))

	return withCORS(allowedOrigin, mux)
}
