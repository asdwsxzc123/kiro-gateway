package routes

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/core"
	"github.com/kiro-gateway/gateway/model"
	"github.com/kiro-gateway/gateway/storage"
	"github.com/kiro-gateway/gateway/util"
)

// RegisterStatsRoutes registers the /stats/* analytics endpoints.
func RegisterStatsRoutes(group *gin.RouterGroup, ps *core.ProxyServer) {
	stats := group.Group("/stats")
	{
		stats.GET("", handleStatsOverview)
		stats.GET("/global", handleGlobalStats)
		stats.GET("/accounts", handleAllAccountStats)
		stats.GET("/accounts/:id", handleSingleAccountStats)
		stats.GET("/models", handleModelStats)
		stats.GET("/concurrency", handleConcurrencyStatus(ps))
		stats.GET("/report", handleStatsReport(ps))
		stats.POST("/reset", handleResetStats)
		stats.GET("/daily/global", handleDailyGlobalStats)
		stats.GET("/today/cost", handleTodayCost)
		stats.GET("/cache", handleCacheStats)
		// Extra stats endpoints (Fix 21-28).
		RegisterStatsExtraRoutes(stats, ps)
	}
}

func handleStatsOverview(c *gin.Context) {
	ctx := context.Background()
	global, err := storage.GetGlobalStats(ctx)
	if err != nil {
		log.Error().Err(err).Msg("Failed to get global stats")
		util.ServerError(c, "Failed to retrieve stats")
		return
	}

	allAccounts, _ := storage.GetAllAccounts(ctx)
	availableAccounts, _ := storage.GetAvailableAccounts(ctx)

	uptime := int64(0)
	if global.StartTime > 0 {
		uptime = time.Now().UnixMilli() - global.StartTime
	}

	cacheHitRate := float64(0)
	totalCacheTokens := global.CacheCreationTokens + global.CacheReadTokens
	if totalCacheTokens > 0 {
		cacheHitRate = float64(global.CacheReadTokens) / float64(totalCacheTokens) * 100
	}

	util.SuccessJSON(c, gin.H{
		"global": global,
		"accounts": gin.H{
			"total":     len(allAccounts),
			"available": len(availableAccounts),
		},
		"uptime": uptime,
		"cache": gin.H{
			"cacheCreationTokens": global.CacheCreationTokens,
			"cacheReadTokens":     global.CacheReadTokens,
			"cacheHitRate":        cacheHitRate,
		},
	})
}

func handleGlobalStats(c *gin.Context) {
	ctx := context.Background()
	stats, err := storage.GetGlobalStats(ctx)
	if err != nil {
		util.ServerError(c, "Failed to get global stats")
		return
	}
	util.SuccessJSON(c, stats)
}

func handleAllAccountStats(c *gin.Context) {
	ctx := context.Background()
	stats, err := storage.GetAllAccountStats(ctx)
	if err != nil {
		util.ServerError(c, "Failed to get account stats")
		return
	}
	util.SuccessJSON(c, stats)
}

func handleSingleAccountStats(c *gin.Context) {
	id := c.Param("id")
	ctx := context.Background()
	stats, err := storage.GetAccountStats(ctx, id)
	if err != nil {
		util.ServerError(c, "Failed to get account stats")
		return
	}
	util.SuccessJSON(c, stats)
}

func handleModelStats(c *gin.Context) {
	ctx := context.Background()
	stats, err := storage.GetAllModelStats(ctx)
	if err != nil {
		util.ServerError(c, "Failed to get model stats")
		return
	}
	util.SuccessJSON(c, stats)
}

func handleConcurrencyStatus(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := ps.GetConcurrencyStatus()

		// Transform to frontend-expected format.
		var accountList []gin.H
		if accts, ok := raw["accounts"]; ok {
			if acctMap, ok := accts.(map[string]int32); ok {
				for id, conc := range acctMap {
					accountList = append(accountList, gin.H{
						"accountId":   id,
						"concurrency": conc,
					})
				}
			}
		}
		if accountList == nil {
			accountList = []gin.H{}
		}

		total, _ := raw["total"].(int32)
		queueSize, _ := raw["queueSize"].(int)
		queueMax, _ := raw["queueMax"].(int)

		util.SuccessJSON(c, gin.H{
			"queue": gin.H{
				"active":        total,
				"queued":        queueSize,
				"maxConcurrent": queueMax,
			},
			"accounts": accountList,
		})
	}
}

func handleStatsReport(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := context.Background()

		global, _ := storage.GetGlobalStats(ctx)
		accountStats, _ := storage.GetAllAccountStats(ctx)
		modelStats, _ := storage.GetAllModelStats(ctx)
		allAccounts, _ := storage.GetAllAccounts(ctx)
		availableAccounts, _ := storage.GetAvailableAccounts(ctx)
		concurrency := ps.GetConcurrencyStatus()

		uptime := int64(0)
		if global != nil && global.StartTime > 0 {
			uptime = time.Now().UnixMilli() - global.StartTime
		}

		util.SuccessJSON(c, gin.H{
			"global":      global,
			"accounts":    accountStats,
			"models":      modelStats,
			"concurrency": concurrency,
			"summary": gin.H{
				"totalAccounts":     len(allAccounts),
				"availableAccounts": len(availableAccounts),
				"uptime":            uptime,
			},
		})
	}
}

func handleResetStats(c *gin.Context) {
	ctx := context.Background()
	if err := storage.ResetAllStats(ctx); err != nil {
		util.ServerError(c, "Failed to reset stats")
		return
	}
	util.SuccessJSON(c, gin.H{"message": "All stats have been reset"})
}

func handleDailyGlobalStats(c *gin.Context) {
	ctx := context.Background()
	startDate := c.Query("startDate")
	endDate := c.Query("endDate")

	if startDate == "" {
		startDate = time.Now().AddDate(0, 0, -7).Format("2006-01-02")
	}
	if endDate == "" {
		endDate = time.Now().Format("2006-01-02")
	}

	start, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		util.ValidationError(c, "Invalid startDate format, expected YYYY-MM-DD")
		return
	}
	end, err := time.Parse("2006-01-02", endDate)
	if err != nil {
		util.ValidationError(c, "Invalid endDate format, expected YYYY-MM-DD")
		return
	}

	var results []*model.DailyGlobalStats
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		dateStr := d.Format("2006-01-02")
		stats, err := storage.GetDailyGlobalStats(ctx, dateStr)
		if err != nil {
			log.Warn().Err(err).Str("date", dateStr).Msg("Failed to get daily stats")
			continue
		}
		results = append(results, stats)
	}
	if results == nil {
		results = []*model.DailyGlobalStats{}
	}

	util.SuccessJSON(c, results)
}

func handleTodayCost(c *gin.Context) {
	ctx := context.Background()
	today := time.Now().Format("2006-01-02")
	stats, err := storage.GetDailyGlobalStats(ctx, today)
	if err != nil {
		util.ServerError(c, "Failed to get today's cost")
		return
	}

	util.SuccessJSON(c, gin.H{
		"cost": stats.TotalCost,
	})
}

func handleCacheStats(c *gin.Context) {
	ctx := context.Background()
	global, err := storage.GetGlobalStats(ctx)
	if err != nil {
		util.ServerError(c, "Failed to get cache stats")
		return
	}

	cacheHitRate := float64(0)
	totalCacheTokens := global.CacheCreationTokens + global.CacheReadTokens
	if totalCacheTokens > 0 {
		cacheHitRate = float64(global.CacheReadTokens) / float64(totalCacheTokens) * 100
	}

	util.SuccessJSON(c, gin.H{
		"cacheCreationTokens": global.CacheCreationTokens,
		"cacheReadTokens":     global.CacheReadTokens,
		"cacheHitRate":        cacheHitRate,
	})
}
