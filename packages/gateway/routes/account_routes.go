package routes

import (
	"context"
	"net/http"
	"strings"
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

// RegisterAccountRoutes registers the /accounts/* CRUD and batch endpoints.
func RegisterAccountRoutes(group *gin.RouterGroup, ps *core.ProxyServer) {
	accounts := group.Group("/accounts")
	{
		accounts.GET("", handleListAccounts)
		accounts.GET("/usage/all", handleAllAccountsUsage)
		accounts.GET("/:id", handleGetAccount)
		accounts.GET("/:id/usage", handleGetAccountUsage)
		accounts.POST("", handleAddAccount(ps))
		accounts.PUT("/:id", handleUpdateAccount(ps))
		accounts.DELETE("/:id", handleDeleteAccount(ps))
		accounts.POST("/:id/pause", handlePauseAccount(ps))
		accounts.POST("/:id/resume", handleResumeAccount(ps))
		accounts.POST("/:id/refresh", handleRefreshAccount(ps))
		accounts.POST("/:id/test", handleTestAccount(ps))
		accounts.POST("/:id/regenerate-machine-id", handleRegenerateMachineID(ps))
		accounts.POST("/batch/import", handleBatchImport(ps))
		accounts.POST("/batch/pause", handleBatchPause(ps))
		accounts.POST("/batch/resume", handleBatchResume(ps))
		accounts.POST("/batch/delete", handleBatchDelete(ps))
		accounts.POST("/batch/update-concurrency", handleBatchUpdateConcurrency(ps))
	}
}

func handleListAccounts(c *gin.Context) {
	ctx := context.Background()
	accounts, err := storage.GetAllAccounts(ctx)
	if err != nil {
		log.Error().Err(err).Msg("Failed to list accounts")
		util.ServerError(c, "Failed to list accounts")
		return
	}
	safeList := make([]map[string]interface{}, 0, len(accounts))
	for i := range accounts {
		safeList = append(safeList, accounts[i].SafeCopy())
	}
	util.SuccessJSON(c, safeList)
}

// handleAllAccountsUsage returns usage data for all accounts as AccountUsage[].
func handleAllAccountsUsage(c *gin.Context) {
	ctx := context.Background()
	accounts, err := storage.GetAllAccounts(ctx)
	if err != nil {
		log.Error().Err(err).Msg("Failed to get all accounts for usage")
		util.ServerError(c, "Failed to get usage stats")
		return
	}

	type usageResult struct {
		index int
		usage model.AccountUsage
	}

	results := make([]model.AccountUsage, len(accounts))
	ch := make(chan usageResult, len(accounts))

	for i := range accounts {
		go func(idx int) {
			acct := &accounts[idx]
			au := model.AccountUsage{
				AccountID: acct.ID,
				UpdatedAt: time.Now().UnixMilli(),
			}
			usage, fetchErr := core.FetchUsageLimits(ctx, acct)
			if fetchErr != nil {
				au.Error = fetchErr.Error()
				// Check for TEMPORARILY_SUSPENDED - auto-suspend the account
				errStr := fetchErr.Error()
				if strings.Contains(errStr, "TEMPORARILY_SUSPENDED") || strings.Contains(errStr, "suspended") {
					statusReason := "Usage check detected suspension: " + errStr
					_ = storage.SetAccountStatus(ctx, acct.ID, model.AccountStatusSuspended, statusReason)
					go services.NotifyAccountStatusChange(ctx, acct.ID, model.AccountStatusSuspended, statusReason)
				}
			} else {
				au.Usage = usage
			}
			ch <- usageResult{index: idx, usage: au}
		}(i)
	}

	// Collect results
	for range accounts {
		r := <-ch
		results[r.index] = r.usage
	}

	util.SuccessJSON(c, results)
}

func handleGetAccount(c *gin.Context) {
	ctx := context.Background()
	id := c.Param("id")
	account, err := storage.GetAccountByID(ctx, id)
	if err != nil {
		util.ServerError(c, "Failed to get account")
		return
	}
	if account == nil {
		util.NotFoundError(c, "Account not found")
		return
	}
	util.SuccessJSON(c, account.SafeCopy())
}

// handleGetAccountUsage returns usage limits for a single account.
func handleGetAccountUsage(c *gin.Context) {
	id := c.Param("id")
	ctx := context.Background()
	account, err := storage.GetAccountByID(ctx, id)
	if err != nil || account == nil {
		util.NotFoundError(c, "Account not found")
		return
	}
	usage, err := core.FetchUsageLimits(ctx, account)
	if err != nil {
		log.Error().Err(err).Str("accountId", id).Msg("Failed to fetch usage limits")
		util.ServerError(c, "Failed to fetch usage limits: "+err.Error())
		return
	}
	util.SuccessJSON(c, usage)
}

func handleAddAccount(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req model.AddAccountRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			util.ValidationError(c, "Invalid request: "+err.Error())
			return
		}
		if req.AccessToken == "" && req.RefreshToken == "" {
			util.ValidationError(c, "Either accessToken or refreshToken is required")
			return
		}
		now := time.Now().UnixMilli()
		machineID := core.NormalizeMachineID(req.MachineID)
		account := &model.ProxyAccount{
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
		ctx := context.Background()

		// If refreshToken is available, attempt token refresh
		if req.RefreshToken != "" {
			refreshResult, refreshErr := core.RefreshTokenByMethod(ctx, account)
			if refreshErr == nil && refreshResult.Success {
				account.AccessToken = refreshResult.AccessToken
				if refreshResult.RefreshToken != "" {
					account.RefreshToken = refreshResult.RefreshToken
				}
				account.ExpiresAt = refreshResult.ExpiresAt
			} else {
				errMsg := "token refresh failed"
				if refreshErr != nil {
					errMsg = refreshErr.Error()
				}
				log.Warn().Str("email", req.Email).Str("error", errMsg).Msg("Add account: token refresh failed, continuing with provided data")
			}
		}

		if err := storage.AddAccount(ctx, account); err != nil {
			log.Error().Err(err).Msg("Failed to add account")
			util.ServerError(c, "Failed to add account")
			return
		}
		_ = ps.RefreshAccounts()
		util.SuccessJSONWithStatus(c, http.StatusCreated, account.SafeCopy())
	}
}

func handleUpdateAccount(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var req model.UpdateAccountRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			util.ValidationError(c, "Invalid request: "+err.Error())
			return
		}
		ctx := context.Background()
		existing, err := storage.GetAccountByID(ctx, id)
		if err != nil || existing == nil {
			util.NotFoundError(c, "Account not found")
			return
		}
		updates := buildAccountUpdates(&req)
		if len(updates) == 0 {
			util.ValidationError(c, "No fields to update")
			return
		}
		if err := storage.UpdateAccount(ctx, id, updates); err != nil {
			util.ServerError(c, "Failed to update account")
			return
		}
		_ = ps.RefreshAccounts()
		updated, _ := storage.GetAccountByID(ctx, id)
		if updated != nil {
			util.SuccessJSON(c, updated.SafeCopy())
		} else {
			util.SuccessJSON(c, gin.H{"message": "Account updated"})
		}
	}
}

func handleDeleteAccount(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		ctx := context.Background()
		if err := storage.DeleteAccount(ctx, id); err != nil {
			util.NotFoundError(c, "Account not found")
			return
		}
		_ = storage.RemoveAccountFromApiKeys(ctx, id)

		// Clean up selectedAccounts
		selectedIDs, _ := storage.GetSelectedAccounts(ctx)
		if len(selectedIDs) > 0 {
			var newSelected []string
			for _, sid := range selectedIDs {
				if sid != id {
					newSelected = append(newSelected, sid)
				}
			}
			if len(newSelected) != len(selectedIDs) {
				_ = storage.SetSelectedAccounts(ctx, newSelected)
			}
		}

		_ = ps.RefreshAccounts()
		util.SuccessJSON(c, gin.H{"message": "Account deleted"})
	}
}

func handlePauseAccount(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		ctx := context.Background()
		if err := storage.SetAccountStatus(ctx, id, model.AccountStatusPaused, "Paused by admin"); err != nil {
			util.ServerError(c, "Failed to pause account")
			return
		}
		go services.NotifyAccountStatusChange(ctx, id, model.AccountStatusPaused, "Paused by admin")
		_ = ps.RefreshAccounts()
		util.SuccessJSON(c, gin.H{"id": id, "status": "paused"})
	}
}

func handleResumeAccount(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		ctx := context.Background()
		if err := storage.SetAccountStatus(ctx, id, model.AccountStatusActive, ""); err != nil {
			util.ServerError(c, "Failed to resume account")
			return
		}
		_ = ps.RefreshAccounts()
		util.SuccessJSON(c, gin.H{"id": id, "status": "active"})
	}
}

func handleRefreshAccount(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		ctx := context.Background()
		account, err := storage.GetAccountByID(ctx, id)
		if err != nil || account == nil {
			util.NotFoundError(c, "Account not found")
			return
		}
		// Attempt token refresh for this specific account.
		result, refreshErr := core.RefreshTokenByMethod(ctx, account)
		if refreshErr != nil {
			log.Warn().Err(refreshErr).Str("accountId", id).Msg("Token refresh failed")
		}
		if result != nil && result.Success {
			updates := map[string]interface{}{
				"accessToken": result.AccessToken,
				"expiresAt":   result.ExpiresAt,
			}
			if result.RefreshToken != "" {
				updates["refreshToken"] = result.RefreshToken
			}
			_ = storage.UpdateAccount(ctx, id, updates)
		}
		_ = ps.RefreshAccounts()
		// Re-fetch and return the updated account.
		updated, _ := storage.GetAccountByID(ctx, id)
		if updated != nil {
			util.SuccessJSON(c, updated.SafeCopy())
		} else {
			util.SuccessJSON(c, account.SafeCopy())
		}
	}
}

func handleTestAccount(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		ctx := context.Background()
		account, err := storage.GetAccountByID(ctx, id)
		if err != nil || account == nil {
			util.NotFoundError(c, "Account not found")
			return
		}
		usage, err := core.FetchUsageLimits(ctx, account)
		if err != nil {
			errMsg := err.Error()
			log.Warn().Err(err).Str("accountId", id).Msg("Test connection failed")

			// Mark account as error_suspended (matches Node.js behavior).
			statusReason := "测试失败: " + errMsg
			_ = storage.SetAccountStatus(ctx, id, model.AccountStatusErrorSuspended, statusReason)
			_ = ps.RefreshAccounts()

			// Send webhook notification asynchronously.
			go services.NotifyAccountStatusChange(ctx, id, model.AccountStatusErrorSuspended, statusReason)

			util.SuccessJSON(c, gin.H{
				"response": gin.H{"error": errMsg},
				"model":    "usage-limits",
				"success":  false,
				"error":    errMsg,
			})
			return
		}
		util.SuccessJSON(c, gin.H{
			"response": usage,
			"model":    "usage-limits",
			"success":  true,
		})
	}
}

func handleRegenerateMachineID(ps *core.ProxyServer) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		ctx := context.Background()
		newMID := core.GenerateMachineID()
		if err := storage.RegenerateMachineID(ctx, id, newMID); err != nil {
			util.ServerError(c, "Failed to regenerate machine ID")
			return
		}
		_ = ps.RefreshAccounts()
		// Re-fetch and return the full account.
		updated, _ := storage.GetAccountByID(ctx, id)
		if updated != nil {
			util.SuccessJSON(c, updated.SafeCopy())
		} else {
			util.SuccessJSON(c, gin.H{"machineId": newMID})
		}
	}
}
