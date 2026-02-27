package util

import (
	"encoding/json"
	"strings"
	"unicode"
)

// Token overhead constants
const (
	messageOverhead = 4  // tokens per message for role/formatting
	toolOverhead    = 50 // tokens per tool definition
	systemOverhead  = 4  // tokens for system prompt wrapper
	baseOverhead    = 3  // base tokens for request framing
)

// EstimateTokens provides a rough token count estimate for a text string.
// Uses ~4 characters per token heuristic with CJK and code adjustments.
func EstimateTokens(text string) int {
	if text == "" {
		return 0
	}

	charCount := len([]rune(text))
	baseEstimate := charCount/4 + 1

	// CJK detection and correction
	cjkCount := countCJK(text)
	if cjkCount > 0 {
		cjkRatio := float64(cjkCount) / float64(charCount)
		if cjkRatio > 0.3 {
			// CJK text averages ~1.5 tokens per character
			baseEstimate = int(float64(cjkCount)*1.5) + (charCount-cjkCount)/4 + 1
		}
	}

	// Code density detection
	if isCodeDense(text) {
		// Code tends to have more tokens per character due to symbols
		baseEstimate = int(float64(baseEstimate) * 1.2)
	}

	return baseEstimate
}

// countCJK counts the number of CJK (Chinese, Japanese, Korean) characters.
func countCJK(text string) int {
	count := 0
	for _, r := range text {
		if unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) ||
			unicode.Is(unicode.Katakana, r) || unicode.Is(unicode.Hangul, r) {
			count++
		}
	}
	return count
}

// isCodeDense checks if text appears to be code-heavy.
func isCodeDense(text string) bool {
	if len(text) < 50 {
		return false
	}
	codeIndicators := []string{
		"{", "}", "(", ")", ";", "=>", "->",
		"func ", "def ", "class ", "import ", "const ", "let ", "var ",
	}
	matches := 0
	for _, indicator := range codeIndicators {
		matches += strings.Count(text, indicator)
	}
	density := float64(matches) / float64(len(text)) * 100
	return density > 2.0
}

// CountTokensRequest is the request body for the count_tokens endpoint.
type CountTokensRequest struct {
	Model    string                   `json:"model"`
	Messages []map[string]interface{} `json:"messages"`
	System   interface{}              `json:"system,omitempty"`
	Tools    []map[string]interface{} `json:"tools,omitempty"`
}

// CountTokens estimates the total input token count for a request.
func CountTokens(req *CountTokensRequest) int {
	total := baseOverhead

	// System prompt tokens
	if req.System != nil {
		systemText := extractSystemText(req.System)
		if systemText != "" {
			total += EstimateTokens(systemText) + systemOverhead
		}
	}

	// Message tokens
	for _, msg := range req.Messages {
		total += messageOverhead
		total += estimateMessageTokens(msg)
	}

	// Tool definitions tokens
	for _, tool := range req.Tools {
		total += toolOverhead
		// Estimate tokens from tool schema
		toolJSON, err := json.Marshal(tool)
		if err == nil {
			total += EstimateTokens(string(toolJSON))
		}
	}

	return total
}

// extractSystemText extracts text from the system field which can be a string or array.
func extractSystemText(system interface{}) string {
	switch s := system.(type) {
	case string:
		return s
	case []interface{}:
		var parts []string
		for _, item := range s {
			if m, ok := item.(map[string]interface{}); ok {
				if text, ok := m["text"].(string); ok {
					parts = append(parts, text)
				}
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}

// estimateMessageTokens estimates tokens for a single message.
func estimateMessageTokens(msg map[string]interface{}) int {
	tokens := 0

	// Role token
	if role, ok := msg["role"].(string); ok {
		tokens += EstimateTokens(role)
	}

	// Content can be string or array of content blocks
	switch content := msg["content"].(type) {
	case string:
		tokens += EstimateTokens(content)
	case []interface{}:
		for _, block := range content {
			if m, ok := block.(map[string]interface{}); ok {
				if text, ok := m["text"].(string); ok {
					tokens += EstimateTokens(text)
				}
				if m["type"] == "tool_use" || m["type"] == "tool_result" {
					// Tool use/result content
					if input, ok := m["input"]; ok {
						inputJSON, _ := json.Marshal(input)
						tokens += EstimateTokens(string(inputJSON))
					}
					if content, ok := m["content"].(string); ok {
						tokens += EstimateTokens(content)
					}
				}
			}
		}
	}

	return tokens
}

// EstimateTokensFromMessages estimates the total token count from a list of
// chat messages. Each message is expected to have a "content" key with a
// string value. Messages without a string content field are skipped.
func EstimateTokensFromMessages(messages []map[string]interface{}) int {
	total := 0
	for _, msg := range messages {
		if content, ok := msg["content"].(string); ok {
			total += EstimateTokens(content)
		}
	}
	return total
}
