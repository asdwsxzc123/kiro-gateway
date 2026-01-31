/**
 * 默认配置
 */

// 服务器默认配置
export const DEFAULT_SERVER_CONFIG = {
  port: 3000,
  host: '0.0.0.0',
  nodeEnv: 'development'
} as const

// Redis 默认配置1
export const DEFAULT_REDIS_CONFIG = {
  url: 'redis://localhost:6379',
  password: '',
  db: 0,
  keyPrefix: 'gateway:',
} as const


// 代理默认配置
export const DEFAULT_PROXY_CONFIG = {
  enableMultiAccount: true,
  maxConcurrent: 10,
  maxRetries: 3,
  retryDelayMs: 1000,
  tokenRefreshBeforeExpiry: 300, // 5分钟提前刷新
  preferredEndpoint: 'codewhisperer' as const,
  autoContinueRounds: 0,
  disableTools: false,
  autoSwitchOnQuotaExhausted: true
} as const

// 限流默认配置
export const DEFAULT_RATE_LIMIT_CONFIG = {
  windowMs: 60000, // 1分钟
  maxRequests: 100
} as const

// 日志默认配置
export const DEFAULT_LOG_CONFIG = {
  level: 'info',
  maxEntries: 100000
} as const

// 账号池默认配置
export const DEFAULT_ACCOUNT_POOL_CONFIG = {
  cooldownMs: 60000, // 1分钟冷却
  maxErrorCount: 3, // 3次错误后暂停
  quotaResetMs: 3600000 // 1小时配额重置
} as const
