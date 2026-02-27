package util

import (
	"io"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

var globalLogger zerolog.Logger

func init() {
	// Default: console writer at info level until InitLogger is called.
	writer := zerolog.ConsoleWriter{
		Out:        os.Stdout,
		TimeFormat: time.RFC3339,
	}
	globalLogger = zerolog.New(writer).With().Timestamp().Logger()
	zerolog.SetGlobalLevel(zerolog.InfoLevel)
}

// InitLogger initialises the global logger at the given level string.
// Accepted values: "trace", "debug", "info", "warn", "error", "fatal", "panic".
// Any unrecognised value defaults to "info".
func InitLogger(level string) {
	lvl := parseLevel(level)
	zerolog.SetGlobalLevel(lvl)

	var writer io.Writer
	if os.Getenv("NODE_ENV") == "production" {
		// In production, output structured JSON to stdout.
		writer = os.Stdout
	} else {
		// In development, use a human-friendly console writer.
		writer = zerolog.ConsoleWriter{
			Out:        os.Stdout,
			TimeFormat: time.RFC3339,
		}
	}

	globalLogger = zerolog.New(writer).With().Timestamp().Logger()
}

// GetLogger returns the global zerolog.Logger instance.
func GetLogger() zerolog.Logger {
	return globalLogger
}

// CreateLogger returns a sub-logger with a "component" field set to the given
// name. Use this to identify log output from distinct subsystems.
func CreateLogger(name string) zerolog.Logger {
	return globalLogger.With().Str("component", name).Logger()
}

// parseLevel converts a level string to a zerolog.Level.
func parseLevel(level string) zerolog.Level {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "trace":
		return zerolog.TraceLevel
	case "debug":
		return zerolog.DebugLevel
	case "info":
		return zerolog.InfoLevel
	case "warn", "warning":
		return zerolog.WarnLevel
	case "error":
		return zerolog.ErrorLevel
	case "fatal":
		return zerolog.FatalLevel
	case "panic":
		return zerolog.PanicLevel
	default:
		return zerolog.InfoLevel
	}
}
