package routes

import "github.com/kiro-gateway/gateway/model"

// buildAccountUpdates converts an UpdateAccountRequest into a map suitable
// for storage.UpdateAccount. Only non-nil fields are included.
func buildAccountUpdates(req *model.UpdateAccountRequest) map[string]interface{} {
	updates := make(map[string]interface{})

	if req.Alias != nil {
		updates["alias"] = *req.Alias
	}
	if req.Email != nil {
		updates["email"] = *req.Email
	}
	if req.UserID != nil {
		updates["userId"] = *req.UserID
	}
	if req.AccessToken != nil {
		updates["accessToken"] = *req.AccessToken
	}
	if req.RefreshToken != nil {
		updates["refreshToken"] = *req.RefreshToken
	}
	if req.ClientID != nil {
		updates["clientId"] = *req.ClientID
	}
	if req.ClientSecret != nil {
		updates["clientSecret"] = *req.ClientSecret
	}
	if req.Region != nil {
		updates["region"] = *req.Region
	}
	if req.AuthMethod != nil {
		updates["authMethod"] = *req.AuthMethod
	}
	if req.Provider != nil {
		updates["provider"] = *req.Provider
	}
	if req.ProfileArn != nil {
		updates["profileArn"] = *req.ProfileArn
	}
	if req.MachineID != nil {
		updates["machineId"] = *req.MachineID
	}
	if req.Status != nil {
		updates["status"] = string(*req.Status)
	}
	if req.ExpiresAt != nil {
		updates["expiresAt"] = *req.ExpiresAt
	}
	if req.StatusChangedAt != nil {
		updates["statusChangedAt"] = *req.StatusChangedAt
	}
	if req.StatusReason != nil {
		updates["statusReason"] = *req.StatusReason
	}
	if req.MaxConcurrency != nil {
		updates["maxConcurrency"] = *req.MaxConcurrency
	}
	if req.ProxyURL != nil {
		updates["proxyUrl"] = *req.ProxyURL
	}
	if req.ErrorCount != nil {
		updates["errorCount"] = *req.ErrorCount
	}
	if req.CooldownUntil != nil {
		updates["cooldownUntil"] = *req.CooldownUntil
	}
	if req.RequestCount != nil {
		updates["requestCount"] = *req.RequestCount
	}
	if req.LastUsed != nil {
		updates["lastUsed"] = *req.LastUsed
	}

	return updates
}
