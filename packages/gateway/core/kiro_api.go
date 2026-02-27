package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/kiro-gateway/gateway/config"
	"github.com/kiro-gateway/gateway/model"
	"github.com/kiro-gateway/gateway/util"
)

// KiroEndpoints maps short names to Kiro streaming API base URLs.
var KiroEndpoints = map[string]string{
	"codewhisperer": "https://codewhisperer.us-east-1.amazonaws.com",
	"amazonq":       "https://q.us-east-1.amazonaws.com",
}

// KiroEndpointMeta holds metadata for a single endpoint.
type KiroEndpointMeta struct {
	URL       string
	Origin    string
	AmzTarget string
	Name      string
}

// KiroEndpointList is the ordered list of available streaming endpoints.
var KiroEndpointList = []KiroEndpointMeta{
	{
		URL: "https://codewhisperer.us-east-1.amazonaws.com", Origin: "AI_EDITOR",
		AmzTarget: "AmazonCodeWhispererStreamingService.GenerateAssistantResponse", Name: "CodeWhisperer",
	},
	{
		URL: "https://q.us-east-1.amazonaws.com", Origin: "CLI",
		AmzTarget: "AmazonQDeveloperStreamingService.SendMessage", Name: "AmazonQ",
	},
}

const (
	KiroAuthEndpoint    = "https://prod.us-east-1.auth.desktop.kiro.dev"
	KiroModelListPath   = "/ListAvailableModels"
	KiroGeneratePath    = "/generateAssistantResponse"
	KiroUsageLimitsPath = "/getUsageLimits"
	KiroVersion         = "0.6.18"
)

// ModelIDMap maps common Claude model name aliases to canonical Kiro model IDs.
var ModelIDMap = map[string]string{
	"claude-sonnet-4-6": "claude-sonnet-4.6", "claude-sonnet-4.6": "claude-sonnet-4.6",
	"claude-sonnet-4-5": "claude-sonnet-4.5", "claude-sonnet-4.5": "claude-sonnet-4.5",
	"claude-sonnet-4-5-20250514": "claude-sonnet-4.5",
	"claude-haiku-4-5": "claude-haiku-4.5", "claude-haiku-4.5": "claude-haiku-4.5",
	"claude-opus-4-6": "claude-opus-4.6", "claude-opus-4.6": "claude-opus-4.6",
	"claude-opus-4-6-20260207": "claude-opus-4.6",
	"claude-opus-4-5": "claude-opus-4.5", "claude-opus-4.5": "claude-opus-4.5",
	"claude-sonnet-4": "claude-sonnet-4", "claude-sonnet-4-20250514": "claude-sonnet-4",
	"claude-sonnet-4-20250529": "claude-sonnet-4",
	"claude-3-5-sonnet": "claude-sonnet-4.5", "claude-3-5-sonnet-20241022": "claude-sonnet-4.5",
	"claude-3.5-sonnet": "claude-sonnet-4.5", "claude-3-opus": "claude-sonnet-4.5",
	"claude-3-sonnet": "claude-sonnet-4", "claude-3-haiku": "claude-haiku-4.5",
}

const defaultKiroModelID = "claude-sonnet-4.5"

// MapModelID translates a caller-provided model name to its Kiro model ID.
func MapModelID(modelName string) string {
	lower := strings.ToLower(modelName)
	for key, value := range ModelIDMap {
		if strings.Contains(lower, key) {
			return value
		}
	}
	return defaultKiroModelID
}

// BuildKiroPayload constructs a complete KiroPayload ready for submission.
func BuildKiroPayload(
	content, modelID, origin string,
	history []model.KiroHistoryMessage, tools []model.KiroToolWrapper,
	toolResults []model.KiroToolResult, images []model.KiroImage,
	profileArn string, inferCfg *model.KiroInferenceConfig,
) *model.KiroPayload {
	fc := strings.TrimSpace(content)
	if fc == "" {
		if len(toolResults) > 0 {
			fc = ""
		} else {
			fc = "Continue"
		}
	}
	uim := model.KiroUserInputMessage{Content: fc, ModelID: modelID, Origin: origin}
	if len(images) > 0 {
		uim.Images = images
	}
	if len(tools) > 0 || len(toolResults) > 0 {
		ctx := &model.KiroUserInputMessageContext{}
		if len(tools) > 0 {
			ctx.Tools = tools
		}
		if len(toolResults) > 0 {
			ctx.ToolResults = toolResults
		}
		uim.UserInputMessageContext = ctx
	}
	payload := &model.KiroPayload{
		ConversationState: model.KiroConversationState{
			ChatTriggerType: "MANUAL", ConversationID: uuid.New().String(),
			CurrentMessage: model.KiroCurrentMessage{UserInputMessage: uim},
		},
	}
	if len(history) > 0 {
		payload.ConversationState.History = history
	}
	if profileArn != "" {
		payload.ProfileArn = profileArn
	}
	if inferCfg != nil {
		payload.InferenceConfig = inferCfg
	}
	return payload
}

func getKiroUserAgent(machineID string) string {
	suffix := fmt.Sprintf("KiroIDE-%s", KiroVersion)
	if machineID != "" {
		suffix = fmt.Sprintf("KiroIDE-%s-%s", KiroVersion, machineID)
	}
	return fmt.Sprintf("aws-sdk-js/1.0.18 ua/2.1 os/windows lang/js md/nodejs#20.16.0 api/codewhispererstreaming#1.0.18 m/E %s", suffix)
}

func getKiroAmzUserAgent(machineID string) string {
	suffix := fmt.Sprintf("KiroIDE-%s", KiroVersion)
	if machineID != "" {
		suffix = fmt.Sprintf("KiroIDE %s %s", KiroVersion, machineID)
	}
	return fmt.Sprintf("aws-sdk-js/1.0.18 %s", suffix)
}

// CallKiroAPIStream sends the payload to the Kiro streaming endpoint and
// returns the raw HTTP response. Caller must close the body.
func CallKiroAPIStream(
	ctx context.Context, payload *model.KiroPayload,
	account *model.ProxyAccount, endpoint KiroEndpointMeta,
) (*http.Response, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.URL+KiroGeneratePath, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	mid := account.MachineID
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "*/*")
	req.Header.Set("X-Amz-Target", endpoint.AmzTarget)
	req.Header.Set("User-Agent", getKiroUserAgent(mid))
	req.Header.Set("X-Amz-User-Agent", getKiroAmzUserAgent(mid))
	req.Header.Set("x-amzn-codewhisperer-optout", "true")
	req.Header.Set("Amz-Sdk-Request", "attempt=1; max=3")
	req.Header.Set("Amz-Sdk-Invocation-Id", uuid.New().String())
	req.Header.Set("Authorization", "Bearer "+account.AccessToken)
	req.Header.Set("x-amzn-kiro-agent-mode", "spec")

	timeout := time.Duration(config.GetConfig().Proxy.RequestTimeout) * time.Millisecond
	client := util.NewHTTPClient(account.ProxyURL, timeout)
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("kiro api request: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return nil, model.KiroApiErrorFromHTTPResponse(resp.StatusCode, string(b), endpoint.Name)
	}
	return resp, nil
}

// GetPreferredEndpoints returns endpoints ordered by configured preference.
func GetPreferredEndpoints() []KiroEndpointMeta {
	cfg := config.GetConfig()
	result := make([]KiroEndpointMeta, len(KiroEndpointList))
	copy(result, KiroEndpointList)
	preferredName := "CodeWhisperer"
	if cfg.Proxy.PreferredEndpoint == "amazonq" {
		preferredName = "AmazonQ"
	}
	for i, ep := range result {
		if ep.Name == preferredName && i > 0 {
			result[0], result[i] = result[i], result[0]
			break
		}
	}
	return result
}

// IsAgenticRequest returns true when the request includes tool definitions.
func IsAgenticRequest(tools []model.ClaudeTool) bool { return len(tools) > 0 }

// FetchKiroModels retrieves available models from the Kiro API.
func FetchKiroModels(ctx context.Context, account *model.ProxyAccount, endpoint string) ([]map[string]interface{}, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+KiroModelListPath+"?origin=AI_EDITOR&maxResults=50", nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+account.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", getKiroUserAgent(account.MachineID))
	req.Header.Set("x-amz-user-agent", getKiroAmzUserAgent(account.MachineID))

	resp, err := util.NewHTTPClient(account.ProxyURL, 30*time.Second).Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch models: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ListAvailableModels %d: %s", resp.StatusCode, string(b))
	}
	var result struct{ Models []map[string]interface{} `json:"models"` }
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode models: %w", err)
	}
	return result.Models, nil
}

// FetchUsageLimits retrieves usage limits for the given account.
func FetchUsageLimits(ctx context.Context, account *model.ProxyAccount) (*model.UsageLimitsResponse, error) {
	url := "https://q.us-east-1.amazonaws.com" + KiroUsageLimitsPath + "?origin=AI_EDITOR&resourceType=AGENTIC_REQUEST&isEmailRequired=true"
	if account.ProfileArn != "" {
		url += "&profileArn=" + account.ProfileArn
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+account.AccessToken)
	req.Header.Set("User-Agent", getKiroUserAgent(account.MachineID))
	req.Header.Set("x-amz-user-agent", getKiroAmzUserAgent(account.MachineID))

	resp, err := util.NewHTTPClient(account.ProxyURL, 30*time.Second).Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch usage limits: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		log.Error().Int("status", resp.StatusCode).Msg("GetUsageLimits failed")
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(b))
	}
	var result model.UsageLimitsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode usage limits: %w", err)
	}
	return &result, nil
}
