package storage

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
)

// Token key prefix matching the TS backend: gateway:token:{jwt_token}
const tokenKeyPrefix = "token:"

// StoreToken saves a JWT token to Redis with the given TTL.
// The value stored is the associated username.
func StoreToken(ctx context.Context, token, username string, expiresInSeconds int) error {
	rdb := GetClient()
	key := Key(tokenKeyPrefix + token)

	ttl := time.Duration(expiresInSeconds) * time.Second
	if err := rdb.Set(ctx, key, username, ttl).Err(); err != nil {
		return fmt.Errorf("store token: %w", err)
	}

	log.Info().
		Str("username", username).
		Int("expiresIn", expiresInSeconds).
		Str("tokenPrefix", truncate(token, 20)).
		Msg("Token stored in Redis")

	return nil
}

// IsTokenValid checks whether a JWT token exists in the Redis whitelist.
func IsTokenValid(ctx context.Context, token string) (bool, error) {
	rdb := GetClient()
	key := Key(tokenKeyPrefix + token)

	exists, err := rdb.Exists(ctx, key).Result()
	if err != nil {
		return false, fmt.Errorf("check token validity: %w", err)
	}
	return exists == 1, nil
}

// RemoveToken deletes a JWT token from Redis (used on logout).
func RemoveToken(ctx context.Context, token string) error {
	rdb := GetClient()
	key := Key(tokenKeyPrefix + token)

	if err := rdb.Del(ctx, key).Err(); err != nil {
		return fmt.Errorf("remove token: %w", err)
	}

	log.Info().Msg("Token removed from Redis")
	return nil
}

// GetTokenUser returns the username associated with a JWT token, or empty if not found.
func GetTokenUser(ctx context.Context, token string) (string, error) {
	rdb := GetClient()
	key := Key(tokenKeyPrefix + token)

	val, err := rdb.Get(ctx, key).Result()
	if err != nil {
		if err.Error() == "redis: nil" {
			return "", nil
		}
		return "", fmt.Errorf("get token user: %w", err)
	}
	return val, nil
}

