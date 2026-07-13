package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/MelloB1989/kora/backend/internal/models"
	"github.com/MelloB1989/kora/backend/internal/store"
)

func (a *API) handleMe(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFrom(r.Context())
	u, err := a.store.GetUser(r.Context(), claims.UserID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load user")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (a *API) handleMySessions(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFrom(r.Context())
	sessions, err := a.store.ListWatchSessions(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load sessions")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
}

func (a *API) handleMyProgress(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFrom(r.Context())
	progress, err := a.store.ListShowProgress(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load progress")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"progress": progress})
}

type weekBucket struct {
	WeekStart string `json:"weekStart"` // ISO date (Monday)
	Seconds   int64  `json:"seconds"`
}

type statsResponse struct {
	TotalSeconds   int64            `json:"totalSeconds"`
	SessionCount   int              `json:"sessionCount"`
	PerPlatform    map[string]int64 `json:"perPlatform"`
	PerWeek        []weekBucket     `json:"perWeek"`
	DistinctTitles int              `json:"distinctTitles"`
}

// handleMyStats aggregates watch sessions into dashboard-ready totals: overall
// seconds, a per-platform breakdown, and an 8-week time series.
func (a *API) handleMyStats(w http.ResponseWriter, r *http.Request) {
	claims := ClaimsFrom(r.Context())
	sessions, err := a.store.ListWatchSessions(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load stats")
		return
	}

	const weeks = 8
	now := time.Now().UTC()
	thisMonday := startOfWeek(now)
	buckets := make([]weekBucket, weeks)
	for i := 0; i < weeks; i++ {
		buckets[i] = weekBucket{WeekStart: thisMonday.AddDate(0, 0, -7*(weeks-1-i)).Format("2006-01-02")}
	}
	bucketIndex := func(t time.Time) int {
		wk := int(thisMonday.Sub(startOfWeek(t.UTC())).Hours() / (24 * 7))
		return (weeks - 1) - wk
	}

	resp := statsResponse{PerPlatform: map[string]int64{}}
	titles := map[string]bool{}
	for _, s := range sessions {
		resp.TotalSeconds += s.SecondsWatched
		resp.PerPlatform[s.Platform] += s.SecondsWatched
		titles[models.ProgressSortKey(s.Platform, s.ContentID)] = true
		if i := bucketIndex(s.EndedAt); i >= 0 && i < weeks {
			buckets[i].Seconds += s.SecondsWatched
		}
	}
	resp.SessionCount = len(sessions)
	resp.DistinctTitles = len(titles)
	resp.PerWeek = buckets
	writeJSON(w, http.StatusOK, resp)
}

// startOfWeek returns midnight UTC on the Monday of t's week.
func startOfWeek(t time.Time) time.Time {
	t = t.Truncate(24 * time.Hour)
	weekday := (int(t.Weekday()) + 6) % 7 // Mon=0 … Sun=6
	return t.AddDate(0, 0, -weekday)
}
