package storage

import (
	"context"
	"fmt"
	"strconv"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/model"
)

// Redis Stream keys for log storage.
const (
	requestLogsStream = "logs:requests"
	systemLogsStream  = "logs:system"

	maxRequestLogs = 100000
	maxSystemLogs  = 50000

	// 7-day retention in milliseconds.
	logRetentionMs = 7 * 24 * 60 * 60 * 1000
)

// AddRequestLog appends a request log entry to the Redis Stream.
func AddRequestLog(ctx context.Context, entry *model.RequestLog) error {
	rdb := GetClient()

	if entry.ID == "" {
		entry.ID = uuid.New().String()
	}

	args := []interface{}{
		"id", entry.ID,
		"timestamp", strconv.FormatInt(entry.Timestamp, 10),
		"path", entry.Path,
		"model", entry.Model,
		"accountId", entry.AccountID,
		"inputTokens", strconv.FormatInt(entry.InputTokens, 10),
		"outputTokens", strconv.FormatInt(entry.OutputTokens, 10),
		"responseTime", strconv.FormatInt(entry.ResponseTime, 10),
		"success", boolToStr(entry.Success),
	}

	if entry.MachineID != "" {
		args = append(args, "machineId", entry.MachineID)
	}
	if entry.Credits != 0 {
		args = append(args, "credits", strconv.FormatFloat(entry.Credits, 'f', -1, 64))
	}
	if entry.Error != "" {
		args = append(args, "error", entry.Error)
	}
	if entry.CacheCreationTokens != 0 {
		args = append(args, "cacheCreationTokens", strconv.FormatInt(entry.CacheCreationTokens, 10))
	}
	if entry.CacheReadTokens != 0 {
		args = append(args, "cacheReadTokens", strconv.FormatInt(entry.CacheReadTokens, 10))
	}
	if entry.Cost != 0 {
		args = append(args, "cost", strconv.FormatFloat(entry.Cost, 'f', -1, 64))
	}
	if entry.KiroCredits != 0 {
		args = append(args, "kiroCredits", strconv.FormatFloat(entry.KiroCredits, 'f', -1, 64))
	}
	if entry.Auxiliary {
		args = append(args, "auxiliary", "true")
	}
	if entry.UserInput != "" {
		input := entry.UserInput
		if len(input) > 500 {
			input = input[:500] + "..."
		}
		args = append(args, "userInput", input)
	}

	streamKey := Key(requestLogsStream)
	if err := rdb.XAdd(ctx, &redis.XAddArgs{
		Stream: streamKey,
		ID:     "*",
		Values: args,
	}).Err(); err != nil {
		return fmt.Errorf("xadd request log: %w", err)
	}

	// Trim by count.
	rdb.XTrimMaxLenApprox(ctx, streamKey, maxRequestLogs, 0)

	// Trim by age (MINID).
	minID := strconv.FormatInt(nowMs()-logRetentionMs, 10)
	rdb.XTrimMinIDApprox(ctx, streamKey, minID, 0)

	return nil
}

// GetRequestLogs retrieves request logs with optional filtering and pagination.
func GetRequestLogs(ctx context.Context, query model.LogsQuery) ([]model.RequestLog, int64, error) {
	rdb := GetClient()
	streamKey := Key(requestLogsStream)

	limit := query.Limit
	if limit <= 0 {
		limit = 100
	}
	offset := query.Offset

	// XREVRANGE uses start=high end=low.
	start := "+"
	end := "-"
	if query.EndTime > 0 {
		start = strconv.FormatInt(query.EndTime, 10)
	}
	if query.StartTime > 0 {
		end = strconv.FormatInt(query.StartTime, 10)
	}

	// Fetch extra entries if filtering by model.
	fetchCount := int64(offset + limit)
	if query.Model != "" {
		fetchCount *= 10
	}

	entries, err := rdb.XRevRangeN(ctx, streamKey, start, end, fetchCount).Result()
	if err != nil {
		return nil, 0, fmt.Errorf("xrevrange request logs: %w", err)
	}

	allLogs := make([]model.RequestLog, 0, len(entries))
	for _, msg := range entries {
		rl := parseRequestLog(msg.Values)
		allLogs = append(allLogs, rl)
	}

	// Apply model filter.
	var filtered []model.RequestLog
	if query.Model != "" {
		for _, rl := range allLogs {
			if rl.Model == query.Model {
				filtered = append(filtered, rl)
			}
		}
	} else {
		filtered = allLogs
	}

	// Calculate total.
	var total int64
	if query.Model != "" {
		total = int64(len(filtered))
	} else {
		total, _ = rdb.XLen(ctx, streamKey).Result()
	}

	// Apply pagination.
	if offset >= len(filtered) {
		return []model.RequestLog{}, total, nil
	}
	endIdx := offset + limit
	if endIdx > len(filtered) {
		endIdx = len(filtered)
	}

	return filtered[offset:endIdx], total, nil
}

// parseRequestLog converts a Redis Stream message values map to a RequestLog.
func parseRequestLog(vals map[string]interface{}) model.RequestLog {
	rl := model.RequestLog{
		ID:           strVal(vals["id"]),
		Timestamp:    parseInt64(strVal(vals["timestamp"])),
		Path:         strVal(vals["path"]),
		Model:        strVal(vals["model"]),
		AccountID:    strVal(vals["accountId"]),
		MachineID:    strVal(vals["machineId"]),
		InputTokens:  parseInt64(strVal(vals["inputTokens"])),
		OutputTokens: parseInt64(strVal(vals["outputTokens"])),
		ResponseTime: parseInt64(strVal(vals["responseTime"])),
		Success:      strVal(vals["success"]) == "true",
		Error:        strVal(vals["error"]),
		UserInput:    strVal(vals["userInput"]),
	}

	if v := strVal(vals["credits"]); v != "" {
		rl.Credits = parseFloat64(v)
	}
	if v := strVal(vals["kiroCredits"]); v != "" {
		rl.KiroCredits = parseFloat64(v)
	}
	if v := strVal(vals["cacheCreationTokens"]); v != "" {
		rl.CacheCreationTokens = parseInt64(v)
	}
	if v := strVal(vals["cacheReadTokens"]); v != "" {
		rl.CacheReadTokens = parseInt64(v)
	}
	if v := strVal(vals["cost"]); v != "" {
		rl.Cost = parseFloat64(v)
	}
	if strVal(vals["auxiliary"]) == "true" {
		rl.Auxiliary = true
	}

	return rl
}

// ClearRequestLogs deletes the entire request logs stream.
func ClearRequestLogs(ctx context.Context) error {
	if err := GetClient().Del(ctx, Key(requestLogsStream)).Err(); err != nil {
		return fmt.Errorf("clear request logs: %w", err)
	}
	log.Info().Msg("Request logs cleared")
	return nil
}

// GetRequestLogCount returns the number of entries in the request log stream.
func GetRequestLogCount(ctx context.Context) (int64, error) {
	return GetClient().XLen(ctx, Key(requestLogsStream)).Result()
}

