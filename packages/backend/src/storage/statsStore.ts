/**
 * 统计存储模块
 * 使用 Redis 存储请求统计数据
 */

import { getRedisClient } from './redis.js'
import { createLogger } from '../utils/logger.js'
import type { AccountStats, ModelStats } from '../core/types.js'

// Redis 存储的全局统计类型（简化版，不包含 Map 类型）
export interface GlobalStats {
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
}

const logger = createLogger('StatsStore')

// Redis Key
const GLOBAL_STATS_KEY = 'stats:global'
const ACCOUNT_STATS_PREFIX = 'stats:account:'
const MODEL_STATS_PREFIX = 'stats:model:'

/**
 * 获取全局统计
 */
export async function getGlobalStats(): Promise<GlobalStats> {
  const redis = getRedisClient()

  try {
    const data = await redis.hgetall(GLOBAL_STATS_KEY)

    if (!data || Object.keys(data).length === 0) {
      return {
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        totalTokens: 0,
        totalCredits: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        startTime: Date.now()
      }
    }

    return {
      totalRequests: parseInt(data.totalRequests, 10) || 0,
      successRequests: parseInt(data.successRequests, 10) || 0,
      failedRequests: parseInt(data.failedRequests, 10) || 0,
      totalTokens: parseInt(data.totalTokens, 10) || 0,
      totalCredits: parseFloat(data.totalCredits) || 0,
      inputTokens: parseInt(data.inputTokens, 10) || 0,
      outputTokens: parseInt(data.outputTokens, 10) || 0,
      totalCost: parseFloat(data.totalCost) || 0,
      cacheCreationTokens: parseInt(data.cacheCreationTokens, 10) || 0,
      cacheReadTokens: parseInt(data.cacheReadTokens, 10) || 0,
      startTime: parseInt(data.startTime, 10) || Date.now()
    }
  } catch (error) {
    logger.error('Failed to get global stats', { error: (error as Error).message })
    return {
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      totalTokens: 0,
      totalCredits: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      startTime: Date.now()
    }
  }
}

/**
 * 更新全局统计
 */
export async function updateGlobalStats(
  success: boolean,
  inputTokens: number,
  outputTokens: number,
  credits: number = 0,
  cost: number = 0,
  cacheCreationTokens: number = 0,
  cacheReadTokens: number = 0
): Promise<void> {
  const redis = getRedisClient()

  try {
    const pipeline = redis.pipeline()

    pipeline.hincrby(GLOBAL_STATS_KEY, 'totalRequests', 1)
    pipeline.hincrby(GLOBAL_STATS_KEY, success ? 'successRequests' : 'failedRequests', 1)
    pipeline.hincrby(GLOBAL_STATS_KEY, 'inputTokens', inputTokens)
    pipeline.hincrby(GLOBAL_STATS_KEY, 'outputTokens', outputTokens)
    pipeline.hincrby(
      GLOBAL_STATS_KEY,
      'totalTokens',
      inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens
    )
    pipeline.hincrbyfloat(GLOBAL_STATS_KEY, 'totalCredits', credits)
    pipeline.hincrbyfloat(GLOBAL_STATS_KEY, 'totalCost', cost)
    pipeline.hincrby(GLOBAL_STATS_KEY, 'cacheCreationTokens', cacheCreationTokens)
    pipeline.hincrby(GLOBAL_STATS_KEY, 'cacheReadTokens', cacheReadTokens)

    // 设置开始时间（如果不存在）
    pipeline.hsetnx(GLOBAL_STATS_KEY, 'startTime', String(Date.now()))

    await pipeline.exec()
  } catch (error) {
    logger.error('Failed to update global stats', { error: (error as Error).message })
  }
}

/**
 * 获取账号统计
 */
export async function getAccountStats(accountId: string): Promise<AccountStats> {
  const redis = getRedisClient()

  try {
    const data = await redis.hgetall(ACCOUNT_STATS_PREFIX + accountId)

    if (!data || Object.keys(data).length === 0) {
      return {
        requests: 0,
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        errors: 0,
        lastUsed: 0,
        avgResponseTime: 0,
        totalResponseTime: 0,
        totalCost: 0
      }
    }

    const requests = parseInt(data.requests, 10) || 0
    const totalResponseTime = parseInt(data.totalResponseTime, 10) || 0

    return {
      requests,
      tokens: parseInt(data.tokens, 10) || 0,
      inputTokens: parseInt(data.inputTokens, 10) || 0,
      outputTokens: parseInt(data.outputTokens, 10) || 0,
      errors: parseInt(data.errors, 10) || 0,
      lastUsed: parseInt(data.lastUsed, 10) || 0,
      avgResponseTime: requests > 0 ? totalResponseTime / requests : 0,
      totalResponseTime,
      totalCost: parseFloat(data.totalCost) || 0
    }
  } catch (error) {
    logger.error('Failed to get account stats', { accountId, error: (error as Error).message })
    return {
      requests: 0,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      errors: 0,
      lastUsed: 0,
      avgResponseTime: 0,
      totalResponseTime: 0,
      totalCost: 0
    }
  }
}

/**
 * 更新账号统计
 */
export async function updateAccountStats(
  accountId: string,
  success: boolean,
  inputTokens: number,
  outputTokens: number,
  responseTime: number,
  cost: number = 0
): Promise<void> {
  const redis = getRedisClient()

  try {
    const pipeline = redis.pipeline()

    pipeline.hincrby(ACCOUNT_STATS_PREFIX + accountId, 'requests', 1)
    pipeline.hincrby(ACCOUNT_STATS_PREFIX + accountId, 'inputTokens', inputTokens)
    pipeline.hincrby(ACCOUNT_STATS_PREFIX + accountId, 'outputTokens', outputTokens)
    pipeline.hincrby(ACCOUNT_STATS_PREFIX + accountId, 'tokens', inputTokens + outputTokens)
    pipeline.hincrby(ACCOUNT_STATS_PREFIX + accountId, 'totalResponseTime', responseTime)
    pipeline.hset(ACCOUNT_STATS_PREFIX + accountId, 'lastUsed', String(Date.now()))
    pipeline.hincrbyfloat(ACCOUNT_STATS_PREFIX + accountId, 'totalCost', cost)

    if (!success) {
      pipeline.hincrby(ACCOUNT_STATS_PREFIX + accountId, 'errors', 1)
    }

    await pipeline.exec()
  } catch (error) {
    logger.error('Failed to update account stats', { accountId, error: (error as Error).message })
  }
}

/**
 * 获取所有账号统计
 */
export async function getAllAccountStats(): Promise<Record<string, AccountStats>> {
  const redis = getRedisClient()

  try {
    // 获取所有账号统计 key
    const keys = await redis.keys(ACCOUNT_STATS_PREFIX + '*')

    if (keys.length === 0) {
      return {}
    }

    const result: Record<string, AccountStats> = {}

    for (const key of keys) {
      const accountId = key.replace(ACCOUNT_STATS_PREFIX, '')
      result[accountId] = await getAccountStats(accountId)
    }

    return result
  } catch (error) {
    logger.error('Failed to get all account stats', { error: (error as Error).message })
    return {}
  }
}

/**
 * 获取模型统计
 */
export async function getModelStats(modelId: string): Promise<ModelStats> {
  const redis = getRedisClient()

  try {
    const data = await redis.hgetall(MODEL_STATS_PREFIX + modelId)

    if (!data || Object.keys(data).length === 0) {
      return { model: modelId, requests: 0, tokens: 0 }
    }

    return {
      model: modelId,
      requests: parseInt(data.requests, 10) || 0,
      tokens: parseInt(data.tokens, 10) || 0
    }
  } catch (error) {
    logger.error('Failed to get model stats', { modelId, error: (error as Error).message })
    return { model: modelId, requests: 0, tokens: 0 }
  }
}

/**
 * 更新模型统计
 */
export async function updateModelStats(
  modelId: string,
  tokens: number
): Promise<void> {
  const redis = getRedisClient()

  try {
    const pipeline = redis.pipeline()
    pipeline.hincrby(MODEL_STATS_PREFIX + modelId, 'requests', 1)
    pipeline.hincrby(MODEL_STATS_PREFIX + modelId, 'tokens', tokens)
    await pipeline.exec()
  } catch (error) {
    logger.error('Failed to update model stats', { modelId, error: (error as Error).message })
  }
}

/**
 * 获取所有模型统计
 */
export async function getAllModelStats(): Promise<ModelStats[]> {
  const redis = getRedisClient()

  try {
    const keys = await redis.keys(MODEL_STATS_PREFIX + '*')

    if (keys.length === 0) {
      return []
    }

    const result: ModelStats[] = []

    for (const key of keys) {
      const modelId = key.replace(MODEL_STATS_PREFIX, '')
      result.push(await getModelStats(modelId))
    }

    return result
  } catch (error) {
    logger.error('Failed to get all model stats', { error: (error as Error).message })
    return []
  }
}

/**
 * 重置所有统计
 */
export async function resetAllStats(): Promise<void> {
  const redis = getRedisClient()

  try {
    // 删除全局统计
    await redis.del(GLOBAL_STATS_KEY)

    // 删除所有账号统计
    const accountKeys = await redis.keys(ACCOUNT_STATS_PREFIX + '*')
    if (accountKeys.length > 0) {
      await redis.del(...accountKeys)
    }

    // 删除所有模型统计
    const modelKeys = await redis.keys(MODEL_STATS_PREFIX + '*')
    if (modelKeys.length > 0) {
      await redis.del(...modelKeys)
    }

    logger.info('All stats reset')
  } catch (error) {
    logger.error('Failed to reset stats', { error: (error as Error).message })
    throw error
  }
}
