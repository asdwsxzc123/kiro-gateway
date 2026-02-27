package services

import (
	"context"
	"time"

	"github.com/kiro-gateway/gateway/model"
	"github.com/kiro-gateway/gateway/storage"
)

// GetRequestLogs returns paginated request logs based on the query parameters.
func GetRequestLogs(ctx context.Context, query *model.LogsQuery) ([]model.RequestLog, int64, error) {
	if query == nil {
		query = &model.LogsQuery{Limit: 100}
	}
	logs, total, err := storage.GetRequestLogs(ctx, *query)
	if err != nil {
		return nil, 0, err
	}
	return logs, total, nil
}

// GetSystemLogs returns system logs filtered by level and category.
func GetSystemLogs(ctx context.Context, limit int, level, category string) ([]model.SystemLog, error) {
	if limit <= 0 {
		limit = 100
	}
	return storage.GetSystemLogs(ctx, limit, level, category)
}

// AddSystemLog creates a new system log entry.
func AddSystemLog(ctx context.Context, level, category, message string, data map[string]interface{}) error {
	entry := &model.SystemLog{
		Timestamp: time.Now().UnixMilli(),
		Level:     level,
		Category:  category,
		Message:   message,
		Data:      data,
	}
	return storage.AddSystemLog(ctx, entry)
}

// ClearRequestLogs deletes all request log entries.
func ClearRequestLogs(ctx context.Context) error {
	return storage.ClearRequestLogs(ctx)
}

// ClearSystemLogs deletes all system log entries.
func ClearSystemLogs(ctx context.Context) error {
	return storage.ClearSystemLogs(ctx)
}

// GetLogStats returns the count of request logs and system logs.
func GetLogStats(ctx context.Context) (map[string]int64, error) {
	requestCount, err := storage.GetRequestLogCount(ctx)
	if err != nil {
		return nil, err
	}
	systemCount, err := storage.GetSystemLogCount(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]int64{
		"requestLogs": requestCount,
		"systemLogs":  systemCount,
	}, nil
}

// GetRecentErrors returns recent failed request log entries.
func GetRecentErrors(ctx context.Context, limit int) ([]model.RequestLog, error) {
	if limit <= 0 {
		limit = 20
	}

	// Fetch more entries than needed to filter for failures.
	query := model.LogsQuery{
		Limit: limit * 5,
	}
	logs, _, err := storage.GetRequestLogs(ctx, query)
	if err != nil {
		return nil, err
	}

	errors := make([]model.RequestLog, 0, limit)
	for _, entry := range logs {
		if !entry.Success {
			errors = append(errors, entry)
			if len(errors) >= limit {
				break
			}
		}
	}

	return errors, nil
}

// GetRequestLogSummary returns an aggregated summary of request logs within a time window.
func GetRequestLogSummary(ctx context.Context, hours int) (*model.LogsSummary, error) {
	if hours <= 0 {
		hours = 24
	}

	now := time.Now().UnixMilli()
	windowStart := now - int64(hours)*60*60*1000

	query := model.LogsQuery{
		StartTime: windowStart,
		EndTime:   now,
		Limit:     10000,
	}

	logs, _, err := storage.GetRequestLogs(ctx, query)
	if err != nil {
		return nil, err
	}

	summary := &model.LogsSummary{}
	var totalResponseTime int64

	for _, entry := range logs {
		summary.Total++
		if entry.Success {
			summary.Success++
		} else {
			summary.Failed++
		}
		totalResponseTime += entry.ResponseTime
	}

	if summary.Total > 0 {
		summary.AvgResponseTime = float64(totalResponseTime) / float64(summary.Total)
	}

	return summary, nil
}
