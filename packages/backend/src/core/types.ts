/**
 * Kiro Gateway 类型定义
 * 基于原有 proxy/types.ts 迁移并扩展
 */

import type { AccountStatus } from '@kiro-gateway/shared'

// ============ Claude 兼容格式 ============

export interface ClaudeThinkingConfig {
  type: 'enabled' | 'disabled'
  budget_tokens?: number
}

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
  thinking?: ClaudeThinkingConfig
}

export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string | ClaudeContentBlock[]
}

export interface ClaudeSystemBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

export interface ClaudeContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'thinking'
  text?: string
  thinking?: string
  source?: { type: 'base64'; media_type: string; data: string }
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: string | ClaudeContentBlock[]
  cache_control?: { type: 'ephemeral' }
}

export interface ClaudeTool {
  type?: string           // e.g. "web_search_20250305" for WebSearch tool
  name: string
  description: string
  input_schema: unknown
  max_uses?: number       // WebSearch max uses
}

// Cache 创建详情（与上游 API 格式一致）
export interface CacheCreationDetails {
  ephemeral_1h_input_tokens: number
  ephemeral_5m_input_tokens: number
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
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    // 上游 API 格式的详细 cache 信息
    cache_creation?: CacheCreationDetails
  }
}

export interface ClaudeStreamEvent {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop' | 'ping' | 'error'
  message?: Partial<ClaudeResponse>
  index?: number
  content_block?: ClaudeContentBlock | { type: 'thinking'; thinking: string }
  delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string; stop_sequence?: string | null }
  usage?: {
    input_tokens?: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    // 上游 API 格式的详细 cache 信息
    cache_creation?: CacheCreationDetails
  }
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
  alias?: string
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
  status?: AccountStatus  // 调度状态，默认 active
  cooldownUntil?: number
  createdAt?: number
}

// 添加账号请求（机器码可选，不提供则自动生成）
export interface AddAccountRequest {
  alias?: string
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
  alias?: string
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
  status?: AccountStatus
  expiresAt?: number
}

// ============ 代理服务配置 ============

export interface ProxyConfig {
  // 基础配置
  enabled: boolean
  port: number
  host: string

  // 账号配置
  enableMultiAccount: boolean
  selectedAccountIds: string[]
  autoSwitchOnQuotaExhausted?: boolean

  // 请求配置
  logRequests: boolean
  maxConcurrent: number
  maxRetries: number
  retryDelayMs: number

  // 错误冷却时间配置（毫秒）
  errorCooldown429?: number    // 429 配额耗尽冷却，默认 60s
  errorCooldown5xx?: number    // 5xx 服务端错误冷却，默认 15s
  errorCooldown529?: number    // 529 过载冷却，默认 120s

  requestTimeout?: number

  // 请求排队配置
  queueEnabled?: boolean       // 是否启用排队，默认 false
  queueMaxSize?: number        // 最大队列长度，默认 2x maxConcurrent
  queueTimeoutMs?: number      // 排队超时时间（毫秒），默认 30s

  // Token 刷新配置
  tokenRefreshBeforeExpiry: number  // 提前刷新时间（秒）
  autoStart: boolean

  // Thinking 模式配置
  modelThinkingMode?: Record<string, boolean>  // 按模型启用 thinking
  thinkingOutputFormat?: 'thinking' | 'think' | 'reasoning_content'

  // 自动继续配置
  autoContinueRounds?: number  // 自动继续轮数

  // 工具配置
  disableTools?: boolean  // 禁用工具调用

  // API Key 配置
  apiKey?: string  // 兼容旧的单 API Key
  apiKeys?: ApiKey[]  // 多 API Key 支持

  // TLS 配置
  tls?: {
    enabled: boolean
    cert?: string
    key?: string
    certPath?: string
    keyPath?: string
  }

  // 端点偏好
  preferredEndpoint?: 'codewhisperer' | 'amazonq'

  // 默认 Region
  defaultRegion?: string
}

// API Key 定义（带用量统计）
export interface ApiKey {
  id: string
  key: string
  name: string
  enabled: boolean
  createdAt: number
  lastUsedAt?: number
  creditsLimit?: number  // 额度限制

  // 用量统计
  usage: {
    totalRequests: number
    totalCredits: number
    totalInputTokens: number
    totalOutputTokens: number
    totalCost: number
    daily: Record<string, {
      requests: number
      credits: number
      inputTokens: number
      outputTokens: number
      cost: number
    }>
    byModel?: Record<string, {
      requests: number
      credits: number
      inputTokens: number
      outputTokens: number
      cost: number
    }>
  }

  // 用量历史（最近 100 条）
  usageHistory?: Array<{
    timestamp: number
    model: string
    inputTokens: number
    outputTokens: number
    credits: number
    cost: number
    path: string
  }>
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
  totalCost: number
  cacheCreationTokens: number
  cacheReadTokens: number
  startTime: number
  // 扩展统计
  accountStats: Map<string, AccountStats>
  endpointStats: Map<string, EndpointStats>
  modelStats: Map<string, ModelStats>
  recentRequests: RequestLog[]
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
  totalCost: number
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
  /** Kiro 上游实际消耗的积分（来自 meteringEvent） */
  kiroCredits?: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  cost?: number
  responseTime: number
  success: boolean
  error?: string
  /** 辅助请求标记（主题检测、自动建议等），不计入计费统计 */
  auxiliary?: boolean
  /** 用户实际输入的文本内容（截断保存，方便排查） */
  userInput?: string
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

// ============ 结构化错误类型 ============

export type KiroErrorCode =
  | 'QUOTA_EXHAUSTED'      // 429
  | 'SERVER_ERROR'         // 5xx
  | 'OVERLOADED'           // 529
  | 'AUTH_ERROR'           // 401/403
  | 'MONTHLY_LIMIT'        // 402 / MONTHLY_REQUEST_COUNT
  | 'ACCOUNT_SUSPENDED'    // TEMPORARILY_SUSPENDED
  | 'UNKNOWN'

export class KiroApiError extends Error {
  public readonly statusCode: number
  public readonly errorCode: KiroErrorCode
  public readonly retryable: boolean
  public readonly endpoint?: string

  constructor(
    message: string,
    statusCode: number,
    errorCode: KiroErrorCode,
    retryable: boolean,
    endpoint?: string
  ) {
    super(message)
    this.name = 'KiroApiError'
    this.statusCode = statusCode
    this.errorCode = errorCode
    this.retryable = retryable
    this.endpoint = endpoint
  }

  static fromHttpResponse(status: number, body: string, endpoint?: string): KiroApiError {
    if (status === 429) {
      return new KiroApiError(`Quota exhausted: ${body}`, 429, 'QUOTA_EXHAUSTED', true, endpoint)
    }
    if (status === 529) {
      return new KiroApiError(`Service overloaded: ${body}`, 529, 'OVERLOADED', true, endpoint)
    }
    if (status === 401 || status === 403) {
      return new KiroApiError(`Auth error ${status}: ${body}`, status, 'AUTH_ERROR', false, endpoint)
    }
    if (status === 402 || body.includes('MONTHLY_REQUEST_COUNT')) {
      return new KiroApiError(`Monthly limit: ${body}`, status, 'MONTHLY_LIMIT', false, endpoint)
    }
    if (body.includes('TEMPORARILY_SUSPENDED') || body.includes('temporarily is suspended')) {
      return new KiroApiError(`Account suspended: ${body}`, status, 'ACCOUNT_SUSPENDED', false, endpoint)
    }
    if (status >= 500) {
      return new KiroApiError(`Server error ${status}: ${body}`, status, 'SERVER_ERROR', true, endpoint)
    }
    return new KiroApiError(`API error ${status}: ${body}`, status, 'UNKNOWN', false, endpoint)
  }
}
