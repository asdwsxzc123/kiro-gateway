package routes

import (
	"context"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/model"
	"github.com/kiro-gateway/gateway/storage"
	"github.com/kiro-gateway/gateway/util"
)

// RegisterLogsRoutes registers the /logs/* log viewing and management endpoints.
func RegisterLogsRoutes(group *gin.RouterGroup) {
	logs := group.Group("/logs")
	{
		logs.GET("/requests", handleGetRequestLogs)
		logs.GET("/system", handleGetSystemLogs)
		logs.GET("/stats", handleGetLogStats)
		logs.GET("/errors", handleGetErrorLogs)
		logs.GET("/summary", handleGetLogSummary)
		logs.GET("/files", handleGetLogFiles)
		logs.GET("/files/download", handleDownloadLogFile)
		logs.DELETE("/requests", handleClearRequestLogs)
		logs.DELETE("/system", handleClearSystemLogs)
	}
}

func handleGetRequestLogs(c *gin.Context) {
	ctx := context.Background()

	limit := parseQueryInt(c, "limit", 20)
	offset := parseQueryInt(c, "offset", 0)
	startTime := parseQueryInt64(c, "startTime", 0)
	endTime := parseQueryInt64(c, "endTime", 0)
	modelFilter := c.Query("model")

	query := model.LogsQuery{
		Limit:     limit,
		Offset:    offset,
		StartTime: startTime,
		EndTime:   endTime,
		Model:     modelFilter,
	}

	logs, total, err := storage.GetRequestLogs(ctx, query)
	if err != nil {
		log.Error().Err(err).Msg("Failed to get request logs")
		util.ServerError(c, "Failed to retrieve request logs")
		return
	}
	if logs == nil {
		logs = []model.RequestLog{}
	}

	// Use "data" instead of "logs" to match frontend expectations.
	util.SuccessJSON(c, gin.H{
		"data":   logs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func handleGetSystemLogs(c *gin.Context) {
	ctx := context.Background()

	limit := parseQueryInt(c, "limit", 100)
	level := c.Query("level")
	category := c.Query("category")

	logs, err := storage.GetSystemLogs(ctx, limit, level, category)
	if err != nil {
		log.Error().Err(err).Msg("Failed to get system logs")
		util.ServerError(c, "Failed to retrieve system logs")
		return
	}
	if logs == nil {
		logs = []model.SystemLog{}
	}

	util.SuccessJSON(c, logs)
}

func handleGetLogStats(c *gin.Context) {
	ctx := context.Background()

	requestCount, err := storage.GetRequestLogCount(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to get request log count")
		requestCount = 0
	}

	systemCount, err := storage.GetSystemLogCount(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to get system log count")
		systemCount = 0
	}

	util.SuccessJSON(c, gin.H{
		"requestLogs": requestCount,
		"systemLogs":  systemCount,
		"total":       requestCount + systemCount,
	})
}

func handleGetErrorLogs(c *gin.Context) {
	ctx := context.Background()

	limit := parseQueryInt(c, "limit", 50)

	// Get request logs and filter to failures (success=false).
	query := model.LogsQuery{Limit: limit * 5}
	logs, _, err := storage.GetRequestLogs(ctx, query)
	if err != nil {
		util.ServerError(c, "Failed to retrieve error logs")
		return
	}

	var errorLogs []model.RequestLog
	for _, l := range logs {
		if !l.Success {
			errorLogs = append(errorLogs, l)
			if len(errorLogs) >= limit {
				break
			}
		}
	}
	if errorLogs == nil {
		errorLogs = []model.RequestLog{}
	}

	util.SuccessJSON(c, errorLogs)
}

func handleGetLogSummary(c *gin.Context) {
	ctx := context.Background()

	// Retrieve recent request logs for summary computation.
	query := model.LogsQuery{Limit: 1000}
	logs, total, err := storage.GetRequestLogs(ctx, query)
	if err != nil {
		util.ServerError(c, "Failed to compute log summary")
		return
	}

	var successCount int64
	var failedCount int64
	var totalResponseTime int64

	for _, l := range logs {
		if l.Success {
			successCount++
		} else {
			failedCount++
		}
		totalResponseTime += l.ResponseTime
	}

	var avgResponseTime float64
	if len(logs) > 0 {
		avgResponseTime = float64(totalResponseTime) / float64(len(logs))
	}

	util.SuccessJSON(c, gin.H{
		"total":           total,
		"success":         successCount,
		"failed":          failedCount,
		"avgResponseTime": avgResponseTime,
	})
}

// handleGetLogFiles returns an empty array since Go uses Redis streams, not file logs.
func handleGetLogFiles(c *gin.Context) {
	util.SuccessJSON(c, []interface{}{})
}

// handleDownloadLogFile returns 404 since Go doesn't use file-based logging.
func handleDownloadLogFile(c *gin.Context) {
	c.JSON(http.StatusNotFound, util.APIResponse{
		Success: false,
		Error: &util.APIError{
			Message: "File-based logging is not available in this deployment",
			Type:    util.ErrTypeNotFound,
		},
	})
}

func handleClearRequestLogs(c *gin.Context) {
	ctx := context.Background()
	if err := storage.ClearRequestLogs(ctx); err != nil {
		util.ServerError(c, "Failed to clear request logs")
		return
	}
	util.SuccessJSON(c, gin.H{"message": "Request logs cleared"})
}

func handleClearSystemLogs(c *gin.Context) {
	ctx := context.Background()
	if err := storage.ClearSystemLogs(ctx); err != nil {
		util.ServerError(c, "Failed to clear system logs")
		return
	}
	util.SuccessJSON(c, gin.H{"message": "System logs cleared"})
}

// parseQueryInt extracts an integer query parameter with a fallback default.
func parseQueryInt(c *gin.Context, key string, defaultVal int) int {
	val := c.Query(key)
	if val == "" {
		return defaultVal
	}
	parsed, err := strconv.Atoi(val)
	if err != nil {
		return defaultVal
	}
	return parsed
}

// parseQueryInt64 extracts an int64 query parameter with a fallback default.
func parseQueryInt64(c *gin.Context, key string, defaultVal int64) int64 {
	val := c.Query(key)
	if val == "" {
		return defaultVal
	}
	parsed, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return defaultVal
	}
	return parsed
}
