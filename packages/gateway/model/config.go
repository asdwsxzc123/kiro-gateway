package model

// GatewayConfig holds all gateway configuration options.
type GatewayConfig struct {
	// Basic
	Port int    `json:"port"`
	Host string `json:"host"`

	// Proxy service
	ProxyEnabled *bool  `json:"proxyEnabled,omitempty"`
	ProxyPort    *int   `json:"proxyPort,omitempty"`
	ProxyHost    *string `json:"proxyHost,omitempty"`

	// Multi-account
	EnableMultiAccount  bool `json:"enableMultiAccount"`
	MultiAccountEnabled *bool `json:"multiAccountEnabled,omitempty"` // frontend alias

	// Request settings
	MaxConcurrent     int     `json:"maxConcurrent"`
	MaxRetries        int     `json:"maxRetries"`
	RetryDelay        int     `json:"retryDelay"`
	RequestTimeout    int     `json:"requestTimeout"`
	PreferredEndpoint *string `json:"preferredEndpoint,omitempty"` // "codewhisperer" or "amazonq"
	DefaultRegion     *string `json:"defaultRegion,omitempty"`

	// Token refresh
	TokenRefreshAdvance      *int `json:"tokenRefreshAdvance,omitempty"`
	TokenRefreshBeforeExpiry *int `json:"tokenRefreshBeforeExpiry,omitempty"`

	// Rate limiting
	RateLimitEnabled bool `json:"rateLimitEnabled"`
	RateLimitWindow  int  `json:"rateLimitWindow"`
	RateLimitMax     int  `json:"rateLimitMax"`

	// Automation
	AutoStart                    *bool `json:"autoStart,omitempty"`
	AutoSwitchOnQuotaExhausted   *bool `json:"autoSwitchOnQuotaExhausted,omitempty"`

	// Tool calls
	DisableToolCalls   *bool `json:"disableToolCalls,omitempty"`
	DisableTools       *bool `json:"disableTools,omitempty"`
	ToolCallAutoRounds *int  `json:"toolCallAutoRounds,omitempty"`
	AutoContinueRounds *int  `json:"autoContinueRounds,omitempty"`

	// Logging
	EnableRequestLogging *bool `json:"enableRequestLogging,omitempty"`
	LogRequests          *bool `json:"logRequests,omitempty"`

	// Account pool
	ErrorCooldownTime    *int `json:"errorCooldownTime,omitempty"`
	MaxConsecutiveErrors *int `json:"maxConsecutiveErrors,omitempty"`
	QuotaResetTime       *int `json:"quotaResetTime,omitempty"`

	// Auto-stop rules
	AutoStopErrorCodes    *string `json:"autoStopErrorCodes,omitempty"`
	AutoStopErrorPatterns *string `json:"autoStopErrorPatterns,omitempty"`
	QuotaUsageThreshold   *int    `json:"quotaUsageThreshold,omitempty"`

	// Queue settings
	QueueEnabled   *bool `json:"queueEnabled,omitempty"`
	QueueMaxSize   *int  `json:"queueMaxSize,omitempty"`
	QueueTimeoutMs *int  `json:"queueTimeoutMs,omitempty"`

	// Dynamic concurrency
	ConcurrencyMultiplier *float64 `json:"concurrencyMultiplier,omitempty"`
	QueueSizeMultiplier   *float64 `json:"queueSizeMultiplier,omitempty"`

	// Account wait queue
	AccountWaitEnabled   *bool `json:"accountWaitEnabled,omitempty"`
	AccountWaitTimeoutMs *int  `json:"accountWaitTimeoutMs,omitempty"`
	AccountWaitMaxSize   *int  `json:"accountWaitMaxSize,omitempty"`

	// Session stickiness
	SessionEnabled                  *bool `json:"sessionEnabled,omitempty"`
	SessionTTLSeconds               *int  `json:"sessionTtlSeconds,omitempty"`
	SessionRenewalThresholdSeconds  *int  `json:"sessionRenewalThresholdSeconds,omitempty"`
	SessionEnableCacheControl       *bool `json:"sessionEnableCacheControl,omitempty"`

	// Testing
	TestModelID *string `json:"testModelId,omitempty"`
}

// TokenRefreshResult holds the outcome of a token refresh attempt.
type TokenRefreshResult struct {
	Success      bool   `json:"success"`
	AccessToken  string `json:"accessToken,omitempty"`
	RefreshToken string `json:"refreshToken,omitempty"`
	ExpiresAt    int64  `json:"expiresAt,omitempty"`
	Error        string `json:"error,omitempty"`
}
