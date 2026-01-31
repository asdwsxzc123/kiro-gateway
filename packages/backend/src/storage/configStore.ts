/**
 * 配置存储模块
 * 使用 Redis 存储网关配置
 */

import { getRedisClient } from './redis.js'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('ConfigStore')

// Redis Key
const CONFIG_KEY = 'config'
const SELECTED_ACCOUNTS_KEY = 'config:selectedAccounts'
const API_KEYS_KEY = 'config:apiKeys'

export interface GatewayConfig {
  // 服务配置
  port: number
  host: string

  // 代理配置
  enableMultiAccount: boolean
  maxConcurrent: number
  maxRetries: number
  retryDelay: number
  requestTimeout: number
  preferredEndpoint?: 'codewhisperer' | 'amazonq'

  // 限流配置
  rateLimitEnabled: boolean
  rateLimitWindow: number
  rateLimitMax: number
}

const DEFAULT_CONFIG: GatewayConfig = {
  port: 3000,
  host: '0.0.0.0',
  enableMultiAccount: true,
  maxConcurrent: 5,
  maxRetries: 3,
  retryDelay: 1000,
  requestTimeout: 120000,
  rateLimitEnabled: false,
  rateLimitWindow: 60000,
  rateLimitMax: 100
}

/**
 * 获取网关配置
 */
export async function getGatewayConfig(): Promise<GatewayConfig> {
  const redis = getRedisClient()

  try {
    const data = await redis.hgetall(CONFIG_KEY)

    if (!data || Object.keys(data).length === 0) {
      return { ...DEFAULT_CONFIG }
    }

    return {
      port: parseInt(data.port, 10) || DEFAULT_CONFIG.port,
      host: data.host || DEFAULT_CONFIG.host,
      enableMultiAccount: data.enableMultiAccount === 'true',
      maxConcurrent: parseInt(data.maxConcurrent, 10) || DEFAULT_CONFIG.maxConcurrent,
      maxRetries: parseInt(data.maxRetries, 10) || DEFAULT_CONFIG.maxRetries,
      retryDelay: parseInt(data.retryDelay, 10) || DEFAULT_CONFIG.retryDelay,
      requestTimeout: parseInt(data.requestTimeout, 10) || DEFAULT_CONFIG.requestTimeout,
      preferredEndpoint: data.preferredEndpoint as GatewayConfig['preferredEndpoint'],
      rateLimitEnabled: data.rateLimitEnabled === 'true',
      rateLimitWindow: parseInt(data.rateLimitWindow, 10) || DEFAULT_CONFIG.rateLimitWindow,
      rateLimitMax: parseInt(data.rateLimitMax, 10) || DEFAULT_CONFIG.rateLimitMax
    }
  } catch (error) {
    logger.error('Failed to get gateway config', { error: (error as Error).message })
    return { ...DEFAULT_CONFIG }
  }
}

/**
 * 更新网关配置
 */
export async function updateGatewayConfig(updates: Partial<GatewayConfig>): Promise<GatewayConfig> {
  const redis = getRedisClient()

  try {
    const current = await getGatewayConfig()
    const updated = { ...current, ...updates }

    const data: Record<string, string> = {}
    for (const [key, value] of Object.entries(updated)) {
      if (value !== undefined && value !== null) {
        data[key] = String(value)
      }
    }

    await redis.hset(CONFIG_KEY, data)
    logger.info('Gateway config updated', { updates })

    return updated
  } catch (error) {
    logger.error('Failed to update gateway config', { error: (error as Error).message })
    throw error
  }
}

/**
 * 获取选中的账号 ID 列表
 */
export async function getSelectedAccounts(): Promise<string[]> {
  const redis = getRedisClient()

  try {
    return await redis.smembers(SELECTED_ACCOUNTS_KEY)
  } catch (error) {
    logger.error('Failed to get selected accounts', { error: (error as Error).message })
    return []
  }
}

/**
 * 设置选中的账号
 */
export async function setSelectedAccounts(accountIds: string[]): Promise<void> {
  const redis = getRedisClient()

  try {
    await redis.del(SELECTED_ACCOUNTS_KEY)
    if (accountIds.length > 0) {
      await redis.sadd(SELECTED_ACCOUNTS_KEY, ...accountIds)
    }
    logger.info('Selected accounts updated', { count: accountIds.length })
  } catch (error) {
    logger.error('Failed to set selected accounts', { error: (error as Error).message })
    throw error
  }
}

/**
 * 添加选中账号
 */
export async function addSelectedAccount(accountId: string): Promise<void> {
  const redis = getRedisClient()

  try {
    await redis.sadd(SELECTED_ACCOUNTS_KEY, accountId)
  } catch (error) {
    logger.error('Failed to add selected account', { error: (error as Error).message })
    throw error
  }
}

/**
 * 移除选中账号
 */
export async function removeSelectedAccount(accountId: string): Promise<void> {
  const redis = getRedisClient()

  try {
    await redis.srem(SELECTED_ACCOUNTS_KEY, accountId)
  } catch (error) {
    logger.error('Failed to remove selected account', { error: (error as Error).message })
    throw error
  }
}

// ============ API Key 管理 ============

export interface ApiKeyRecord {
  id: string
  key: string
  name: string
  createdAt: number
  lastUsed?: number
}

/**
 * 获取所有 API Key
 */
export async function getAllApiKeys(): Promise<ApiKeyRecord[]> {
  const redis = getRedisClient()

  try {
    const data = await redis.hgetall(API_KEYS_KEY)

    if (!data || Object.keys(data).length === 0) {
      return []
    }

    return Object.values(data).map(json => JSON.parse(json) as ApiKeyRecord)
  } catch (error) {
    logger.error('Failed to get API keys', { error: (error as Error).message })
    return []
  }
}

/**
 * 添加 API Key
 */
export async function addApiKey(record: ApiKeyRecord): Promise<void> {
  const redis = getRedisClient()

  try {
    await redis.hset(API_KEYS_KEY, record.id, JSON.stringify(record))
    logger.info('API key added', { id: record.id, name: record.name })
  } catch (error) {
    logger.error('Failed to add API key', { error: (error as Error).message })
    throw error
  }
}

/**
 * 删除 API Key
 */
export async function deleteApiKey(id: string): Promise<boolean> {
  const redis = getRedisClient()

  try {
    const result = await redis.hdel(API_KEYS_KEY, id)
    if (result > 0) {
      logger.info('API key deleted', { id })
      return true
    }
    return false
  } catch (error) {
    logger.error('Failed to delete API key', { error: (error as Error).message })
    return false
  }
}

/**
 * 验证 API Key
 */
export async function validateApiKey(key: string): Promise<boolean> {
  const redis = getRedisClient()

  try {
    const data = await redis.hgetall(API_KEYS_KEY)

    if (!data || Object.keys(data).length === 0) {
      // 没有配置任何 API Key，允许访问
      return true
    }

    for (const json of Object.values(data)) {
      const record = JSON.parse(json) as ApiKeyRecord
      if (record.key === key) {
        // 更新最后使用时间
        record.lastUsed = Date.now()
        await redis.hset(API_KEYS_KEY, record.id, JSON.stringify(record))
        return true
      }
    }

    return false
  } catch (error) {
    logger.error('Failed to validate API key', { error: (error as Error).message })
    return false
  }
}
