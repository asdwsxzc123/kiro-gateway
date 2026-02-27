package storage

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/model"
)

// Redis key constants for configuration storage.
const (
	configKey           = "config"
	selectedAccountsKey = "config:selectedAccounts"
	apiKeysKey          = "config:apiKeys"
	apiKeysIndexKey     = "config:apiKeyIndex"
	webhookConfigKey    = "webhook_config"
)

func safeParseInt(s string, fallback int) int {
	if s == "" {
		return fallback
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return fallback
	}
	return v
}

func safeParseFloat(s string, fallback float64) float64 {
	if s == "" {
		return fallback
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return fallback
	}
	return v
}

func safeParseBoolStr(s string, fallback bool) bool {
	if s == "" {
		return fallback
	}
	return s == "true"
}

func intPtr(v int) *int           { return &v }
func boolPtr(v bool) *bool        { return &v }
func strPtr(s string) *string     { return &s }
func floatPtr(v float64) *float64 { return &v }

func coalesce(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func coalesceStr(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// defaultGatewayConfig returns a GatewayConfig with TS backend defaults.
func defaultGatewayConfig() *model.GatewayConfig {
	return &model.GatewayConfig{
		Port:                       3000,
		Host:                       "0.0.0.0",
		EnableMultiAccount:         true,
		MaxConcurrent:              0,
		MaxRetries:                 3,
		RetryDelay:                 1000,
		RequestTimeout:             120000,
		DefaultRegion:              strPtr("us-east-1"),
		DisableTools:               boolPtr(false),
		AutoContinueRounds:         intPtr(0),
		AutoSwitchOnQuotaExhausted: boolPtr(true),
		RateLimitEnabled:           false,
		RateLimitWindow:            60000,
		RateLimitMax:               100,
		TestModelID:                strPtr("claude-sonnet-4.5"),
	}
}

// GetGatewayConfig retrieves the full gateway configuration from Redis.
// Handles field aliases for backward compatibility with the TS backend.
func GetGatewayConfig(ctx context.Context) (*model.GatewayConfig, error) {
	rdb := GetClient()
	def := defaultGatewayConfig()

	data, err := rdb.HGetAll(ctx, Key(configKey)).Result()
	if err != nil {
		return def, fmt.Errorf("get gateway config: %w", err)
	}
	if len(data) == 0 {
		return def, nil
	}

	// Field alias handling: prefer standard names, fall back to aliases.
	enableMultiRaw := coalesce(data["enableMultiAccount"], data["multiAccountEnabled"])
	enableLoggingRaw := coalesce(data["enableRequestLogging"], data["logRequests"])
	tokenRefreshRaw := coalesce(data["tokenRefreshBeforeExpiry"], data["tokenRefreshAdvance"])
	autoContinueRaw := coalesce(data["autoContinueRounds"], data["toolCallAutoRounds"])
	disableToolsVal := data["disableTools"] == "true" || data["disableToolCalls"] == "true"
	autoContinueVal := safeParseInt(autoContinueRaw, 0)

	cfg := &model.GatewayConfig{
		Port:               safeParseInt(data["port"], def.Port),
		Host:               coalesceStr(data["host"], def.Host),
		EnableMultiAccount: safeParseBoolStr(enableMultiRaw, def.EnableMultiAccount),
		MaxConcurrent:      safeParseInt(data["maxConcurrent"], def.MaxConcurrent),
		MaxRetries:         safeParseInt(data["maxRetries"], def.MaxRetries),
		RetryDelay:         safeParseInt(data["retryDelay"], def.RetryDelay),
		RequestTimeout:     safeParseInt(data["requestTimeout"], def.RequestTimeout),
		RateLimitEnabled:   data["rateLimitEnabled"] == "true",
		RateLimitWindow:    safeParseInt(data["rateLimitWindow"], def.RateLimitWindow),
		RateLimitMax:       safeParseInt(data["rateLimitMax"], def.RateLimitMax),
	}

	// Pointer-based optional fields.
	if v := data["preferredEndpoint"]; v != "" {
		cfg.PreferredEndpoint = strPtr(v)
	}
	cfg.DefaultRegion = strPtr(coalesceStr(data["defaultRegion"], "us-east-1"))
	cfg.DisableTools = boolPtr(disableToolsVal)
	cfg.DisableToolCalls = boolPtr(disableToolsVal)
	cfg.AutoContinueRounds = intPtr(autoContinueVal)
	cfg.ToolCallAutoRounds = intPtr(autoContinueVal)

	autoSwitch := true
	if v, ok := data["autoSwitchOnQuotaExhausted"]; ok {
		autoSwitch = v == "true"
	}
	cfg.AutoSwitchOnQuotaExhausted = boolPtr(autoSwitch)

	loggingEnabled := true
	if enableLoggingRaw != "" {
		loggingEnabled = enableLoggingRaw == "true"
	}
	cfg.EnableRequestLogging = boolPtr(loggingEnabled)
	cfg.TokenRefreshBeforeExpiry = intPtr(safeParseInt(tokenRefreshRaw, 300))

	if v := data["queueEnabled"]; v != "" {
		cfg.QueueEnabled = boolPtr(v == "true")
	}
	if v := data["testModelId"]; v != "" {
		cfg.TestModelID = strPtr(v)
	} else {
		cfg.TestModelID = strPtr("claude-sonnet-4.5")
	}

	// Optional account pool settings.
	if v := data["errorCooldownTime"]; v != "" {
		cfg.ErrorCooldownTime = intPtr(safeParseInt(v, 0))
	}
	if v := data["maxConsecutiveErrors"]; v != "" {
		cfg.MaxConsecutiveErrors = intPtr(safeParseInt(v, 0))
	}
	if v := data["quotaResetTime"]; v != "" {
		cfg.QuotaResetTime = intPtr(safeParseInt(v, 0))
	}
	if v := data["autoStopErrorCodes"]; v != "" {
		cfg.AutoStopErrorCodes = strPtr(v)
	}
	if v := data["autoStopErrorPatterns"]; v != "" {
		cfg.AutoStopErrorPatterns = strPtr(v)
	}
	if v := data["quotaUsageThreshold"]; v != "" {
		cfg.QuotaUsageThreshold = intPtr(safeParseInt(v, 0))
	}

	// Queue settings.
	if v := data["queueMaxSize"]; v != "" {
		cfg.QueueMaxSize = intPtr(safeParseInt(v, 0))
	}
	if v := data["queueTimeoutMs"]; v != "" {
		cfg.QueueTimeoutMs = intPtr(safeParseInt(v, 0))
	}

	// Dynamic concurrency.
	if v := data["concurrencyMultiplier"]; v != "" {
		cfg.ConcurrencyMultiplier = floatPtr(safeParseFloat(v, 0))
	}
	if v := data["queueSizeMultiplier"]; v != "" {
		cfg.QueueSizeMultiplier = floatPtr(safeParseFloat(v, 0))
	}

	// Account wait queue.
	if v, ok := data["accountWaitEnabled"]; ok {
		cfg.AccountWaitEnabled = boolPtr(v == "true")
	}
	if v := data["accountWaitTimeoutMs"]; v != "" {
		cfg.AccountWaitTimeoutMs = intPtr(safeParseInt(v, 0))
	}
	if v := data["accountWaitMaxSize"]; v != "" {
		cfg.AccountWaitMaxSize = intPtr(safeParseInt(v, 0))
	}

	// Session stickiness.
	if v, ok := data["sessionEnabled"]; ok {
		cfg.SessionEnabled = boolPtr(v == "true")
	}
	if v := data["sessionTtlSeconds"]; v != "" {
		cfg.SessionTTLSeconds = intPtr(safeParseInt(v, 0))
	}
	if v := data["sessionRenewalThresholdSeconds"]; v != "" {
		cfg.SessionRenewalThresholdSeconds = intPtr(safeParseInt(v, 0))
	}
	if v, ok := data["sessionEnableCacheControl"]; ok {
		cfg.SessionEnableCacheControl = boolPtr(v == "true")
	}

	// Proxy service settings.
	if v, ok := data["proxyEnabled"]; ok {
		cfg.ProxyEnabled = boolPtr(v == "true")
	}
	if v := data["proxyPort"]; v != "" {
		cfg.ProxyPort = intPtr(safeParseInt(v, 0))
	}
	if v := data["proxyHost"]; v != "" {
		cfg.ProxyHost = strPtr(v)
	}

	// Automation.
	if v, ok := data["autoStart"]; ok {
		cfg.AutoStart = boolPtr(v == "true")
	}

	return cfg, nil
}

// UpdateGatewayConfig merges updates into the stored configuration.
// Normalizes field aliases and cleans up stale alias keys.
func UpdateGatewayConfig(ctx context.Context, updates map[string]interface{}) (*model.GatewayConfig, error) {
	rdb := GetClient()

	// Normalize field aliases to canonical names.
	if v, ok := updates["multiAccountEnabled"]; ok {
		updates["enableMultiAccount"] = v
		delete(updates, "multiAccountEnabled")
	}
	if v, ok := updates["logRequests"]; ok {
		updates["enableRequestLogging"] = v
		delete(updates, "logRequests")
	}
	if v, ok := updates["tokenRefreshAdvance"]; ok {
		updates["tokenRefreshBeforeExpiry"] = v
		delete(updates, "tokenRefreshAdvance")
	}

	// Build flat string map for HSET.
	fields := make(map[string]interface{}, len(updates))
	for k, v := range updates {
		if v == nil {
			continue
		}
		switch val := v.(type) {
		case string:
			fields[k] = val
		case bool:
			if val {
				fields[k] = "true"
			} else {
				fields[k] = "false"
			}
		case int:
			fields[k] = strconv.Itoa(val)
		case int64:
			fields[k] = strconv.FormatInt(val, 10)
		case float64:
			fields[k] = strconv.FormatFloat(val, 'f', -1, 64)
		default:
			fields[k] = fmt.Sprintf("%v", val)
		}
	}

	// Remove stale alias keys to avoid duplicate semantics.
	aliasKeys := []string{"multiAccountEnabled", "logRequests", "tokenRefreshAdvance"}
	for _, ak := range aliasKeys {
		rdb.HDel(ctx, Key(configKey), ak)
	}

	if len(fields) > 0 {
		if err := rdb.HSet(ctx, Key(configKey), fields).Err(); err != nil {
			return nil, fmt.Errorf("update gateway config: %w", err)
		}
	}

	log.Info().Msg("Gateway config updated")
	return GetGatewayConfig(ctx)
}

// GetSelectedAccounts returns the set of selected account IDs.
func GetSelectedAccounts(ctx context.Context) ([]string, error) {
	return GetClient().SMembers(ctx, Key(selectedAccountsKey)).Result()
}

// SetSelectedAccounts replaces the entire set of selected account IDs.
func SetSelectedAccounts(ctx context.Context, ids []string) error {
	rdb := GetClient()

	rdb.Del(ctx, Key(selectedAccountsKey))
	if len(ids) > 0 {
		members := make([]interface{}, len(ids))
		for i, id := range ids {
			members[i] = id
		}
		if err := rdb.SAdd(ctx, Key(selectedAccountsKey), members...).Err(); err != nil {
			return fmt.Errorf("set selected accounts: %w", err)
		}
	}

	log.Info().Int("count", len(ids)).Msg("Selected accounts updated")
	return nil
}