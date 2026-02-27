package services

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/model"
	"github.com/kiro-gateway/gateway/storage"
)

// GetStatsOverview returns a high-level summary of gateway statistics.
func GetStatsOverview(ctx context.Context) (*model.StatsOverview, error) {
	global, err := storage.GetGlobalStats(ctx)
	if err != nil {
		return nil, fmt.Errorf("get global stats: %w", err)
	}

	totalCount, err := storage.GetAccountCount(ctx)
	if err != nil {
		return nil, fmt.Errorf("get account count: %w", err)
	}

	available, err := storage.GetAvailableAccounts(ctx)
	if err != nil {
		return nil, fmt.Errorf("get available accounts: %w", err)
	}

	var uptime int64
	if global.StartTime > 0 {
		uptime = time.Now().UnixMilli() - global.StartTime
	}

	return &model.StatsOverview{
		Global: *global,
		Accounts: model.StatsAccountSummary{
			Total:     int(totalCount),
			Available: len(available),
		},
		Uptime: uptime,
	}, nil
}

// GetGlobalStats returns the cumulative global proxy statistics.
func GetGlobalStats(ctx context.Context) (*model.ProxyStats, error) {
	return storage.GetGlobalStats(ctx)
}

// GetAllAccountStats returns per-account statistics for all accounts.
func GetAllAccountStats(ctx context.Context) (map[string]*model.AccountStats, error) {
	return storage.GetAllAccountStats(ctx)
}

// GetAccountStatsById returns statistics for a single account.
func GetAccountStatsById(ctx context.Context, id string) (*model.AccountStats, error) {
	return storage.GetAccountStats(ctx, id)
}

// GetModelStats returns per-model usage statistics.
func GetModelStats(ctx context.Context) ([]model.ModelStats, error) {
	return storage.GetAllModelStats(ctx)
}

// GetDetailedReport aggregates global, account, model, and daily stats into a report.
func GetDetailedReport(ctx context.Context) (map[string]interface{}, error) {
	global, err := storage.GetGlobalStats(ctx)
	if err != nil {
		return nil, fmt.Errorf("get global stats for report: %w", err)
	}

	accountStats, err := storage.GetAllAccountStats(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to get account stats for report")
		accountStats = make(map[string]*model.AccountStats)
	}

	modelStats, err := storage.GetAllModelStats(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to get model stats for report")
		modelStats = []model.ModelStats{}
	}

	today := time.Now().Format("2006-01-02")
	dailyGlobal, err := storage.GetDailyGlobalStats(ctx, today)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to get daily global stats for report")
		dailyGlobal = &model.DailyGlobalStats{Date: today}
	}

	totalCount, _ := storage.GetAccountCount(ctx)
	available, _ := storage.GetAvailableAccounts(ctx)

	var uptime int64
	if global.StartTime > 0 {
		uptime = time.Now().UnixMilli() - global.StartTime
	}

	return map[string]interface{}{
		"global":       global,
		"accountStats": accountStats,
		"modelStats":   modelStats,
		"dailyGlobal":  dailyGlobal,
		"accounts": map[string]interface{}{
			"total":     totalCount,
			"available": len(available),
		},
		"uptime":    uptime,
		"timestamp": time.Now().UnixMilli(),
	}, nil
}

// GetTodayGlobalCost returns the total cost for today.
func GetTodayGlobalCost(ctx context.Context) (float64, error) {
	today := time.Now().Format("2006-01-02")
	stats, err := storage.GetDailyGlobalStats(ctx, today)
	if err != nil {
		return 0, fmt.Errorf("get today global cost: %w", err)
	}
	return stats.TotalCost, nil
}

// GetGlobalDailyCosts returns daily global statistics for a date range.
func GetGlobalDailyCosts(ctx context.Context, startDate, endDate string) ([]model.DailyGlobalStats, error) {
	start, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		return nil, fmt.Errorf("parse start date: %w", err)
	}
	end, err := time.Parse("2006-01-02", endDate)
	if err != nil {
		return nil, fmt.Errorf("parse end date: %w", err)
	}

	if end.Before(start) {
		return nil, fmt.Errorf("end date must be after start date")
	}

	var results []model.DailyGlobalStats
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		dateStr := d.Format("2006-01-02")
		stats, err := storage.GetDailyGlobalStats(ctx, dateStr)
		if err != nil {
			log.Warn().Err(err).Str("date", dateStr).Msg("Failed to get daily stats")
			results = append(results, model.DailyGlobalStats{Date: dateStr})
			continue
		}
		results = append(results, *stats)
	}

	return results, nil
}

// ResetAllStats clears all stored statistics.
func ResetAllStats(ctx context.Context) error {
	return storage.ResetAllStats(ctx)
}

// RecordRequestStats records statistics for a completed request.
// This is typically called asynchronously via a goroutine.
func RecordRequestStats(ctx context.Context, entry *model.RequestLog) error {
	success := entry.Success
	inputTokens := int(entry.InputTokens)
	outputTokens := int(entry.OutputTokens)
	cost := entry.Cost
	cacheCreate := int(entry.CacheCreationTokens)
	cacheRead := int(entry.CacheReadTokens)
	totalTokens := inputTokens + outputTokens + cacheCreate + cacheRead

	// Update global stats.
	if err := storage.UpdateGlobalStats(
		ctx, success, inputTokens, outputTokens,
		entry.Credits, cost, cacheCreate, cacheRead,
	); err != nil {
		log.Error().Err(err).Msg("Failed to update global stats")
	}

	// Update account stats.
	if entry.AccountID != "" {
		if err := storage.UpdateAccountStats(
			ctx, entry.AccountID, success,
			inputTokens, outputTokens,
			entry.ResponseTime, cost,
		); err != nil {
			log.Error().Err(err).Msg("Failed to update account stats")
		}
	}

	// Update model stats.
	if entry.Model != "" {
		if err := storage.UpdateModelStats(ctx, entry.Model, totalTokens); err != nil {
			log.Error().Err(err).Msg("Failed to update model stats")
		}
	}

	// Update daily global stats.
	if err := storage.UpdateDailyGlobalStats(
		ctx, success, inputTokens, outputTokens,
		cost, cacheCreate, cacheRead,
	); err != nil {
		log.Error().Err(err).Msg("Failed to update daily global stats")
	}

	// Update daily account stats.
	if entry.AccountID != "" {
		if err := storage.UpdateDailyAccountStats(
			ctx, entry.AccountID, success,
			inputTokens, outputTokens,
			entry.ResponseTime, cost,
		); err != nil {
			log.Error().Err(err).Msg("Failed to update daily account stats")
		}
	}

	// Update daily model stats.
	if entry.Model != "" {
		if err := storage.UpdateDailyModelStats(ctx, entry.Model, totalTokens); err != nil {
			log.Error().Err(err).Msg("Failed to update daily model stats")
		}
	}

	// Add request log entry.
	if err := storage.AddRequestLog(ctx, entry); err != nil {
		log.Error().Err(err).Msg("Failed to add request log")
	}

	return nil
}
