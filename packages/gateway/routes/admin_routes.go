package routes

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/core"
	"github.com/kiro-gateway/gateway/model"
	"github.com/kiro-gateway/gateway/storage"
	"github.com/kiro-gateway/gateway/util"
)

// RegisterAdminRoutes registers the /admin/* management endpoints.
func RegisterAdminRoutes(group *gin.RouterGroup, ps *core.ProxyServer) {
	admin := group.Group("/admin")
	{
		admin.GET("/config", handleGetConfig)
		admin.PUT("/config", handleUpdateConfig(ps))
		admin.GET("/selected-accounts", handleGetSelectedAccounts)
		admin.PUT("/selected-accounts", handleSetSelectedAccounts(ps))
		admin.GET("/apikeys", handleListApiKeys)
		admin.POST("/apikeys", handleCreateApiKey)
		admin.PUT("/apikeys/:id", handleUpdateApiKey)
		admin.DELETE("/apikeys/:id", handleDeleteApiKey)
		admin.GET("/health", handleAdminHealth)
		admin.GET("/webhook/config", handleGetWebhookConfig)
		admin.PUT("/webhook/config", handleUpdateWebhookConfig)
		admin.POST("/webhook/test", handleTestWebhook)
		admin.GET("/prices", handleGetPrices)
		admin.POST("/prices/update", handleUpdatePrices)
	}
}

func handleGetConfig(c *gin.Context) {
	ctx := context.Background()
	cfg, err := storage.GetGatewayConfig(ctx)
	if err != nil {
		log.Error().Err(err).Msg("Failed to get gateway config")
		util.ServerError(c, "Failed to get configuration")
		return
	}
	util.SuccessJSON(c, cfg)
}

func handleUpdateConfig(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		var updates map[string]interface{}
		if err := c.ShouldBindJSON(&updates); err != nil {
			util.ValidationError(c, "Invalid request body")
			return
		}
		ctx := context.Background()
		cfg, err := storage.UpdateGatewayConfig(ctx, updates)
		if err != nil {
			log.Error().Err(err).Msg("Failed to update gateway config")
			util.ServerError(c, "Failed to update configuration")
			return
		}
		// Hot reload proxy server config.
		if reloadErr := ps.UpdateConfig(); reloadErr != nil {
			log.Warn().Err(reloadErr).Msg("Config saved but proxy reload failed")
		}
		util.SuccessJSON(c, cfg)
	}
}

func handleGetSelectedAccounts(c *gin.Context) {
	ctx := context.Background()
	ids, err := storage.GetSelectedAccounts(ctx)
	if err != nil {
		util.ServerError(c, "Failed to get selected accounts")
		return
	}
	if ids == nil {
		ids = []string{}
	}
	util.SuccessJSON(c, ids)
}

// selectedAccountsRequest holds the list of account IDs to select.
// Accepts both "ids" and "accountIds" for frontend compatibility.
type selectedAccountsRequest struct {
	IDs        []string `json:"ids"`
	AccountIDs []string `json:"accountIds"`
}

func handleSetSelectedAccounts(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req selectedAccountsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			util.ValidationError(c, "Invalid request body")
			return
		}
		// Merge IDs and AccountIDs.
		merged := mergeStringSlices(req.IDs, req.AccountIDs)
		ctx := context.Background()
		if err := storage.SetSelectedAccounts(ctx, merged); err != nil {
			util.ServerError(c, "Failed to set selected accounts")
			return
		}
		_ = ps.RefreshAccounts()
		util.SuccessJSON(c, gin.H{"selectedAccounts": merged})
	}
}

// mergeStringSlices combines two slices, deduplicating entries.
func mergeStringSlices(a, b []string) []string {
	seen := make(map[string]struct{})
	var result []string
	for _, id := range a {
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			result = append(result, id)
		}
	}
	for _, id := range b {
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			result = append(result, id)
		}
	}
	return result
}

func handleListApiKeys(c *gin.Context) {
	ctx := context.Background()
	keys, err := storage.GetAllApiKeys(ctx)
	if err != nil {
		util.ServerError(c, "Failed to list API keys")
		return
	}
	if keys == nil {
		keys = []model.ApiKeyRecord{}
	}
	// Mask the full key value, only show preview.
	for i := range keys {
		if keys[i].Key != "" {
			keys[i].KeyPreview = maskKey(keys[i].Key)
			keys[i].Key = ""
		}
	}
	util.SuccessJSON(c, keys)
}

func handleCreateApiKey(c *gin.Context) {
	var req model.CreateApiKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		util.ValidationError(c, "Name is required")
		return
	}
	now := time.Now().UnixMilli()
	key := fmt.Sprintf("sk-%s", strings.ReplaceAll(uuid.New().String(), "-", ""))
	record := &model.ApiKeyRecord{
		ID:              uuid.New().String(),
		Key:             key,
		Name:            req.Name,
		KeyPreview:      maskKey(key),
		BoundAccountIDs: req.BoundAccountIDs,
		QuotaLimit:      req.QuotaLimit,
		CreatedAt:       now,
	}
	ctx := context.Background()
	if err := storage.AddApiKey(ctx, record); err != nil {
		util.ServerError(c, "Failed to create API key")
		return
	}
	util.SuccessJSONWithStatus(c, http.StatusCreated, record)
}

func handleUpdateApiKey(c *gin.Context) {
	id := c.Param("id")
	var updates map[string]interface{}
	if err := c.ShouldBindJSON(&updates); err != nil {
		util.ValidationError(c, "Invalid request body")
		return
	}
	ctx := context.Background()

	// Normalize boundAccountIds if present (JSON numbers to strings).
	if rawIDs, ok := updates["boundAccountIds"]; ok {
		if idSlice, ok := rawIDs.([]interface{}); ok {
			strIDs := make([]string, 0, len(idSlice))
			for _, id := range idSlice {
				strIDs = append(strIDs, fmt.Sprintf("%v", id))
			}
			updates["boundAccountIds"] = strIDs
		}
	}

	if err := storage.UpdateApiKey(ctx, id, updates); err != nil {
		util.NotFoundError(c, "API key not found")
		return
	}
	updated, _ := storage.GetApiKeyByID(ctx, id)
	if updated != nil {
		updated.Key = ""
	}
	util.SuccessJSON(c, updated)
}

func handleDeleteApiKey(c *gin.Context) {
	id := c.Param("id")
	ctx := context.Background()
	if err := storage.DeleteApiKey(ctx, id); err != nil {
		util.NotFoundError(c, "API key not found")
		return
	}
	util.SuccessJSON(c, gin.H{"message": "API key deleted"})
}

func handleAdminHealth(c *gin.Context) {
	ctx := context.Background()
	err := storage.HealthCheck(ctx)
	if err != nil {
		util.ServerError(c, "Redis connection failed: "+err.Error())
		return
	}
	util.SuccessJSON(c, gin.H{
		"status":    "healthy",
		"redis":     "connected",
		"timestamp": time.Now().UnixMilli(),
	})
}

func handleGetWebhookConfig(c *gin.Context) {
	ctx := context.Background()
	cfg, err := storage.GetWebhookConfig(ctx)
	if err != nil {
		util.ServerError(c, "Failed to get webhook config")
		return
	}
	util.SuccessJSON(c, cfg)
}

func handleUpdateWebhookConfig(c *gin.Context) {
	var cfg model.WebhookConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		util.ValidationError(c, "Invalid webhook config")
		return
	}
	ctx := context.Background()
	if err := storage.UpdateWebhookConfig(ctx, &cfg); err != nil {
		util.ServerError(c, "Failed to update webhook config")
		return
	}
	util.SuccessJSON(c, &cfg)
}

// handleTestWebhook sends a test notification to all configured webhook platforms.
func handleTestWebhook(c *gin.Context) {
	ctx := context.Background()
	cfg, err := storage.GetWebhookConfig(ctx)
	if err != nil {
		util.ServerError(c, "Failed to get webhook config")
		return
	}

	notification := &model.WebhookNotification{
		Type:      model.WebhookNotifyTest,
		Timestamp: time.Now().Format(time.RFC3339),
		Subject:   cfg.Subject,
		Detail: map[string]interface{}{
			"message": "This is a test notification from Kiro Gateway",
		},
	}

	results := testWebhookDelivery(cfg, notification)
	if results == nil {
		results = []model.WebhookDeliveryResult{}
	}
	util.SuccessJSON(c, results)
}

// testWebhookDelivery sends a test notification to all enabled platforms
// synchronously and collects delivery results. It applies platform-specific
// signing (feishu, dingtalk) when a secret is configured.
func testWebhookDelivery(
	cfg *model.WebhookConfig, notification *model.WebhookNotification,
) []model.WebhookDeliveryResult {
	var results []model.WebhookDeliveryResult
	for _, platform := range cfg.Platforms {
		if !platform.Enabled || platform.URL == "" {
			continue
		}
		result := model.WebhookDeliveryResult{
			Platform: platform.Platform,
			Label:    platform.Label,
		}
		payload := core.BuildWebhookPayload(platform.Platform, notification)
		if payload == nil {
			result.Success = false
			result.Error = "unsupported platform"
			results = append(results, result)
			continue
		}
		// Apply signing (feishu timestamp+sign, dingtalk URL params).
		targetURL := platform.URL
		core.ApplyWebhookSigning(platform, payload, &targetURL)

		body, err := json.Marshal(payload)
		if err != nil {
			result.Success = false
			result.Error = "failed to marshal payload"
			results = append(results, result)
			continue
		}
		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Post(targetURL, "application/json", bytes.NewReader(body))
		if err != nil {
			result.Success = false
			result.Error = err.Error()
			results = append(results, result)
			continue
		}
		resp.Body.Close()
		result.StatusCode = resp.StatusCode
		result.Success = resp.StatusCode >= 200 && resp.StatusCode < 300
		if !result.Success {
			result.Error = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		results = append(results, result)
	}
	return results
}

// handleGetPrices returns pricing information. If a "model" query parameter is
// present, it returns the price for that single model; otherwise it returns all
// model prices.
func handleGetPrices(c *gin.Context) {
	modelID := c.Query("model")
	if modelID != "" {
		price := core.GetModelPrice(modelID)
		util.SuccessJSON(c, price)
		return
	}
	prices := core.GetModelPrices()
	util.SuccessJSON(c, prices)
}

// handleUpdatePrices is a deprecated/no-op endpoint that returns the built-in
// pricing info, matching the Node.js behavior.
func handleUpdatePrices(c *gin.Context) {
	prices := core.GetModelPrices()
	util.SuccessJSON(c, prices)
}

// maskKey returns a preview of an API key, showing the first 7 and last 4 chars.
func maskKey(key string) string {
	if len(key) <= 11 {
		return key
	}
	return key[:7] + "..." + key[len(key)-4:]
}
