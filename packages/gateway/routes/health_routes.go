package routes

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/kiro-gateway/gateway/storage"
)

// HealthHandler responds with the health status of the gateway, including
// Redis connectivity. Returns 200 if healthy, 503 if Redis is unreachable.
func HealthHandler(c *gin.Context) {
	ctx := context.Background()
	err := storage.HealthCheck(ctx)

	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status": "error",
			"redis":  err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
	})
}
