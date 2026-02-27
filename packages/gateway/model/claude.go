package model

import "encoding/json"

// ClaudeThinkingConfig controls extended thinking behaviour.
type ClaudeThinkingConfig struct {
	Type         string `json:"type"`                    // "enabled" or "disabled"
	BudgetTokens *int   `json:"budget_tokens,omitempty"` // token budget when enabled
}

// ClaudeRequest is the Claude Messages API request body.
type ClaudeRequest struct {
	Model      string               `json:"model"`
	Messages   []ClaudeMessage      `json:"messages"`
	MaxTokens  int                  `json:"max_tokens"`
	Temperature *float64            `json:"temperature,omitempty"`
	TopP       *float64             `json:"top_p,omitempty"`
	Stream     *bool                `json:"stream,omitempty"`
	System     json.RawMessage      `json:"system,omitempty"` // string or []ClaudeSystemBlock
	Tools      []ClaudeTool         `json:"tools,omitempty"`
	ToolChoice *ClaudeToolChoice    `json:"tool_choice,omitempty"`
	Thinking   *ClaudeThinkingConfig `json:"thinking,omitempty"`
}

// IsStream returns true when the request asks for SSE streaming.
func (r *ClaudeRequest) IsStream() bool {
	return r.Stream != nil && *r.Stream
}

// GetSystemPrompt extracts the system prompt regardless of whether it was
// supplied as a plain string or as an array of ClaudeSystemBlock objects.
func (r *ClaudeRequest) GetSystemPrompt() string {
	if r.System == nil {
		return ""
	}

	// Try plain string first.
	var s string
	if err := json.Unmarshal(r.System, &s); err == nil {
		return s
	}

	// Try array of system blocks.
	var blocks []ClaudeSystemBlock
	if err := json.Unmarshal(r.System, &blocks); err == nil {
		var result string
		for i, b := range blocks {
			if i > 0 {
				result += "\n"
			}
			result += b.Text
		}
		return result
	}

	return ""
}

// ClaudeMessage represents a single message in the conversation.
type ClaudeMessage struct {
	Role    string          `json:"role"` // "user" or "assistant"
	Content json.RawMessage `json:"content"` // string or []ClaudeContentBlock
}

// ClaudeSystemBlock is a typed system prompt block with optional cache control.
type ClaudeSystemBlock struct {
	Type         string            `json:"type"` // "text"
	Text         string            `json:"text"`
	CacheControl *CacheControlMeta `json:"cache_control,omitempty"`
}

// CacheControlMeta specifies ephemeral caching on a block.
type CacheControlMeta struct {
	Type string `json:"type"` // "ephemeral"
}

// ClaudeContentBlock is a polymorphic content block in messages.
type ClaudeContentBlock struct {
	Type         string             `json:"type"` // text, image, tool_use, tool_result, thinking
	Text         string             `json:"text,omitempty"`
	Thinking     string             `json:"thinking,omitempty"`
	Source       *ImageSource       `json:"source,omitempty"`
	ID           string             `json:"id,omitempty"`
	Name         string             `json:"name,omitempty"`
	Input        json.RawMessage    `json:"input,omitempty"`
	ToolUseID    string             `json:"tool_use_id,omitempty"`
	Content      json.RawMessage    `json:"content,omitempty"` // string or []ClaudeContentBlock
	CacheControl *CacheControlMeta  `json:"cache_control,omitempty"`
}

// ImageSource describes a base64-encoded image.
type ImageSource struct {
	Type      string `json:"type"`       // "base64"
	MediaType string `json:"media_type"` // e.g. "image/png"
	Data      string `json:"data"`
}

// ClaudeTool describes a tool available to the model.
type ClaudeTool struct {
	Type        string          `json:"type,omitempty"` // e.g. "web_search_20250305"
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
	MaxUses     *int            `json:"max_uses,omitempty"`
}

// ClaudeToolChoice controls how the model selects tools.
type ClaudeToolChoice struct {
	Type string `json:"type"`
	Name string `json:"name,omitempty"`
}

// ClaudeUsage contains token usage information in a response.
type ClaudeUsage struct {
	InputTokens              int                   `json:"input_tokens"`
	OutputTokens             int                   `json:"output_tokens"`
	CacheCreationInputTokens int                   `json:"cache_creation_input_tokens,omitempty"`
	CacheReadInputTokens     int                   `json:"cache_read_input_tokens,omitempty"`
	CacheCreation            *CacheCreationDetails `json:"cache_creation,omitempty"`
}

// CacheCreationDetails provides granular cache token breakdown.
type CacheCreationDetails struct {
	Ephemeral1hInputTokens int `json:"ephemeral_1h_input_tokens"`
	Ephemeral5mInputTokens int `json:"ephemeral_5m_input_tokens"`
}

// ClaudeResponse is the non-streaming response from the Claude Messages API.
type ClaudeResponse struct {
	ID           string               `json:"id"`
	Type         string               `json:"type"`      // "message"
	Role         string               `json:"role"`      // "assistant"
	Content      []ClaudeContentBlock `json:"content"`
	Model        string               `json:"model"`
	StopReason   *string              `json:"stop_reason"`   // end_turn, max_tokens, tool_use
	StopSequence *string              `json:"stop_sequence"`
	Usage        ClaudeUsage          `json:"usage"`
}

// ClaudeStreamEvent represents a single SSE event in a streaming response.
type ClaudeStreamEvent struct {
	Type         string               `json:"type"`
	Message      *ClaudeResponse      `json:"message,omitempty"`
	Index        *int                 `json:"index,omitempty"`
	ContentBlock *ClaudeContentBlock  `json:"content_block,omitempty"`
	Delta        *StreamDelta         `json:"delta,omitempty"`
	Usage        *ClaudeUsage         `json:"usage,omitempty"`
	Error        *StreamError         `json:"error,omitempty"`
}

// StreamDelta carries incremental content in a streaming event.
type StreamDelta struct {
	Type         string  `json:"type,omitempty"`
	Text         string  `json:"text,omitempty"`
	Thinking     string  `json:"thinking,omitempty"`
	StopReason   string  `json:"stop_reason,omitempty"`
	StopSequence *string `json:"stop_sequence,omitempty"`
}

// StreamError describes an error within a stream.
type StreamError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}
