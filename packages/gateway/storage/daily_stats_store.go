package storage

import (
	"context"
	"fmt"
	"time"

	"github.com/kiro-gateway/gateway/model"
)

// TTL for daily stats: 7 days.
const dailyStatsTTL = 7 * 24 * time.Hour

// formatDate formats a time.Time to YYYY-MM-DD.
func formatDate(t time.Time) string {
	return t.Format("2006-01-02")
}

// --- Key builders matching TS backend patterns ---

func globalDailyKey(date string) string {
	return Key("stats", "daily", "global", date)
}

func accountDailyKey(accountID, date string) string {
	return Key("stats", "daily", "account", accountID, date)
}

func modelDailyKey(modelName, date string) string {
	return Key("stats", "daily", "model", modelName, date)
}

func apiKeyTotalStatsKey(keyID string) string {
	return Key("stats", "total", "apikey", keyID)
}

func apiKeyDailyStatsKey(keyID, date string) string {
	return Key("stats", "daily", "apikey", keyID, date)
}

// UpdateDailyGlobalStats increments global daily counters.
func UpdateDailyGlobalStats(
	ctx context.Context,
	success bool,
	inputTokens, outputTokens int,
	cost float64,
	cacheCreate, cacheRead int,
) error {
	rdb := GetClient()
	date := formatDate(time.Now())
	key := globalDailyKey(date)

	pipe := rdb.Pipeline()
	pipe.HIncrBy(ctx, key, "totalRequests", 1)
	if success {
		pipe.HIncrBy(ctx, key, "successRequests", 1)
	} else {
		pipe.HIncrBy(ctx, key, "failedRequests", 1)
	}
	pipe.HIncrBy(ctx, key, "inputTokens", int64(inputTokens))
	pipe.HIncrBy(ctx, key, "outputTokens", int64(outputTokens))
	pipe.HIncrBy(ctx, key, "totalTokens", int64(inputTokens+outputTokens+cacheCreate+cacheRead))
	pipe.HIncrByFloat(ctx, key, "totalCost", cost)
	pipe.HIncrBy(ctx, key, "cacheCreationTokens", int64(cacheCreate))
	pipe.HIncrBy(ctx, key, "cacheReadTokens", int64(cacheRead))
	pipe.Expire(ctx, key, dailyStatsTTL)

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("update daily global stats: %w", err)
	}
	return nil
}

// GetDailyGlobalStats retrieves global statistics for a specific date.
func GetDailyGlobalStats(ctx context.Context, date string) (*model.DailyGlobalStats, error) {
	rdb := GetClient()
	key := globalDailyKey(date)

	data, err := rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("get daily global stats: %w", err)
	}

	return &model.DailyGlobalStats{
		Date:                date,
		TotalRequests:       parseInt64(data["totalRequests"]),
		SuccessRequests:     parseInt64(data["successRequests"]),
		FailedRequests:      parseInt64(data["failedRequests"]),
		InputTokens:         parseInt64(data["inputTokens"]),
		OutputTokens:        parseInt64(data["outputTokens"]),
		TotalTokens:         parseInt64(data["totalTokens"]),
		TotalCost:           parseFloat64(data["totalCost"]),
		CacheCreationTokens: parseInt64(data["cacheCreationTokens"]),
		CacheReadTokens:     parseInt64(data["cacheReadTokens"]),
	}, nil
}

// UpdateDailyAccountStats increments per-account daily counters.
func UpdateDailyAccountStats(
	ctx context.Context,
	accountID string,
	success bool,
	inputTokens, outputTokens int,
	responseTime int64,
	cost float64,
) error {
	rdb := GetClient()
	date := formatDate(time.Now())
	key := accountDailyKey(accountID, date)

	pipe := rdb.Pipeline()
	pipe.HIncrBy(ctx, key, "requests", 1)
	if success {
		pipe.HIncrBy(ctx, key, "successRequests", 1)
	} else {
		pipe.HIncrBy(ctx, key, "failedRequests", 1)
	}
	pipe.HIncrBy(ctx, key, "inputTokens", int64(inputTokens))
	pipe.HIncrBy(ctx, key, "outputTokens", int64(outputTokens))
	pipe.HIncrBy(ctx, key, "totalTokens", int64(inputTokens+outputTokens))
	pipe.HIncrBy(ctx, key, "totalResponseTime", responseTime)
	pipe.HIncrByFloat(ctx, key, "totalCost", cost)
	pipe.Expire(ctx, key, dailyStatsTTL)

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("update daily account stats %s: %w", accountID, err)
	}
	return nil
}

// GetDailyAccountStats retrieves per-account statistics for a specific date.
func GetDailyAccountStats(
	ctx context.Context,
	accountID, date string,
) (*model.DailyAccountStats, error) {
	rdb := GetClient()
	key := accountDailyKey(accountID, date)

	data, err := rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("get daily account stats: %w", err)
	}

	requests := parseInt64(data["requests"])
	totalRT := parseInt64(data["totalResponseTime"])
	var avgRT float64
	if requests > 0 {
		avgRT = float64(totalRT) / float64(requests)
	}

	return &model.DailyAccountStats{
		Date:                date,
		AccountID:           accountID,
		Requests:            requests,
		SuccessRequests:     parseInt64(data["successRequests"]),
		FailedRequests:      parseInt64(data["failedRequests"]),
		InputTokens:         parseInt64(data["inputTokens"]),
		OutputTokens:        parseInt64(data["outputTokens"]),
		TotalTokens:         parseInt64(data["totalTokens"]),
		TotalResponseTime:   totalRT,
		AvgResponseTime:     avgRT,
		TotalCost:           parseFloat64(data["totalCost"]),
		CacheCreationTokens: parseInt64(data["cacheCreationTokens"]),
		CacheReadTokens:     parseInt64(data["cacheReadTokens"]),
	}, nil
}

// UpdateDailyModelStats increments per-model daily counters.
func UpdateDailyModelStats(
	ctx context.Context,
	modelName string,
	tokens int,
) error {
	rdb := GetClient()
	date := formatDate(time.Now())
	key := modelDailyKey(modelName, date)

	pipe := rdb.Pipeline()
	pipe.HIncrBy(ctx, key, "inputTokens", int64(tokens))
	pipe.HIncrBy(ctx, key, "totalTokens", int64(tokens))
	pipe.Expire(ctx, key, dailyStatsTTL)

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("update daily model stats %s: %w", modelName, err)
	}
	return nil
}

// GetDailyModelStats retrieves per-model statistics for a specific date.
func GetDailyModelStats(
	ctx context.Context,
	modelName, date string,
) (*model.DailyModelStats, error) {
	rdb := GetClient()
	key := modelDailyKey(modelName, date)

	data, err := rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("get daily model stats: %w", err)
	}

	return &model.DailyModelStats{
		Date:         date,
		Model:        modelName,
		InputTokens:  parseInt64(data["inputTokens"]),
		OutputTokens: parseInt64(data["outputTokens"]),
		TotalTokens:  parseInt64(data["totalTokens"]),
		TotalCost:    parseFloat64(data["totalCost"]),
	}, nil
}

// UpdateApiKeyTotalStats atomically increments total API key usage stats.
func UpdateApiKeyTotalStats(
	ctx context.Context,
	keyID string,
	credits float64,
	inputTokens, outputTokens int,
	cost float64,
) error {
	rdb := GetClient()
	key := apiKeyTotalStatsKey(keyID)

	pipe := rdb.Pipeline()
	pipe.HIncrByFloat(ctx, key, "credits", credits)
	pipe.HIncrBy(ctx, key, "inputTokens", int64(inputTokens))
	pipe.HIncrBy(ctx, key, "outputTokens", int64(outputTokens))
	pipe.HIncrByFloat(ctx, key, "cost", cost)

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("update apikey total stats %s: %w", keyID, err)
	}
	return nil
}

// GetApiKeyTotalStats retrieves total usage statistics for an API key.
func GetApiKeyTotalStats(ctx context.Context, keyID string) (*model.ApiKeyStats, error) {
	rdb := GetClient()
	key := apiKeyTotalStatsKey(keyID)

	data, err := rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("get apikey total stats %s: %w", keyID, err)
	}

	return &model.ApiKeyStats{
		TotalCredits:      parseFloat64(data["credits"]),
		TotalInputTokens:  parseInt64(data["inputTokens"]),
		TotalOutputTokens: parseInt64(data["outputTokens"]),
		TotalCost:         parseFloat64(data["cost"]),
	}, nil
}

// UpdateDailyApiKeyStats atomically increments daily API key usage stats.
func UpdateDailyApiKeyStats(
	ctx context.Context,
	keyID string,
	credits float64,
	inputTokens, outputTokens int,
	cost float64,
) error {
	rdb := GetClient()
	date := formatDate(time.Now())
	key := apiKeyDailyStatsKey(keyID, date)

	pipe := rdb.Pipeline()
	pipe.HIncrByFloat(ctx, key, "credits", credits)
	pipe.HIncrBy(ctx, key, "inputTokens", int64(inputTokens))
	pipe.HIncrBy(ctx, key, "outputTokens", int64(outputTokens))
	pipe.HIncrByFloat(ctx, key, "cost", cost)
	pipe.Expire(ctx, key, dailyStatsTTL)

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("update daily apikey stats %s: %w", keyID, err)
	}
	return nil
}

// GetDailyApiKeyStats retrieves daily usage statistics for an API key.
func GetDailyApiKeyStats(
	ctx context.Context,
	keyID, date string,
) (*model.ApiKeyStats, error) {
	rdb := GetClient()
	key := apiKeyDailyStatsKey(keyID, date)

	data, err := rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("get daily apikey stats %s: %w", keyID, err)
	}

	return &model.ApiKeyStats{
		TotalCredits:      parseFloat64(data["credits"]),
		TotalInputTokens:  parseInt64(data["inputTokens"]),
		TotalOutputTokens: parseInt64(data["outputTokens"]),
		TotalCost:         parseFloat64(data["cost"]),
	}, nil
}

