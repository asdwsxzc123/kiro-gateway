package core

import (
	"math/rand"
	"strings"
	"time"

	"github.com/kiro-gateway/gateway/model"
)

// MapErrorToHTTPStatus maps a KiroApiError to an HTTP status code for the client response.
func MapErrorToHTTPStatus(err *model.KiroApiError) int {
	if err == nil {
		return 500
	}
	switch {
	case err.StatusCode == 429:
		return 429
	case err.StatusCode == 529:
		return 503
	case err.StatusCode == 402:
		return 402
	case err.StatusCode == 401 || err.StatusCode == 403:
		return 502
	case err.StatusCode >= 500:
		return 502
	default:
		return 500
	}
}

// RetryAction describes what to do when a request fails.
type RetryAction int

const (
	// RetryActionNone means do not retry.
	RetryActionNone RetryAction = iota
	// RetryActionSameAccount means retry with the same account (e.g., after token refresh).
	RetryActionSameAccount
	// RetryActionNextAccount means retry with a different account.
	RetryActionNextAccount
	// RetryActionNextEndpoint means try the next Kiro API endpoint.
	RetryActionNextEndpoint
)

// ClassifyRetryError determines whether an error is retryable and what action to take.
func ClassifyRetryError(err *model.KiroApiError) RetryAction {
	if err == nil {
		return RetryActionNone
	}

	switch err.ErrorCode {
	case model.KiroErrorQuotaExhausted:
		return RetryActionNextAccount
	case model.KiroErrorOverloaded:
		// Try another endpoint first, then another account.
		return RetryActionNextEndpoint
	case model.KiroErrorAuthError:
		return RetryActionSameAccount
	case model.KiroErrorMonthlyLimit:
		return RetryActionNextAccount
	case model.KiroErrorAccountSuspended:
		return RetryActionNextAccount
	case model.KiroErrorServerError:
		return RetryActionNextEndpoint
	default:
		return RetryActionNone
	}
}

// CalculateRetryAfter computes the Retry-After header value in seconds based on current load.
func CalculateRetryAfter(queueSize int, concurrentCount int) int {
	base := 5
	base += queueSize / 10
	base += concurrentCount / 5

	// Cap at 120 seconds.
	if base > 120 {
		base = 120
	}
	return base
}

// CapBillingTokens caps tokens to prevent excessive billing on anomalous responses.
// Models containing "opus" have a higher cap due to larger expected output.
func CapBillingTokens(tokens int, modelID string) int {
	maxTokens := 200000
	if strings.Contains(strings.ToLower(modelID), "opus") {
		maxTokens = 1000000
	}
	if tokens > maxTokens {
		return maxTokens
	}
	return tokens
}

// AddJitter adds random jitter (plus/minus 20%) to a base duration in milliseconds.
func AddJitter(baseMs int) time.Duration {
	if baseMs <= 0 {
		return 0
	}
	// Calculate +/- 20% jitter.
	jitterRange := float64(baseMs) * 0.2
	jitter := (rand.Float64()*2 - 1) * jitterRange
	result := float64(baseMs) + jitter
	if result < 0 {
		result = 0
	}
	return time.Duration(result) * time.Millisecond
}

// IsOverloaded checks if the server is currently at capacity.
// Returns false if maxConcurrent is 0 (unlimited).
func IsOverloaded(queueSize, maxConcurrent, activeCount int) bool {
	if maxConcurrent <= 0 {
		return false
	}
	return activeCount >= maxConcurrent
}
