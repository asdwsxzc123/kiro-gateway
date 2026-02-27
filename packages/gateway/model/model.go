// Package model defines all domain types for the kiro-gateway.
//
// Types are organized into the following files:
//   - account.go:  ProxyAccount, AddAccountRequest, UpdateAccountRequest
//   - apikey.go:   API key management types
//   - claude.go:   Claude Messages API types (request, response, streaming)
//   - config.go:   GatewayConfig, TokenRefreshResult
//   - errors.go:   Structured Kiro API error types
//   - kiro.go:     Kiro upstream API payload types
//   - pricing.go:  Model pricing and cost calculation types
//   - stats.go:    Statistics, logs, daily stats, cost ranking
//   - usage.go:    Usage limits, subscription info, usage breakdowns
//   - webhook.go:  Webhook notification types
package model
