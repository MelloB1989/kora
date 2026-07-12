// Package auth implements stateless JWT auth (HS256) and password hashing.
package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/MelloB1989/kora/backend/internal/models"
)

const DefaultTokenTTL = 7 * 24 * time.Hour

var ErrInvalidToken = errors.New("invalid token")

// Claims is the verified identity attached to a request or WS connection.
type Claims struct {
	UserID      string
	DisplayName string
}

type Manager struct {
	secret []byte
	ttl    time.Duration
	now    func() time.Time
}

func NewManager(secret string, ttl time.Duration) *Manager {
	if ttl <= 0 {
		ttl = DefaultTokenTTL
	}
	return &Manager{secret: []byte(secret), ttl: ttl, now: time.Now}
}

func (m *Manager) IssueToken(u *models.User) (string, error) {
	now := m.now()
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":  u.UserID,
		"name": u.DisplayName,
		"iat":  now.Unix(),
		"exp":  now.Add(m.ttl).Unix(),
	})
	return t.SignedString(m.secret)
}

func (m *Manager) VerifyToken(token string) (*Claims, error) {
	parsed, err := jwt.Parse(token, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method %q", t.Method.Alg())
		}
		return m.secret, nil
	}, jwt.WithExpirationRequired(), jwt.WithTimeFunc(m.now))
	if err != nil || !parsed.Valid {
		return nil, ErrInvalidToken
	}
	mc, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return nil, ErrInvalidToken
	}
	sub, _ := mc["sub"].(string)
	if sub == "" {
		return nil, ErrInvalidToken
	}
	name, _ := mc["name"].(string)
	return &Claims{UserID: sub, DisplayName: name}, nil
}

func HashPassword(plain string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	return string(h), err
}

func CheckPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}
