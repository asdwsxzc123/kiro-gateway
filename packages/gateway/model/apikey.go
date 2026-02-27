package model

// ApiKeyRecord represents a stored API key with metadata.
type ApiKeyRecord struct {
	ID              string   `json:"id"`
	Key             string   `json:"key,omitempty"`
	Name            string   `json:"name"`
	KeyPreview      string   `json:"keyPreview,omitempty"`
	BoundAccountIDs []string `json:"boundAccountIds,omitempty"`
	QuotaLimit      float64  `json:"quotaLimit,omitempty"` // cost cap in USD, 0 = unlimited
	CreatedAt       int64    `json:"createdAt"`
	LastUsed        int64    `json:"lastUsed,omitempty"`
}

// CreateApiKeyRequest is the request body for creating a new API key.
type CreateApiKeyRequest struct {
	Name            string   `json:"name" binding:"required"`
	BoundAccountIDs []string `json:"boundAccountIds,omitempty"`
	QuotaLimit      float64  `json:"quotaLimit,omitempty"`
}

// ApiKeyStats holds cumulative and daily usage statistics for an API key.
type ApiKeyStats struct {
	TotalRequests    int64              `json:"totalRequests"`
	TotalCredits     float64            `json:"totalCredits"`
	TotalInputTokens int64              `json:"totalInputTokens"`
	TotalOutputTokens int64             `json:"totalOutputTokens"`
	TotalCost        float64            `json:"totalCost"`
	Daily            map[string]ApiKeyDailyStats `json:"daily,omitempty"`
	ByModel          map[string]ApiKeyModelStats `json:"byModel,omitempty"`
}

// ApiKeyDailyStats holds per-day statistics for an API key.
type ApiKeyDailyStats struct {
	Requests     int64   `json:"requests"`
	Credits      float64 `json:"credits"`
	InputTokens  int64   `json:"inputTokens"`
	OutputTokens int64   `json:"outputTokens"`
	Cost         float64 `json:"cost"`
}

// ApiKeyModelStats holds per-model statistics for an API key.
type ApiKeyModelStats struct {
	Requests     int64   `json:"requests"`
	Credits      float64 `json:"credits"`
	InputTokens  int64   `json:"inputTokens"`
	OutputTokens int64   `json:"outputTokens"`
	Cost         float64 `json:"cost"`
}

// ApiKeyUsage records a single usage entry for auditing.
type ApiKeyUsage struct {
	Timestamp    int64   `json:"timestamp"`
	Model        string  `json:"model"`
	InputTokens  int64   `json:"inputTokens"`
	OutputTokens int64   `json:"outputTokens"`
	Credits      float64 `json:"credits"`
	Cost         float64 `json:"cost"`
	Path         string  `json:"path"`
}
