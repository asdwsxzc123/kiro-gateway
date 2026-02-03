/**
 * API Key 存储模块
 * 使用 Redis 存储 API Key 元数据和统计数据
 */

import { getRedisClient } from './redis.js'
import { createLogger } from '../utils/logger.js'
import { encrypt, decrypt } from '../utils/crypto.js'
import { v4 as uuidv4 } from 'uuid'
import type { ApiKey } from '../core/types.js'

const logger = createLogger('ApiKeyStore')

// Redis Key 前缀
const APIKEY_META_PREFIX = 'apikey:meta:'
const APIKEY_STATS_TOTAL_PREFIX = 'stats:total:apikey:'
const APIKEY_STATS_DAILY_PREFIX = 'stats:daily:apikey:'
const APIKEYS_INDEX = 'apikeys:index'

// 敏感字段列表（需要加密）
const SENSITIVE_FIELDS = ['key']

// 7 天 TTL（秒）
const DAILY_STATS_TTL = 7 * 24 * 60 * 60

/**
 * 序列化 API Key 数据（加密敏感字段）
 */
function serializeApiKey(apiKey: ApiKey): Record<string, string> {
  const data: Record<string, string> = {}

  for (const [key, value] of Object.entries(apiKey)) {
    if (value === undefined || value === null) continue

    if (SENSITIVE_FIELDS.includes(key) && typeof value === 'string') {
      data[key] = encrypt(value)
    } else if (typeof value === 'number') {
      data[key] = String(value)
    } else if (typeof value === 'string') {
      data[key] = value
    }
  }

  return data
}

/**
 * 反序列化 API Key 数据（解密敏感字段）
 */
function deserializeApiKey(data: Record<string, string>): ApiKey {
  const apiKey: Partial<ApiKey> = {}

  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_FIELDS.includes(key)) {
      (apiKey as Record<string, unknown>)[key] = decrypt(value)
    } else if (['createdAt', 'lastUsed'].includes(key)) {
      (apiKey as Record<string, unknown>)[key] = parseInt(value, 10)
    } else {
      (apiKey as Record<string, unknown>)[key] = value
    }
  }

  return apiKey as ApiKey
}

/**
 * 获取日期字符串 (YYYY-MM-DD)
 */
function getDateString(date?: Date): string {
  const d = date || new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 保存 API Key 元数据
 */
export async function saveApiKeyMeta(apiKey: ApiKey): Promise<void> {
  const redis = getRedisClient()

  try {
    const serialized = serializeApiKey(apiKey)

    const pipeline = redis.pipeline()
    pipeline.hset(APIKEY_META_PREFIX + apiKey.id, serialized)
    pipeline.zadd(APIKEYS_INDEX, Date.now(), apiKey.id)
    await pipeline.exec()

    logger.info('API Key meta saved', { apiKeyId: apiKey.id, name: apiKey.name })
  } catch (error) {
    logger.error('Failed to save API Key meta', { apiKeyId: apiKey.id, error: (error as Error).message })
    throw error
  }
}

/**
 * 获取 API Key 元数据
 */
export async function getApiKeyMeta(apiKeyId: string): Promise<ApiKey | null> {
  const redis = getRedisClient()

  try {
    const data = await redis.hgetall(APIKEY_META_PREFIX + apiKeyId)

    if (!data || Object.keys(data).length === 0) {
      return null
    }

    return deserializeApiKey(data)
  } catch (error) {
    logger.error('Failed to get API Key meta', { apiKeyId, error: (error as Error).message })
    return null
  }
}

/**
 * 获取所有 API Key 元数据
 */
export async function getAllApiKeyMeta(): Promise<ApiKey[]> {
  const redis = getRedisClient()

  try {
    // 获取所有 API Key ID
    const apiKeyIds = await redis.zrange(APIKEYS_INDEX, 0, -1)

    if (apiKeyIds.length === 0) {
      return []
    }

    // 批量获取 API Key 数据
    const pipeline = redis.pipeline()
    for (const id of apiKeyIds) {
      pipeline.hgetall(APIKEY_META_PREFIX + id)
    }

    const results = await pipeline.exec()
    const apiKeys: ApiKey[] = []

    if (results) {
      for (const [err, data] of results) {
        if (!err && data && typeof data === 'object' && Object.keys(data).length > 0) {
          apiKeys.push(deserializeApiKey(data as Record<string, string>))
        }
      }
    }

    return apiKeys
  } catch (error) {
    logger.error('Failed to get all API Key meta', { error: (error as Error).message })
    return []
  }
}

/**
 * 获取 API Key 总统计
 */
export async function getApiKeyTotalStats(apiKeyId: string): Promise<{
  credits: number
  inputTokens: number
  outputTokens: number
  cost: number
}> {
  const redis = getRedisClient()

  try {
    const data = await redis.hgetall(APIKEY_STATS_TOTAL_PREFIX + apiKeyId)

    if (!data || Object.keys(data).length === 0) {
      return {
        credits: 0,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0
      }
    }

    return {
      credits: parseFloat(data.credits) || 0,
      inputTokens: parseInt(data.inputTokens, 10) || 0,
      outputTokens: parseInt(data.outputTokens, 10) || 0,
      cost: parseFloat(data.cost) || 0
    }
  } catch (error) {
    logger.error('Failed to get API Key total stats', { apiKeyId, error: (error as Error).message })
    return {
      credits: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0
    }
  }
}

/**
 * 更新 API Key 总统计
 */
export async function updateApiKeyTotalStats(
  apiKeyId: string,
  credits: number = 0,
  inputTokens: number = 0,
  outputTokens: number = 0,
  cost: number = 0
): Promise<void> {
  const redis = getRedisClient()

  try {
    const pipeline = redis.pipeline()

    pipeline.hincrbyfloat(APIKEY_STATS_TOTAL_PREFIX + apiKeyId, 'credits', credits)
    pipeline.hincrby(APIKEY_STATS_TOTAL_PREFIX + apiKeyId, 'inputTokens', inputTokens)
    pipeline.hincrby(APIKEY_STATS_TOTAL_PREFIX + apiKeyId, 'outputTokens', outputTokens)
    pipeline.hincrbyfloat(APIKEY_STATS_TOTAL_PREFIX + apiKeyId, 'cost', cost)

    await pipeline.exec()
  } catch (error) {
    logger.error('Failed to update API Key total stats', { apiKeyId, error: (error as Error).message })
  }
}

/**
 * 获取 API Key 日统计
 */
export async function getDailyApiKeyStats(
  apiKeyId: string,
  date?: Date
): Promise<{
  credits: number
  inputTokens: number
  outputTokens: number
  cost: number
}> {
  const redis = getRedisClient()
  const dateStr = getDateString(date)

  try {
    const data = await redis.hgetall(APIKEY_STATS_DAILY_PREFIX + apiKeyId + ':' + dateStr)

    if (!data || Object.keys(data).length === 0) {
      return {
        credits: 0,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0
      }
    }

    return {
      credits: parseFloat(data.credits) || 0,
      inputTokens: parseInt(data.inputTokens, 10) || 0,
      outputTokens: parseInt(data.outputTokens, 10) || 0,
      cost: parseFloat(data.cost) || 0
    }
  } catch (error) {
    logger.error('Failed to get daily API Key stats', { apiKeyId, date: dateStr, error: (error as Error).message })
    return {
      credits: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0
    }
  }
}

/**
 * 更新 API Key 日统计
 */
export async function updateDailyApiKeyStats(
  apiKeyId: string,
  credits: number = 0,
  inputTokens: number = 0,
  outputTokens: number = 0,
  cost: number = 0,
  date?: Date
): Promise<void> {
  const redis = getRedisClient()
  const dateStr = getDateString(date)
  const key = APIKEY_STATS_DAILY_PREFIX + apiKeyId + ':' + dateStr

  try {
    const pipeline = redis.pipeline()

    pipeline.hincrbyfloat(key, 'credits', credits)
    pipeline.hincrby(key, 'inputTokens', inputTokens)
    pipeline.hincrby(key, 'outputTokens', outputTokens)
    pipeline.hincrbyfloat(key, 'cost', cost)

    // 设置 TTL
    pipeline.expire(key, DAILY_STATS_TTL)

    await pipeline.exec()
  } catch (error) {
    logger.error('Failed to update daily API Key stats', { apiKeyId, date: dateStr, error: (error as Error).message })
  }
}

/**
 * 更新 API Key 最后使用时间
 */
export async function updateApiKeyLastUsed(apiKeyId: string): Promise<void> {
  const redis = getRedisClient()

  try {
    const now = Date.now()

    const pipeline = redis.pipeline()
    pipeline.hset(APIKEY_META_PREFIX + apiKeyId, 'lastUsed', String(now))
    pipeline.zadd(APIKEYS_INDEX, now, apiKeyId)
    await pipeline.exec()
  } catch (error) {
    logger.error('Failed to update API Key last used', { apiKeyId, error: (error as Error).message })
  }
}

/**
 * 删除 API Key 元数据
 */
export async function deleteApiKeyMeta(apiKeyId: string): Promise<boolean> {
  const redis = getRedisClient()

  try {
    const apiKey = await getApiKeyMeta(apiKeyId)
    if (!apiKey) {
      return false
    }

    const pipeline = redis.pipeline()

    // 删除元数据
    pipeline.del(APIKEY_META_PREFIX + apiKeyId)

    // 删除总统计
    pipeline.del(APIKEY_STATS_TOTAL_PREFIX + apiKeyId)

    // 删除所有日统计
    const dailyKeys = await redis.keys(APIKEY_STATS_DAILY_PREFIX + apiKeyId + ':*')
    if (dailyKeys.length > 0) {
      pipeline.del(...dailyKeys)
    }

    // 删除索引
    pipeline.zrem(APIKEYS_INDEX, apiKeyId)

    await pipeline.exec()

    logger.info('API Key meta deleted', { apiKeyId, name: apiKey.name })
    return true
  } catch (error) {
    logger.error('Failed to delete API Key meta', { apiKeyId, error: (error as Error).message })
    return false
  }
}

/**
 * 获取 API Key 数量
 */
export async function getApiKeyCount(): Promise<number> {
  const redis = getRedisClient()

  try {
    return await redis.zcard(APIKEYS_INDEX)
  } catch (error) {
    logger.error('Failed to get API Key count', { error: (error as Error).message })
    return 0
  }
}

/**
 * 创建新的 API Key 记录
 */
export async function createApiKey(name: string): Promise<ApiKey> {
  const id = `key_${uuidv4().substring(0, 12)}`
  const key = `sk_${uuidv4().replace(/-/g, '')}`
  const now = Date.now()

  const apiKey: ApiKey = {
    id,
    key,
    name,
    enabled: true,
    createdAt: now,
    usage: {
      totalRequests: 0,
      totalCredits: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      daily: {}
    }
  }

  await saveApiKeyMeta(apiKey)

  return apiKey
}

/**
 * 验证 API Key 是否存在
 */
export async function validateApiKey(key: string): Promise<ApiKey | null> {
  try {
    // 获取所有 API Key
    const allKeys = await getAllApiKeyMeta()

    for (const apiKey of allKeys) {
      if (apiKey.key === key) {
        return apiKey
      }
    }

    return null
  } catch (error) {
    logger.error('Failed to validate API Key', { error: (error as Error).message })
    return null
  }
}

/**
 * 获取 API Key 的日统计列表（最近 N 天）
 */
export async function getApiKeyDailyStatsList(
  apiKeyId: string,
  days: number = 7
): Promise<Array<{ date: string; stats: { credits: number; inputTokens: number; outputTokens: number; cost: number } }>> {
  try {
    const result: Array<{ date: string; stats: { credits: number; inputTokens: number; outputTokens: number; cost: number } }> = []

    for (let i = 0; i < days; i++) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = getDateString(date)

      const stats = await getDailyApiKeyStats(apiKeyId, date)
      result.push({ date: dateStr, stats })
    }

    return result
  } catch (error) {
    logger.error('Failed to get API Key daily stats list', { apiKeyId, days, error: (error as Error).message })
    return []
  }
}
