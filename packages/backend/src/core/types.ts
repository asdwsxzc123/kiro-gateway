/**
 * Kiro Gateway 类型定义
 * 基于原有 proxy/types.ts 迁移并扩展
 */

// ============ OpenAI 兼容格式 ============

export interface OpenAIChatRequest {
  model: string
  messages: OpenAIMessage[]
  temperature?: number
  top_p?: number
  max_tokens?: number
  stream?: boolean
  tools?: OpenAITool[]
  tool_choice?: string | { type: string; function: { name: string } }
  response_format?: { type: string; json_schema?: unknown }
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OpenAIContentPart[]
  name?: string
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

export interface OpenAIContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string; detail?: string }
}

export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: unknown
  }
}

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface OpenAIChatResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: OpenAIChoice[]
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface OpenAIChoice {
  index: number
  message: {
    role: 'assistant'
    content: string | null
    tool_calls?: OpenAIToolCall[]
  }
  finish_reason: 'stop' | 'length' | 'tool_calls' | null
}

export interface OpenAIStreamChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: {
    index: number
    delta: {
      role?: 'assistant'
      content?: string
      tool_calls?: Partial<OpenAIToolCall>[]
    }
    finish_reason: 'stop' | 'length' | 'tool_calls' | null
  }[]
}

// ============ Claude 兼容格式 ============

export interface ClaudeRequest {
  model: string
  messages: ClaudeMessage[]
  max_tokens: number
  temperature?: number
  top_p?: number
  stream?: boolean
  system?: string | ClaudeSystemBlock[]
  tools?: ClaudeTool[]
  tool_choice?: { type: string; name?: string }
}

export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string | ClaudeContentBlock[]
}

export interface ClaudeSystemBlock {
  type: 'text'
  text: string
}

export interface ClaudeContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result'
  text?: string
  source?: { type: 'base64'; media_type: string; data: string }
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: string | ClaudeContentBlock[]
}

export interface ClaudeTool {
  name: string
  description: string
  input_schema: unknown
}

export interface ClaudeResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: ClaudeContentBlock[]
  model: string
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | null
  stop_sequence: string | null
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

export interface ClaudeStreamEvent {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop' | 'ping' | 'error'
  message?: Partial<ClaudeResponse>
  index?: number
  content_block?: ClaudeContentBlock
  delta?: { type: string; text?: string; stop_reason?: string; stop_sequence?: string }
  usage?: { input_tokens?: number; output_tokens: number }
  error?: { type: string; message: string }
}

// ============ Kiro API 格式 ============

export interface KiroPayload {
  conversationState: KiroConversationState
  profileArn?: string
  inferenceConfig?: KiroInferenceConfig
}

export interface KiroConversationState {
  chatTriggerType: 'MANUAL'
  conversationId: string
  currentMessage: KiroCurrentMessage
  history?: KiroHistoryMessage[]
}

export interface KiroCurrentMessage {
  userInputMessage: KiroUserInputMessage
}

export interface KiroUserInputMessage {
  content: string
  modelId?: string
  origin: string
  images?: KiroImage[]
  userInputMessageContext?: KiroUserInputMessageContext
}

export interface KiroImage {
  format: string
  source: { bytes: string }
}

export interface KiroUserInputMessageContext {
  toolResults?: KiroToolResult[]
  tools?: KiroToolWrapper[]
}

export interface KiroToolResult {
  content: { text: string }[]
  status: 'success' | 'error'
  toolUseId: string
}

export interface KiroToolWrapper {
  toolSpecification: {
    name: string
    description: string
    inputSchema: { json: unknown }
  }
}

export interface KiroHistoryMessage {
  userInputMessage?: KiroUserInputMessage
  assistantResponseMessage?: KiroAssistantResponseMessage
}

export interface KiroAssistantResponseMessage {
  content: string
  toolUses?: KiroToolUse[]
}

export interface KiroToolUse {
  toolUseId: string
  name: string
  input: Record<string, unknown>
}

export interface KiroInferenceConfig {
  maxTokens?: number
  temperature?: number
  topP?: number
}

// ============ 账号定义（含机器码）============

export interface ProxyAccount {
  id: string
  email?: string
  userId?: string
  accessToken: string
  refreshToken?: string
  clientId?: string
  clientSecret?: string
  region?: string
  authMethod?: 'social' | 'idc'
  provider?: string
  profileArn?: string
  expiresAt?: number

  // 机器码相关
  machineId: string              // 账号绑定的机器码（必填）
  machineIdCreatedAt?: number    // 机器码创建时间

  // 运行时状态
  lastUsed?: number
  requestCount?: number
  errorCount?: number
  isAvailable?: boolean
  cooldownUntil?: number
  createdAt?: number
}

// 添加账号请求（机器码可选，不提供则自动生成）
export interface AddAccountRequest {
  email?: string
  accessToken: string
  refreshToken?: string
  clientId?: string
  clientSecret?: string
  region?: string
  authMethod?: 'social' | 'idc'
  provider?: string
  profileArn?: string
  machineId?: string  // 可选，不提供则自动生成
}

// 更新账号请求
export interface UpdateAccountRequest {
  email?: string
  userId?: string
  accessToken?: string
  refreshToken?: string
  clientId?: string
  clientSecret?: string
  region?: string
  authMethod?: 'social' | 'idc'
  provider?: string
  profileArn?: string
  machineId?: string
  isAvailable?: boolean
  expiresAt?: number
}

// ============ 统计类型 ============

export interface ProxyStats {
  totalRequests: number
  successRequests: number
  failedRequests: number
  totalTokens: number
  totalCredits: number
  inputTokens: number
  outputTokens: number
  startTime: number
}

export interface AccountStats {
  requests: number
  tokens: number
  inputTokens: number
  outputTokens: number
  errors: number
  lastUsed: number
  avgResponseTime: number
  totalResponseTime: number
}

export interface EndpointStats {
  name: string
  requests: number
  successes: number
  failures: number
  quotaErrors: number
}

export interface ModelStats {
  model: string
  requests: number
  tokens: number
}

// ============ 日志类型 ============

export interface RequestLog {
  id?: string
  timestamp: number
  path: string
  model: string
  accountId: string
  machineId?: string
  inputTokens: number
  outputTokens: number
  credits?: number
  responseTime: number
  success: boolean
  error?: string
}

export interface SystemLog {
  id?: string
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error'
  category: string
  message: string
  data?: Record<string, unknown>
}

// ============ Event Stream 解析 ============

export interface KiroEventStreamMessage {
  type: string
  payload: unknown
}

export interface KiroAssistantResponseEvent {
  content?: string
  toolUse?: KiroToolUse
}

export interface KiroUsageEvent {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

// ============ Token 刷新 ============

export interface TokenRefreshResult {
  success: boolean
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  error?: string
}

export type TokenRefreshCallback = (account: ProxyAccount) => Promise<TokenRefreshResult>

// ============ API 响应格式 ============

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    message: string
    code?: string
    details?: unknown
  }
}

// ============ API Key 管理 ============

export interface ApiKeyInfo {
  id: string
  key: string
  name: string
  createdAt: number
  lastUsed?: number
}

// ============ Kiro 模型 ============

export interface KiroModel {
  modelId: string
  name: string
  description?: string
  maxTokens?: number
}
