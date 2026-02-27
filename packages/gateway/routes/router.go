package routes

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/kiro-gateway/gateway/core"
	"github.com/kiro-gateway/gateway/middleware"
)

// RegisterRoutes configures all middleware and route groups on the given engine.
// It sets up CORS, error handling, request logging, rate limiting, and wires
// the API (JWT-protected), proxy (API-key-protected), and public route groups.
func RegisterRoutes(r *gin.Engine, proxyServer *core.ProxyServer) {
	// Global middleware pipeline (order matters).
	r.Use(middleware.CORSMiddleware())
	r.Use(middleware.ErrorHandler())
	r.Use(middleware.RequestLoggerMiddleware())
	r.Use(middleware.RateLimitMiddleware())

	// Custom 404 handler.
	r.NoRoute(middleware.NotFoundHandler)

	// Public routes.
	r.GET("/health", HealthHandler)

	// Claude Code telemetry no-op endpoint.
	r.POST("/api/event_logging/batch", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	// API group: JWT authentication required.
	api := r.Group("/api")
	api.Use(middleware.JWTAuthMiddleware())
	RegisterAuthRoutes(api)
	RegisterAccountRoutes(api, proxyServer)
	RegisterAdminRoutes(api, proxyServer)
	RegisterStatsRoutes(api, proxyServer)
	RegisterLogsRoutes(api)

	// Proxy group: API key authentication.
	v1 := r.Group("/v1")
	v1.Use(middleware.APIKeyAuthMiddleware())
	RegisterProxyRoutes(v1, proxyServer)
}
