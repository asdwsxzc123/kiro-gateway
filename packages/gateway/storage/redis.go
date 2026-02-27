// Package storage provides Redis-backed persistence for the kiro-gateway.
// All Redis keys are prefixed with "gateway:" to match the TypeScript backend.
package storage

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/config"
)

const keyPrefix = "gateway:"

var client *redis.Client

// InitRedis initializes the Redis client from the provided configuration.
// The Redis URL is expected in the format: redis://[:password@]host:port[/db]
func InitRedis(cfg *config.RedisConfig) error {
	opts, err := parseRedisURL(cfg.URL)
	if err != nil {
		return fmt.Errorf("failed to parse redis URL: %w", err)
	}

	// Override with explicit config values if provided.
	if cfg.Password != "" {
		opts.Password = cfg.Password
	}
	if cfg.DB != 0 {
		opts.DB = cfg.DB
	}

	opts.MaxRetries = 3

	client = redis.NewClient(opts)

	// Verify connectivity.
	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis ping failed: %w", err)
	}

	log.Info().Str("addr", opts.Addr).Int("db", opts.DB).Msg("Redis connected")
	return nil
}

// parseRedisURL parses a Redis URL into client options.
// Supports: redis://host:port, redis://:password@host:port/db
func parseRedisURL(rawURL string) (*redis.Options, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}

	opts := &redis.Options{
		Addr: u.Host,
	}

	if u.User != nil {
		if p, ok := u.User.Password(); ok {
			opts.Password = p
		}
	}

	// Parse DB number from path (e.g. "/2").
	if u.Path != "" && u.Path != "/" {
		dbStr := strings.TrimPrefix(u.Path, "/")
		if db, err := strconv.Atoi(dbStr); err == nil {
			opts.DB = db
		}
	}

	return opts, nil
}

// GetClient returns the initialized Redis client.
// Panics if InitRedis has not been called.
func GetClient() *redis.Client {
	if client == nil {
		panic("storage: Redis client not initialized, call InitRedis first")
	}
	return client
}

// Close gracefully shuts down the Redis connection.
func Close() error {
	if client != nil {
		err := client.Close()
		client = nil
		log.Info().Msg("Redis connection closed")
		return err
	}
	return nil
}

// HealthCheck verifies the Redis connection is alive.
func HealthCheck(ctx context.Context) error {
	if client == nil {
		return fmt.Errorf("redis client not initialized")
	}
	return client.Ping(ctx).Err()
}

// Key builds a fully-prefixed Redis key by joining parts with ":".
// Example: Key("account", id) returns "gateway:account:{id}"
func Key(parts ...string) string {
	return keyPrefix + strings.Join(parts, ":")
}
