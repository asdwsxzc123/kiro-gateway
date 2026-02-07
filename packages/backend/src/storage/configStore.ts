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
  boundAccountIds?: string[]  // 绑定的账号 ID 列表（空或不设 = 使用全局账号池）
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
 * 返回匹配的 ApiKeyRecord（含 boundAccountIds），无匹配返回 null
 */
export async function validateApiKey(key: string): Promise<ApiKeyRecord | null> {
  const redis = getRedisClient()

  try {
    const data = await redis.hgetall(API_KEYS_KEY)

    if (!data || Object.keys(data).length === 0) {
      // 没有配置任何 API Key，拒绝访问（更安全的默认行为）
      logger.warn('No API keys configured, access denied')
      return null
    }

    for (const json of Object.values(data)) {
      const record = JSON.parse(json) as ApiKeyRecord
      if (record.key === key) {
        // 更新最后使用时间
        record.lastUsed = Date.now()
        await redis.hset(API_KEYS_KEY, record.id, JSON.stringify(record))
        return record
      }
    }

    return null
  } catch (error) {
    logger.error('Failed to validate API key', { error: (error as Error).message })
    return null
  }
}

/**
 * 更新 API Key（名称、绑定账号等）
 */
export async function updateApiKey(
  id: string,
  updates: Partial<Pick<ApiKeyRecord, 'name' | 'boundAccountIds'>>
): Promise<ApiKeyRecord | null> {
  const redis = getRedisClient()

  try {
    const raw = await redis.hget(API_KEYS_KEY, id)
    if (!raw) return null

    const record = JSON.parse(raw) as ApiKeyRecord
    // 合并更新字段
    if (updates.name !== undefined) record.name = updates.name
    if (updates.boundAccountIds !== undefined) record.boundAccountIds = updates.boundAccountIds

    await redis.hset(API_KEYS_KEY, id, JSON.stringify(record))
    logger.info('API key updated', { id, updates })
    return record
  } catch (error) {
    logger.error('Failed to update API key', { error: (error as Error).message })
    return null
  }
}

/**
 * 从所有 API Key 的 boundAccountIds 中移除指定账号
 * 用于账号删除时的级联清理
 */
export async function removeAccountFromApiKeys(accountId: string): Promise<number> {
  const redis = getRedisClient()
  let updated = 0

  try {
    const data = await redis.hgetall(API_KEYS_KEY)
    if (!data || Object.keys(data).length === 0) return 0

    for (const [id, json] of Object.entries(data)) {
      const record = JSON.parse(json) as ApiKeyRecord
      if (record.boundAccountIds && record.boundAccountIds.includes(accountId)) {
        // 移除已删除的账号 ID
        record.boundAccountIds = record.boundAccountIds.filter(aid => aid !== accountId)
        await redis.hset(API_KEYS_KEY, id, JSON.stringify(record))
        updated++
      }
    }

    if (updated > 0) {
      logger.info('Removed account from API key bindings', { accountId, updatedKeys: updated })
    }
    return updated
  } catch (error) {
    logger.error('Failed to remove account from API keys', { error: (error as Error).message })
    return 0
  }
}
