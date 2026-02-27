package model

// AccountUsage wraps usage limits for a single account.
type AccountUsage struct {
	AccountID string               `json:"accountId"`
	Usage     *UsageLimitsResponse `json:"usage,omitempty"`
	Error     string               `json:"error,omitempty"`
	UpdatedAt int64                `json:"updatedAt,omitempty"`
}

// UsageLimitsResponse is the response from the Kiro GetUsageLimits API.
type UsageLimitsResponse struct {
	UsageBreakdownList []UsageBreakdown  `json:"usageBreakdownList,omitempty"`
	NextDateReset      string            `json:"nextDateReset,omitempty"`
	SubscriptionInfo   *SubscriptionInfo `json:"subscriptionInfo,omitempty"`
	OverageConfig      *OverageConfig    `json:"overageConfiguration,omitempty"`
	UserInfo           *UsageUserInfo    `json:"userInfo,omitempty"`
}

// SubscriptionInfo describes the account's subscription details.
type SubscriptionInfo struct {
	SubscriptionName             string `json:"subscriptionName,omitempty"`
	SubscriptionTitle            string `json:"subscriptionTitle,omitempty"`
	SubscriptionType             string `json:"subscriptionType,omitempty"`
	Status                       string `json:"status,omitempty"`
	Type                         string `json:"type,omitempty"`
	SubscriptionManagementTarget string `json:"subscriptionManagementTarget,omitempty"`
	UpgradeCapability            string `json:"upgradeCapability,omitempty"`
	OverageCapability            string `json:"overageCapability,omitempty"`
}

// OverageConfig indicates whether overage billing is enabled.
type OverageConfig struct {
	OverageEnabled bool `json:"overageEnabled"`
}

// UsageUserInfo contains the user's email and ID from the usage response.
type UsageUserInfo struct {
	Email  string `json:"email,omitempty"`
	UserID string `json:"userId,omitempty"`
}

// UsageBreakdown describes usage for a single resource type.
type UsageBreakdown struct {
	ResourceType              string         `json:"resourceType,omitempty"`
	DisplayName               string         `json:"displayName,omitempty"`
	DisplayNamePlural         string         `json:"displayNamePlural,omitempty"`
	CurrentUsage              *float64       `json:"currentUsage,omitempty"`
	CurrentUsageWithPrecision *float64       `json:"currentUsageWithPrecision,omitempty"`
	UsageLimit                *float64       `json:"usageLimit,omitempty"`
	UsageLimitWithPrecision   *float64       `json:"usageLimitWithPrecision,omitempty"`
	Currency                  string         `json:"currency,omitempty"`
	Unit                      string         `json:"unit,omitempty"`
	OverageRate               *float64       `json:"overageRate,omitempty"`
	OverageCap                *float64       `json:"overageCap,omitempty"`
	Type                      string         `json:"type,omitempty"`
	FreeTrialInfo             *FreeTrialInfo `json:"freeTrialInfo,omitempty"`
	Bonuses                   []UsageBonus   `json:"bonuses,omitempty"`
}

// FreeTrialInfo holds free trial details within a usage breakdown.
type FreeTrialInfo struct {
	FreeTrialStatus           string   `json:"freeTrialStatus,omitempty"`
	UsageLimit                *float64 `json:"usageLimit,omitempty"`
	UsageLimitWithPrecision   *float64 `json:"usageLimitWithPrecision,omitempty"`
	CurrentUsage              *float64 `json:"currentUsage,omitempty"`
	CurrentUsageWithPrecision *float64 `json:"currentUsageWithPrecision,omitempty"`
	FreeTrialExpiry           string   `json:"freeTrialExpiry,omitempty"`
}

// UsageBonus describes a bonus code applied to the subscription.
type UsageBonus struct {
	BonusCode                 string   `json:"bonusCode,omitempty"`
	DisplayName               string   `json:"displayName,omitempty"`
	Description               string   `json:"description,omitempty"`
	UsageLimit                *float64 `json:"usageLimit,omitempty"`
	UsageLimitWithPrecision   *float64 `json:"usageLimitWithPrecision,omitempty"`
	CurrentUsage              *float64 `json:"currentUsage,omitempty"`
	CurrentUsageWithPrecision *float64 `json:"currentUsageWithPrecision,omitempty"`
	ExpiresAt                 string   `json:"expiresAt,omitempty"`
	RedeemedAt                string   `json:"redeemedAt,omitempty"`
	Status                    string   `json:"status,omitempty"`
}
