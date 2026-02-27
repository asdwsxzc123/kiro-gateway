package services

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/config"
	"github.com/kiro-gateway/gateway/core"
	"github.com/kiro-gateway/gateway/model"
	"github.com/kiro-gateway/gateway/storage"
	"github.com/kiro-gateway/gateway/util"
)

// GetAllAccounts returns all proxy accounts from storage.
func GetAllAccounts(ctx context.Context) ([]*model.ProxyAccount, error) {
	accounts, err := storage.GetAllAccounts(ctx)
	if err != nil {
		return nil, fmt.Errorf("get all accounts: %w", err)
	}
	result := make([]*model.ProxyAccount, len(accounts))
	for i := range accounts {
		result[i] = &accounts[i]
	}
	return result, nil
}

// GetAccountByID returns a single account by its ID.
func GetAccountByID(ctx context.Context, id string) (*model.ProxyAccount, error) {
	acct, err := storage.GetAccountByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("get account %s: %w", id, err)
	}
	if acct == nil {
		return nil, fmt.Errorf("account %s not found", id)
	}
	return acct, nil
}

// AddAccount creates a new proxy account with generated defaults and encrypted tokens.
func AddAccount(ctx context.Context, req *model.AddAccountRequest) (*model.ProxyAccount, error) {
	cfg := config.GetConfig()
	now := time.Now().UnixMilli()

	machineID := req.MachineID
	if machineID != "" {
		machineID = core.NormalizeMachineID(machineID)
	} else {
		machineID = core.GenerateMachineID()
	}

	authMethod := req.AuthMethod
	if authMethod == "" {
		authMethod = guessAuthMethod(req)
	}

	region := req.Region
	if region == "" {
		region = cfg.Proxy.DefaultRegion
	}

	encKey := cfg.Security.EncryptionKey
	accessToken, refreshToken, clientSecret, err := encryptAccountTokens(
		req.AccessToken, req.RefreshToken, req.ClientSecret, encKey,
	)
	if err != nil {
		return nil, err
	}

	acct := &model.ProxyAccount{
		ID:                 uuid.New().String(),
		Alias:              req.Alias,
		Email:              req.Email,
		AccessToken:        accessToken,
		RefreshToken:       refreshToken,
		ClientID:           req.ClientID,
		ClientSecret:       clientSecret,
		Region:             region,
		AuthMethod:         authMethod,
		Provider:           req.Provider,
		ProfileArn:         req.ProfileArn,
		MachineID:          machineID,
		MachineIDCreatedAt: now,
		MaxConcurrency:     req.MaxConcurrency,
		ProxyURL:           req.ProxyURL,
		Status:             model.AccountStatusActive,
		CreatedAt:          now,
	}

	if err := storage.AddAccount(ctx, acct); err != nil {
		return nil, fmt.Errorf("add account: %w", err)
	}

	log.Info().Str("id", acct.ID).Str("email", acct.Email).Msg("Account created")
	go NotifyAccountStatusChange(ctx, acct.ID, model.AccountStatusActive, "account created")
	return acct, nil
}

// UpdateAccount applies partial updates to an existing account.
func UpdateAccount(ctx context.Context, id string, req *model.UpdateAccountRequest) (*model.ProxyAccount, error) {
	existing, err := storage.GetAccountByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("get account for update: %w", err)
	}
	if existing == nil {
		return nil, fmt.Errorf("account %s not found", id)
	}

	cfg := config.GetConfig()
	encKey := cfg.Security.EncryptionKey
	updates := buildAccountUpdates(req, encKey)
	if updates == nil {
		return nil, fmt.Errorf("failed to build account updates")
	}

	if err := storage.UpdateAccount(ctx, id, updates); err != nil {
		return nil, fmt.Errorf("update account: %w", err)
	}

	return storage.GetAccountByID(ctx, id)
}

// DeleteAccount removes an account and cleans up related references.
func DeleteAccount(ctx context.Context, id string) error {
	if err := storage.DeleteAccount(ctx, id); err != nil {
		return fmt.Errorf("delete account: %w", err)
	}
	// Remove from selected accounts list.
	selected, _ := storage.GetSelectedAccounts(ctx)
	filtered := make([]string, 0, len(selected))
	for _, sid := range selected {
		if sid != id {
			filtered = append(filtered, sid)
		}
	}
	if len(filtered) != len(selected) {
		_ = storage.SetSelectedAccounts(ctx, filtered)
	}
	// Unbind from API keys.
	_ = storage.RemoveAccountFromApiKeys(ctx, id)
	return nil
}

// PauseAccount sets an account to paused status.
func PauseAccount(ctx context.Context, id string) error {
	if err := storage.SetAccountStatus(ctx, id, model.AccountStatusPaused, "manually paused"); err != nil {
		return err
	}
	go NotifyAccountStatusChange(ctx, id, model.AccountStatusPaused, "manually paused")
	return nil
}

// ResumeAccount sets an account back to active status.
func ResumeAccount(ctx context.Context, id string) error {
	return storage.SetAccountStatus(ctx, id, model.AccountStatusActive, "")
}

// TestAccountConnection tests connectivity for an account by fetching usage limits.
func TestAccountConnection(ctx context.Context, id string) (map[string]interface{}, error) {
	acct, err := getDecryptedAccount(ctx, id)
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}, err
	}

	usage, fetchErr := core.FetchUsageLimits(ctx, acct)
	if fetchErr != nil {
		return map[string]interface{}{
			"success": false,
			"error":   fetchErr.Error(),
		}, nil
	}

	return map[string]interface{}{
		"success": true,
		"usage":   usage,
	}, nil
}

// RegenerateMachineID generates a new machine ID for the specified account.
func RegenerateMachineID(ctx context.Context, id string) (string, error) {
	newMID := core.GenerateMachineID()
	if err := storage.RegenerateMachineID(ctx, id, newMID); err != nil {
		return "", fmt.Errorf("regenerate machine id: %w", err)
	}
	return newMID, nil
}

// BatchImportAccounts imports multiple accounts, returning success count and errors.
func BatchImportAccounts(ctx context.Context, accounts []model.AddAccountRequest) (int, []string, error) {
	var successCount int
	var errors []string

	for i, req := range accounts {
		_, err := AddAccount(ctx, &req)
		if err != nil {
			errors = append(errors, fmt.Sprintf("account[%d]: %s", i, err.Error()))
			continue
		}
		successCount++
	}

	return successCount, errors, nil
}

// guessAuthMethod infers the auth method from the request fields.
func guessAuthMethod(req *model.AddAccountRequest) string {
	if req.ClientID != "" && req.ClientSecret != "" {
		return "idc"
	}
	if strings.Contains(req.AccessToken, "Atza|") {
		return "social"
	}
	return "social"
}

// encryptAccountTokens encrypts token fields using the provided encryption key.
func encryptAccountTokens(access, refresh, secret, encKey string) (string, string, string, error) {
	encAccess, err := util.Encrypt(access, encKey)
	if err != nil {
		return "", "", "", fmt.Errorf("encrypt access token: %w", err)
	}

	var encRefresh string
	if refresh != "" {
		encRefresh, err = util.Encrypt(refresh, encKey)
		if err != nil {
			return "", "", "", fmt.Errorf("encrypt refresh token: %w", err)
		}
	}

	var encSecret string
	if secret != "" {
		encSecret, err = util.Encrypt(secret, encKey)
		if err != nil {
			return "", "", "", fmt.Errorf("encrypt client secret: %w", err)
		}
	}

	return encAccess, encRefresh, encSecret, nil
}
