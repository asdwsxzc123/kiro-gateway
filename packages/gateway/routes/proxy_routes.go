package routes

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/core"
	"github.com/kiro-gateway/gateway/model"
	"github.com/kiro-gateway/gateway/storage"
	"github.com/kiro-gateway/gateway/util"
)

// RegisterProxyRoutes registers the /v1/* proxy endpoints for Claude and
// OpenAI compatible API access.
func RegisterProxyRoutes(group *gin.RouterGroup, ps *core.ProxyServer) {
	group.POST("/messages", handleClaudeMessages(ps))
	group.POST("/messages/count_tokens", handleCountTokens())
	group.POST("/chat/completions", handleChatCompletions())
	group.GET("/models", handleListModels())
	group.GET("/stats", handleProxyStats())
}

// handleClaudeMessages processes Claude Messages API requests. It supports
// both streaming (SSE) and non-streaming JSON responses.
func handleClaudeMessages(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		var request model.ClaudeRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			util.ValidationError(c, "Invalid request body: "+err.Error())
			return
		}

		// Extract API key info from context (set by APIKeyAuthMiddleware).
		var apiKeyID string
		var boundAccountIDs []string

		if val, exists := c.Get("apiKeyID"); exists {
			apiKeyID, _ = val.(string)
		}
		if val, exists := c.Get("boundAccountIDs"); exists {
			boundAccountIDs, _ = val.([]string)
		}

		// TODO: Implement streaming support via a separate HandleClaudeStreamRequest.
		// For now, both streaming and non-streaming go through HandleClaudeRequest.

		result, err := ps.HandleClaudeRequest(c, &request, apiKeyID, boundAccountIDs)
		if err != nil {
			log.Error().Err(err).Msg("Claude request failed")
			util.ServerError(c, "Request processing failed: "+err.Error())
			return
		}

		c.JSON(http.StatusOK, result)
	}
}

// handleCountTokens estimates the input token count for a Claude Messages API
// request without actually sending it. Returns {"input_tokens": int}.
func handleCountTokens() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req util.CountTokensRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			util.ValidationError(c, "Invalid request body: "+err.Error())
			return
		}

		inputTokens := util.CountTokens(&req)

		c.JSON(http.StatusOK, gin.H{
			"input_tokens": inputTokens,
		})
	}
}

// handleChatCompletions returns a placeholder for the OpenAI chat/completions
// compatibility endpoint.
func handleChatCompletions() gin.HandlerFunc {
	return func(c *gin.Context) {
		util.ErrorJSON(c, http.StatusNotImplemented,
			"OpenAI format not yet implemented", util.ErrTypeServer)
	}
}

// modelEntry defines a model to expose via the /v1/models endpoint.
type modelEntry struct {
	ID      string
	Created time.Time
}

// availableModels is the list of models returned by handleListModels.
var availableModels = []modelEntry{
	{"claude-opus-4-6", time.Date(2026, 2, 7, 0, 0, 0, 0, time.UTC)},
	{"claude-opus-4-6-1m", time.Date(2026, 2, 7, 0, 0, 0, 0, time.UTC)},
	{"claude-sonnet-4-6", time.Date(2026, 1, 28, 0, 0, 0, 0, time.UTC)},
	{"claude-sonnet-4-5", time.Date(2025, 2, 24, 0, 0, 0, 0, time.UTC)},
	{"claude-sonnet-4", time.Date(2025, 5, 22, 0, 0, 0, 0, time.UTC)},
	{"claude-haiku-4-5", time.Date(2025, 6, 20, 0, 0, 0, 0, time.UTC)},
	{"claude-opus-4-5", time.Date(2025, 5, 22, 0, 0, 0, 0, time.UTC)},
}

// handleListModels returns the list of available models with pricing metadata.
func handleListModels() gin.HandlerFunc {
	return func(c *gin.Context) {
		models := make([]gin.H, 0, len(availableModels))
		for _, m := range availableModels {
			price, _ := core.FindModelPrice(m.ID)
			models = append(models, gin.H{
				"id":                m.ID,
				"object":            "model",
				"created":           m.Created.Unix(),
				"owned_by":          "kiro",
				"max_input_tokens":  price.MaxInputTokens,
				"max_output_tokens": price.MaxOutputTokens,
			})
		}

		c.JSON(http.StatusOK, gin.H{
			"object": "list",
			"data":   models,
		})
	}
}

// handleProxyStats returns a quick overview of global proxy statistics.
func handleProxyStats() gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := context.Background()
		stats, err := storage.GetGlobalStats(ctx)
		if err != nil {
			log.Error().Err(err).Msg("Failed to get global stats")
			util.ServerError(c, "Failed to retrieve stats")
			return
		}

		util.SuccessJSON(c, stats)
	}
}
