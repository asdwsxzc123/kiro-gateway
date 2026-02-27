package core

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/model"
)

// StreamResult accumulates the parsed output from a Kiro event stream.
type StreamResult struct {
	Content           string
	ToolUses          []model.KiroToolUse
	InputTokens       int
	OutputTokens      int
	CacheCreateTokens int
	CacheReadTokens   int
	KiroCredits       float64
	StopReason        string
	Error             *model.KiroApiError
}

// StreamCallback is invoked for each significant event extracted from the stream.
type StreamCallback func(eventType string, data interface{})

type toolUseState struct {
	ToolUseID   string
	Name        string
	InputBuffer string
}

// ProcessEventFrame processes a single EventStreamFrame, updating result and
// invoking callback for content events.
func ProcessEventFrame(
	frame *EventStreamFrame, result *StreamResult, callback StreamCallback,
	currentTool **toolUseState, processedIDs map[string]bool,
) error {
	if len(frame.Payload) == 0 {
		return nil
	}
	if msgType, ok := frame.Headers[":message-type"]; ok && msgType == "exception" {
		return handleExceptionEvent(frame.Payload, result)
	}
	switch frame.EventType {
	case "assistantResponseEvent":
		return handleAssistantResponse(frame.Payload, result, callback)
	case "toolUseEvent":
		return handleToolUseEvent(frame.Payload, result, callback, currentTool, processedIDs)
	case "reasoningContentEvent":
		return handleReasoningEvent(frame.Payload, callback)
	case "meteringEvent":
		return handleMeteringEvent(frame.Payload, result, callback)
	case "messageMetadataEvent":
		return handleMetadataEvent(frame.Payload, result)
	case "supplementaryWebLinksEvent", "supplementaryWebReferencesEvent",
		"codeReferenceEvent", "contextUsageEvent", "followupPromptEvent":
		log.Debug().Str("type", frame.EventType).Msg("skipping informational event")
		return nil
	case "invalidStateEvent":
		return handleInvalidState(frame.Payload)
	default:
		var g map[string]interface{}
		if json.Unmarshal(frame.Payload, &g) == nil {
			if _, ok := g["error"]; ok {
				return handleExceptionEvent(frame.Payload, result)
			}
			if _, ok := g["_type"]; ok {
				return handleExceptionEvent(frame.Payload, result)
			}
		}
		log.Debug().Str("type", frame.EventType).Msg("unhandled event type")
		return nil
	}
}

func handleAssistantResponse(payload []byte, result *StreamResult, cb StreamCallback) error {
	text, err := parseNestedString(payload, "assistantResponseEvent", "content")
	if err != nil {
		return err
	}
	if text != "" {
		result.Content += text
		cb("text_delta", text)
	}
	return nil
}

func handleToolUseEvent(
	payload []byte, result *StreamResult, cb StreamCallback,
	currentTool **toolUseState, processedIDs map[string]bool,
) error {
	var raw map[string]interface{}
	if err := json.Unmarshal(payload, &raw); err != nil {
		return fmt.Errorf("parse toolUseEvent: %w", err)
	}
	d, _ := raw["toolUseEvent"].(map[string]interface{})
	if d == nil {
		d = raw
	}
	id, _ := d["toolUseId"].(string)
	name, _ := d["name"].(string)
	isStop, _ := d["stop"].(bool)

	var frag string
	var obj map[string]interface{}
	switch v := d["input"].(type) {
	case string:
		frag = v
	case map[string]interface{}:
		obj = v
	}

	if id != "" && name != "" {
		if *currentTool != nil && (*currentTool).ToolUseID != id {
			flushToolUse(*currentTool, result, cb, processedIDs)
			*currentTool = nil
		}
		if *currentTool == nil && !processedIDs[id] {
			*currentTool = &toolUseState{ToolUseID: id, Name: name}
		}
	}
	if *currentTool != nil {
		if frag != "" {
			(*currentTool).InputBuffer += frag
		}
		if obj != nil {
			b, _ := json.Marshal(obj)
			(*currentTool).InputBuffer = string(b)
		}
	}
	if isStop && *currentTool != nil {
		flushToolUse(*currentTool, result, cb, processedIDs)
		*currentTool = nil
	}
	return nil
}

func flushToolUse(tool *toolUseState, result *StreamResult, cb StreamCallback, ids map[string]bool) {
	if ids[tool.ToolUseID] {
		return
	}
	input := make(map[string]interface{})
	if tool.InputBuffer != "" {
		if err := json.Unmarshal([]byte(tool.InputBuffer), &input); err != nil {
			input = map[string]interface{}{
				"_error": "Tool input truncated by Kiro API", "_partialInput": truncateStr(tool.InputBuffer, 500),
			}
		}
	}
	tu := model.KiroToolUse{ToolUseID: tool.ToolUseID, Name: tool.Name, Input: input}
	result.ToolUses = append(result.ToolUses, tu)
	cb("tool_use", tu)
	ids[tool.ToolUseID] = true
}

// FlushPendingToolUse emits any incomplete tool use at end-of-stream.
func FlushPendingToolUse(
	currentTool **toolUseState, result *StreamResult, cb StreamCallback, ids map[string]bool,
) {
	if *currentTool != nil && !ids[(*currentTool).ToolUseID] {
		flushToolUse(*currentTool, result, cb, ids)
		*currentTool = nil
	}
}

func handleReasoningEvent(payload []byte, cb StreamCallback) error {
	text, err := parseNestedString(payload, "reasoningContentEvent", "content")
	if err != nil {
		// Try "text" field as fallback.
		text, err = parseNestedString(payload, "reasoningContentEvent", "text")
		if err != nil {
			return err
		}
	}
	if text != "" {
		cb("thinking_delta", text)
	}
	return nil
}

func handleMeteringEvent(payload []byte, result *StreamResult, cb StreamCallback) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil
	}
	data := payload
	if d, ok := raw["meteringEvent"]; ok {
		data = d
	}
	var evt struct {
		InputTokenCount  int     `json:"inputTokenCount"`
		OutputTokenCount int     `json:"outputTokenCount"`
		CacheWriteTokens int    `json:"cacheWriteTokens"`
		CacheReadTokens  int    `json:"cacheReadTokens"`
		Usage            float64 `json:"usage"`
	}
	if err := json.Unmarshal(data, &evt); err != nil {
		log.Warn().Err(err).Msg("failed to parse metering event")
		return nil
	}
	result.InputTokens = evt.InputTokenCount
	result.OutputTokens = evt.OutputTokenCount
	result.CacheCreateTokens = evt.CacheWriteTokens
	result.CacheReadTokens = evt.CacheReadTokens
	result.KiroCredits += evt.Usage
	cb("metering", nil)
	return nil
}

func handleMetadataEvent(payload []byte, result *StreamResult) error {
	var raw map[string]interface{}
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil
	}
	md, _ := raw["messageMetadataEvent"].(map[string]interface{})
	if md == nil {
		md = raw
	}
	if u, ok := md["usage"].(map[string]interface{}); ok {
		if c, ok := u["credits"].(float64); ok && c > 0 {
			result.KiroCredits += c
		}
	}
	if c, ok := md["credits"].(float64); ok && c > 0 {
		result.KiroCredits += c
	}
	return nil
}

func handleInvalidState(payload []byte) error {
	var raw map[string]interface{}
	if json.Unmarshal(payload, &raw) != nil {
		return nil
	}
	inv, _ := raw["invalidStateEvent"].(map[string]interface{})
	if inv == nil {
		inv = raw
	}
	reason, _ := inv["reason"].(string)
	msg, _ := inv["message"].(string)
	log.Error().Str("reason", reason).Str("message", msg).Msg("invalidStateEvent")
	return nil
}

func handleExceptionEvent(payload []byte, result *StreamResult) error {
	var raw map[string]interface{}
	if json.Unmarshal(payload, &raw) != nil {
		return fmt.Errorf("stream error (unparseable payload)")
	}
	errMsg := "Unknown stream error"
	if m, ok := raw["message"].(string); ok {
		errMsg = m
	} else if e, ok := raw["error"].(map[string]interface{}); ok {
		if m, ok := e["message"].(string); ok {
			errMsg = m
		}
	}
	switch {
	case strings.Contains(errMsg, "MONTHLY_REQUEST_COUNT"):
		result.Error = model.NewKiroApiError(errMsg, 402, model.KiroErrorMonthlyLimit, false, "")
	case strings.Contains(errMsg, "TEMPORARILY_SUSPENDED") || strings.Contains(errMsg, "temporarily is suspended"):
		result.Error = model.NewKiroApiError(errMsg, 0, model.KiroErrorAccountSuspended, false, "")
	case strings.Contains(errMsg, "overloaded") || strings.Contains(errMsg, "529"):
		result.Error = model.NewKiroApiError(errMsg, 529, model.KiroErrorOverloaded, true, "")
	default:
		result.Error = model.NewKiroApiError(errMsg, 0, model.KiroErrorUnknown, false, "")
	}
	return result.Error
}

// parseNestedString extracts a string field from a possibly nested JSON object.
// It tries raw[wrapper][field] first, then raw[field].
func parseNestedString(payload []byte, wrapper, field string) (string, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(payload, &raw); err != nil {
		return "", fmt.Errorf("parse %s: %w", wrapper, err)
	}
	data := json.RawMessage(payload)
	if d, ok := raw[wrapper]; ok {
		data = d
	}
	var obj map[string]interface{}
	if err := json.Unmarshal(data, &obj); err != nil {
		return "", fmt.Errorf("parse %s inner: %w", wrapper, err)
	}
	val, _ := obj[field].(string)
	return val, nil
}

func truncateStr(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen]
}
