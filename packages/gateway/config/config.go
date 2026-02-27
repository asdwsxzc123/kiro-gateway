package config

import (
	"os"
	"strconv"
	"sync"

	"github.com/joho/godotenv"
)

// ServerConfig holds HTTP server settings.
type ServerConfig struct {
	Port    int    `json:"port"`
	Host    string `json:"host"`
	NodeEnv string `json:"nodeEnv"`
}

// RedisConfig holds Redis connection settings.
type RedisConfig struct {
	URL       string `json:"url"`
	Password  string `json:"password"`
	DB        int    `json:"db"`
	KeyPrefix string `json:"keyPrefix"`
}

// ProxyConfig holds proxy/LLM request settings.
type ProxyConfig struct {
	EnableMultiAccount         bool   `json:"enableMultiAccount"`
	MaxConcurrent              int    `json:"maxConcurrent"`
	MaxRetries                 int    `json:"maxRetries"`
	RetryDelayMs               int    `json:"retryDelayMs"`
	RequestTimeout             int    `json:"requestTimeout"`
	TokenRefreshBeforeExpiry   int    `json:"tokenRefreshBeforeExpiry"`
	PreferredEndpoint          string `json:"preferredEndpoint"`
	DefaultRegion              string `json:"defaultRegion"`
	AutoContinueRounds         int    `json:"autoContinueRounds"`
	DisableTools               bool   `json:"disableTools"`
	AutoSwitchOnQuotaExhausted bool   `json:"autoSwitchOnQuotaExhausted"`
}

// RateLimitConfig holds rate-limiting settings.
type RateLimitConfig struct {
	Enabled  bool `json:"enabled"`
	WindowMs int  `json:"windowMs"`
	Max      int  `json:"max"`
}

// LogConfig holds logging settings.
type LogConfig struct {
	Level      string `json:"level"`
	MaxEntries int    `json:"maxEntries"`
	Dir        string `json:"dir"`
}

// AccountPoolConfig holds account pool behaviour settings.
type AccountPoolConfig struct {
	CooldownMs       int `json:"cooldownMs"`
	MaxErrorCount    int `json:"maxErrorCount"`
	QuotaResetMs     int `json:"quotaResetMs"`
	ErrorCooldown429 int `json:"errorCooldown429"`
	ErrorCooldown529 int `json:"errorCooldown529"`
	ErrorCooldown5xx int `json:"errorCooldown5xx"`
}

// SessionConfig holds session stickiness settings.
type SessionConfig struct {
	Enabled                 bool `json:"enabled"`
	TTLSeconds              int  `json:"ttlSeconds"`
	RenewalThresholdSeconds int  `json:"renewalThresholdSeconds"`
	EnableCacheControl      bool `json:"enableCacheControl"`
}

// QueueConfig holds request queue settings.
type QueueConfig struct {
	Enabled   bool `json:"enabled"`
	MaxSize   int  `json:"maxSize"`
	TimeoutMs int  `json:"timeoutMs"`
}

// AccountWaitConfig holds settings for waiting when no account is available.
type AccountWaitConfig struct {
	Enabled   bool `json:"enabled"`
	TimeoutMs int  `json:"timeoutMs"`
	MaxSize   int  `json:"maxSize"`
}

// ConcurrencyConfig holds concurrency multiplier settings.
type ConcurrencyConfig struct {
	Multiplier          int `json:"multiplier"`
	QueueSizeMultiplier int `json:"queueSizeMultiplier"`
}

// JWTConfig holds JWT authentication settings.
type JWTConfig struct {
	Secret    string `json:"secret"`
	ExpiresIn string `json:"expiresIn"`
}

// AdminConfig holds admin credential settings.
type AdminConfig struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// SecurityConfig holds encryption key settings.
type SecurityConfig struct {
	EncryptionKey string `json:"encryptionKey"`
}

// Config is the root configuration structure for the gateway.
type Config struct {
	Server      ServerConfig      `json:"server"`
	Redis       RedisConfig       `json:"redis"`
	Proxy       ProxyConfig       `json:"proxy"`
	RateLimit   RateLimitConfig   `json:"rateLimit"`
	Log         LogConfig         `json:"log"`
	AccountPool AccountPoolConfig `json:"accountPool"`
	Session     SessionConfig     `json:"session"`
	Queue       QueueConfig       `json:"queue"`
	AccountWait AccountWaitConfig `json:"accountWait"`
	Concurrency ConcurrencyConfig `json:"concurrency"`
	JWT         JWTConfig         `json:"jwt"`
	Admin       AdminConfig       `json:"admin"`
	Security    SecurityConfig    `json:"security"`
}

var (
	instance *Config
	once     sync.Once
	mu       sync.Mutex
)

// getEnv returns the environment variable value or the provided default.
func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

// getEnvInt returns the environment variable parsed as int or the provided default.
func getEnvInt(key string, defaultVal int) int {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	parsed, err := strconv.Atoi(val)
	if err != nil {
		return defaultVal
	}
	return parsed
}

// getEnvBool returns the environment variable parsed as bool or the provided default.
// Recognises "true"/"1" as true and "false"/"0" as false.
func getEnvBool(key string, defaultVal bool) bool {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	parsed, err := strconv.ParseBool(val)
	if err != nil {
		return defaultVal
	}
	return parsed
}

// Load reads environment variables (and an optional .env file) and returns a
// fully populated Config with defaults applied for any missing values.
func Load() *Config {
	// Attempt to load .env file; ignore errors (file may not exist).
	_ = godotenv.Load()

	return &Config{
		Server: ServerConfig{
			Port:    getEnvInt("PORT", DefaultPort),
			Host:    getEnv("HOST", DefaultHost),
			NodeEnv: getEnv("NODE_ENV", DefaultNodeEnv),
		},
		Redis: RedisConfig{
			URL:       getEnv("REDIS_URL", DefaultRedisURL),
			Password:  getEnv("REDIS_PASSWORD", ""),
			DB:        getEnvInt("REDIS_DB", DefaultRedisDB),
			KeyPrefix: getEnv("REDIS_KEY_PREFIX", DefaultRedisKeyPrefix),
		},
		Proxy: ProxyConfig{
			EnableMultiAccount:         getEnvBool("ENABLE_MULTI_ACCOUNT", true),
			MaxConcurrent:              getEnvInt("MAX_CONCURRENT", DefaultMaxConcurrent),
			MaxRetries:                 getEnvInt("MAX_RETRIES", DefaultMaxRetries),
			RetryDelayMs:               getEnvInt("RETRY_DELAY_MS", DefaultRetryDelayMs),
			RequestTimeout:             getEnvInt("REQUEST_TIMEOUT", DefaultRequestTimeout),
			TokenRefreshBeforeExpiry:   getEnvInt("TOKEN_REFRESH_BEFORE_EXPIRY", DefaultTokenRefreshBeforeExpiry),
			PreferredEndpoint:          getEnv("PREFERRED_ENDPOINT", DefaultPreferredEndpoint),
			DefaultRegion:              getEnv("DEFAULT_REGION", ""),
			AutoContinueRounds:         getEnvInt("AUTO_CONTINUE_ROUNDS", DefaultAutoContinueRounds),
			DisableTools:               getEnvBool("DISABLE_TOOLS", false),
			AutoSwitchOnQuotaExhausted: getEnvBool("AUTO_SWITCH_ON_QUOTA_EXHAUSTED", DefaultAutoSwitchOnQuota),
		},
		RateLimit: RateLimitConfig{
			Enabled:  getEnvBool("RATE_LIMIT_ENABLED", false),
			WindowMs: getEnvInt("RATE_LIMIT_WINDOW_MS", DefaultRateLimitWindowMs),
			Max:      getEnvInt("RATE_LIMIT_MAX_REQUESTS", DefaultRateLimitMax),
		},
		Log: LogConfig{
			Level:      getEnv("LOG_LEVEL", DefaultLogLevel),
			MaxEntries: getEnvInt("LOG_MAX_ENTRIES", DefaultLogMaxEntries),
			Dir:        getEnv("LOG_DIR", DefaultLogDir),
		},
		AccountPool: AccountPoolConfig{
			CooldownMs:       getEnvInt("ACCOUNT_COOLDOWN_MS", DefaultCooldownMs),
			MaxErrorCount:    getEnvInt("ACCOUNT_MAX_ERROR_COUNT", DefaultMaxErrorCount),
			QuotaResetMs:     getEnvInt("ACCOUNT_QUOTA_RESET_MS", DefaultQuotaResetMs),
			ErrorCooldown429: getEnvInt("ERROR_COOLDOWN_429", DefaultErrorCooldown429),
			ErrorCooldown529: getEnvInt("ERROR_COOLDOWN_529", DefaultErrorCooldown529),
			ErrorCooldown5xx: getEnvInt("ERROR_COOLDOWN_5XX", DefaultErrorCooldown5xx),
		},
		Session: SessionConfig{
			Enabled:                 getEnvBool("SESSION_ENABLED", true),
			TTLSeconds:              getEnvInt("SESSION_TTL_SECONDS", DefaultSessionTTL),
			RenewalThresholdSeconds: getEnvInt("SESSION_RENEWAL_THRESHOLD_SECONDS", DefaultSessionRenewalThreshold),
			EnableCacheControl:      getEnvBool("SESSION_ENABLE_CACHE_CONTROL", true),
		},
		Queue: QueueConfig{
			Enabled:   getEnvBool("QUEUE_ENABLED", false),
			MaxSize:   getEnvInt("QUEUE_MAX_SIZE", DefaultAccountWaitMaxSize),
			TimeoutMs: getEnvInt("QUEUE_TIMEOUT_MS", DefaultAccountWaitTimeoutMs),
		},
		AccountWait: AccountWaitConfig{
			Enabled:   getEnvBool("ACCOUNT_WAIT_ENABLED", DefaultAccountWaitEnabled),
			TimeoutMs: getEnvInt("ACCOUNT_WAIT_TIMEOUT_MS", DefaultAccountWaitTimeoutMs),
			MaxSize:   getEnvInt("ACCOUNT_WAIT_MAX_SIZE", DefaultAccountWaitMaxSize),
		},
		Concurrency: ConcurrencyConfig{
			Multiplier:          getEnvInt("CONCURRENCY_MULTIPLIER", DefaultConcurrencyMultiplier),
			QueueSizeMultiplier: getEnvInt("QUEUE_SIZE_MULTIPLIER", DefaultQueueSizeMultiplier),
		},
		JWT: JWTConfig{
			Secret:    getEnv("JWT_SECRET", DefaultJWTSecret),
			ExpiresIn: getEnv("JWT_EXPIRES_IN", DefaultJWTExpiresIn),
		},
		Admin: AdminConfig{
			Username: getEnv("ADMIN_USERNAME", DefaultAdminUsername),
			Password: getEnv("ADMIN_PASSWORD", DefaultAdminPassword),
		},
		Security: SecurityConfig{
			EncryptionKey: getEnv("ENCRYPTION_KEY", ""),
		},
	}
}

// GetConfig returns the singleton Config instance, loading it on first call.
func GetConfig() *Config {
	once.Do(func() {
		instance = Load()
	})
	return instance
}

// ReloadConfig resets the singleton so the next GetConfig call reloads from
// environment variables. It is safe to call from multiple goroutines.
func ReloadConfig() {
	mu.Lock()
	defer mu.Unlock()
	instance = Load()
	// Reset once so subsequent GetConfig calls return the new instance.
	once = sync.Once{}
	once.Do(func() {
		// instance is already set above; this ensures once is marked as done.
	})
}
