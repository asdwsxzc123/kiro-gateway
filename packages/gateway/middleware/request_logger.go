package middleware

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

// healthPaths are paths excluded from request logging to reduce noise.
var healthPaths = map[string]bool{
	"/health":            true,
	"/api/admin/health":  true,
}

// RequestLoggerMiddleware returns a Gin middleware that logs each HTTP
// request with method, path, status code, duration, and client IP.
// Health check paths are excluded from logging.
func RequestLoggerMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path

		c.Next()

		// Skip logging for health check endpoints.
		if healthPaths[path] {
			return
		}

		duration := time.Since(start)
		status := c.Writer.Status()

		log.Info().
			Str("method", c.Request.Method).
			Str("path", path).
			Int("status", status).
			Dur("duration", duration).
			Str("clientIP", c.ClientIP()).
			Msg("HTTP request")
	}
}
