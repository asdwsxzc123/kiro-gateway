package storage

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/model"
)

// GetWebhookConfig retrieves the webhook configuration.
// Migrates legacy per-field webhook settings on first access.
func GetWebhookConfig(ctx context.Context) (*model.WebhookConfig, error) {
	rdb := GetClient()

	raw, err := rdb.Get(ctx, Key(webhookConfigKey)).Result()
	if err == nil && raw != "" {
		var cfg model.WebhookConfig
		if err := json.Unmarshal([]byte(raw), &cfg); err == nil {
			// Ensure non-nil slices for JSON serialization.
			if cfg.Platforms == nil {
				cfg.Platforms = []model.WebhookPlatformConfig{}
			}
			return &cfg, nil
		}
	}

	// Auto-migrate from legacy config hash fields.
	oldData, _ := rdb.HGetAll(ctx, Key(configKey)).Result()
	migrated := &model.WebhookConfig{
		Enabled:                  oldData["webhookUrl"] != "",
		UsageThreshold:           safeParseFloat(oldData["webhookUsageThreshold"], 0),
		NotifyOnAccountError:     oldData["webhookOnAccountError"] == "true",
		NotifyOnTokenRefreshFail: false,
		NotifyHeartbeat:          false,
		Platforms:                []model.WebhookPlatformConfig{},
	}

	if oldData["webhookUrl"] != "" {
		migrated.Platforms = append(migrated.Platforms, model.WebhookPlatformConfig{
			Platform: model.WebhookPlatformFeishu,
			Enabled:  true,
			URL:      oldData["webhookUrl"],
			Label:    "Default",
		})
	}

	b, _ := json.Marshal(migrated)
	rdb.Set(ctx, Key(webhookConfigKey), string(b), 0)

	if oldData["webhookUrl"] != "" {
		rdb.HDel(ctx, Key(configKey), "webhookUrl", "webhookUsageThreshold", "webhookOnAccountError")
	}

	return migrated, nil
}

// UpdateWebhookConfig persists the webhook configuration.
func UpdateWebhookConfig(ctx context.Context, cfg *model.WebhookConfig) error {
	b, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal webhook config: %w", err)
	}

	if err := GetClient().Set(ctx, Key(webhookConfigKey), string(b), 0).Err(); err != nil {
		return fmt.Errorf("save webhook config: %w", err)
	}

	log.Info().Msg("Webhook config updated")
	return nil
}
