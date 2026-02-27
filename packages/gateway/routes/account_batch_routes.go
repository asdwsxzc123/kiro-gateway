package routes

import (
	"context"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/core"
	"github.com/kiro-gateway/gateway/model"
	"github.com/kiro-gateway/gateway/services"
	"github.com/kiro-gateway/gateway/storage"
	"github.com/kiro-gateway/gateway/util"
)

// batchIDsRequest is used for batch operations that take a list of IDs.
// Accepts both "ids" and "accountIds" for frontend compatibility.
type batchIDsRequest struct {
	IDs        []string `json:"ids"`
	AccountIDs []string `json:"accountIds"`
}

// mergedIDs returns the combined, deduplicated list from IDs and AccountIDs.
func (r *batchIDsRequest) mergedIDs() []string {
	seen := make(map[string]struct{})
	var result []string
	for _, id := range r.IDs {
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			result = append(result, id)
		}
	}
	for _, id := range r.AccountIDs {
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			result = append(result, id)
		}
	}
	return result
}

// batchConcurrencyRequest carries IDs and a target concurrency value.
type batchConcurrencyRequest struct {
	IDs            []string `json:"ids"`
	AccountIDs     []string `json:"accountIds"`
	MaxConcurrency int      `json:"maxConcurrency"`
}

func (r *batchConcurrencyRequest) mergedIDs() []string {
	seen := make(map[string]struct{})
	var result []string
	for _, id := range r.IDs {
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			result = append(result, id)
		}
	}
	for _, id := range r.AccountIDs {
		if _, ok := seen[id]; !ok {
			seen[id] = struct{}{}
			result = append(result, id)
		}
	}
	return result
}

func handleBatchImport(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		var accounts []model.AddAccountRequest
		if err := c.ShouldBindJSON(&accounts); err != nil {
			util.ValidationError(c, "Invalid request: "+err.Error())
			return
		}
		ctx := context.Background()
		now := time.Now().UnixMilli()
		successCount := 0
		failedCount := 0
		errors := make([]string, 0)
		for i, req := range accounts {
			if req.AccessToken == "" && req.RefreshToken == "" {
				failedCount++
				errors = append(errors, fmt.Sprintf("Account #%d (%s): either accessToken or refreshToken is required", i+1, req.Email))
				continue
			}
			machineID := core.NormalizeMachineID(req.MachineID)
			acct := &model.ProxyAccount{
				ID:                 uuid.New().String(),
				Alias:              req.Alias,
				Email:              req.Email,
				AccessToken:        req.AccessToken,
				RefreshToken:       req.RefreshToken,
				ClientID:           req.ClientID,
				ClientSecret:       req.ClientSecret,
				Region:             req.Region,
				AuthMethod:         req.AuthMethod,
				Provider:           req.Provider,
				ProfileArn:         req.ProfileArn,
				MachineID:          machineID,
				MaxConcurrency:     req.MaxConcurrency,
				ProxyURL:           req.ProxyURL,
				Status:             model.AccountStatusActive,
				CreatedAt:          now,
				MachineIDCreatedAt: now,
			}

			// Try to refresh token if refreshToken is available
			if req.RefreshToken != "" {
				refreshResult, refreshErr := core.RefreshTokenByMethod(ctx, acct)
				if refreshErr == nil && refreshResult.Success {
					acct.AccessToken = refreshResult.AccessToken
					if refreshResult.RefreshToken != "" {
						acct.RefreshToken = refreshResult.RefreshToken
					}
					acct.ExpiresAt = refreshResult.ExpiresAt
				} else {
					errMsg := "token refresh failed"
					if refreshErr != nil {
						errMsg = refreshErr.Error()
					}
					log.Warn().Str("email", req.Email).Str("error", errMsg).Msg("Import: token refresh failed, continuing with provided data")
				}
			}

			// Try to fetch usage limits to validate and extract user info
			usage, usageErr := core.FetchUsageLimits(ctx, acct)
			if usageErr == nil && usage != nil {
				if usage.UserInfo != nil {
					if usage.UserInfo.Email != "" && acct.Email == "" {
						acct.Email = usage.UserInfo.Email
					}
					if usage.UserInfo.UserID != "" && acct.UserID == "" {
						acct.UserID = usage.UserInfo.UserID
					}
				}
			} else {
				if usageErr != nil {
					log.Warn().Str("email", req.Email).Str("error", usageErr.Error()).Msg("Import: usage limits fetch failed")
				}
			}

			if err := storage.AddAccount(ctx, acct); err != nil {
				log.Warn().Err(err).Str("email", req.Email).Msg("Failed to import account")
				failedCount++
				errors = append(errors, fmt.Sprintf("Failed to import %s: %s", req.Email, err.Error()))
				continue
			}
			successCount++
		}
		_ = ps.RefreshAccounts()
		util.SuccessJSON(c, gin.H{
			"success": successCount,
			"failed":  failedCount,
			"errors":  errors,
		})
	}
}

func handleBatchPause(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req batchIDsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			util.ValidationError(c, "Invalid request: "+err.Error())
			return
		}
		ids := req.mergedIDs()
		if len(ids) == 0 {
			util.ValidationError(c, "No account IDs provided")
			return
		}
		ctx := context.Background()
		updated := 0
		for _, id := range ids {
			if err := storage.SetAccountStatus(ctx, id, model.AccountStatusPaused, "Batch paused"); err == nil {
				updated++
				go services.NotifyAccountStatusChange(ctx, id, model.AccountStatusPaused, "Batch paused")
			}
		}
		_ = ps.RefreshAccounts()
		util.SuccessJSON(c, gin.H{"updated": updated})
	}
}

func handleBatchResume(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req batchIDsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			util.ValidationError(c, "Invalid request: "+err.Error())
			return
		}
		ids := req.mergedIDs()
		if len(ids) == 0 {
			util.ValidationError(c, "No account IDs provided")
			return
		}
		ctx := context.Background()
		updated := 0
		for _, id := range ids {
			if err := storage.SetAccountStatus(ctx, id, model.AccountStatusActive, ""); err == nil {
				updated++
			}
		}
		_ = ps.RefreshAccounts()
		util.SuccessJSON(c, gin.H{"updated": updated})
	}
}

func handleBatchDelete(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req batchIDsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			util.ValidationError(c, "Invalid request: "+err.Error())
			return
		}
		ids := req.mergedIDs()
		if len(ids) == 0 {
			util.ValidationError(c, "No account IDs provided")
			return
		}
		ctx := context.Background()
		deleted := 0
		for _, id := range ids {
			if err := storage.DeleteAccount(ctx, id); err == nil {
				_ = storage.RemoveAccountFromApiKeys(ctx, id)
				deleted++
			}
		}

		// Clean up selectedAccounts
		selectedIDs, _ := storage.GetSelectedAccounts(ctx)
		if len(selectedIDs) > 0 {
			deletedSet := make(map[string]struct{})
			for _, id := range ids {
				deletedSet[id] = struct{}{}
			}
			var newSelected []string
			for _, sid := range selectedIDs {
				if _, isDeleted := deletedSet[sid]; !isDeleted {
					newSelected = append(newSelected, sid)
				}
			}
			if len(newSelected) != len(selectedIDs) {
				_ = storage.SetSelectedAccounts(ctx, newSelected)
			}
		}

		_ = ps.RefreshAccounts()
		util.SuccessJSON(c, gin.H{
			"deleted": deleted,
			"total":   len(ids),
		})
	}
}

func handleBatchUpdateConcurrency(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req batchConcurrencyRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			util.ValidationError(c, "Invalid request: "+err.Error())
			return
		}
		ids := req.mergedIDs()
		if len(ids) == 0 {
			util.ValidationError(c, "No account IDs provided")
			return
		}
		ctx := context.Background()
		updated := 0
		for _, id := range ids {
			err := storage.UpdateAccount(ctx, id, map[string]interface{}{
				"maxConcurrency": req.MaxConcurrency,
			})
			if err == nil {
				updated++
			}
		}
		_ = ps.RefreshAccounts()
		util.SuccessJSON(c, gin.H{
			"updated":        updated,
			"maxConcurrency": req.MaxConcurrency,
		})
	}
}
