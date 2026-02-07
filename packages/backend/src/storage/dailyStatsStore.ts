/**
 * 日统计存储模块
 * 使用 Redis 存储每日请求统计数据
 * TTL: 7 天
 */

import { getRedisClient } from './redis.js'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('DailyStatsStore')

// 7 天 TTL（秒）
const DAILY_STATS_TTL = 7 * 24 * 60 * 60

/**
 * 日统计数据结构
 */
export interface DailyStats {
  date: string // YYYY-MM-DD
  totalRequests: number
  successRequests: number
  failedRequests: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  totalCredits: number
  totalCost: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

/**
 * 账号日统计数据结构
 */
export interface DailyAccountStats {
  date: string // YYYY-MM-DD
  accountId: string
  requests: number
  successRequests: number
  failedRequests: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  totalResponseTime: number
  avgResponseTime: number
  totalCost: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

/**
 * 模型日统计数据结构
 */
export interface DailyModelStats {
  date: string // YYYY-MM-DD
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  totalCost: number
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 生成全局日统计 Redis Key
 */
function getGlobalDailyKey(date: string): string {
  return `stats:daily:global:${date}`
}

/**
 * 生成账号日统计 Redis Key
 */
function getAccountDailyKey(accountId: string, date: string): string {
  return `stats:daily:account:${accountId}:${date}`
}

/**
 * 生成模型日统计 Redis Key
 */
function getModelDailyKey(model: string, date: string): string {
  return `stats:daily:model:${model}:${date}`
}

/**
 * 更新全局日统计
 */
export async function updateDailyGlobalStats(
  date: string | Date | number,
  success: boolean,
  inputTokens: number,
  outputTokens: number,
  credits: number = 0,
  cost: number = 0,
  cacheCreationTokens: number = 0,
  cacheReadTokens: number = 0
): Promise<void> {
  const redis = getRedisClient()
  const dateStr = formatDate(date)
  const key = getGlobalDailyKey(dateStr)

  try {
    const pipeline = redis.pipeline()

    pipeline.hincrby(key, 'totalRequests', 1)
    pipeline.hincrby(key, success ? 'successRequests' : 'failedRequests', 1)
    pipeline.hincrby(key, 'inputTokens', inputTokens)
    pipeline.hincrby(key, 'outputTokens', outputTokens)
    pipeline.hincrby(
      key,
      'totalTokens',
      inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens
    )
    pipeline.hincrbyfloat(key, 'totalCredits', credits)
    pipeline.hincrbyfloat(key, 'totalCost', cost)
    pipeline.hincrby(key, 'cacheCreationTokens', cacheCreationTokens)
    pipeline.hincrby(key, 'cacheReadTokens', cacheReadTokens)

    // 设置 TTL
    pipeline.expire(key, DAILY_STATS_TTL)

    await pipeline.exec()
  } catch (error) {
    logger.error('Failed to update daily global stats', {
      date: dateStr,
      error: (error as Error).message
    })
  }
}

/**
 * 获取全局日统计
 */
export async function getDailyGlobalStats(date: string | Date | number): Promise<DailyStats> {
  const redis = getRedisClient()
  const dateStr = formatDate(date)
  const key = getGlobalDailyKey(dateStr)

  try {
    const data = await redis.hgetall(key)

    if (!data || Object.keys(data).length === 0) {
      return {
        date: dateStr,
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        totalCredits: 0,
        totalCost: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0
      }
    }

    return {
      date: dateStr,
      totalRequests: parseInt(data.totalRequests, 10) || 0,
      successRequests: parseInt(data.successRequests, 10) || 0,
      failedRequests: parseInt(data.failedRequests, 10) || 0,
      inputTokens: parseInt(data.inputTokens, 10) || 0,
      outputTokens: parseInt(data.outputTokens, 10) || 0,
      totalTokens: parseInt(data.totalTokens, 10) || 0,
      totalCredits: parseFloat(data.totalCredits) || 0,
      totalCost: parseFloat(data.totalCost) || 0,
      cacheCreationTokens: parseInt(data.cacheCreationTokens, 10) || 0,
      cacheReadTokens: parseInt(data.cacheReadTokens, 10) || 0
    }
  } catch (error) {
    logger.error('Failed to get daily global stats', {
      date: dateStr,
      error: (error as Error).message
    })
    return {
      date: dateStr,
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCredits: 0,
      totalCost: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0
    }
  }
}

/**
 * 获取全局日统计范围
 */
export async function getDailyGlobalStatsRange(
  startDate: string | Date | number,
  endDate: string | Date | number
): Promise<DailyStats[]> {
  const startStr = formatDate(startDate)
  const endStr = formatDate(endDate)

  try {
    // 生成日期范围内的所有日期
    const dates: string[] = []
    const current = new Date(startStr)
    const end = new Date(endStr)

    while (current <= end) {
      dates.push(formatDate(current))
      current.setDate(current.getDate() + 1)
    }

    // 批量获取统计数据
    const results: DailyStats[] = []
    for (const date of dates) {
      const stats = await getDailyGlobalStats(date)
      results.push(stats)
    }

    return results
  } catch (error) {
    logger.error('Failed to get daily global stats range', {
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      error: (error as Error).message
    })
    return []
  }
}

/**
 * 更新账号日统计
 */
export async function updateDailyAccountStats(
  accountId: string,
  date: string | Date | number,
  success: boolean,
  inputTokens: number,
  outputTokens: number,
  responseTime: number,
  cost: number = 0,
  cacheCreationTokens: number = 0,
  cacheReadTokens: number = 0
): Promise<void> {
  const redis = getRedisClient()
  const dateStr = formatDate(date)
  const key = getAccountDailyKey(accountId, dateStr)

  try {
    const pipeline = redis.pipeline()

    pipeline.hincrby(key, 'requests', 1)
    pipeline.hincrby(key, success ? 'successRequests' : 'failedRequests', 1)
    pipeline.hincrby(key, 'inputTokens', inputTokens)
    pipeline.hincrby(key, 'outputTokens', outputTokens)
    pipeline.hincrby(
      key,
      'totalTokens',
      inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens
    )
    pipeline.hincrby(key, 'totalResponseTime', responseTime)
    pipeline.hincrbyfloat(key, 'totalCost', cost)
    pipeline.hincrby(key, 'cacheCreationTokens', cacheCreationTokens)
    pipeline.hincrby(key, 'cacheReadTokens', cacheReadTokens)

    // 设置 TTL
    pipeline.expire(key, DAILY_STATS_TTL)

    await pipeline.exec()
  } catch (error) {
    logger.error('Failed to update daily account stats', {
      accountId,
      date: dateStr,
      error: (error as Error).message
    })
  }
}

/**
 * 获取账号日统计
 */
export async function getDailyAccountStats(
  accountId: string,
  date: string | Date | number
): Promise<DailyAccountStats> {
  const redis = getRedisClient()
  const dateStr = formatDate(date)
  const key = getAccountDailyKey(accountId, dateStr)

  try {
    const data = await redis.hgetall(key)

    if (!data || Object.keys(data).length === 0) {
      return {
        date: dateStr,
        accountId,
        requests: 0,
        successRequests: 0,
        failedRequests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        totalResponseTime: 0,
        avgResponseTime: 0,
        totalCost: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0
      }
    }

    const requests = parseInt(data.requests, 10) || 0
    const totalResponseTime = parseInt(data.totalResponseTime, 10) || 0

    return {
      date: dateStr,
      accountId,
      requests,
      successRequests: parseInt(data.successRequests, 10) || 0,
      failedRequests: parseInt(data.failedRequests, 10) || 0,
      inputTokens: parseInt(data.inputTokens, 10) || 0,
      outputTokens: parseInt(data.outputTokens, 10) || 0,
      totalTokens: parseInt(data.totalTokens, 10) || 0,
      totalResponseTime,
      avgResponseTime: requests > 0 ? totalResponseTime / requests : 0,
      totalCost: parseFloat(data.totalCost) || 0,
      cacheCreationTokens: parseInt(data.cacheCreationTokens, 10) || 0,
      cacheReadTokens: parseInt(data.cacheReadTokens, 10) || 0
    }
  } catch (error) {
    logger.error('Failed to get daily account stats', {
      accountId,
      date: dateStr,
      error: (error as Error).message
    })
    return {
      date: dateStr,
      accountId,
      requests: 0,
      successRequests: 0,
      failedRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalResponseTime: 0,
      avgResponseTime: 0,
      totalCost: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0
    }
  }
}

/**
 * 获取账号日统计范围
 */
export async function getDailyAccountStatsRange(
  accountId: string,
  startDate: string | Date | number,
  endDate: string | Date | number
): Promise<DailyAccountStats[]> {
  const startStr = formatDate(startDate)
  const endStr = formatDate(endDate)

  try {
    // 生成日期范围内的所有日期
    const dates: string[] = []
    const current = new Date(startStr)
    const end = new Date(endStr)

    while (current <= end) {
      dates.push(formatDate(current))
      current.setDate(current.getDate() + 1)
    }

    // 批量获取统计数据
    const results: DailyAccountStats[] = []
    for (const date of dates) {
      const stats = await getDailyAccountStats(accountId, date)
      results.push(stats)
    }

    return results
  } catch (error) {
    logger.error('Failed to get daily account stats range', {
      accountId,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      error: (error as Error).message
    })
    return []
  }
}

/**
 * 更新模型日统计
 */
export async function updateDailyModelStats(
  model: string,
  date: string | Date | number,
  inputTokens: number,
  outputTokens: number,
  cost: number = 0
): Promise<void> {
  const redis = getRedisClient()
  const dateStr = formatDate(date)
  const key = getModelDailyKey(model, dateStr)

  try {
    const pipeline = redis.pipeline()

    pipeline.hincrby(key, 'inputTokens', inputTokens)
    pipeline.hincrby(key, 'outputTokens', outputTokens)
    pipeline.hincrby(key, 'totalTokens', inputTokens + outputTokens)
    pipeline.hincrbyfloat(key, 'totalCost', cost)

    // 设置 TTL
    pipeline.expire(key, DAILY_STATS_TTL)

    await pipeline.exec()
  } catch (error) {
    logger.error('Failed to update daily model stats', {
      model,
      date: dateStr,
      error: (error as Error).message
    })
  }
}

/**
 * 获取模型日统计
 */
export async function getDailyModelStats(
  model: string,
  date: string | Date | number
): Promise<DailyModelStats> {
  const redis = getRedisClient()
  const dateStr = formatDate(date)
  const key = getModelDailyKey(model, dateStr)

  try {
    const data = await redis.hgetall(key)

    if (!data || Object.keys(data).length === 0) {
      return {
        date: dateStr,
        model,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        totalCost: 0
      }
    }

    return {
      date: dateStr,
      model,
      inputTokens: parseInt(data.inputTokens, 10) || 0,
      outputTokens: parseInt(data.outputTokens, 10) || 0,
      totalTokens: parseInt(data.totalTokens, 10) || 0,
      totalCost: parseFloat(data.totalCost) || 0
    }
  } catch (error) {
    logger.error('Failed to get daily model stats', {
      model,
      date: dateStr,
      error: (error as Error).message
    })
    return {
      date: dateStr,
      model,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCost: 0
    }
  }
}

/**
 * 获取模型日统计范围
 */
export async function getDailyModelStatsRange(
  model: string,
  startDate: string | Date | number,
  endDate: string | Date | number
): Promise<DailyModelStats[]> {
  const startStr = formatDate(startDate)
  const endStr = formatDate(endDate)

  try {
    // 生成日期范围内的所有日期
    const dates: string[] = []
    const current = new Date(startStr)
    const end = new Date(endStr)

    while (current <= end) {
      dates.push(formatDate(current))
      current.setDate(current.getDate() + 1)
    }

    // 批量获取统计数据
    const results: DailyModelStats[] = []
    for (const date of dates) {
      const stats = await getDailyModelStats(model, date)
      results.push(stats)
    }

    return results
  } catch (error) {
    logger.error('Failed to get daily model stats range', {
      model,
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      error: (error as Error).message
    })
    return []
  }
}

/**
 * 获取所有模型的日统计范围
 */
export async function getAllDailyModelStatsRange(
  startDate: string | Date | number,
  endDate: string | Date | number
): Promise<DailyModelStats[]> {
  const redis = getRedisClient()
  const startStr = formatDate(startDate)
  const endStr = formatDate(endDate)

  try {
    // 生成日期范围内的所有日期
    const dates: string[] = []
    const current = new Date(startStr)
    const end = new Date(endStr)

    while (current <= end) {
      dates.push(formatDate(current))
      current.setDate(current.getDate() + 1)
    }

    // 获取所有模型日统计 key
    const pattern = 'stats:daily:model:*'
    const keys = await redis.keys(pattern)

    if (keys.length === 0) {
      return []
    }

    // 提取所有模型名称
    const models = new Set<string>()
    for (const key of keys) {
      const match = key.match(/stats:daily:model:(.+):\d{4}-\d{2}-\d{2}$/)
      if (match) {
        models.add(match[1])
      }
    }

    // 批量获取统计数据
    const results: DailyModelStats[] = []
    for (const model of models) {
      for (const date of dates) {
        const stats = await getDailyModelStats(model, date)
        if (stats.totalTokens > 0 || stats.totalCost > 0) {
          results.push(stats)
        }
      }
    }

    return results
  } catch (error) {
    logger.error('Failed to get all daily model stats range', {
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      error: (error as Error).message
    })
    return []
  }
}

/**
 * 删除指定日期的所有日统计
 */
export async function deleteDailyStats(date: string | Date | number): Promise<void> {
  const redis = getRedisClient()
  const dateStr = formatDate(date)

  try {
    // 删除全局日统计
    const globalKey = getGlobalDailyKey(dateStr)
    await redis.del(globalKey)

    // 删除所有账号日统计
    const accountPattern = `stats:daily:account:*:${dateStr}`
    const accountKeys = await redis.keys(accountPattern)
    if (accountKeys.length > 0) {
      await redis.del(...accountKeys)
    }

    // 删除所有模型日统计
    const modelPattern = `stats:daily:model:*:${dateStr}`
    const modelKeys = await redis.keys(modelPattern)
    if (modelKeys.length > 0) {
      await redis.del(...modelKeys)
    }

    logger.info('Daily stats deleted', { date: dateStr })
  } catch (error) {
    logger.error('Failed to delete daily stats', {
      date: dateStr,
      error: (error as Error).message
    })
    throw error
  }
}

/**
 * 清空所有日统计
 */
export async function clearAllDailyStats(): Promise<void> {
  const redis = getRedisClient()

  try {
    // 删除所有全局日统计
    const globalKeys = await redis.keys('stats:daily:global:*')
    if (globalKeys.length > 0) {
      await redis.del(...globalKeys)
    }

    // 删除所有账号日统计
    const accountKeys = await redis.keys('stats:daily:account:*')
    if (accountKeys.length > 0) {
      await redis.del(...accountKeys)
    }

    // 删除所有模型日统计
    const modelKeys = await redis.keys('stats:daily:model:*')
    if (modelKeys.length > 0) {
      await redis.del(...modelKeys)
    }

    logger.info('All daily stats cleared')
  } catch (error) {
    logger.error('Failed to clear all daily stats', {
      error: (error as Error).message
    })
    throw error
  }
}
