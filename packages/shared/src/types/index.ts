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
 * 账号相关类型 - 与后端 ProxyAccount 对应
 */
export interface Account {
  id: string;
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
  isAvailable?: boolean;
  cooldownUntil?: number;
  createdAt?: number;
}

export interface AddAccountRequest {
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
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cost?: number;
  responseTime: number;
  success: boolean;
  error?: string;
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
  startTime?: number;
  endTime?: number;
}

export interface LogsSummary {
  total: number;
  success: number;
  failed: number;
  avgResponseTime: number;
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
}

/**
 * API Key 相关类型
 */
export interface ApiKeyRecord {
  id: string;
  key?: string;
  name: string;
  keyPreview?: string;
  createdAt: number;
  lastUsed?: number;
}

export interface CreateApiKeyRequest {
  name: string;
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
