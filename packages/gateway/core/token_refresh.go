package core

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/config"
	"github.com/kiro-gateway/gateway/model"
	"github.com/kiro-gateway/gateway/util"
)

const (
	// KiroAuthServiceURL is the base URL for the Kiro social authentication service.
	KiroAuthServiceURL = "https://prod.us-east-1.auth.desktop.kiro.dev"

	// OIDCTokenPath is the path for OIDC token endpoint.
	OIDCTokenPath = "/token"

	// tokenRefreshTimeout is the HTTP timeout for token refresh requests.
	tokenRefreshTimeout = 30 * time.Second
)

// socialRefreshResponse is the JSON response from the social token refresh endpoint.
type socialRefreshResponse struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	ExpiresAt    int64  `json:"expiresAt"`
}

// oidcTokenResponse is the JSON response from the OIDC token endpoint.
type oidcTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

// RefreshTokenByMethod dispatches to the appropriate token refresh handler
// based on the account's authentication method.
func RefreshTokenByMethod(ctx context.Context, account *model.ProxyAccount) (*model.TokenRefreshResult, error) {
	if account.RefreshToken == "" {
		return &model.TokenRefreshResult{
			Success: false,
			Error:   "no refresh token available",
		}, fmt.Errorf("no refresh token for account %s", account.ID)
	}

	switch account.AuthMethod {
	case "idc", "builderId":
		return refreshOIDCToken(ctx, account)
	default:
		// Default to social auth (includes "social" and empty authMethod).
		return refreshSocialToken(ctx, account)
	}
}

// refreshSocialToken refreshes an access token using the Kiro social auth endpoint.
func refreshSocialToken(ctx context.Context, account *model.ProxyAccount) (*model.TokenRefreshResult, error) {
	reqURL := KiroAuthServiceURL + "/refresh"

	body := fmt.Sprintf(`{"refreshToken":"%s"}`, account.RefreshToken)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, strings.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create social refresh request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", fmt.Sprintf("kiro-gateway/%s", account.MachineID))

	client := util.NewHTTPClient(account.ProxyURL, tokenRefreshTimeout)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("social refresh request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read social refresh response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Warn().
			Str("accountId", account.ID).
			Int("status", resp.StatusCode).
			Str("body", string(respBody)).
			Msg("Social token refresh failed")
		return &model.TokenRefreshResult{
			Success: false,
			Error:   fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody)),
		}, fmt.Errorf("social refresh HTTP %d", resp.StatusCode)
	}

	var result socialRefreshResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("parse social refresh response: %w", err)
	}

	log.Info().
		Str("accountId", account.ID).
		Int64("expiresAt", result.ExpiresAt).
		Msg("Social token refreshed")

	return &model.TokenRefreshResult{
		Success:      true,
		AccessToken:  result.AccessToken,
		RefreshToken: result.RefreshToken,
		ExpiresAt:    result.ExpiresAt,
	}, nil
}

// refreshOIDCToken refreshes an access token using the OIDC token endpoint.
func refreshOIDCToken(ctx context.Context, account *model.ProxyAccount) (*model.TokenRefreshResult, error) {
	region := account.Region
	if region == "" {
		region = "us-east-1"
	}

	oidcURL := fmt.Sprintf("https://oidc.%s.amazonaws.com%s", region, OIDCTokenPath)

	// Build form data.
	formData := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {account.RefreshToken},
		"client_id":     {account.ClientID},
	}
	if account.ClientSecret != "" {
		formData.Set("client_secret", account.ClientSecret)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, oidcURL, strings.NewReader(formData.Encode()))
	if err != nil {
		return nil, fmt.Errorf("create OIDC refresh request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := util.NewHTTPClient(account.ProxyURL, tokenRefreshTimeout)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("OIDC refresh request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read OIDC refresh response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Warn().
			Str("accountId", account.ID).
			Int("status", resp.StatusCode).
			Str("body", string(respBody)).
			Msg("OIDC token refresh failed")
		return &model.TokenRefreshResult{
			Success: false,
			Error:   fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody)),
		}, fmt.Errorf("OIDC refresh HTTP %d", resp.StatusCode)
	}

	var result oidcTokenResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("parse OIDC refresh response: %w", err)
	}

	// Calculate absolute expiry time from relative expires_in.
	expiresAt := time.Now().UnixMilli() + (result.ExpiresIn * 1000)

	log.Info().
		Str("accountId", account.ID).
		Int64("expiresIn", result.ExpiresIn).
		Int64("expiresAt", expiresAt).
		Msg("OIDC token refreshed")

	return &model.TokenRefreshResult{
		Success:      true,
		AccessToken:  result.AccessToken,
		RefreshToken: result.RefreshToken,
		ExpiresAt:    expiresAt,
	}, nil
}

// NeedsTokenRefresh checks whether an account's token should be proactively refreshed
// before it expires, based on the configured threshold.
func NeedsTokenRefresh(account *model.ProxyAccount) bool {
	if account.ExpiresAt == 0 {
		return false
	}
	threshold := config.GetConfig().Proxy.TokenRefreshBeforeExpiry
	// ExpiresAt is in milliseconds; threshold is in seconds.
	return time.Now().UnixMilli()+int64(threshold)*1000 > account.ExpiresAt
}

// IsTokenExpired checks whether an account's token has already expired.
func IsTokenExpired(account *model.ProxyAccount) bool {
	if account.ExpiresAt == 0 {
		return false
	}
	return time.Now().UnixMilli() > account.ExpiresAt
}
