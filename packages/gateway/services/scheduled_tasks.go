package services

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/storage"
)

const (
	tokenRefreshInterval = 5 * time.Minute
	usageCheckInterval   = 5 * time.Minute
	healthCheckInterval  = 10 * time.Minute
)

// StartTokenRefreshTask runs a periodic task that checks for and refreshes
// expired account tokens. It stops when the context is cancelled.
func StartTokenRefreshTask(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(tokenRefreshInterval)
		defer ticker.Stop()

		log.Info().Dur("interval", tokenRefreshInterval).Msg("Token refresh task started")

		for {
			select {
			case <-ctx.Done():
				log.Info().Msg("Token refresh task stopped")
				return
			case <-ticker.C:
				log.Debug().Msg("Running scheduled token refresh check")
				CheckAndRefreshExpiredTokens(ctx)
			}
		}
	}()
}

// StartUsageCheckTask runs a periodic task that checks if usage thresholds
// have been exceeded and sends notifications accordingly.
func StartUsageCheckTask(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(usageCheckInterval)
		defer ticker.Stop()

		log.Info().Dur("interval", usageCheckInterval).Msg("Usage check task started")

		for {
			select {
			case <-ctx.Done():
				log.Info().Msg("Usage check task stopped")
				return
			case <-ticker.C:
				log.Debug().Msg("Running scheduled usage threshold check")
				CheckUsageThreshold(ctx)
			}
		}
	}()
}

// StartHealthCheckTask runs a periodic task that monitors gateway health,
// including Redis connectivity and detection of stale inflight requests.
func StartHealthCheckTask(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(healthCheckInterval)
		defer ticker.Stop()

		log.Info().Dur("interval", healthCheckInterval).Msg("Health check task started")

		for {
			select {
			case <-ctx.Done():
				log.Info().Msg("Health check task stopped")
				return
			case <-ticker.C:
				performHealthCheck(ctx)
			}
		}
	}()
}

// performHealthCheck executes the individual health check steps.
func performHealthCheck(ctx context.Context) {
	// Check Redis connectivity.
	if err := storage.HealthCheck(ctx); err != nil {
		log.Error().Err(err).Msg("Redis health check failed")
		_ = AddSystemLog(ctx, "error", "health", "Redis health check failed", map[string]interface{}{
			"error": err.Error(),
		})
		NotifyHealthCheck(ctx, "unhealthy")
		return
	}

	// Gather basic statistics for the health log.
	accountCount, _ := storage.GetAccountCount(ctx)
	available, _ := storage.GetAvailableAccounts(ctx)

	log.Debug().
		Int64("totalAccounts", accountCount).
		Int("availableAccounts", len(available)).
		Msg("Health check passed")
}
