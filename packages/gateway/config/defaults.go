package config

const (
	DefaultPort                  = 3000
	DefaultHost                  = "0.0.0.0"
	DefaultNodeEnv               = "development"
	DefaultRedisURL              = "redis://localhost:16379"
	DefaultRedisDB               = 0
	DefaultRedisKeyPrefix        = "gateway:"
	DefaultMaxConcurrent         = 0 // unlimited
	DefaultMaxRetries            = 3
	DefaultRetryDelayMs          = 1000
	DefaultTokenRefreshBeforeExpiry = 300 // 5 min
	DefaultPreferredEndpoint     = "codewhisperer"
	DefaultAutoContinueRounds    = 0
	DefaultAutoSwitchOnQuota     = true
	DefaultRateLimitWindowMs     = 60000
	DefaultRateLimitMax          = 100
	DefaultLogLevel              = "info"
	DefaultLogMaxEntries         = 100000
	DefaultLogDir                = "./logs"
	DefaultCooldownMs            = 60000
	DefaultMaxErrorCount         = 3
	DefaultQuotaResetMs          = 3600000
	DefaultSessionTTL            = 3600
	DefaultSessionRenewalThreshold = 300
	DefaultJWTSecret             = "default-jwt-secret-change-in-production"
	DefaultJWTExpiresIn          = "24h"
	DefaultAdminUsername         = "admin"
	DefaultAdminPassword         = "admin123"
	DefaultRequestTimeout        = 300000 // 5 min in ms
	DefaultAccountWaitEnabled    = true
	DefaultAccountWaitTimeoutMs  = 5000
	DefaultAccountWaitMaxSize    = 50
	DefaultConcurrencyMultiplier = 10
	DefaultQueueSizeMultiplier   = 2
	DefaultErrorCooldown429      = 60
	DefaultErrorCooldown529      = 120
	DefaultErrorCooldown5xx      = 15
	DefaultTestModelID           = "claude-sonnet-4-5"
)
