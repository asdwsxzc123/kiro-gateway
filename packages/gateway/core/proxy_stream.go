package core

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/model"
)

// HandleClaudeStreamRequest handles a streaming Claude request with SSE output.
func (s *ProxyServer) HandleClaudeStreamRequest(
	c *gin.Context,
	request *model.ClaudeRequest,
	apiKeyID string,
	boundAccountIDs []string,
) {
	ctx := c.Request.Context()

	// Acquire global request queue slot.
	if err := s.requestQueue.Acquire(ctx); err != nil {
		writeSSEError(c, http.StatusServiceUnavailable, "request queue full")
		return
	}
	defer s.requestQueue.Release()

	// Execute the streaming request with retry.
	if err := s.streamWithRetry(c, request, apiKeyID, boundAccountIDs); err != nil {
		log.Error().Err(err).Str("apiKey", apiKeyID).Msg("Stream request failed")
		// If headers not yet sent, write an error event.
		if !c.Writer.Written() {
			kiroErr, ok := err.(*model.KiroApiError)
			if ok {
				writeSSEError(c, MapErrorToHTTPStatus(kiroErr), kiroErr.Msg)
			} else {
				writeSSEError(c, http.StatusInternalServerError, err.Error())
			}
		}
	}
}

// streamWithRetry attempts to stream a response, retrying with different accounts on error.
func (s *ProxyServer) streamWithRetry(
	c *gin.Context,
	request *model.ClaudeRequest,
	apiKeyID string,
	boundAccountIDs []string,
) error {
	s.mu.RLock()
	maxRetries := s.config.MaxRetries
	retryDelayMs := s.config.RetryDelayMs
	s.mu.RUnlock()

	ctx := c.Request.Context()
	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		// Check for client disconnect.
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// If headers already written, we cannot retry.
		if c.Writer.Written() {
			return lastErr
		}

		// Select an account.
		acct, err := s.selectAccount(boundAccountIDs)
		if err != nil {
			lastErr = err
			break
		}

		s.pool.IncrementConcurrency(acct.ID)
		requestID := fmt.Sprintf("%s-%d", acct.ID, time.Now().UnixNano())
		startTime := time.Now()
		s.inflightReqs.Store(requestID, inflightInfo{
			AccountID: acct.ID,
			Model:     request.Model,
			StartTime: startTime,
		})

		streamErr := s.executeStreamRequest(c, request, acct, apiKeyID, startTime)

		s.inflightReqs.Delete(requestID)
		s.pool.DecrementConcurrency(acct.ID)

		if streamErr == nil {
			s.pool.RecordSuccess(acct.ID)
			return nil
		}

		lastErr = streamErr

		// If headers already sent, we cannot retry with a different response.
		if c.Writer.Written() {
			return lastErr
		}

		// Classify the error to decide on retry.
		kiroErr, ok := streamErr.(*model.KiroApiError)
		if !ok {
			break
		}

		action := ClassifyRetryError(kiroErr)
		s.pool.RecordError(acct.ID, kiroErr.ErrorCode)

		if action == RetryActionNone {
			return lastErr
		}

		// Delay before retry.
		if attempt < maxRetries {
			select {
			case <-time.After(AddJitter(retryDelayMs)):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}

	return lastErr
}

// executeStreamRequest performs the streaming API call and writes SSE events to the client.
// This is a placeholder structure showing the SSE output pattern.
func (s *ProxyServer) executeStreamRequest(
	c *gin.Context,
	request *model.ClaudeRequest,
	account *model.ProxyAccount,
	apiKeyID string,
	startTime time.Time,
) error {
	// TODO: Wire to actual Kiro API streaming call.
	// The implementation below demonstrates the SSE framing protocol.

	// Set SSE headers.
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	msgID := "msg_" + uuid.New().String()

	// Send message_start event.
	messageStart := model.ClaudeStreamEvent{
		Type: "message_start",
		Message: &model.ClaudeResponse{
			ID:    msgID,
			Type:  "message",
			Role:  "assistant",
			Model: request.Model,
			Usage: model.ClaudeUsage{},
		},
	}
	if err := writeSSEEvent(c, "message_start", messageStart); err != nil {
		return err
	}

	// Send content_block_start event.
	blockIndex := 0
	blockStart := model.ClaudeStreamEvent{
		Type:  "content_block_start",
		Index: &blockIndex,
		ContentBlock: &model.ClaudeContentBlock{
			Type: "text",
			Text: "",
		},
	}
	if err := writeSSEEvent(c, "content_block_start", blockStart); err != nil {
		return err
	}

	// In a real implementation, this is where we would read frames from the
	// Kiro API streaming response and translate each into Claude SSE events:
	//   - Text deltas as content_block_delta with type "text_delta"
	//   - Tool use as tool_use content blocks
	//   - Thinking as thinking content blocks

	// Send content_block_stop event.
	blockStop := model.ClaudeStreamEvent{
		Type:  "content_block_stop",
		Index: &blockIndex,
	}
	if err := writeSSEEvent(c, "content_block_stop", blockStop); err != nil {
		return err
	}

	// Send message_delta event.
	stopReason := "end_turn"
	messageDelta := model.ClaudeStreamEvent{
		Type: "message_delta",
		Delta: &model.StreamDelta{
			StopReason: stopReason,
		},
		Usage: &model.ClaudeUsage{},
	}
	if err := writeSSEEvent(c, "message_delta", messageDelta); err != nil {
		return err
	}

	// Send message_stop event.
	messageStop := model.ClaudeStreamEvent{
		Type: "message_stop",
	}
	if err := writeSSEEvent(c, "message_stop", messageStop); err != nil {
		return err
	}

	// Log timing.
	elapsed := time.Since(startTime)
	log.Debug().
		Str("accountId", account.ID).
		Str("model", request.Model).
		Dur("elapsed", elapsed).
		Msg("Stream request completed")

	_ = apiKeyID // Used for stats recording in full implementation.

	return fmt.Errorf("executeStreamRequest not fully implemented")
}

// writeSSEEvent writes a single SSE event to the response writer.
func writeSSEEvent(c *gin.Context, eventType string, data interface{}) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal SSE event: %w", err)
	}

	_, err = fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", eventType, jsonData)
	if err != nil {
		return fmt.Errorf("write SSE event: %w", err)
	}
	c.Writer.Flush()
	return nil
}

// writeSSEError writes an error response. If headers have not been sent, it sets
// the status code; otherwise it writes an error SSE event.
func writeSSEError(c *gin.Context, statusCode int, message string) {
	if c.Writer.Written() {
		// Headers already sent; write an error event in the stream.
		errEvent := model.ClaudeStreamEvent{
			Type: "error",
			Error: &model.StreamError{
				Type:    "server_error",
				Message: message,
			},
		}
		_ = writeSSEEvent(c, "error", errEvent)
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Status(statusCode)
	errEvent := model.ClaudeStreamEvent{
		Type: "error",
		Error: &model.StreamError{
			Type:    "server_error",
			Message: message,
		},
	}
	_ = writeSSEEvent(c, "error", errEvent)
}
