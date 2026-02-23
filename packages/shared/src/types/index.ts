/**
 * TLS 配置类型
 */
export interface TlsConfig {
  enabled: boolean;
  certPath?: string;
  keyPath?: string;
  cert?: string;
  key?: string;
}

/**
 * 代理服务配置类型
 */
export interface ProxyConfig {
  enabled: boolean;
  port: number;
  host: string;
  apiKey?: string;
  enableMultiAccount: boolean;
  selectedAccountIds: string[];
  logRequests: boolean;
  maxConcurrent: number;
  maxRetries: number;
  retryDelayMs: number;
  requestTimeout: number;
  preferredEndpoint?: 'codewhisperer' | 'amazonq';
  tokenRefreshBeforeExpiry: number;
  tls?: TlsConfig;
  autoStart?: boolean;
  autoContinueRounds?: number;
  disableTools?: boolean;
  autoSwitchOnQuotaExhausted?: boolean;
}

/**
 * 账号池配置类型
 */
export interface AccountPoolConfig {
  cooldownMs: number;
  maxErrorCount: number;
  quotaResetMs: number;
}

/**
 * 账号凭证类型
 */
export interface AccountCredentials {
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  region?: string;
  startUrl?: string;
  expiresAt?: number;
  authMethod?: 'social' | 'idc';
  provider?: 'BuilderId' | 'Enterprise' | 'Github' | 'Google' | 'IAM_SSO';
}

/**
 * 账号调度状态
 */
export type AccountStatus = 'active' | 'paused' | 'error_suspended' | 'suspended'

/**
 * 账号相关类型 - 与后端 ProxyAccount 对应
 */
export interface Account {
  id: string;
  alias?: string;
  email?: string;
  userId?: string;
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  region?: string;
  authMethod?: 'social' | 'idc';
  provider?: string;
  profileArn?: string;
  expiresAt?: number;
  machineId: string;
  machineIdCreatedAt?: number;
  lastUsed?: number;
  requestCount?: number;
  errorCount?: number;
  status?: AccountStatus;
  cooldownUntil?: number;
  createdAt?: number;
}

export interface AddAccountRequest {
  alias?: string;
  email?: string;
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  region?: string;
  authMethod?: 'social' | 'idc';
  provider?: string;
  profileArn?: string;
  machineId?: string;
}

export interface AddAccountResponse {
  success: boolean;
  data?: Account;
  error?: string;
}

/**
 * 统计相关类型 - 与后端 ProxyStats 对应
 */
export interface ProxyStats {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalTokens: number;
  totalCredits: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  startTime: number;
}

export interface AccountStats {
  requests: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
  lastUsed: number;
  avgResponseTime: number;
  totalResponseTime: number;
}

export interface StatsOverview {
  global: ProxyStats;
  accounts: {
    total: number;
    available: number;
  };
  uptime: number;
}

export interface ModelStats {
  model: string;
  requests: number;
  tokens: number;
}

/**
 * 日志相关类型 - 与后端 RequestLog 对应
 */
export interface RequestLog {
  id?: string;
  timestamp: number;
  path: string;
  model: string;
  accountId: string;
  machineId?: string;
  inputTokens: number;
  outputTokens: number;
  credits?: number;
  /** Kiro 上游实际消耗的积分 */
  kiroCredits?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cost?: number;
  responseTime: number;
  success: boolean;
  error?: string;
  /** 辅助请求标记 */
  auxiliary?: boolean;
  /** 用户实际输入内容 */
  userInput?: string;
}

export interface SystemLog {
  id?: string;
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface LogsQuery {
  limit?: number;
  offset?: number;
  startTime?: number;
  endTime?: number;
  model?: string;
}

/**
 * 分页日志响应
 */
export interface PaginatedLogsResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface LogsSummary {
  total: number;
  success: number;
  failed: number;
  avgResponseTime: number;
}

/**
 * 日志文件信息
 */
export interface LogFile {
  filename: string;
  type: 'requests' | 'system';
  size: number;
  date: string;
}

/**
 * 配置相关类型 - 与后端 GatewayConfig 对应
 */
export interface GatewayConfig {
  // 基础配置
  port: number;
  host: string;

  // 代理服务配置
  proxyEnabled?: boolean;
  proxyPort?: number;
  proxyHost?: string;

  // 多账号配置
  enableMultiAccount: boolean;
  multiAccountEnabled?: boolean; // 前端别名

  // 请求配置
  maxConcurrent: number;
  maxRetries: number;
  retryDelay: number;
  requestTimeout: number;
  preferredEndpoint?: 'codewhisperer' | 'amazonq';
  defaultRegion?: string;

  // Token 刷新配置
  tokenRefreshAdvance?: number;
  tokenRefreshBeforeExpiry?: number;

  // 速率限制配置
  rateLimitEnabled: boolean;
  rateLimitWindow: number;
  rateLimitMax: number;

  // 自动化配置
  autoStart?: boolean;
  autoSwitchOnQuotaExhausted?: boolean;

  // 工具调用配置
  disableToolCalls?: boolean;
  disableTools?: boolean;
  toolCallAutoRounds?: number;
  autoContinueRounds?: number;

  // 日志配置
  enableRequestLogging?: boolean;
  logRequests?: boolean;

  // 账号池配置
  errorCooldownTime?: number;
  maxConsecutiveErrors?: number;
  quotaResetTime?: number;

  // 账号自动停用规则
  autoStopErrorCodes?: string;      // 逗号分隔的错误码，如 "429,403"
  autoStopErrorPatterns?: string;    // 逗号分隔的错误消息匹配模式
  quotaUsageThreshold?: number;      // 配额使用阈值百分比 (0-100)，0 表示不限制

}

export interface UpdateConfigRequest {
  // 基础配置
  port?: number;
  host?: string;
  apiKey?: string;

  // 代理服务配置（前端别名）
  proxyEnabled?: boolean;
  proxyPort?: number;
  proxyHost?: string;

  // 多账号配置
  enableMultiAccount?: boolean;
  multiAccountEnabled?: boolean; // 前端别名
  selectedAccountIds?: string[];

  // 请求配置
  logRequests?: boolean;
  enableRequestLogging?: boolean; // 前端别名
  maxConcurrent?: number;
  maxRetries?: number;
  retryDelay?: number;
  retryDelayMs?: number;
  requestTimeout?: number;
  preferredEndpoint?: 'codewhisperer' | 'amazonq';
  defaultRegion?: string;
  tokenRefreshBeforeExpiry?: number;
  tokenRefreshAdvance?: number; // 前端别名（秒）

  // 速率限制配置
  rateLimitEnabled?: boolean;
  rateLimitWindow?: number;
  rateLimitMax?: number;

  // TLS 配置
  tls?: TlsConfig;

  // 自动化配置
  autoStart?: boolean;
  autoContinueRounds?: number;
  toolCallAutoRounds?: number; // 前端别名
  disableTools?: boolean;
  disableToolCalls?: boolean; // 前端别名
  autoSwitchOnQuotaExhausted?: boolean;

  // 账号池配置
  accountPool?: AccountPoolConfig;
  // 账号池配置（前端别名，扁平化）
  errorCooldownTime?: number;
  maxConsecutiveErrors?: number;
  quotaResetTime?: number;

  // 账号自动停用规则
  autoStopErrorCodes?: string;
  autoStopErrorPatterns?: string;
  quotaUsageThreshold?: number;

}

/**
 * API Key 相关类型
 */
export interface ApiKeyRecord {
  id: string;
  key?: string;
  name: string;
  keyPreview?: string;
  boundAccountIds?: string[];  // 绑定的账号 ID 列表
  createdAt: number;
  lastUsed?: number;
}

export interface CreateApiKeyRequest {
  name: string;
  boundAccountIds?: string[];  // 创建时可选绑定账号
}

/**
 * API 响应通用类型
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * 使用量相关类型 - 与 Kiro API GetUsageLimits 对应
 */
export interface UsageBreakdown {
  resourceType?: string;
  displayName?: string;
  displayNamePlural?: string;
  currentUsage?: number;
  currentUsageWithPrecision?: number;
  usageLimit?: number;
  usageLimitWithPrecision?: number;
  currency?: string;
  unit?: string;
  overageRate?: number;
  overageCap?: number;
  type?: string;
  freeTrialInfo?: {
    freeTrialStatus?: string;
    usageLimit?: number;
    usageLimitWithPrecision?: number;
    currentUsage?: number;
    currentUsageWithPrecision?: number;
    freeTrialExpiry?: string;
  };
  bonuses?: Array<{
    bonusCode?: string;
    displayName?: string;
    description?: string;
    usageLimit?: number;
    usageLimitWithPrecision?: number;
    currentUsage?: number;
    currentUsageWithPrecision?: number;
    expiresAt?: string;
    redeemedAt?: string;
    status?: string;
  }>;
}

export interface SubscriptionInfo {
  subscriptionName?: string;
  subscriptionTitle?: string;
  subscriptionType?: string;
  status?: string;
  type?: string;
  subscriptionManagementTarget?: string;
  upgradeCapability?: string;
  overageCapability?: string;
}

export interface UsageLimitsResponse {
  usageBreakdownList?: UsageBreakdown[];
  nextDateReset?: string;
  subscriptionInfo?: SubscriptionInfo;
  overageConfiguration?: {
    overageEnabled?: boolean;
  };
  userInfo?: {
    email?: string;
    userId?: string;
  };
}

export interface AccountUsage {
  accountId: string;
  usage?: UsageLimitsResponse;
  error?: string;
  updatedAt?: number;
}

/**
 * 日统计相关类型
 */
export interface DailyGlobalStats {
  date: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface DailyAccountStats {
  date: string;
  accountId: string;
  requests: number;
  successRequests: number;
  failedRequests: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  avgResponseTime: number;
}

export interface DailyApiKeyStats {
  date: string;
  apiKeyId: string;
  requests: number;
  successRequests: number;
  failedRequests: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface DailyModelStats {
  date: string;
  model: string;
  requests: number;
  successRequests: number;
  failedRequests: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface CostRanking {
  rank: number;
  id: string;
  name: string;
  type: 'account' | 'apiKey' | 'model';
  totalCost: number;
  requestCount: number;
  tokenCount: number;
  percentage: number;
}

// ─── Webhook Types ──────────────────────────────────────────────────────────

export type WebhookPlatformType =
  | 'feishu' | 'dingtalk' | 'wechat_work'
  | 'slack' | 'discord' | 'custom'

export type WebhookNotificationType =
  | 'account_error' | 'usage_alert' | 'token_refresh_fail'
  | 'heartbeat' | 'request_stuck' | 'test'

export interface WebhookPlatformConfig {
  platform: WebhookPlatformType;
  enabled: boolean;
  url: string;
  secret?: string;
  label?: string;
}

export interface WebhookConfig {
  enabled: boolean;
  usageThreshold: number;
  notifyOnAccountError: boolean;
  notifyOnTokenRefreshFail: boolean;
  notifyHeartbeat: boolean;
  platforms: WebhookPlatformConfig[];
}

export interface WebhookNotification {
  type: WebhookNotificationType;
  timestamp: string;
  account?: { id: string; alias?: string; email?: string };
  detail: Record<string, unknown>;
}

export interface WebhookDeliveryResult {
  platform: WebhookPlatformType;
  label?: string;
  success: boolean;
  statusCode?: number;
  error?: string;
}
