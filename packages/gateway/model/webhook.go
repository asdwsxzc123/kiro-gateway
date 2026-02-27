package model

// WebhookPlatformType identifies the notification platform.
type WebhookPlatformType string

const (
	WebhookPlatformFeishu     WebhookPlatformType = "feishu"
	WebhookPlatformDingtalk   WebhookPlatformType = "dingtalk"
	WebhookPlatformWechatWork WebhookPlatformType = "wechat_work"
	WebhookPlatformSlack      WebhookPlatformType = "slack"
	WebhookPlatformDiscord    WebhookPlatformType = "discord"
	WebhookPlatformCustom     WebhookPlatformType = "custom"
)

// WebhookNotificationType identifies the kind of notification event.
type WebhookNotificationType string

const (
	WebhookNotifyAccountError     WebhookNotificationType = "account_error"
	WebhookNotifyUsageAlert       WebhookNotificationType = "usage_alert"
	WebhookNotifyTokenRefreshFail WebhookNotificationType = "token_refresh_fail"
	WebhookNotifyHeartbeat        WebhookNotificationType = "heartbeat"
	WebhookNotifyRequestStuck     WebhookNotificationType = "request_stuck"
	WebhookNotifyTest             WebhookNotificationType = "test"
)

// WebhookConfig is the top-level webhook configuration.
type WebhookConfig struct {
	Enabled                  bool                    `json:"enabled"`
	Subject                  string                  `json:"subject,omitempty"`
	UsageThreshold           float64                 `json:"usageThreshold"`
	NotifyOnAccountError     bool                    `json:"notifyOnAccountError"`
	NotifyOnTokenRefreshFail bool                    `json:"notifyOnTokenRefreshFail"`
	NotifyHeartbeat          bool                    `json:"notifyHeartbeat"`
	Platforms                []WebhookPlatformConfig `json:"platforms"`
}

// WebhookPlatformConfig describes a single notification platform endpoint.
type WebhookPlatformConfig struct {
	Platform WebhookPlatformType `json:"platform"`
	Enabled  bool                `json:"enabled"`
	URL      string              `json:"url"`
	Secret   string              `json:"secret,omitempty"`
	Label    string              `json:"label,omitempty"`
}

// WebhookNotificationAccount is the account subset included in notifications.
type WebhookNotificationAccount struct {
	ID    string `json:"id"`
	Alias string `json:"alias,omitempty"`
	Email string `json:"email,omitempty"`
}

// WebhookNotification is the payload delivered to webhook endpoints.
type WebhookNotification struct {
	Type      WebhookNotificationType     `json:"type"`
	Timestamp string                      `json:"timestamp"`
	Subject   string                      `json:"subject,omitempty"`
	Account   *WebhookNotificationAccount `json:"account,omitempty"`
	Detail    map[string]interface{}      `json:"detail"`
}

// WebhookDeliveryResult records the outcome of a single webhook delivery.
type WebhookDeliveryResult struct {
	Platform   WebhookPlatformType `json:"platform"`
	Label      string              `json:"label,omitempty"`
	Success    bool                `json:"success"`
	StatusCode int                 `json:"statusCode,omitempty"`
	Error      string              `json:"error,omitempty"`
}
