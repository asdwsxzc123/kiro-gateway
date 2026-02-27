package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/util"
)

// ErrorHandler returns a Gin middleware that recovers from panics and
// responds with a 500 JSON error. It wraps gin.Recovery with custom
// error formatting.
func ErrorHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if err := recover(); err != nil {
				log.Error().
					Interface("error", err).
					Str("method", c.Request.Method).
					Str("path", c.Request.URL.Path).
					Str("clientIP", c.ClientIP()).
					Msg("Panic recovered in request handler")

				// Abort if headers have not been written yet.
				if !c.Writer.Written() {
					util.ErrorJSON(c, http.StatusInternalServerError,
						"Internal Server Error", util.ErrTypeServer)
				}
				c.Abort()
			}
		}()

		c.Next()
	}
}

// NotFoundHandler responds with a 404 JSON error for unmatched routes.
func NotFoundHandler(c *gin.Context) {
	util.ErrorJSON(c, http.StatusNotFound,
		"Not Found", util.ErrTypeNotFound)
}
