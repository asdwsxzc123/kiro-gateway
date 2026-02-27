package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/kiro-gateway/gateway/config"
	"github.com/kiro-gateway/gateway/storage"
)

const sessionPrefix = "session:"

// ComputeSessionHash generates a deterministic SHA-256 hash from the model name,
// messages content, and system prompt. This hash is used to associate a
// conversation with a specific account for session stickiness.
func ComputeSessionHash(model string, messages interface{}, system string) string {
	h := sha256.New()

	// Write the model name.
	h.Write([]byte(model))

	// Serialize and write the messages. JSON serialization provides a stable
	// representation regardless of Go map iteration order.
	msgBytes, err := json.Marshal(messages)
	if err != nil {
		// Fallback: use fmt representation if marshalling fails.
		msgBytes = []byte(fmt.Sprintf("%v", messages))
	}
	h.Write(msgBytes)

	// Write the system prompt.
	h.Write([]byte(system))

	return hex.EncodeToString(h.Sum(nil))
}

// GetSessionAccount retrieves the account ID bound to a session hash.
// Returns an empty string and nil error if no binding exists.
func GetSessionAccount(ctx context.Context, hash string) (string, error) {
	rdb := storage.GetClient()
	key := storage.Key(sessionPrefix + hash)

	val, err := rdb.Get(ctx, key).Result()
	if err == redis.Nil {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get session account: %w", err)
	}

	return val, nil
}

// SetSessionAccount binds a session hash to an account ID with a TTL
// derived from the session configuration.
func SetSessionAccount(ctx context.Context, hash string, accountID string) error {
	rdb := storage.GetClient()
	cfg := config.GetConfig()
	key := storage.Key(sessionPrefix + hash)

	ttl := time.Duration(cfg.Session.TTLSeconds) * time.Second

	if err := rdb.Set(ctx, key, accountID, ttl).Err(); err != nil {
		return fmt.Errorf("set session account: %w", err)
	}

	return nil
}

// ExtendSession refreshes the TTL of a session binding if the remaining time
// is below the configured renewal threshold. This keeps active sessions alive
// without constantly resetting the expiry.
func ExtendSession(ctx context.Context, hash string) error {
	rdb := storage.GetClient()
	cfg := config.GetConfig()
	key := storage.Key(sessionPrefix + hash)

	// Check the remaining TTL.
	remaining, err := rdb.TTL(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("check session TTL: %w", err)
	}

	// Key does not exist or has no expiry set.
	if remaining < 0 {
		return nil
	}

	threshold := time.Duration(cfg.Session.RenewalThresholdSeconds) * time.Second
	if remaining < threshold {
		newTTL := time.Duration(cfg.Session.TTLSeconds) * time.Second
		if err := rdb.Expire(ctx, key, newTTL).Err(); err != nil {
			return fmt.Errorf("extend session TTL: %w", err)
		}
	}

	return nil
}

// DeleteSession removes a session binding from Redis.
func DeleteSession(ctx context.Context, hash string) error {
	rdb := storage.GetClient()
	key := storage.Key(sessionPrefix + hash)

	if err := rdb.Del(ctx, key).Err(); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}

	return nil
}
