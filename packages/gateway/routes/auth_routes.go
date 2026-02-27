package routes

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/config"
	"github.com/kiro-gateway/gateway/middleware"
	"github.com/kiro-gateway/gateway/storage"
	"github.com/kiro-gateway/gateway/util"
)

// RegisterAuthRoutes registers the /auth/* authentication endpoints.
func RegisterAuthRoutes(group *gin.RouterGroup) {
	auth := group.Group("/auth")
	{
		auth.POST("/login", handleLogin)
		auth.GET("/me", handleMe)
		auth.PUT("/password", handleChangePassword)
		auth.POST("/logout", handleLogout)
	}
}

// loginRequest is the expected body for POST /auth/login.
type loginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// handleLogin validates admin credentials and returns a JWT token.
func handleLogin(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		util.ValidationError(c, "Username and password are required")
		return
	}

	valid, err := storage.ValidatePassword(req.Username, req.Password)
	if err != nil {
		log.Error().Err(err).Msg("Login validation error")
		util.ServerError(c, "Login failed")
		return
	}
	if !valid {
		util.UnauthorizedError(c, "Invalid username or password")
		return
	}

	token, err := middleware.GenerateToken(req.Username)
	if err != nil {
		log.Error().Err(err).Msg("Failed to generate JWT token")
		util.ServerError(c, "Failed to generate token")
		return
	}

	cfg := config.GetConfig()
	util.SuccessJSON(c, gin.H{
		"token":     token,
		"expiresIn": cfg.JWT.ExpiresIn,
		"user":      gin.H{"username": req.Username},
	})
}

// handleMe returns the current authenticated user's information.
func handleMe(c *gin.Context) {
	username, exists := c.Get("username")
	if !exists {
		util.UnauthorizedError(c, "Not authenticated")
		return
	}

	now := time.Now().UnixMilli()
	util.SuccessJSON(c, gin.H{
		"user": gin.H{
			"username":  username,
			"createdAt": now,
			"updatedAt": now,
		},
	})
}

// changePasswordRequest is the expected body for PUT /auth/password.
type changePasswordRequest struct {
	OldPassword string `json:"oldPassword" binding:"required"`
	NewPassword string `json:"newPassword" binding:"required"`
}

// handleChangePassword validates the old password and sets a new one.
func handleChangePassword(c *gin.Context) {
	var req changePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		util.ValidationError(c, "Old password and new password are required")
		return
	}

	if len(req.NewPassword) < 6 {
		util.ValidationError(c, "New password must be at least 6 characters")
		return
	}

	err := storage.UpdatePassword(req.OldPassword, req.NewPassword)
	if err != nil {
		if err.Error() == "old password verification failed" {
			util.UnauthorizedError(c, "Old password is incorrect")
			return
		}
		log.Error().Err(err).Msg("Failed to update password")
		util.ServerError(c, "Failed to update password")
		return
	}

	util.SuccessJSON(c, gin.H{
		"message": "Password updated successfully",
	})
}

// handleLogout removes the current JWT token from the Redis whitelist.
func handleLogout(c *gin.Context) {
	tokenVal, exists := c.Get("token")
	if !exists {
		util.SuccessJSON(c, gin.H{"message": "Logged out"})
		return
	}

	token, ok := tokenVal.(string)
	if !ok || token == "" {
		util.SuccessJSON(c, gin.H{"message": "Logged out"})
		return
	}

	ctx := context.Background()
	if err := storage.RemoveToken(ctx, token); err != nil {
		log.Error().Err(err).Msg("Failed to remove token from Redis")
	}

	c.JSON(http.StatusOK, util.APIResponse{
		Success: true,
		Data:    gin.H{"message": "Logged out successfully"},
	})
}
