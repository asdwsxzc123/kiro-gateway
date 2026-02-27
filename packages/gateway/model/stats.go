package model

// ProxyStats holds the global cumulative proxy statistics.
type ProxyStats struct {
	TotalRequests       int64   `json:"totalRequests"`
	SuccessRequests     int64   `json:"successRequests"`
	FailedRequests      int64   `json:"failedRequests"`
	TotalTokens         int64   `json:"totalTokens"`
	TotalCredits        float64 `json:"totalCredits"`
	InputTokens         int64   `json:"inputTokens"`
	OutputTokens        int64   `json:"outputTokens"`
	TotalCost           float64 `json:"totalCost"`
	CacheCreationTokens int64   `json:"cacheCreationTokens"`
	CacheReadTokens     int64   `json:"cacheReadTokens"`
	StartTime           int64   `json:"startTime"`
}

// AccountStats holds per-account usage statistics.
type AccountStats struct {
	Requests          int64   `json:"requests"`
	Tokens            int64   `json:"tokens"`
	InputTokens       int64   `json:"inputTokens"`
	OutputTokens      int64   `json:"outputTokens"`
	Errors            int64   `json:"errors"`
	LastUsed          int64   `json:"lastUsed"`
	AvgResponseTime   float64 `json:"avgResponseTime"`
	TotalResponseTime float64 `json:"totalResponseTime"`
	TotalCost         float64 `json:"totalCost"`
}

// ModelStats holds per-model usage statistics.
type ModelStats struct {
	Model    string `json:"model"`
	Requests int64  `json:"requests"`
	Tokens   int64  `json:"tokens"`
}

// DailyGlobalStats holds aggregated statistics for a single day.
type DailyGlobalStats struct {
	Date                string  `json:"date"`
	TotalRequests       int64   `json:"totalRequests"`
	SuccessRequests     int64   `json:"successRequests"`
	FailedRequests      int64   `json:"failedRequests"`
	TotalTokens         int64   `json:"totalTokens"`
	InputTokens         int64   `json:"inputTokens"`
	OutputTokens        int64   `json:"outputTokens"`
	TotalCost           float64 `json:"totalCost"`
	CacheCreationTokens int64   `json:"cacheCreationTokens"`
	CacheReadTokens     int64   `json:"cacheReadTokens"`
}

// DailyAccountStats holds per-account statistics for a single day.
type DailyAccountStats struct {
	Date                string  `json:"date"`
	AccountID           string  `json:"accountId"`
	Requests            int64   `json:"requests"`
	SuccessRequests     int64   `json:"successRequests"`
	FailedRequests      int64   `json:"failedRequests"`
	InputTokens         int64   `json:"inputTokens"`
	OutputTokens        int64   `json:"outputTokens"`
	TotalTokens         int64   `json:"totalTokens"`
	TotalResponseTime   int64   `json:"totalResponseTime"`
	AvgResponseTime     float64 `json:"avgResponseTime"`
	TotalCost           float64 `json:"totalCost"`
	CacheCreationTokens int64   `json:"cacheCreationTokens"`
	CacheReadTokens     int64   `json:"cacheReadTokens"`
}

// DailyModelStats holds per-model statistics for a single day.
type DailyModelStats struct {
	Date         string  `json:"date"`
	Model        string  `json:"model"`
	InputTokens  int64   `json:"inputTokens"`
	OutputTokens int64   `json:"outputTokens"`
	TotalTokens  int64   `json:"totalTokens"`
	TotalCost    float64 `json:"totalCost"`
}

// DailyApiKeyStats holds per-API-key statistics for a single day.
type DailyApiKeyStats struct {
	Date            string  `json:"date"`
	ApiKeyID        string  `json:"apiKeyId"`
	Requests        int64   `json:"requests"`
	SuccessRequests int64   `json:"successRequests"`
	FailedRequests  int64   `json:"failedRequests"`
	Tokens          int64   `json:"tokens"`
	InputTokens     int64   `json:"inputTokens"`
	OutputTokens    int64   `json:"outputTokens"`
	Cost            float64 `json:"cost"`
}

// StatsOverview is the top-level stats summary returned by the stats API.
type StatsOverview struct {
	Global   ProxyStats          `json:"global"`
	Accounts StatsAccountSummary `json:"accounts"`
	Uptime   int64               `json:"uptime"`
}

// StatsAccountSummary provides a summary count of accounts.
type StatsAccountSummary struct {
	Total     int `json:"total"`
	Available int `json:"available"`
}

// CostRanking represents a ranked entry in a cost leaderboard.
type CostRanking struct {
	Rank         int     `json:"rank"`
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Type         string  `json:"type"` // "account", "apiKey", or "model"
	TotalCost    float64 `json:"totalCost"`
	RequestCount int64   `json:"requestCount"`
	TokenCount   int64   `json:"tokenCount"`
	Percentage   float64 `json:"percentage"`
}

// RequestLog records a single proxy request for auditing and analytics.
type RequestLog struct {
	ID                  string  `json:"id,omitempty"`
	Timestamp           int64   `json:"timestamp"`
	Path                string  `json:"path"`
	Model               string  `json:"model"`
	AccountID           string  `json:"accountId"`
	MachineID           string  `json:"machineId,omitempty"`
	InputTokens         int64   `json:"inputTokens"`
	OutputTokens        int64   `json:"outputTokens"`
	Credits             float64 `json:"credits,omitempty"`
	KiroCredits         float64 `json:"kiroCredits,omitempty"`
	CacheCreationTokens int64   `json:"cacheCreationTokens,omitempty"`
	CacheReadTokens     int64   `json:"cacheReadTokens,omitempty"`
	Cost                float64 `json:"cost,omitempty"`
	ResponseTime        int64   `json:"responseTime"`
	Success             bool    `json:"success"`
	Error               string  `json:"error,omitempty"`
	Auxiliary           bool    `json:"auxiliary,omitempty"`
	UserInput           string  `json:"userInput,omitempty"`
}

// SystemLog records a system-level log entry.
type SystemLog struct {
	ID        string                 `json:"id,omitempty"`
	Timestamp int64                  `json:"timestamp"`
	Level     string                 `json:"level"`    // debug, info, warn, error
	Category  string                 `json:"category"`
	Message   string                 `json:"message"`
	Data      map[string]interface{} `json:"data,omitempty"`
}

// LogsQuery contains parameters for querying logs.
type LogsQuery struct {
	Limit     int    `json:"limit,omitempty"`
	Offset    int    `json:"offset,omitempty"`
	StartTime int64  `json:"startTime,omitempty"`
	EndTime   int64  `json:"endTime,omitempty"`
	Model     string `json:"model,omitempty"`
}

// LogsSummary provides an aggregated summary of request logs.
type LogsSummary struct {
	Total           int64   `json:"total"`
	Success         int64   `json:"success"`
	Failed          int64   `json:"failed"`
	AvgResponseTime float64 `json:"avgResponseTime"`
}
