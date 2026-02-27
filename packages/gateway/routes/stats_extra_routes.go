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

// RegisterStatsExtraRoutes registers additional stats endpoints (Fix 21-28).
func RegisterStatsExtraRoutes(stats *gin.RouterGroup, ps *core.ProxyServer) {
	stats.GET("/today/apikeys", handleTodayApiKeyStats)
	stats.GET("/today/accounts", handleTodayAccountStats)
	stats.GET("/daily/apikeys/:id", handleDailyApiKeyStats)
	stats.GET("/daily/accounts/:id", handleDailyAccountStats)
	stats.GET("/daily/models", handleDailyModelStats)
	stats.GET("/top/accounts", handleTopAccounts)
	stats.GET("/top/apikeys", handleTopApiKeys)
	stats.GET("/sessions", handleSessionStats(ps))
}

// handleTodayApiKeyStats returns today's cost per API key.
func handleTodayApiKeyStats(c *gin.Context) {
	ctx := context.Background()
	keys, err := storage.GetAllApiKeys(ctx)
	if err != nil {
		util.ServerError(c, "Failed to get API keys")
		return
	}

	today := time.Now().Format("2006-01-02")
	var results []gin.H
	for _, k := range keys {
		dailyStats, _ := storage.GetDailyApiKeyStats(ctx, k.ID, today)
		totalStats, _ := storage.GetApiKeyTotalStats(ctx, k.ID)

		dayCost := float64(0)
		if dailyStats != nil {
			dayCost = dailyStats.TotalCost
		}
		totalCost := float64(0)
		if totalStats != nil {
			totalCost = totalStats.TotalCost
		}

		results = append(results, gin.H{
			"id":        k.ID,
			"name":      k.Name,
			"cost":      dayCost,
			"totalCost": totalCost,
		})
	}
	if results == nil {
		results = []gin.H{}
	}
	util.SuccessJSON(c, results)
}

// handleTodayAccountStats returns today's cost per account.
func handleTodayAccountStats(c *gin.Context) {
	ctx := context.Background()
	accounts, err := storage.GetAllAccounts(ctx)
	if err != nil {
		util.ServerError(c, "Failed to get accounts")
		return
	}

	today := time.Now().Format("2006-01-02")
	var results []gin.H
	for _, acct := range accounts {
		dailyStats, _ := storage.GetDailyAccountStats(ctx, acct.ID, today)
		cost := float64(0)
		if dailyStats != nil {
			cost = dailyStats.TotalCost
		}
		name := acct.Alias
		if name == "" {
			name = acct.Email
		}
		results = append(results, gin.H{
			"id":   acct.ID,
			"name": name,
			"cost": cost,
		})
	}
	if results == nil {
		results = []gin.H{}
	}
	util.SuccessJSON(c, results)
}

// handleDailyApiKeyStats returns daily stats for a specific API key.
func handleDailyApiKeyStats(c *gin.Context) {
	id := c.Param("id")
	ctx := context.Background()

	startDate := c.DefaultQuery("startDate", time.Now().AddDate(0, 0, -7).Format("2006-01-02"))
	endDate := c.DefaultQuery("endDate", time.Now().Format("2006-01-02"))

	start, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		util.ValidationError(c, "Invalid startDate")
		return
	}
	end, err := time.Parse("2006-01-02", endDate)
	if err != nil {
		util.ValidationError(c, "Invalid endDate")
		return
	}

	var results []gin.H
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		dateStr := d.Format("2006-01-02")
		stats, _ := storage.GetDailyApiKeyStats(ctx, id, dateStr)
		if stats != nil {
			results = append(results, gin.H{
				"date":         dateStr,
				"apiKeyId":     id,
				"credits":      stats.TotalCredits,
				"inputTokens":  stats.TotalInputTokens,
				"outputTokens": stats.TotalOutputTokens,
				"cost":         stats.TotalCost,
			})
		} else {
			results = append(results, gin.H{
				"date":         dateStr,
				"apiKeyId":     id,
				"credits":      0,
				"inputTokens":  0,
				"outputTokens": 0,
				"cost":         0,
			})
		}
	}
	if results == nil {
		results = []gin.H{}
	}
	util.SuccessJSON(c, results)
}

// handleDailyAccountStats returns daily stats for a specific account.
func handleDailyAccountStats(c *gin.Context) {
	id := c.Param("id")
	ctx := context.Background()

	startDate := c.DefaultQuery("startDate", time.Now().AddDate(0, 0, -7).Format("2006-01-02"))
	endDate := c.DefaultQuery("endDate", time.Now().Format("2006-01-02"))

	start, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		util.ValidationError(c, "Invalid startDate")
		return
	}
	end, err := time.Parse("2006-01-02", endDate)
	if err != nil {
		util.ValidationError(c, "Invalid endDate")
		return
	}

	var results []*model.DailyAccountStats
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		dateStr := d.Format("2006-01-02")
		stats, _ := storage.GetDailyAccountStats(ctx, id, dateStr)
		if stats != nil {
			results = append(results, stats)
		}
	}
	if results == nil {
		results = []*model.DailyAccountStats{}
	}
	util.SuccessJSON(c, results)
}

// handleDailyModelStats returns daily stats aggregated across all models.
func handleDailyModelStats(c *gin.Context) {
	ctx := context.Background()

	startDate := c.DefaultQuery("startDate", time.Now().AddDate(0, 0, -7).Format("2006-01-02"))
	endDate := c.DefaultQuery("endDate", time.Now().Format("2006-01-02"))

	start, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		util.ValidationError(c, "Invalid startDate")
		return
	}
	end, err := time.Parse("2006-01-02", endDate)
	if err != nil {
		util.ValidationError(c, "Invalid endDate")
		return
	}

	var results []*model.DailyModelStats
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		dateStr := d.Format("2006-01-02")
		stats, _ := storage.GetDailyGlobalStats(ctx, dateStr)
		if stats != nil {
			results = append(results, &model.DailyModelStats{
				Date:         dateStr,
				Model:        "all",
				InputTokens:  stats.InputTokens,
				OutputTokens: stats.OutputTokens,
				TotalTokens:  stats.TotalTokens,
				TotalCost:    stats.TotalCost,
			})
		}
	}
	if results == nil {
		results = []*model.DailyModelStats{}
	}
	util.SuccessJSON(c, results)
}

// handleTopAccounts returns accounts ranked by total cost.
func handleTopAccounts(c *gin.Context) {
	days := parseQueryInt(c, "days", 7)
	if days <= 0 {
		days = 7
	}
	ctx := context.Background()
	accounts, err := storage.GetAllAccounts(ctx)
	if err != nil {
		util.ServerError(c, "Failed to get accounts")
		return
	}

	var results []gin.H
	for _, acct := range accounts {
		stats, _ := storage.GetAccountStats(ctx, acct.ID)
		totalCost := float64(0)
		if stats != nil {
			totalCost = stats.TotalCost
		}
		avgDailyCost := totalCost / float64(days)

		name := acct.Alias
		if name == "" {
			name = acct.Email
		}
		results = append(results, gin.H{
			"id":           acct.ID,
			"name":         name,
			"totalCost":    totalCost,
			"avgDailyCost": avgDailyCost,
		})
	}
	if results == nil {
		results = []gin.H{}
	}
	util.SuccessJSON(c, results)
}

// handleTopApiKeys returns API keys ranked by total cost.
func handleTopApiKeys(c *gin.Context) {
	days := parseQueryInt(c, "days", 7)
	if days <= 0 {
		days = 7
	}
	ctx := context.Background()
	keys, err := storage.GetAllApiKeys(ctx)
	if err != nil {
		util.ServerError(c, "Failed to get API keys")
		return
	}

	var results []gin.H
	for _, k := range keys {
		stats, _ := storage.GetApiKeyTotalStats(ctx, k.ID)
		totalCost := float64(0)
		if stats != nil {
			totalCost = stats.TotalCost
		}
		avgDailyCost := totalCost / float64(days)

		results = append(results, gin.H{
			"id":           k.ID,
			"name":         k.Name,
			"totalCost":    totalCost,
			"avgDailyCost": avgDailyCost,
		})
	}
	if results == nil {
		results = []gin.H{}
	}
	util.SuccessJSON(c, results)
}

// handleSessionStats returns active session bindings from Redis.
func handleSessionStats(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := context.Background()
		rdb := storage.GetClient()

		// Scan for session keys.
		pattern := storage.Key("session:" + "*")
		var sessions []gin.H
		var cursor uint64
		prefix := storage.Key("session:")
		for {
			keys, nextCursor, err := rdb.Scan(ctx, cursor, pattern, 100).Result()
			if err != nil {
				log.Warn().Err(err).Msg("Failed to scan session keys")
				break
			}
			for _, key := range keys {
				accountID, _ := rdb.Get(ctx, key).Result()
				ttl, _ := rdb.TTL(ctx, key).Result()
				hash := key[len(prefix):]
				sessions = append(sessions, gin.H{
					"hash":      hash,
					"accountId": accountID,
					"ttl":       int64(ttl.Seconds()),
				})
			}
			cursor = nextCursor
			if cursor == 0 {
				break
			}
		}
		if sessions == nil {
			sessions = []gin.H{}
		}

		util.SuccessJSON(c, gin.H{
			"totalSessions": len(sessions),
			"sessions":      sessions,
		})
	}
}
