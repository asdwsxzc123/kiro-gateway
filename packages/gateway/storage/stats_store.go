package storage

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/model"
)

// Redis key constants for statistics storage.
const (
	globalStatsKey       = "stats:global"
	accountStatsPrefix   = "stats:account:"
	modelStatsPrefix     = "stats:model:"
)

// UpdateGlobalStats atomically increments global request statistics.
func UpdateGlobalStats(
	ctx context.Context,
	success bool,
	inputTokens, outputTokens int,
	credits, cost float64,
	cacheCreate, cacheRead int,
) error {
	rdb := GetClient()
	key := Key(globalStatsKey)

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
	pipe.HIncrByFloat(ctx, key, "totalCredits", credits)
	pipe.HIncrByFloat(ctx, key, "totalCost", cost)
	pipe.HIncrBy(ctx, key, "cacheCreationTokens", int64(cacheCreate))
	pipe.HIncrBy(ctx, key, "cacheReadTokens", int64(cacheRead))

	// Set startTime only if it does not exist yet.
	pipe.HSetNX(ctx, key, "startTime", strconv.FormatInt(time.Now().UnixMilli(), 10))

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("update global stats: %w", err)
	}
	return nil
}

// GetGlobalStats retrieves the current global statistics.
func GetGlobalStats(ctx context.Context) (*model.ProxyStats, error) {
	rdb := GetClient()

	data, err := rdb.HGetAll(ctx, Key(globalStatsKey)).Result()
	if err != nil {
		return nil, fmt.Errorf("get global stats: %w", err)
	}

	stats := &model.ProxyStats{
		TotalRequests:       parseInt64(data["totalRequests"]),
		SuccessRequests:     parseInt64(data["successRequests"]),
		FailedRequests:      parseInt64(data["failedRequests"]),
		TotalTokens:         parseInt64(data["totalTokens"]),
		TotalCredits:        parseFloat64(data["totalCredits"]),
		InputTokens:         parseInt64(data["inputTokens"]),
		OutputTokens:        parseInt64(data["outputTokens"]),
		TotalCost:           parseFloat64(data["totalCost"]),
		CacheCreationTokens: parseInt64(data["cacheCreationTokens"]),
		CacheReadTokens:     parseInt64(data["cacheReadTokens"]),
		StartTime:           parseInt64(data["startTime"]),
	}

	if stats.StartTime == 0 {
		stats.StartTime = time.Now().UnixMilli()
	}

	return stats, nil
}

// UpdateAccountStats atomically increments per-account statistics.
func UpdateAccountStats(
	ctx context.Context,
	accountID string,
	success bool,
	inputTokens, outputTokens int,
	responseTime int64,
	cost float64,
) error {
	rdb := GetClient()
	key := Key(accountStatsPrefix + accountID)

	pipe := rdb.Pipeline()
	pipe.HIncrBy(ctx, key, "requests", 1)
	pipe.HIncrBy(ctx, key, "inputTokens", int64(inputTokens))
	pipe.HIncrBy(ctx, key, "outputTokens", int64(outputTokens))
	pipe.HIncrBy(ctx, key, "tokens", int64(inputTokens+outputTokens))
	pipe.HIncrBy(ctx, key, "totalResponseTime", responseTime)
	pipe.HSet(ctx, key, "lastUsed", strconv.FormatInt(time.Now().UnixMilli(), 10))
	pipe.HIncrByFloat(ctx, key, "totalCost", cost)

	if !success {
		pipe.HIncrBy(ctx, key, "errors", 1)
	}

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("update account stats %s: %w", accountID, err)
	}
	return nil
}

// GetAccountStats retrieves statistics for a single account.
func GetAccountStats(ctx context.Context, accountID string) (*model.AccountStats, error) {
	rdb := GetClient()

	data, err := rdb.HGetAll(ctx, Key(accountStatsPrefix+accountID)).Result()
	if err != nil {
		return nil, fmt.Errorf("get account stats %s: %w", accountID, err)
	}

	requests := parseInt64(data["requests"])
	totalRT := parseFloat64(data["totalResponseTime"])

	var avgRT float64
	if requests > 0 {
		avgRT = totalRT / float64(requests)
	}

	return &model.AccountStats{
		Requests:          requests,
		Tokens:            parseInt64(data["tokens"]),
		InputTokens:       parseInt64(data["inputTokens"]),
		OutputTokens:      parseInt64(data["outputTokens"]),
		Errors:            parseInt64(data["errors"]),
		LastUsed:          parseInt64(data["lastUsed"]),
		AvgResponseTime:   avgRT,
		TotalResponseTime: totalRT,
		TotalCost:         parseFloat64(data["totalCost"]),
	}, nil
}

// GetAllAccountStats retrieves statistics for all accounts.
// Uses SCAN to find all account stat keys (avoids blocking KEYS in production).
func GetAllAccountStats(ctx context.Context) (map[string]*model.AccountStats, error) {
	rdb := GetClient()

	pattern := Key(accountStatsPrefix + "*")
	keys, err := scanKeys(ctx, rdb, pattern)
	if err != nil {
		return nil, fmt.Errorf("scan account stats keys: %w", err)
	}

	result := make(map[string]*model.AccountStats, len(keys))
	prefix := Key(accountStatsPrefix)

	for _, k := range keys {
		accountID := strings.TrimPrefix(k, prefix)
		stats, err := GetAccountStats(ctx, accountID)
		if err != nil {
			log.Warn().Err(err).Str("accountId", accountID).Msg("Skip account stats")
			continue
		}
		result[accountID] = stats
	}

	return result, nil
}

// UpdateModelStats atomically increments per-model statistics.
func UpdateModelStats(ctx context.Context, modelID string, tokens int) error {
	rdb := GetClient()
	key := Key(modelStatsPrefix + modelID)

	pipe := rdb.Pipeline()
	pipe.HIncrBy(ctx, key, "requests", 1)
	pipe.HIncrBy(ctx, key, "tokens", int64(tokens))

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("update model stats %s: %w", modelID, err)
	}
	return nil
}

// GetModelStats retrieves statistics for a single model.
func GetModelStats(ctx context.Context, modelID string) (*model.ModelStats, error) {
	rdb := GetClient()

	data, err := rdb.HGetAll(ctx, Key(modelStatsPrefix+modelID)).Result()
	if err != nil {
		return nil, fmt.Errorf("get model stats %s: %w", modelID, err)
	}

	return &model.ModelStats{
		Model:    modelID,
		Requests: parseInt64(data["requests"]),
		Tokens:   parseInt64(data["tokens"]),
	}, nil
}

// GetAllModelStats retrieves statistics for all models.
func GetAllModelStats(ctx context.Context) ([]model.ModelStats, error) {
	rdb := GetClient()

	pattern := Key(modelStatsPrefix + "*")
	keys, err := scanKeys(ctx, rdb, pattern)
	if err != nil {
		return nil, fmt.Errorf("scan model stats keys: %w", err)
	}

	prefix := Key(modelStatsPrefix)
	result := make([]model.ModelStats, 0, len(keys))

	for _, k := range keys {
		modelID := strings.TrimPrefix(k, prefix)
		stats, err := GetModelStats(ctx, modelID)
		if err != nil {
			log.Warn().Err(err).Str("model", modelID).Msg("Skip model stats")
			continue
		}
		result = append(result, *stats)
	}

	return result, nil
}

// ResetAllStats deletes all global, account, and model statistics.
func ResetAllStats(ctx context.Context) error {
	rdb := GetClient()

	// Delete global stats.
	rdb.Del(ctx, Key(globalStatsKey))

	// Delete all account stats.
	accountKeys, _ := scanKeys(ctx, rdb, Key(accountStatsPrefix+"*"))
	if len(accountKeys) > 0 {
		rdb.Del(ctx, accountKeys...)
	}

	// Delete all model stats.
	modelKeys, _ := scanKeys(ctx, rdb, Key(modelStatsPrefix+"*"))
	if len(modelKeys) > 0 {
		rdb.Del(ctx, modelKeys...)
	}

	log.Info().Msg("All stats reset")
	return nil
}

// scanKeys performs an incremental SCAN for keys matching the given pattern.
func scanKeys(ctx context.Context, rdb *redis.Client, pattern string) ([]string, error) {
	var allKeys []string
	var cursor uint64

	for {
		keys, nextCursor, err := rdb.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return allKeys, err
		}
		allKeys = append(allKeys, keys...)
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	return allKeys, nil
}
