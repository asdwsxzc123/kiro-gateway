package services

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/core"
	"github.com/kiro-gateway/gateway/model"
	"github.com/kiro-gateway/gateway/storage"
)

// NotifyAccountStatusChange sends a webhook notification when an account status changes.
// Active status transitions are considered normal and do not trigger notifications.
func NotifyAccountStatusChange(ctx context.Context, accountID string, status model.AccountStatus, reason string) {
	if status == model.AccountStatusActive {
		return
	}

	whCfg, err := storage.GetWebhookConfig(ctx)
	if err != nil || !whCfg.Enabled || !whCfg.NotifyOnAccountError {
		return
	}

	acct, _ := storage.GetAccountByID(ctx, accountID)

	notification := &model.WebhookNotification{
		Type:      model.WebhookNotifyAccountError,
		Timestamp: time.Now().Format(time.RFC3339),
		Subject:   whCfg.Subject,
		Detail: map[string]interface{}{
			"status": string(status),
			"reason": reason,
		},
	}

	if acct != nil {
		notification.Account = &model.WebhookNotificationAccount{
			ID:    acct.ID,
			Alias: acct.Alias,
			Email: acct.Email,
		}
	}

	core.SendWebhookNotification(ctx, notification)
}

// NotifyTokenRefreshFail sends a webhook notification when a token refresh fails.
func NotifyTokenRefreshFail(ctx context.Context, accountID, errorMsg string) {
	whCfg, err := storage.GetWebhookConfig(ctx)
	if err != nil || !whCfg.Enabled || !whCfg.NotifyOnTokenRefreshFail {
		return
	}

	acct, _ := storage.GetAccountByID(ctx, accountID)

	notification := &model.WebhookNotification{
		Type:      model.WebhookNotifyTokenRefreshFail,
		Timestamp: time.Now().Format(time.RFC3339),
		Subject:   whCfg.Subject,
		Detail: map[string]interface{}{
			"error": errorMsg,
		},
	}

	if acct != nil {
		notification.Account = &model.WebhookNotificationAccount{
			ID:    acct.ID,
			Alias: acct.Alias,
			Email: acct.Email,
		}
	}

	core.SendWebhookNotification(ctx, notification)
}

// CheckUsageThreshold checks if usage cost exceeds the configured threshold
// and sends a notification when triggered.
func CheckUsageThreshold(ctx context.Context) {
	whCfg, err := storage.GetWebhookConfig(ctx)
	if err != nil || !whCfg.Enabled || whCfg.UsageThreshold <= 0 {
		return
	}

	global, err := storage.GetGlobalStats(ctx)
	if err != nil {
		log.Error().Err(err).Msg("Failed to get global stats for usage threshold check")
		return
	}

	if global.TotalCost < whCfg.UsageThreshold {
		return
	}

	notification := &model.WebhookNotification{
		Type:      model.WebhookNotifyUsageAlert,
		Timestamp: time.Now().Format(time.RFC3339),
		Subject:   whCfg.Subject,
		Detail: map[string]interface{}{
			"currentCost": global.TotalCost,
			"threshold":   whCfg.UsageThreshold,
			"message":     fmt.Sprintf("Usage cost $%.2f exceeds threshold $%.2f", global.TotalCost, whCfg.UsageThreshold),
		},
	}

	core.SendWebhookNotification(ctx, notification)
}

// NotifyHealthCheck sends a heartbeat notification with the current gateway status.
func NotifyHealthCheck(ctx context.Context, status string) {
	whCfg, err := storage.GetWebhookConfig(ctx)
	if err != nil || !whCfg.Enabled || !whCfg.NotifyHeartbeat {
		return
	}

	notification := &model.WebhookNotification{
		Type:      model.WebhookNotifyHeartbeat,
		Timestamp: time.Now().Format(time.RFC3339),
		Subject:   whCfg.Subject,
		Detail: map[string]interface{}{
			"status": status,
		},
	}

	core.SendWebhookNotification(ctx, notification)
}
