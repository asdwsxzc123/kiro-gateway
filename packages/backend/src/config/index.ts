/**
 * 配置加载器
 * 优先级: 环境变量 > 默认值
 */

import dotenv from 'dotenv'
import {
  DEFAULT_SERVER_CONFIG,
  DEFAULT_REDIS_CONFIG,
  DEFAULT_PROXY_CONFIG,
  DEFAULT_RATE_LIMIT_CONFIG,
  DEFAULT_LOG_CONFIG,
  DEFAULT_ACCOUNT_POOL_CONFIG
} from './defaults.js'

// 加载 .env 文件
dotenv.config()

// 服务器配置
export interface ServerConfig {
  port: number
  host: string
  nodeEnv: string
}

// Redis 配置
export interface RedisConfig {
  url: string
  password: string
  db: number
  keyPrefix: string
}

// 安全配置
export interface SecurityConfig {
  apiKey: string
  encryptionKey: string
  requireApiKey: boolean
}

// 代理配置
export interface ProxyConfig {
  enableMultiAccount: boolean
  maxConcurrent: number
  maxRetries: number
  retryDelayMs: number
  tokenRefreshBeforeExpiry: number
  preferredEndpoint: 'codewhisperer' | 'amazonq'
  autoContinueRounds: number
  disableTools: boolean
  autoSwitchOnQuotaExhausted: boolean
}

// 限流配置
export interface RateLimitConfig {
  enabled: boolean
  windowMs: number
  maxRequests: number
}

// 日志配置
export interface LogConfig {
  level: string
  maxEntries: number
}

// 账号池配置
export interface AccountPoolConfig {
  cooldownMs: number
  maxErrorCount: number
  quotaResetMs: number
}

// 完整配置
export interface Config {
  server: ServerConfig
  redis: RedisConfig
  security: SecurityConfig
  proxy: ProxyConfig
  rateLimit: RateLimitConfig
  log: LogConfig
  accountPool: AccountPoolConfig
}

/**
 * 加载配置
 */
export function loadConfig(): Config {
  return {
    server: {
      port: parseInt(process.env.PORT || String(DEFAULT_SERVER_CONFIG.port), 10),
      host: process.env.HOST || DEFAULT_SERVER_CONFIG.host,
      nodeEnv: process.env.NODE_ENV || DEFAULT_SERVER_CONFIG.nodeEnv
    },
    redis: {
      url: process.env.REDIS_URL || DEFAULT_REDIS_CONFIG.url,
      password: process.env.REDIS_PASSWORD || DEFAULT_REDIS_CONFIG.password,
      db: parseInt(process.env.REDIS_DB || String(DEFAULT_REDIS_CONFIG.db), 10),
      keyPrefix: process.env.REDIS_KEY_PREFIX || DEFAULT_REDIS_CONFIG.keyPrefix
    },
    security: {
      apiKey: process.env.API_KEY || '',
      encryptionKey: process.env.ENCRYPTION_KEY || '',
      requireApiKey: process.env.REQUIRE_API_KEY === 'true'
    },
    proxy: {
      enableMultiAccount: process.env.ENABLE_MULTI_ACCOUNT !== 'false',
      maxConcurrent: parseInt(process.env.MAX_CONCURRENT || String(DEFAULT_PROXY_CONFIG.maxConcurrent), 10),
      maxRetries: parseInt(process.env.MAX_RETRIES || String(DEFAULT_PROXY_CONFIG.maxRetries), 10),
      retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || String(DEFAULT_PROXY_CONFIG.retryDelayMs), 10),
      tokenRefreshBeforeExpiry: parseInt(process.env.TOKEN_REFRESH_BEFORE_EXPIRY || String(DEFAULT_PROXY_CONFIG.tokenRefreshBeforeExpiry), 10),
      preferredEndpoint: (process.env.PREFERRED_ENDPOINT as 'codewhisperer' | 'amazonq') || DEFAULT_PROXY_CONFIG.preferredEndpoint,
      autoContinueRounds: parseInt(process.env.AUTO_CONTINUE_ROUNDS || String(DEFAULT_PROXY_CONFIG.autoContinueRounds), 10),
      disableTools: process.env.DISABLE_TOOLS === 'true',
      autoSwitchOnQuotaExhausted: process.env.AUTO_SWITCH_ON_QUOTA_EXHAUSTED !== 'false'
    },
    rateLimit: {
      enabled: process.env.RATE_LIMIT_ENABLED === 'true',
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || String(DEFAULT_RATE_LIMIT_CONFIG.windowMs), 10),
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || String(DEFAULT_RATE_LIMIT_CONFIG.maxRequests), 10)
    },
    log: {
      level: process.env.LOG_LEVEL || DEFAULT_LOG_CONFIG.level,
      maxEntries: parseInt(process.env.LOG_MAX_ENTRIES || String(DEFAULT_LOG_CONFIG.maxEntries), 10)
    },
    accountPool: {
      cooldownMs: DEFAULT_ACCOUNT_POOL_CONFIG.cooldownMs,
      maxErrorCount: DEFAULT_ACCOUNT_POOL_CONFIG.maxErrorCount,
      quotaResetMs: DEFAULT_ACCOUNT_POOL_CONFIG.quotaResetMs
    }
  }
}

// 导出单例配置
let configInstance: Config | null = null

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig()
  }
  return configInstance
}

// 重新加载配置
export function reloadConfig(): Config {
  configInstance = loadConfig()
  return configInstance
}
