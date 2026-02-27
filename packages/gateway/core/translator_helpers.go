package core

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/kiro-gateway/gateway/model"
)

// extractClaudeContent parses a user message's Content field (string or
// []ClaudeContentBlock) and returns the text, images, and tool results.
func extractClaudeContent(msg *model.ClaudeMessage) (string, []model.KiroImage, []model.KiroToolResult) {
	var images []model.KiroImage
	var toolResults []model.KiroToolResult
	var content string

	var s string
	if err := json.Unmarshal(msg.Content, &s); err == nil {
		return s, images, toolResults
	}

	var blocks []model.ClaudeContentBlock
	if err := json.Unmarshal(msg.Content, &blocks); err != nil {
		return content, images, toolResults
	}

	for _, block := range blocks {
		switch block.Type {
		case "text":
			content += block.Text
		case "image":
			if block.Source != nil {
				format := "png"
				if parts := strings.SplitN(block.Source.MediaType, "/", 2); len(parts) == 2 {
					format = parts[1]
				}
				images = append(images, model.KiroImage{
					Format: format,
					Source: model.KiroImageSource{Bytes: block.Source.Data},
				})
			}
		case "tool_result":
			if block.ToolUseID != "" {
				resultContent := extractToolResultContent(block)
				toolResults = append(toolResults, model.KiroToolResult{
					ToolUseID: block.ToolUseID,
					Content:   []model.KiroToolContent{{Text: resultContent}},
					Status:    "success",
				})
			}
		}
	}
	return content, images, toolResults
}

// extractToolResultContent extracts text from a tool_result block's Content field.
func extractToolResultContent(block model.ClaudeContentBlock) string {
	if block.Content == nil {
		return ""
	}
	var s string
	if err := json.Unmarshal(block.Content, &s); err == nil {
		return s
	}
	var nested []model.ClaudeContentBlock
	if err := json.Unmarshal(block.Content, &nested); err == nil {
		var parts []string
		for _, b := range nested {
			if b.Text != "" {
				parts = append(parts, b.Text)
			}
		}
		return strings.Join(parts, "")
	}
	return ""
}

// extractAssistantContent parses an assistant message and returns text
// (including thinking blocks wrapped in tags) and any tool uses.
func extractAssistantContent(msg *model.ClaudeMessage) (string, []model.KiroToolUse) {
	var toolUses []model.KiroToolUse
	var thinkingContent, textContent string

	var s string
	if err := json.Unmarshal(msg.Content, &s); err == nil {
		return s, toolUses
	}

	var blocks []model.ClaudeContentBlock
	if err := json.Unmarshal(msg.Content, &blocks); err != nil {
		return textContent, toolUses
	}

	for _, block := range blocks {
		switch block.Type {
		case "thinking":
			thinkingContent += block.Thinking
		case "text":
			textContent += block.Text
		case "tool_use":
			if block.ID != "" && block.Name != "" {
				inputMap := make(map[string]interface{})
				if block.Input != nil {
					_ = json.Unmarshal(block.Input, &inputMap)
				}
				toolUses = append(toolUses, model.KiroToolUse{
					ToolUseID: block.ID, Name: block.Name, Input: inputMap,
				})
			}
		}
	}

	var content string
	if thinkingContent != "" {
		content = fmt.Sprintf("<thinking>%s</thinking>\n\n", thinkingContent)
	}
	content += textContent
	if strings.TrimSpace(content) == "" && len(toolUses) > 0 {
		content = "Using tools."
	}
	return content, toolUses
}

// convertClaudeTools converts Claude tool definitions to Kiro tool wrappers.
func convertClaudeTools(tools []model.ClaudeTool) []model.KiroToolWrapper {
	if len(tools) == 0 {
		return nil
	}
	wrappers := make([]model.KiroToolWrapper, 0, len(tools))
	for _, tool := range tools {
		desc := tool.Description
		if desc == "" {
			desc = fmt.Sprintf("Tool: %s", tool.Name)
		}
		if len(desc) > KIRO_MAX_TOOL_DESC_LEN {
			desc = desc[:KIRO_MAX_TOOL_DESC_LEN] + "..."
		}
		wrappers = append(wrappers, model.KiroToolWrapper{
			ToolSpecification: model.KiroToolSpec{
				Name: shortenToolName(tool.Name), Description: desc,
				InputSchema: model.KiroInputSchema{JSON: tool.InputSchema},
			},
		})
	}
	return wrappers
}

// shortenToolName shortens MCP-style tool names by keeping only the prefix
// and last segment. The result is truncated to 64 characters.
func shortenToolName(name string) string {
	const limit = 64
	if len(name) <= limit {
		return name
	}
	if strings.HasPrefix(name, "mcp__") {
		lastIdx := strings.LastIndex(name, "__")
		if lastIdx > 5 {
			shortened := "mcp__" + name[lastIdx+2:]
			if len(shortened) > limit {
				return shortened[:limit]
			}
			return shortened
		}
	}
	return name[:limit]
}

// --- Kiro -> Claude conversion ---

// UsageInput groups token counts passed to KiroToClaudeResponse.
type UsageInput struct {
	InputTokens         int
	OutputTokens        int
	CacheCreationTokens int
	CacheWriteTokens    int
	CacheReadTokens     int
}

// KiroToClaudeResponse converts accumulated Kiro streaming output into a
// complete Claude Messages API response.
func KiroToClaudeResponse(content string, toolUses []model.KiroToolUse, usage UsageInput, modelID string) *model.ClaudeResponse {
	var blocks []model.ClaudeContentBlock
	if content != "" {
		blocks = append(blocks, model.ClaudeContentBlock{Type: "text", Text: content})
	}
	for _, tu := range toolUses {
		inputBytes, _ := json.Marshal(tu.Input)
		blocks = append(blocks, model.ClaudeContentBlock{Type: "tool_use", ID: tu.ToolUseID, Name: tu.Name, Input: inputBytes})
	}
	stopReason := "end_turn"
	if len(toolUses) > 0 {
		stopReason = "tool_use"
	}
	cc := usage.CacheCreationTokens
	if cc == 0 {
		cc = usage.CacheWriteTokens
	}
	return &model.ClaudeResponse{
		ID: fmt.Sprintf("msg_%s", uuid.New().String()), Type: "message", Role: "assistant",
		Content: blocks, Model: modelID, StopReason: &stopReason,
		Usage: model.ClaudeUsage{
			InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens,
			CacheCreationInputTokens: cc, CacheReadInputTokens: usage.CacheReadTokens,
			CacheCreation: &model.CacheCreationDetails{Ephemeral5mInputTokens: cc},
		},
	}
}

// --- SSE event helpers ---

// CreateMessageStartEvent creates a "message_start" streaming event.
func CreateMessageStartEvent(modelID string, usage *model.ClaudeUsage) *model.ClaudeStreamEvent {
	if usage == nil {
		usage = &model.ClaudeUsage{}
	}
	idx := 0
	sr := ""
	return &model.ClaudeStreamEvent{
		Type: "message_start", Index: &idx,
		Message: &model.ClaudeResponse{
			ID: fmt.Sprintf("msg_%s", uuid.New().String()), Type: "message", Role: "assistant",
			Content: []model.ClaudeContentBlock{}, Model: modelID, StopReason: &sr, Usage: *usage,
		},
	}
}

// CreateContentBlockStartEvent creates a "content_block_start" event.
func CreateContentBlockStartEvent(index int, blockType string, name string) *model.ClaudeStreamEvent {
	block := &model.ClaudeContentBlock{Type: blockType}
	if blockType == "tool_use" {
		block.ID = fmt.Sprintf("toolu_%s", uuid.New().String())
		block.Name = name
		block.Input = json.RawMessage(`{}`)
	}
	return &model.ClaudeStreamEvent{Type: "content_block_start", Index: &index, ContentBlock: block}
}

// CreateContentBlockDeltaEvent creates a "content_block_delta" event.
func CreateContentBlockDeltaEvent(index int, deltaType string, text string) *model.ClaudeStreamEvent {
	delta := &model.StreamDelta{Type: deltaType}
	if deltaType == "thinking_delta" {
		delta.Thinking = text
	} else {
		delta.Text = text
	}
	return &model.ClaudeStreamEvent{Type: "content_block_delta", Index: &index, Delta: delta}
}

// CreateContentBlockStopEvent creates a "content_block_stop" event.
func CreateContentBlockStopEvent(index int) *model.ClaudeStreamEvent {
	return &model.ClaudeStreamEvent{Type: "content_block_stop", Index: &index}
}

// CreateMessageDeltaEvent creates a "message_delta" event.
func CreateMessageDeltaEvent(stopReason string, usage *model.ClaudeUsage) *model.ClaudeStreamEvent {
	return &model.ClaudeStreamEvent{
		Type: "message_delta", Delta: &model.StreamDelta{Type: "message_delta", StopReason: stopReason}, Usage: usage,
	}
}

// CreateMessageStopEvent creates a "message_stop" event.
func CreateMessageStopEvent() *model.ClaudeStreamEvent {
	return &model.ClaudeStreamEvent{Type: "message_stop"}
}

// FormatSSEEvent marshals a ClaudeStreamEvent to SSE wire format.
func FormatSSEEvent(event *model.ClaudeStreamEvent) (string, error) {
	data, err := json.Marshal(event)
	if err != nil {
		return "", fmt.Errorf("marshal stream event: %w", err)
	}
	return fmt.Sprintf("event: %s\ndata: %s\n\n", event.Type, string(data)), nil
}
