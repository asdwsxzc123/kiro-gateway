package model

import "encoding/json"

// KiroPayload is the top-level request body sent to the Kiro streaming API.
type KiroPayload struct {
	ConversationState KiroConversationState `json:"conversationState"`
	ProfileArn        string                `json:"profileArn,omitempty"`
	InferenceConfig   *KiroInferenceConfig  `json:"inferenceConfig,omitempty"`
}

// KiroConversationState describes the full conversation context.
type KiroConversationState struct {
	ChatTriggerType string               `json:"chatTriggerType"` // "MANUAL"
	ConversationID  string               `json:"conversationId"`
	CurrentMessage  KiroCurrentMessage    `json:"currentMessage"`
	History         []KiroHistoryMessage  `json:"history,omitempty"`
}

// KiroCurrentMessage wraps the current user input message.
type KiroCurrentMessage struct {
	UserInputMessage KiroUserInputMessage `json:"userInputMessage"`
}

// KiroUserInputMessage is the user's input within a conversation turn.
type KiroUserInputMessage struct {
	Content                 string                        `json:"content"`
	ModelID                 string                        `json:"modelId,omitempty"`
	Origin                  string                        `json:"origin"`
	Images                  []KiroImage                   `json:"images,omitempty"`
	UserInputMessageContext *KiroUserInputMessageContext   `json:"userInputMessageContext,omitempty"`
}

// KiroImage represents an image attachment in the request.
type KiroImage struct {
	Format string          `json:"format"`
	Source KiroImageSource `json:"source"`
}

// KiroImageSource holds the base64-encoded image bytes.
type KiroImageSource struct {
	Bytes string `json:"bytes"`
}

// KiroUserInputMessageContext carries tool results and tool definitions.
type KiroUserInputMessageContext struct {
	ToolResults []KiroToolResult  `json:"toolResults,omitempty"`
	Tools       []KiroToolWrapper `json:"tools,omitempty"`
}

// KiroToolResult is the result of a previous tool invocation.
type KiroToolResult struct {
	Content   []KiroToolContent `json:"content"`
	Status    string            `json:"status"` // "success" or "error"
	ToolUseID string            `json:"toolUseId"`
}

// KiroToolContent is a single text segment within a tool result.
type KiroToolContent struct {
	Text string `json:"text"`
}

// KiroToolWrapper wraps a tool specification for the Kiro API.
type KiroToolWrapper struct {
	ToolSpecification KiroToolSpec `json:"toolSpecification"`
}

// KiroToolSpec defines a tool's name, description, and input schema.
type KiroToolSpec struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema KiroInputSchema `json:"inputSchema"`
}

// KiroInputSchema wraps the JSON Schema definition for a tool's input.
type KiroInputSchema struct {
	JSON json.RawMessage `json:"json"`
}

// KiroHistoryMessage is a single turn in the conversation history.
// Exactly one of UserInputMessage or AssistantResponseMessage should be set.
type KiroHistoryMessage struct {
	UserInputMessage         *KiroUserInputMessage         `json:"userInputMessage,omitempty"`
	AssistantResponseMessage *KiroAssistantResponseMessage  `json:"assistantResponseMessage,omitempty"`
}

// KiroAssistantResponseMessage is the assistant's response in a history turn.
type KiroAssistantResponseMessage struct {
	Content  string         `json:"content"`
	ToolUses []KiroToolUse  `json:"toolUses,omitempty"`
}

// KiroToolUse represents a tool invocation by the assistant.
type KiroToolUse struct {
	ToolUseID string                 `json:"toolUseId"`
	Name      string                 `json:"name"`
	Input     map[string]interface{} `json:"input"`
}

// KiroInferenceConfig provides optional inference parameters.
type KiroInferenceConfig struct {
	MaxTokens   *int     `json:"maxTokens,omitempty"`
	Temperature *float64 `json:"temperature,omitempty"`
	TopP        *float64 `json:"topP,omitempty"`
}
