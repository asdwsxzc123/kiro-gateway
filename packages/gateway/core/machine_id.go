// Package core contains the core business logic for the kiro-gateway,
// including proxy orchestration, session management, and pricing calculations.
package core

import (
	"regexp"
	"strings"

	"github.com/google/uuid"
)

// uuidRegex matches a standard UUID format (lowercase hex with dashes).
var uuidRegex = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// hexRegex matches a 32-character lowercase hex string (UUID without dashes).
var hexRegex = regexp.MustCompile(`^[0-9a-f]{32}$`)

// GenerateMachineID creates a new random machine ID in UUID v4 format.
func GenerateMachineID() string {
	return uuid.New().String()
}

// IsValidMachineID checks whether the given string is a valid machine ID.
// Accepts both standard UUID format (with dashes) and 32-character hex format.
func IsValidMachineID(id string) bool {
	lower := strings.ToLower(id)
	return uuidRegex.MatchString(lower) || hexRegex.MatchString(lower)
}

// FormatAsUUID converts a 32-character hex string into standard UUID format
// with dashes (8-4-4-4-12). If the input is not exactly 32 hex characters,
// it is returned as-is.
func FormatAsUUID(hex string) string {
	lower := strings.ToLower(hex)
	if !hexRegex.MatchString(lower) {
		return hex
	}
	return lower[:8] + "-" + lower[8:12] + "-" + lower[12:16] + "-" + lower[16:20] + "-" + lower[20:]
}

// FormatAsHex converts a UUID string into a 32-character hex string by
// removing all dashes. Non-UUID inputs are returned with dashes stripped.
func FormatAsHex(id string) string {
	return strings.ReplaceAll(strings.ToLower(id), "-", "")
}

// NormalizeMachineID lowercases and validates the given machine ID.
// If the ID is invalid or empty, a new machine ID is generated automatically.
func NormalizeMachineID(id string) string {
	trimmed := strings.TrimSpace(id)
	if trimmed == "" {
		return GenerateMachineID()
	}

	lower := strings.ToLower(trimmed)

	// Already a valid UUID.
	if uuidRegex.MatchString(lower) {
		return lower
	}

	// Valid 32-char hex, convert to UUID format.
	if hexRegex.MatchString(lower) {
		return FormatAsUUID(lower)
	}

	// Invalid format, generate a new one.
	return GenerateMachineID()
}
