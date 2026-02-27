package services

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/config"
	"github.com/kiro-gateway/gateway/core"
	"github.com/kiro-gateway/gateway/model"
	"github.com/kiro-gateway/gateway/storage"
	"github.com/kiro-gateway/gateway/util"
)

// RefreshAccountToken refreshes the tokens for a specific account.
func RefreshAccountToken(ctx context.Context, id string) (*model.TokenRefreshResult, error) {
	acct, err := getDecryptedAccount(ctx, id)
	if err != nil {
		return nil, err
	}

	result, err := core.RefreshTokenByMethod(ctx, acct)
	if err != nil || !result.Success {
		errMsg := ""
		if err != nil {
			errMsg = err.Error()
		} else {
			errMsg = result.Error
		}
		go NotifyTokenRefreshFail(ctx, id, errMsg)
		return result, nil
	}

	applyRefreshResult(ctx, id, result)
	return result, nil
}

// CheckAndRefreshExpiredTokens checks all accounts and refreshes expired tokens.
func CheckAndRefreshExpiredTokens(ctx context.Context) {
	accounts, err := getAllAccountsDecrypted(ctx)
	if err != nil {
		log.Error().Err(err).Msg("Failed to get accounts for token refresh")
		return
	}

	for _, acct := range accounts {
		if acct.Status != model.AccountStatusActive {
			continue
		}
		if !core.NeedsTokenRefresh(acct) {
			continue
		}

		result, refreshErr := core.RefreshTokenByMethod(ctx, acct)
		if refreshErr == nil && result.Success {
			applyRefreshResult(ctx, acct.ID, result)
			log.Info().Str("id", acct.ID).Msg("Token refreshed successfully")
		} else {
			errMsg := extractRefreshError(refreshErr, result)
			log.Warn().Str("id", acct.ID).Str("error", errMsg).Msg("Token refresh failed")
			go NotifyTokenRefreshFail(ctx, acct.ID, errMsg)
		}
	}
}

// applyRefreshResult persists new tokens from a successful refresh.
func applyRefreshResult(ctx context.Context, id string, result *model.TokenRefreshResult) {
	cfg := config.GetConfig()
	encKey := cfg.Security.EncryptionKey
	updates := make(map[string]interface{})

	if result.AccessToken != "" {
		enc, _ := util.Encrypt(result.AccessToken, encKey)
		updates["accessToken"] = enc
	}
	if result.RefreshToken != "" {
		enc, _ := util.Encrypt(result.RefreshToken, encKey)
		updates["refreshToken"] = enc
	}
	if result.ExpiresAt > 0 {
		updates["expiresAt"] = result.ExpiresAt
	}
	if len(updates) > 0 {
		_ = storage.UpdateAccount(ctx, id, updates)
	}
}

// extractRefreshError extracts an error message from a refresh attempt.
func extractRefreshError(err error, result *model.TokenRefreshResult) string {
	if err != nil {
		return err.Error()
	}
	if result != nil {
		return result.Error
	}
	return "unknown error"
}

// getAllAccountsDecrypted returns all accounts with sensitive fields decrypted.
func getAllAccountsDecrypted(ctx context.Context) ([]*model.ProxyAccount, error) {
	accounts, err := storage.GetAllAccounts(ctx)
	if err != nil {
		return nil, err
	}

	cfg := config.GetConfig()
	encKey := cfg.Security.EncryptionKey
	result := make([]*model.ProxyAccount, 0, len(accounts))

	for i := range accounts {
		acct := &accounts[i]
		acct.AccessToken, _ = util.Decrypt(acct.AccessToken, encKey)
		acct.RefreshToken, _ = util.Decrypt(acct.RefreshToken, encKey)
		acct.ClientSecret, _ = util.Decrypt(acct.ClientSecret, encKey)
		result = append(result, acct)
	}

	return result, nil
}

// getDecryptedAccount returns a single account with sensitive fields decrypted.
func getDecryptedAccount(ctx context.Context, id string) (*model.ProxyAccount, error) {
	acct, err := storage.GetAccountByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("get account %s: %w", id, err)
	}
	if acct == nil {
		return nil, fmt.Errorf("account %s not found", id)
	}

	cfg := config.GetConfig()
	encKey := cfg.Security.EncryptionKey
	acct.AccessToken, _ = util.Decrypt(acct.AccessToken, encKey)
	acct.RefreshToken, _ = util.Decrypt(acct.RefreshToken, encKey)
	acct.ClientSecret, _ = util.Decrypt(acct.ClientSecret, encKey)

	return acct, nil
}

// buildAccountUpdates builds the update map from an UpdateAccountRequest.
func buildAccountUpdates(req *model.UpdateAccountRequest, encKey string) map[string]interface{} {
	updates := make(map[string]interface{})

	applyStringUpdate(updates, "alias", req.Alias)
	applyStringUpdate(updates, "email", req.Email)
	applyStringUpdate(updates, "userId", req.UserID)
	applyStringUpdate(updates, "clientId", req.ClientID)
	applyStringUpdate(updates, "region", req.Region)
	applyStringUpdate(updates, "authMethod", req.AuthMethod)
	applyStringUpdate(updates, "provider", req.Provider)
	applyStringUpdate(updates, "profileArn", req.ProfileArn)
	applyStringUpdate(updates, "machineId", req.MachineID)
	applyStringUpdate(updates, "proxyUrl", req.ProxyURL)
	applyStringUpdate(updates, "statusReason", req.StatusReason)

	if req.AccessToken != nil {
		enc, err := util.Encrypt(*req.AccessToken, encKey)
		if err != nil {
			return nil
		}
		updates["accessToken"] = enc
	}
	if req.RefreshToken != nil {
		enc, err := util.Encrypt(*req.RefreshToken, encKey)
		if err != nil {
			return nil
		}
		updates["refreshToken"] = enc
	}
	if req.ClientSecret != nil {
		enc, err := util.Encrypt(*req.ClientSecret, encKey)
		if err != nil {
			return nil
		}
		updates["clientSecret"] = enc
	}

	if req.Status != nil {
		updates["status"] = string(*req.Status)
	}
	applyInt64Update(updates, "expiresAt", req.ExpiresAt)
	applyInt64Update(updates, "statusChangedAt", req.StatusChangedAt)
	applyInt64Update(updates, "errorCount", req.ErrorCount)
	applyInt64Update(updates, "cooldownUntil", req.CooldownUntil)
	applyInt64Update(updates, "requestCount", req.RequestCount)
	applyInt64Update(updates, "lastUsed", req.LastUsed)
	if req.MaxConcurrency != nil {
		updates["maxConcurrency"] = *req.MaxConcurrency
	}

	return updates
}

// applyStringUpdate adds a string pointer field to the updates map if non-nil.
func applyStringUpdate(updates map[string]interface{}, key string, val *string) {
	if val != nil {
		updates[key] = *val
	}
}

// applyInt64Update adds an int64 pointer field to the updates map if non-nil.
func applyInt64Update(updates map[string]interface{}, key string, val *int64) {
	if val != nil {
		updates[key] = *val
	}
}
