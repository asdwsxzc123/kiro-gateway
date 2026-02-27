package model

import (
	"fmt"
	"strings"
)

// KiroErrorCode categorises upstream Kiro API errors.
type KiroErrorCode string

const (
	KiroErrorQuotaExhausted   KiroErrorCode = "QUOTA_EXHAUSTED"
	KiroErrorServerError      KiroErrorCode = "SERVER_ERROR"
	KiroErrorOverloaded       KiroErrorCode = "OVERLOADED"
	KiroErrorAuthError        KiroErrorCode = "AUTH_ERROR"
	KiroErrorMonthlyLimit     KiroErrorCode = "MONTHLY_LIMIT"
	KiroErrorAccountSuspended KiroErrorCode = "ACCOUNT_SUSPENDED"
	KiroErrorUnknown          KiroErrorCode = "UNKNOWN"
)

// KiroApiError is a structured error from the Kiro upstream API.
type KiroApiError struct {
	StatusCode int           `json:"statusCode"`
	ErrorCode  KiroErrorCode `json:"errorCode"`
	Retryable  bool          `json:"retryable"`
	Endpoint   string        `json:"endpoint,omitempty"`
	Msg        string        `json:"message"`
}

// Error implements the error interface.
func (e *KiroApiError) Error() string {
	if e.Endpoint != "" {
		return fmt.Sprintf("KiroApiError [%s] %d %s: %s",
			e.ErrorCode, e.StatusCode, e.Endpoint, e.Msg)
	}
	return fmt.Sprintf("KiroApiError [%s] %d: %s",
		e.ErrorCode, e.StatusCode, e.Msg)
}

// NewKiroApiError creates a KiroApiError with all fields specified.
func NewKiroApiError(
	message string,
	statusCode int,
	errorCode KiroErrorCode,
	retryable bool,
	endpoint string,
) *KiroApiError {
	return &KiroApiError{
		Msg:        message,
		StatusCode: statusCode,
		ErrorCode:  errorCode,
		Retryable:  retryable,
		Endpoint:   endpoint,
	}
}

// KiroApiErrorFromHTTPResponse maps an HTTP status code and response body
// to the appropriate KiroApiError, matching the TypeScript implementation.
func KiroApiErrorFromHTTPResponse(
	status int,
	body string,
	endpoint string,
) *KiroApiError {
	switch {
	case status == 429:
		return NewKiroApiError(
			fmt.Sprintf("Quota exhausted: %s", body),
			429, KiroErrorQuotaExhausted, true, endpoint,
		)

	case status == 529:
		return NewKiroApiError(
			fmt.Sprintf("Service overloaded: %s", body),
			529, KiroErrorOverloaded, true, endpoint,
		)

	case status == 401 || status == 403:
		return NewKiroApiError(
			fmt.Sprintf("Auth error %d: %s", status, body),
			status, KiroErrorAuthError, false, endpoint,
		)

	case status == 402 || strings.Contains(body, "MONTHLY_REQUEST_COUNT"):
		return NewKiroApiError(
			fmt.Sprintf("Monthly limit: %s", body),
			status, KiroErrorMonthlyLimit, false, endpoint,
		)

	case strings.Contains(body, "TEMPORARILY_SUSPENDED") ||
		strings.Contains(body, "temporarily is suspended"):
		return NewKiroApiError(
			fmt.Sprintf("Account suspended: %s", body),
			status, KiroErrorAccountSuspended, false, endpoint,
		)

	case status >= 500:
		return NewKiroApiError(
			fmt.Sprintf("Server error %d: %s", status, body),
			status, KiroErrorServerError, true, endpoint,
		)

	default:
		return NewKiroApiError(
			fmt.Sprintf("API error %d: %s", status, body),
			status, KiroErrorUnknown, false, endpoint,
		)
	}
}
