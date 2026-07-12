// localdev runs the whole backend as a single local process, because
// `sam local` does not support WebSocket APIs. It serves:
//
//	ws://localhost:8080/ws     — same relay.Handler as the WS Lambda
//	http://localhost:8080/...  — same httpapi router as the REST Lambda
//
// State lives in the in-memory store, so restarting resets everything.
//
//	JWT_SECRET=dev-secret go run ./cmd/localdev
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/MelloB1989/kora/backend/internal/auth"
	"github.com/MelloB1989/kora/backend/internal/config"
	"github.com/MelloB1989/kora/backend/internal/httpapi"
	"github.com/MelloB1989/kora/backend/internal/models"
	"github.com/MelloB1989/kora/backend/internal/relay"
	"github.com/MelloB1989/kora/backend/internal/rooms"
	"github.com/MelloB1989/kora/backend/internal/store"
)

// registry is the in-process relay.Sender: connectionID → live websocket.
type registry struct {
	mu    sync.RWMutex
	conns map[string]*websocket.Conn
}

func newRegistry() *registry { return &registry{conns: map[string]*websocket.Conn{}} }

func (r *registry) add(id string, c *websocket.Conn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.conns[id] = c
}

func (r *registry) remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.conns, id)
}

func (r *registry) Send(ctx context.Context, connectionID string, data []byte) error {
	r.mu.RLock()
	c, ok := r.conns[connectionID]
	r.mu.RUnlock()
	if !ok {
		return relay.ErrGone
	}
	return c.Write(ctx, websocket.MessageText, data)
}

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(log)

	if os.Getenv("JWT_SECRET") == "" {
		os.Setenv("JWT_SECRET", "localdev-secret")
	}
	cfg, err := config.Load()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}

	st := store.NewMemory()
	reg := newRegistry()
	am := auth.NewManager(cfg.JWTSecret, 0)
	rs := rooms.NewService(st)
	handler := relay.NewHandler(st, rs, am, reg, log)
	api := httpapi.New(st, am, rs)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"*"}})
		if err != nil {
			return
		}
		connID := models.NewID("conn")
		ctx := r.Context()

		// Mirror API Gateway: authenticate on $connect via ?token=.
		if err := handler.HandleConnect(ctx, connID, r.URL.Query().Get("token")); err != nil {
			log.Info("connect rejected", "err", err)
			c.Close(websocket.StatusPolicyViolation, "unauthorized")
			return
		}
		reg.add(connID, c)
		log.Info("connected", "connectionId", connID)

		defer func() {
			reg.remove(connID)
			// Detached context: the request context is canceled by now.
			dctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := handler.HandleDisconnect(dctx, connID); err != nil {
				log.Error("disconnect", "err", err)
			}
			log.Info("disconnected", "connectionId", connID)
		}()

		for {
			typ, data, err := c.Read(ctx)
			if err != nil {
				var ce websocket.CloseError
				if !errors.As(err, &ce) && ctx.Err() == nil {
					log.Info("read", "err", err)
				}
				return
			}
			if typ != websocket.MessageText {
				continue
			}
			if err := handler.HandleMessage(ctx, connID, data); err != nil {
				log.Error("message", "err", err)
			}
		}
	})
	mux.Handle("/", api.Router(cfg.AllowedOrigin))

	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8080"
	}
	log.Info("localdev up", "addr", addr, "ws", "ws://localhost"+addr+"/ws", "rest", "http://localhost"+addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Error("serve", "err", err)
		os.Exit(1)
	}
}
