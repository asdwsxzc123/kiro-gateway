package storage

import (
	"fmt"
	"strconv"
	"time"
)

// parseInt64 safely parses a string to int64, returning 0 on failure.
func parseInt64(s string) int64 {
	if s == "" {
		return 0
	}
	v, _ := strconv.ParseInt(s, 10, 64)
	return v
}

// parseFloat64 safely parses a string to float64, returning 0 on failure.
func parseFloat64(s string) float64 {
	if s == "" {
		return 0
	}
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

// strVal safely converts an interface{} to string.
func strVal(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}

// boolToStr converts bool to "true"/"false" string.
func boolToStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// truncate returns the first n characters of s, or s if shorter.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// nowMs returns the current time in milliseconds since epoch.
func nowMs() int64 {
	return time.Now().UnixMilli()
}
