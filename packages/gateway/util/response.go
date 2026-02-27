package util

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Error type constants matching the TypeScript backend.
const (
	ErrTypeValidation     = "validation_error"
	ErrTypeAuthentication = "authentication_error"
	ErrTypeAuthorization  = "authorization_error"
	ErrTypeNotFound       = "not_found"
	ErrTypeServer         = "server_error"
	ErrTypeRateLimit      = "rate_limit_error"
)

// APIError represents the error object in an API response.
type APIError struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Code    string `json:"code,omitempty"`
}

// APIResponse is the standard envelope for all JSON API responses.
type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   *APIError   `json:"error,omitempty"`
}

// SuccessJSON sends a 200 JSON response with the given data.
func SuccessJSON(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, APIResponse{
		Success: true,
		Data:    data,
	})
}

// SuccessJSONWithStatus sends a JSON success response with a custom HTTP status.
func SuccessJSONWithStatus(c *gin.Context, status int, data interface{}) {
	c.JSON(status, APIResponse{
		Success: true,
		Data:    data,
	})
}

// ErrorJSON sends a JSON error response with the given status, message, and
// error type.
func ErrorJSON(c *gin.Context, status int, message, errType string) {
	c.JSON(status, APIResponse{
		Success: false,
		Error: &APIError{
			Message: message,
			Type:    errType,
		},
	})
}

// ErrorJSONWithCode sends a JSON error response that includes an application-
// level error code in addition to the message and type.
func ErrorJSONWithCode(c *gin.Context, status int, message, errType, code string) {
	c.JSON(status, APIResponse{
		Success: false,
		Error: &APIError{
			Message: message,
			Type:    errType,
			Code:    code,
		},
	})
}

// ValidationError sends a 400 validation error response.
func ValidationError(c *gin.Context, message string) {
	ErrorJSON(c, http.StatusBadRequest, message, ErrTypeValidation)
}

// UnauthorizedError sends a 401 authentication error response.
func UnauthorizedError(c *gin.Context, message string) {
	ErrorJSON(c, http.StatusUnauthorized, message, ErrTypeAuthentication)
}

// ForbiddenError sends a 403 authorization error response.
func ForbiddenError(c *gin.Context, message string) {
	ErrorJSON(c, http.StatusForbidden, message, ErrTypeAuthorization)
}

// NotFoundError sends a 404 not-found error response.
func NotFoundError(c *gin.Context, message string) {
	ErrorJSON(c, http.StatusNotFound, message, ErrTypeNotFound)
}

// ServerError sends a 500 internal server error response.
func ServerError(c *gin.Context, message string) {
	ErrorJSON(c, http.StatusInternalServerError, message, ErrTypeServer)
}

// RateLimitError sends a 429 rate-limit error response.
func RateLimitError(c *gin.Context, message string) {
	ErrorJSON(c, http.StatusTooManyRequests, message, ErrTypeRateLimit)
}
