package model

// AccountStatus represents the scheduling state of an account.
type AccountStatus string

const (
	AccountStatusActive         AccountStatus = "active"
	AccountStatusPaused         AccountStatus = "paused"
	AccountStatusErrorSuspended AccountStatus = "error_suspended"
	AccountStatusSuspended      AccountStatus = "suspended"
)

// ProxyAccount represents a proxy account with credentials and runtime state.
type ProxyAccount struct {
	ID                 string        `json:"id"`
	Alias              string        `json:"alias,omitempty"`
	Email              string        `json:"email,omitempty"`
	UserID             string        `json:"userId,omitempty"`
	AccessToken        string        `json:"accessToken"`
	RefreshToken       string        `json:"refreshToken,omitempty"`
	ClientID           string        `json:"clientId,omitempty"`
	ClientSecret       string        `json:"clientSecret,omitempty"`
	Region             string        `json:"region,omitempty"`
	AuthMethod         string        `json:"authMethod,omitempty"`
	Provider           string        `json:"provider,omitempty"`
	ProfileArn         string        `json:"profileArn,omitempty"`
	ExpiresAt          int64         `json:"expiresAt,omitempty"`
	MachineID          string        `json:"machineId"`
	MachineIDCreatedAt int64         `json:"machineIdCreatedAt,omitempty"`
	MaxConcurrency     int           `json:"maxConcurrency,omitempty"`
	ProxyURL           string        `json:"proxyUrl,omitempty"`
	LastUsed           int64         `json:"lastUsed,omitempty"`
	RequestCount       int64         `json:"requestCount,omitempty"`
	ErrorCount         int64         `json:"errorCount,omitempty"`
	Status             AccountStatus `json:"status,omitempty"`
	CooldownUntil      int64         `json:"cooldownUntil,omitempty"`
	CreatedAt          int64         `json:"createdAt,omitempty"`
	StatusChangedAt    int64         `json:"statusChangedAt,omitempty"`
	StatusReason       string        `json:"statusReason,omitempty"`
}

// AddAccountRequest is the request body for creating a new account.
type AddAccountRequest struct {
	Alias          string `json:"alias,omitempty"`
	Email          string `json:"email,omitempty"`
	AccessToken    string `json:"accessToken,omitempty"`
	RefreshToken   string `json:"refreshToken,omitempty"`
	ClientID       string `json:"clientId,omitempty"`
	ClientSecret   string `json:"clientSecret,omitempty"`
	Region         string `json:"region,omitempty"`
	AuthMethod     string `json:"authMethod,omitempty"`
	Provider       string `json:"provider,omitempty"`
	ProfileArn     string `json:"profileArn,omitempty"`
	MachineID      string `json:"machineId,omitempty"`
	MaxConcurrency int    `json:"maxConcurrency,omitempty"`
	ProxyURL       string `json:"proxyUrl,omitempty"`
}

// UpdateAccountRequest is the request body for updating an existing account.
// Pointer fields allow distinguishing between "not provided" and "set to zero value".
type UpdateAccountRequest struct {
	Alias           *string        `json:"alias,omitempty"`
	Email           *string        `json:"email,omitempty"`
	UserID          *string        `json:"userId,omitempty"`
	AccessToken     *string        `json:"accessToken,omitempty"`
	RefreshToken    *string        `json:"refreshToken,omitempty"`
	ClientID        *string        `json:"clientId,omitempty"`
	ClientSecret    *string        `json:"clientSecret,omitempty"`
	Region          *string        `json:"region,omitempty"`
	AuthMethod      *string        `json:"authMethod,omitempty"`
	Provider        *string        `json:"provider,omitempty"`
	ProfileArn      *string        `json:"profileArn,omitempty"`
	MachineID       *string        `json:"machineId,omitempty"`
	Status          *AccountStatus `json:"status,omitempty"`
	ExpiresAt       *int64         `json:"expiresAt,omitempty"`
	StatusChangedAt *int64         `json:"statusChangedAt,omitempty"`
	StatusReason    *string        `json:"statusReason,omitempty"`
	MaxConcurrency  *int           `json:"maxConcurrency,omitempty"`
	ProxyURL        *string        `json:"proxyUrl,omitempty"`
	ErrorCount      *int64         `json:"errorCount,omitempty"`
	CooldownUntil   *int64         `json:"cooldownUntil,omitempty"`
	RequestCount    *int64         `json:"requestCount,omitempty"`
	LastUsed        *int64         `json:"lastUsed,omitempty"`
}

// SafeCopy returns a map with sensitive fields (tokens, secrets) removed,
// suitable for listing accounts in API responses.
func (a *ProxyAccount) SafeCopy() map[string]interface{} {
	return map[string]interface{}{
		"id":                 a.ID,
		"alias":              a.Alias,
		"email":              a.Email,
		"userId":             a.UserID,
		"authMethod":         a.AuthMethod,
		"provider":           a.Provider,
		"region":             a.Region,
		"machineId":          a.MachineID,
		"machineIdCreatedAt": a.MachineIDCreatedAt,
		"maxConcurrency":     a.MaxConcurrency,
		"proxyUrl":           a.ProxyURL,
		"status":             a.Status,
		"statusReason":       a.StatusReason,
		"statusChangedAt":    a.StatusChangedAt,
		"errorCount":         a.ErrorCount,
		"requestCount":       a.RequestCount,
		"lastUsed":           a.LastUsed,
		"expiresAt":          a.ExpiresAt,
		"createdAt":          a.CreatedAt,
		"cooldownUntil":      a.CooldownUntil,
		"profileArn":         a.ProfileArn,
	}
}
