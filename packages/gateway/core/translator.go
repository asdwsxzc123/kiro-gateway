package core

import (
	"fmt"
	"strings"
	"time"

	"github.com/kiro-gateway/gateway/model"
)

// KIRO_MAX_TOOL_DESC_LEN is the maximum allowed length for a tool description
// in the Kiro API.
const KIRO_MAX_TOOL_DESC_LEN = 10237

// EXECUTION_DIRECTIVE is injected into the system prompt to keep the model
// focused on executing the user's task rather than exploring endlessly.
const EXECUTION_DIRECTIVE = `
<execution_discipline>
When the user asks you to perform a specific task, you must follow this discipline:
1. **Goal Lock**: Keep the user's original goal in mind throughout the session; do not lose direction while exploring code.
2. **Action First**: Prioritize executing the task over merely analyzing or summarizing, unless the user explicitly only asks for analysis.
3. **Plan and Execute**: Create a clear step-by-step plan, execute each step, and mark completion status.
4. **No Confirmation Stalling**: Before the task is complete, do not output questions like "Shall I continue?" or "Need deeper analysis?"
5. **Keep Pushing**: If you discover that some steps are already done, immediately continue with the remaining unfinished steps.
6. **Full Delivery**: The task is only complete when every step has been executed.
</execution_discipline>
`

// buildUserInputMsg is a helper that constructs a KiroUserInputMessage with
// optional images and tool results and returns it wrapped in a history entry.
func buildUserInputMsg(content, modelID, origin string, imgs []model.KiroImage, toolRes []model.KiroToolResult) model.KiroHistoryMessage {
	if content == "" {
		if len(toolRes) > 0 {
			content = "Tool results provided."
		} else {
			content = "Continue"
		}
	}
	uim := model.KiroUserInputMessage{Content: content, ModelID: modelID, Origin: origin}
	if len(imgs) > 0 {
		uim.Images = imgs
	}
	if len(toolRes) > 0 {
		uim.UserInputMessageContext = &model.KiroUserInputMessageContext{ToolResults: toolRes}
	}
	return model.KiroHistoryMessage{UserInputMessage: &uim}
}

// ClaudeToKiro translates a Claude Messages API request into a Kiro API payload.
func ClaudeToKiro(request *model.ClaudeRequest, profileArn string) *model.KiroPayload {
	modelID := MapModelID(request.Model)
	origin := "AI_EDITOR"

	systemPrompt := request.GetSystemPrompt()
	timestamp := time.Now().UTC().Format(time.RFC3339)
	systemPrompt = fmt.Sprintf("[Context: Current time is %s]\n\n%s", timestamp, systemPrompt)
	systemPrompt += "\n\n" + EXECUTION_DIRECTIVE

	var history []model.KiroHistoryMessage
	var currentToolResults []model.KiroToolResult
	var currentContent string
	var images []model.KiroImage
	var pendingContent string
	var pendingImages []model.KiroImage
	var pendingToolRes []model.KiroToolResult

	for i, msg := range request.Messages {
		isLast := i == len(request.Messages)-1

		if msg.Role == "user" {
			uc, ui, ut := extractClaudeContent(&msg)
			if isLast {
				currentContent = mergeContent(pendingContent, uc)
				images = append(append(images, pendingImages...), ui...)
				currentToolResults = append(pendingToolRes, ut...)
				pendingContent, pendingImages, pendingToolRes = "", nil, nil
			} else if request.Messages[i+1].Role == "assistant" {
				fc := mergeContent(pendingContent, uc)
				fi := append(pendingImages, ui...)
				ft := append(pendingToolRes, ut...)
				if strings.TrimSpace(fc) != "" || len(fi) > 0 || len(ft) > 0 {
					history = append(history, buildUserInputMsg(fc, modelID, origin, fi, ft))
				}
				pendingContent, pendingImages, pendingToolRes = "", nil, nil
			} else {
				pendingContent = mergeContent(pendingContent, uc)
				pendingImages = append(pendingImages, ui...)
				pendingToolRes = append(pendingToolRes, ut...)
			}
		} else if msg.Role == "assistant" {
			ac, toolUses := extractAssistantContent(&msg)
			if strings.TrimSpace(pendingContent) != "" || len(pendingImages) > 0 || len(pendingToolRes) > 0 {
				history = append(history, buildUserInputMsg(pendingContent, modelID, origin, pendingImages, pendingToolRes))
				pendingContent, pendingImages, pendingToolRes = "", nil, nil
			}
			arm := &model.KiroAssistantResponseMessage{Content: ac}
			if len(toolUses) > 0 {
				arm.ToolUses = toolUses
			}
			history = append(history, model.KiroHistoryMessage{AssistantResponseMessage: arm})
		}
	}

	// Flush remaining pending content.
	if strings.TrimSpace(pendingContent) != "" || len(pendingImages) > 0 || len(pendingToolRes) > 0 {
		suffix := ""
		if currentContent != "" {
			suffix = "\n" + currentContent
		}
		currentContent = pendingContent + suffix
		images = append(pendingImages, images...)
		currentToolResults = append(pendingToolRes, currentToolResults...)
	}

	// Ensure history starts with a user message.
	if len(history) > 0 && history[0].AssistantResponseMessage != nil {
		dummy := model.KiroUserInputMessage{Content: "Begin conversation", ModelID: modelID, Origin: origin}
		history = append([]model.KiroHistoryMessage{{UserInputMessage: &dummy}}, history...)
	}

	// Build final content with system prompt.
	finalContent := ""
	if systemPrompt != "" {
		finalContent = fmt.Sprintf("--- SYSTEM PROMPT ---\n%s\n--- END SYSTEM PROMPT ---\n\n", systemPrompt)
	}
	if currentContent != "" {
		finalContent += currentContent
	} else if len(currentToolResults) > 0 {
		finalContent += "Tool results provided."
	} else {
		finalContent += "Continue"
	}

	kiroTools := convertClaudeTools(request.Tools)

	var inferCfg *model.KiroInferenceConfig
	if request.MaxTokens > 0 || request.Temperature != nil || request.TopP != nil {
		inferCfg = &model.KiroInferenceConfig{}
		if request.MaxTokens > 0 {
			mt := request.MaxTokens
			inferCfg.MaxTokens = &mt
		}
		inferCfg.Temperature = request.Temperature
		inferCfg.TopP = request.TopP
	}

	return BuildKiroPayload(finalContent, modelID, origin, history, kiroTools,
		currentToolResults, images, profileArn, inferCfg)
}

// mergeContent joins two content strings with a newline separator when both
// are non-empty.
func mergeContent(a, b string) string {
	if a != "" && b != "" {
		return a + "\n" + b
	}
	if a != "" {
		return a
	}
	return b
}
