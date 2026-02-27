package middleware

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/config"
	"github.com/kiro-gateway/gateway/storage"
	"github.com/kiro-gateway/gateway/util"
)

// publicPaths lists paths that do not require JWT authentication.
var publicPaths = []string{
	"/api/auth/login",
	"/health",
	"/api/admin/health",
}

// JWTAuthMiddleware returns a Gin middleware that validates JWT tokens from
// the Authorization header. Tokens must also exist in the Redis whitelist.
func JWTAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path

		// Skip authentication for public paths.
		for _, pp := range publicPaths {
			if path == pp {
				c.Next()
				return
			}
		}

		// Extract token from Authorization header.
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			util.UnauthorizedError(c, "Authorization header is required")
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			util.UnauthorizedError(c, "Invalid authorization format, expected Bearer token")
			c.Abort()
			return
		}
		tokenString := parts[1]

		// Parse and validate the JWT.
		cfg := config.GetConfig()
		token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(cfg.JWT.Secret), nil
		})
		if err != nil || !token.Valid {
			util.UnauthorizedError(c, "Invalid or expired token")
			c.Abort()
			return
		}

		// Verify token exists in Redis whitelist.
		ctx := context.Background()
		valid, err := storage.IsTokenValid(ctx, tokenString)
		if err != nil {
			log.Error().Err(err).Msg("Failed to validate token in Redis")
			util.ErrorJSON(c, http.StatusInternalServerError,
				"Token validation failed", util.ErrTypeServer)
			c.Abort()
			return
		}
		if !valid {
			util.UnauthorizedError(c, "Token has been revoked")
			c.Abort()
			return
		}

		// Extract username from claims and set on context.
		subject, err := token.Claims.GetSubject()
		if err != nil || subject == "" {
			util.UnauthorizedError(c, "Invalid token claims")
			c.Abort()
			return
		}

		c.Set("username", subject)
		c.Set("token", tokenString)
		c.Next()
	}
}

// GenerateToken creates a signed JWT for the given username and stores it in
// the Redis whitelist with the configured TTL.
func GenerateToken(username string) (string, error) {
	cfg := config.GetConfig()
	expiresIn := ParseJWTExpiresIn(cfg.JWT.ExpiresIn)

	claims := jwt.RegisteredClaims{
		Subject:   username,
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiresIn)),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(cfg.JWT.Secret))
	if err != nil {
		return "", err
	}

	// Store token in Redis whitelist.
	ttlSeconds := int(expiresIn.Seconds())
	ctx := context.Background()
	if err := storage.StoreToken(ctx, tokenString, username, ttlSeconds); err != nil {
		log.Error().Err(err).Msg("Failed to store token in Redis")
		return "", err
	}

	return tokenString, nil
}

// ParseJWTExpiresIn converts a duration string like "24h", "7d", or "1h" to a
// time.Duration. Falls back to 24 hours if the string cannot be parsed.
func ParseJWTExpiresIn(expiresIn string) time.Duration {
	expiresIn = strings.TrimSpace(expiresIn)
	if expiresIn == "" {
		return 24 * time.Hour
	}

	// Handle "d" suffix for days.
	if strings.HasSuffix(expiresIn, "d") {
		numStr := strings.TrimSuffix(expiresIn, "d")
		days, err := strconv.Atoi(numStr)
		if err == nil && days > 0 {
			return time.Duration(days) * 24 * time.Hour
		}
		return 24 * time.Hour
	}

	// Delegate to Go's standard duration parser for "h", "m", "s", etc.
	d, err := time.ParseDuration(expiresIn)
	if err != nil {
		return 24 * time.Hour
	}
	return d
}
