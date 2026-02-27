package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/config"
	"github.com/kiro-gateway/gateway/util"
)

// APIKeyAuthMiddleware returns a Gin middleware that validates API keys for
// the /v1/* proxy endpoints. Keys can be provided via the Authorization
// header (Bearer prefix), the x-api-key header, or the api_key query param.
func APIKeyAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		apiKey := extractAPIKey(c)
		cfg := config.GetConfig()

		// If no key provided and auth is not required, allow through.
		if apiKey == "" {
			requireKey := cfg.RateLimit.Enabled // REQUIRE_API_KEY maps to a config field
			// Check the environment-level setting. In this gateway, if no
			// key is set and the gateway does not mandate keys, pass through.
			if !requireKey {
				c.Next()
				return
			}
			util.UnauthorizedError(c, "API key is required")
			c.Abort()
			return
		}

		// Validate key against storage.
		ctx := context.Background()
		record, err := lookupAPIKey(ctx, apiKey)
		if err != nil {
			log.Error().Err(err).Msg("Failed to validate API key")
			util.ErrorJSON(c, http.StatusInternalServerError,
				"API key validation failed", util.ErrTypeServer)
			c.Abort()
			return
		}
		if record == nil {
			util.UnauthorizedError(c, "Invalid API key")
			c.Abort()
			return
		}

		// Check quota limit: if quotaLimit > 0 and totalCost >= quotaLimit, reject.
		if record.QuotaLimit > 0 {
			totalCost, costErr := getAPIKeyTotalCost(ctx, record.ID)
			if costErr != nil {
				log.Error().Err(costErr).Str("keyID", record.ID).Msg("Failed to get API key cost")
			} else if totalCost >= record.QuotaLimit {
				util.RateLimitError(c, "API key quota exceeded")
				c.Abort()
				return
			}
		}

		// Store API key info in context for downstream handlers.
		c.Set("apiKey", record)
		c.Set("apiKeyID", record.ID)
		c.Set("boundAccountIDs", record.BoundAccountIDs)
		c.Next()
	}
}

// extractAPIKey extracts the API key from the request in order of precedence:
// 1. Authorization header with Bearer prefix
// 2. x-api-key header
// 3. api_key query parameter
func extractAPIKey(c *gin.Context) string {
	// Check Authorization header.
	authHeader := c.GetHeader("Authorization")
	if authHeader != "" {
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
			return strings.TrimSpace(parts[1])
		}
	}

	// Check x-api-key header.
	if key := c.GetHeader("x-api-key"); key != "" {
		return key
	}

	// Check query parameter.
	if key := c.Query("api_key"); key != "" {
		return key
	}

	return ""
}
