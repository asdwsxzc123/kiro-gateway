package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/config"
	"github.com/kiro-gateway/gateway/core"
	"github.com/kiro-gateway/gateway/routes"
	"github.com/kiro-gateway/gateway/services"
	"github.com/kiro-gateway/gateway/storage"
	"github.com/kiro-gateway/gateway/util"
)

func main() {
	// Load configuration from environment variables and .env file.
	cfg := config.GetConfig()

	// Initialize structured logger.
	util.InitLogger(cfg.Log.Level)
	log.Info().Str("version", "1.0.0").Msg("Kiro Gateway starting")

	// Connect to Redis.
	if err := storage.InitRedis(&cfg.Redis); err != nil {
		log.Fatal().Err(err).Msg("Failed to initialize Redis")
	}
	defer func() {
		if err := storage.Close(); err != nil {
			log.Error().Err(err).Msg("Error closing Redis connection")
		}
	}()

	// Initialize admin account (create if not exists).
	if err := storage.InitAdmin(cfg.Admin.Username, cfg.Admin.Password); err != nil {
		log.Fatal().Err(err).Msg("Failed to initialize admin account")
	}

	// Set Gin mode based on environment.
	if cfg.Server.NodeEnv == "production" {
		gin.SetMode(gin.ReleaseMode)
	} else {
		gin.SetMode(gin.DebugMode)
	}

	// Create Gin engine with default middleware (logger and recovery).
	r := gin.New()
	r.Use(gin.Recovery())

	// Create the proxy server instance for request orchestration.
	proxyServer := core.NewProxyServer()

	// Register all route groups (proxy, auth, accounts, admin, stats, logs).
	routes.RegisterRoutes(r, proxyServer)

	// Serve static frontend files for SPA.
	serveSPA(r)

	// Create a root context that is cancelled on shutdown signals.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start scheduled background tasks.
	go services.StartTokenRefreshTask(ctx)
	go services.StartUsageCheckTask(ctx)
	go services.StartHealthCheckTask(ctx)

	// Build server address.
	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)

	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Start listening in a goroutine so we can handle shutdown gracefully.
	go func() {
		log.Info().Str("addr", addr).Str("env", cfg.Server.NodeEnv).Msg("Server listening")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("Server failed")
		}
	}()

	// Wait for termination signal.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Info().Str("signal", sig.String()).Msg("Shutting down server")

	// Cancel background tasks.
	cancel()

	// Give active connections time to finish.
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("Server forced to shutdown")
	}

	log.Info().Msg("Server exited")
}

// serveSPA sets up static file serving for the single-page application.
// It looks for the frontend build output in common locations and falls back
// to serving index.html for any non-API, non-file routes (SPA routing).
func serveSPA(r *gin.Engine) {
	// Try common frontend build directories.
	candidates := []string{
		"../frontend/dist",
		"./public",
	}

	var staticDir string
	for _, dir := range candidates {
		abs, err := filepath.Abs(dir)
		if err != nil {
			continue
		}
		if info, err := os.Stat(abs); err == nil && info.IsDir() {
			staticDir = abs
			break
		}
	}

	if staticDir == "" {
		log.Warn().Msg("No static frontend directory found, skipping SPA setup")
		return
	}

	log.Info().Str("dir", staticDir).Msg("Serving static files")

	// Serve static assets.
	r.Static("/assets", filepath.Join(staticDir, "assets"))
	r.StaticFile("/favicon.ico", filepath.Join(staticDir, "favicon.ico"))

	// SPA fallback: serve index.html for unmatched routes that are not API calls.
	indexPath := filepath.Join(staticDir, "index.html")
	r.NoRoute(func(c *gin.Context) {
		// Only serve index.html for non-API paths (let API 404s pass through).
		path := c.Request.URL.Path
		if len(path) >= 4 && (path[:4] == "/api" || path[:3] == "/v1") {
			c.JSON(http.StatusNotFound, gin.H{
				"success": false,
				"error":   gin.H{"message": "Not found", "type": "not_found"},
			})
			return
		}
		c.File(indexPath)
	})
}
