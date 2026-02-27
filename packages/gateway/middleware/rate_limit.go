package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/config"
	"github.com/kiro-gateway/gateway/storage"
	"github.com/kiro-gateway/gateway/util"
)

const rateLimitPrefix = "ratelimit:"

// RateLimitMiddleware returns a Gin middleware that enforces per-IP rate
// limiting using a Redis sorted-set sliding window. If rate limiting is
// disabled in config, the middleware is a no-op. On Redis errors the request
// is allowed through (graceful degradation).
func RateLimitMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := config.GetConfig()
		if !cfg.RateLimit.Enabled {
			c.Next()
			return
		}

		clientIP := c.ClientIP()
		key := storage.Key(rateLimitPrefix + clientIP)
		windowMs := int64(cfg.RateLimit.WindowMs)
		maxRequests := cfg.RateLimit.Max
		now := time.Now().UnixMilli()
		windowStart := now - windowMs
		ctx := context.Background()
		rdb := storage.GetClient()

		// Execute sliding window commands in a pipeline.
		pipe := rdb.Pipeline()

		// Remove entries outside the current window.
		pipe.ZRemRangeByScore(ctx, key, "-inf", strconv.FormatInt(windowStart, 10))

		// Add the current request timestamp.
		pipe.ZAdd(ctx, key, newZMember(float64(now), strconv.FormatInt(now, 10)))

		// Count entries in the window.
		countCmd := pipe.ZCard(ctx, key)

		// Set key expiry to the window duration.
		expiry := time.Duration(windowMs) * time.Millisecond
		pipe.Expire(ctx, key, expiry)

		if _, err := pipe.Exec(ctx); err != nil {
			// Graceful degradation: allow request on Redis error.
			log.Warn().Err(err).Str("ip", clientIP).Msg("Rate limit Redis error, allowing request")
			c.Next()
			return
		}

		count := countCmd.Val()
		remaining := int64(maxRequests) - count
		if remaining < 0 {
			remaining = 0
		}
		resetTime := now + windowMs

		// Set rate limit response headers.
		c.Header("X-RateLimit-Limit", strconv.Itoa(maxRequests))
		c.Header("X-RateLimit-Remaining", strconv.FormatInt(remaining, 10))
		c.Header("X-RateLimit-Reset", strconv.FormatInt(resetTime, 10))

		if count > int64(maxRequests) {
			util.ErrorJSON(c, http.StatusTooManyRequests,
				fmt.Sprintf("Rate limit exceeded. Try again in %d seconds", windowMs/1000),
				util.ErrTypeRateLimit)
			c.Abort()
			return
		}

		c.Next()
	}
}
