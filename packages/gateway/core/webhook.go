package core

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/model"
	"github.com/kiro-gateway/gateway/storage"
)

const (
	webhookTimeout     = 10 * time.Second
	defaultMaxAttempts = 4
)

// SendWebhookNotification dispatches a notification to all enabled webhook
// platforms. The delivery is performed asynchronously (fire-and-forget) in
// a separate goroutine so it does not block the caller.
func SendWebhookNotification(ctx context.Context, notification *model.WebhookNotification) {
	go func() {
		deliverWebhook(ctx, notification)
	}()
}

// deliverWebhook reads the webhook configuration, applies notification type
// filtering, and sends the payload to each enabled platform endpoint.
func deliverWebhook(ctx context.Context, notification *model.WebhookNotification) {
	cfg, err := storage.GetWebhookConfig(ctx)
	if err != nil {
		log.Error().Err(err).Msg("Failed to load webhook config")
		return
	}

	if !cfg.Enabled || len(cfg.Platforms) == 0 {
		return
	}

	// Notification type filtering.
	switch notification.Type {
	case model.WebhookNotifyAccountError:
		if !cfg.NotifyOnAccountError {
			return
		}
	case model.WebhookNotifyUsageAlert:
		if cfg.UsageThreshold <= 0 {
			return
		}
	case model.WebhookNotifyTokenRefreshFail:
		if !cfg.NotifyOnTokenRefreshFail {
			return
		}
	case model.WebhookNotifyHeartbeat:
		if !cfg.NotifyHeartbeat {
			return
		}
	case model.WebhookNotifyTest:
		// Always deliver test notifications.
	}

	for _, platform := range cfg.Platforms {
		if !platform.Enabled || platform.URL == "" {
			continue
		}

		payload := BuildWebhookPayload(platform.Platform, notification)
		if payload == nil {
			log.Warn().
				Str("platform", string(platform.Platform)).
				Msg("Unsupported webhook platform, skipping")
			continue
		}

		sendWithRetry(platform, payload, defaultMaxAttempts)
	}
}

// BuildWebhookPayload creates the platform-specific JSON payload for the
// notification. Exported for use by webhook test endpoints.
func BuildWebhookPayload(platform model.WebhookPlatformType, n *model.WebhookNotification) map[string]interface{} {
	switch platform {
	case model.WebhookPlatformFeishu:
		return buildFeishuPayload(n)
	case model.WebhookPlatformDingtalk:
		return buildDingTalkPayload(n)
	case model.WebhookPlatformSlack:
		return buildSlackPayload(n)
	case model.WebhookPlatformWechatWork:
		return buildWechatWorkPayload(n)
	case model.WebhookPlatformDiscord:
		return buildDiscordPayload(n)
	case model.WebhookPlatformCustom:
		return buildCustomPayload(n)
	default:
		return nil
	}
}

// sendWithRetry POSTs the JSON payload to the platform webhook URL with
// exponential backoff retry. It does not retry on 4xx errors (except 429).
func sendWithRetry(platform model.WebhookPlatformConfig, payload map[string]interface{}, maxAttempts int) {
	if maxAttempts <= 0 {
		maxAttempts = defaultMaxAttempts
	}

	// Apply platform-specific signing.
	targetURL := platform.URL
	ApplyWebhookSigning(platform, payload, &targetURL)

	body, err := json.Marshal(payload)
	if err != nil {
		log.Error().Err(err).
			Str("platform", string(platform.Platform)).
			Msg("Failed to marshal webhook payload")
		return
	}

	client := &http.Client{Timeout: webhookTimeout}

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		resp, postErr := client.Post(targetURL, "application/json", bytes.NewReader(body))
		if postErr != nil {
			log.Warn().Err(postErr).
				Str("platform", string(platform.Platform)).
				Str("label", platform.Label).
				Int("attempt", attempt).
				Int("maxAttempts", maxAttempts).
				Msg("Webhook delivery failed")

			if attempt < maxAttempts {
				sleepDuration := time.Second * time.Duration(1<<(attempt-1))
				time.Sleep(sleepDuration)
			}
			continue
		}
		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			log.Info().
				Str("platform", string(platform.Platform)).
				Str("label", platform.Label).
				Int("status", resp.StatusCode).
				Int("attempt", attempt).
				Msg("Webhook delivered successfully")
			return
		}

		// Do not retry on 4xx errors, except 429 (Too Many Requests).
		if resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != 429 {
			log.Warn().
				Str("platform", string(platform.Platform)).
				Str("label", platform.Label).
				Int("status", resp.StatusCode).
				Msg("Webhook delivery returned 4xx, not retrying")
			return
		}

		log.Warn().
			Str("platform", string(platform.Platform)).
			Str("label", platform.Label).
			Int("status", resp.StatusCode).
			Int("attempt", attempt).
			Int("maxAttempts", maxAttempts).
			Msg("Webhook delivery returned non-2xx, retrying")

		if attempt < maxAttempts {
			sleepDuration := time.Second * time.Duration(1<<(attempt-1))
			time.Sleep(sleepDuration)
		}
	}

	log.Error().
		Str("platform", string(platform.Platform)).
		Str("label", platform.Label).
		Int("maxAttempts", maxAttempts).
		Msg("Webhook delivery exhausted all retry attempts")
}

// ApplyWebhookSigning applies platform-specific signing to the payload and/or
// URL. It mutates the payload map and targetURL pointer in-place. Exported so
// admin_routes.go can call it for test webhook delivery.
func ApplyWebhookSigning(platform model.WebhookPlatformConfig, payload map[string]interface{}, targetURL *string) {
	if platform.Secret == "" {
		return
	}
	switch platform.Platform {
	case model.WebhookPlatformFeishu:
		ts, sign := signFeishu(platform.Secret)
		payload["timestamp"] = ts
		payload["sign"] = sign
	case model.WebhookPlatformDingtalk:
		*targetURL = signDingtalk(*targetURL, platform.Secret)
	}
}

// signFeishu computes a Feishu webhook signature.
// Returns (timestamp, base64-encoded HMAC-SHA256 signature).
func signFeishu(secret string) (string, string) {
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	stringToSign := timestamp + "\n" + secret

	mac := hmac.New(sha256.New, []byte(stringToSign))
	mac.Write([]byte{})
	signature := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	return timestamp, signature
}

// signDingtalk computes a DingTalk webhook signature and appends it to the URL.
// Returns the modified URL with timestamp and sign query parameters.
func signDingtalk(webhookURL, secret string) string {
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	stringToSign := timestamp + "\n" + secret

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(stringToSign))
	signature := url.QueryEscape(base64.StdEncoding.EncodeToString(mac.Sum(nil)))

	sep := "&"
	if !containsQuery(webhookURL) {
		sep = "?"
	}
	return fmt.Sprintf("%s%stimestamp=%s&sign=%s", webhookURL, sep, timestamp, signature)
}

// containsQuery checks whether the URL already has a query string.
func containsQuery(rawURL string) bool {
	for i := 0; i < len(rawURL); i++ {
		if rawURL[i] == '?' {
			return true
		}
	}
	return false
}
