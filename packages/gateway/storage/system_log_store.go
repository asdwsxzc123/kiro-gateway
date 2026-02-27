package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/model"
)

// AddSystemLog appends a system log entry to the Redis Stream.
func AddSystemLog(ctx context.Context, entry *model.SystemLog) error {
	rdb := GetClient()

	if entry.ID == "" {
		entry.ID = uuid.New().String()
	}

	args := []interface{}{
		"id", entry.ID,
		"timestamp", strconv.FormatInt(entry.Timestamp, 10),
		"level", entry.Level,
		"category", entry.Category,
		"message", entry.Message,
	}

	if entry.Data != nil {
		b, err := json.Marshal(entry.Data)
		if err == nil {
			args = append(args, "data", string(b))
		}
	}

	streamKey := Key(systemLogsStream)
	if err := rdb.XAdd(ctx, &redis.XAddArgs{
		Stream: streamKey,
		ID:     "*",
		Values: args,
	}).Err(); err != nil {
		return fmt.Errorf("xadd system log: %w", err)
	}

	rdb.XTrimMaxLenApprox(ctx, streamKey, maxSystemLogs, 0)

	minID := strconv.FormatInt(nowMs()-logRetentionMs, 10)
	rdb.XTrimMinIDApprox(ctx, streamKey, minID, 0)

	return nil
}

// GetSystemLogs retrieves system logs with optional level and category filtering.
func GetSystemLogs(ctx context.Context, limit int, level, category string) ([]model.SystemLog, error) {
	rdb := GetClient()
	streamKey := Key(systemLogsStream)

	if limit <= 0 {
		limit = 100
	}

	// Fetch more entries to account for filtering.
	fetchCount := int64(limit * 2)
	entries, err := rdb.XRevRangeN(ctx, streamKey, "+", "-", fetchCount).Result()
	if err != nil {
		return nil, fmt.Errorf("xrevrange system logs: %w", err)
	}

	logs := make([]model.SystemLog, 0, limit)
	for _, msg := range entries {
		if len(logs) >= limit {
			break
		}

		vals := msg.Values
		entryLevel := strVal(vals["level"])
		entryCat := strVal(vals["category"])

		if level != "" && entryLevel != level {
			continue
		}
		if category != "" && entryCat != category {
			continue
		}

		sl := model.SystemLog{
			ID:        strVal(vals["id"]),
			Timestamp: parseInt64(strVal(vals["timestamp"])),
			Level:     entryLevel,
			Category:  entryCat,
			Message:   strVal(vals["message"]),
		}

		if dataStr := strVal(vals["data"]); dataStr != "" {
			var data map[string]interface{}
			if err := json.Unmarshal([]byte(dataStr), &data); err == nil {
				sl.Data = data
			}
		}

		logs = append(logs, sl)
	}

	return logs, nil
}

// ClearSystemLogs deletes the entire system logs stream.
func ClearSystemLogs(ctx context.Context) error {
	if err := GetClient().Del(ctx, Key(systemLogsStream)).Err(); err != nil {
		return fmt.Errorf("clear system logs: %w", err)
	}
	log.Info().Msg("System logs cleared")
	return nil
}

// GetSystemLogCount returns the number of entries in the system log stream.
func GetSystemLogCount(ctx context.Context) (int64, error) {
	return GetClient().XLen(ctx, Key(systemLogsStream)).Result()
}
