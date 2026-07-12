package auth

import (
	"testing"
	"time"

	"github.com/MelloB1989/kora/backend/internal/models"
)

func TestIssueAndVerify(t *testing.T) {
	m := NewManager("secret", time.Hour)
	token, err := m.IssueToken(&models.User{UserID: "u_1", DisplayName: "Alice"})
	if err != nil {
		t.Fatal(err)
	}
	claims, err := m.VerifyToken(token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.UserID != "u_1" || claims.DisplayName != "Alice" {
		t.Fatalf("bad claims: %+v", claims)
	}
}

func TestVerifyRejectsWrongSecret(t *testing.T) {
	token, _ := NewManager("secret-a", time.Hour).IssueToken(&models.User{UserID: "u_1"})
	if _, err := NewManager("secret-b", time.Hour).VerifyToken(token); err == nil {
		t.Fatal("token signed with different secret accepted")
	}
}

func TestVerifyRejectsExpired(t *testing.T) {
	m := NewManager("secret", time.Hour)
	m.now = func() time.Time { return time.Now().Add(-2 * time.Hour) }
	token, _ := m.IssueToken(&models.User{UserID: "u_1"})
	m.now = time.Now
	if _, err := m.VerifyToken(token); err == nil {
		t.Fatal("expired token accepted")
	}
}

func TestVerifyRejectsGarbage(t *testing.T) {
	if _, err := NewManager("secret", time.Hour).VerifyToken("garbage"); err == nil {
		t.Fatal("garbage token accepted")
	}
}

func TestPasswordHashRoundtrip(t *testing.T) {
	h, err := HashPassword("hunter2hunter2")
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword(h, "hunter2hunter2") {
		t.Fatal("correct password rejected")
	}
	if CheckPassword(h, "wrong") {
		t.Fatal("wrong password accepted")
	}
}
