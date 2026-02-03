/**
 * 日志存储模块
 * 使用 Redis Stream 存储请求日志和系统日志
 */

import { getRedisClient } from './redis.js'
import { createLogger } from '../utils/logger.js'
import type { RequestLog, SystemLog } from '../core/types.js'
import { v4 as uuidv4 } from 'uuid'

const logger = createLogger('LogStore')

// Redis Key
const REQUEST_LOGS_STREAM = 'logs:requests'
const SYSTEM_LOGS_STREAM = 'logs:system'

// 日志保留数量
const MAX_REQUEST_LOGS = 100000
const MAX_SYSTEM_LOGS = 50000

/**
 * 添加请求日志
 */
export async function addRequestLog(log: Omit<RequestLog, 'id'>): Promise<string> {
  const redis = getRedisClient()

  try {
    const id = uuidv4()
    const entry: Record<string, string> = {
      id,
      timestamp: String(log.timestamp),
      path: log.path,
      model: log.model,
      accountId: log.accountId,
      inputTokens: String(log.inputTokens),
      outputTokens: String(log.outputTokens),
      responseTime: String(log.responseTime),
      success: log.success ? 'true' : 'false'
    }

    if (log.machineId) {
      entry.machineId = log.machineId
    }
    if (log.credits !== undefined) {
      entry.credits = String(log.credits)
    }
    if (log.error) {
      entry.error = log.error
    }
    if (log.cacheCreationTokens !== undefined) {
      entry.cacheCreationTokens = String(log.cacheCreationTokens)
    }
    if (log.cacheReadTokens !== undefined) {
      entry.cacheReadTokens = String(log.cacheReadTokens)
    }
    if (log.cost !== undefined) {
      entry.cost = String(log.cost)
    }

    // 将对象展开为键值对数组
    const args: string[] = []
    for (const [key, value] of Object.entries(entry)) {
      args.push(key, value)
    }

    await redis.xadd(REQUEST_LOGS_STREAM, '*', ...args)

    // 限制日志数量
    await redis.xtrim(REQUEST_LOGS_STREAM, 'MAXLEN', '~', MAX_REQUEST_LOGS)

    return id
  } catch (error) {
    logger.error('Failed to add request log', { error: (error as Error).message })
    throw error
  }
}

/**
 * 获取请求日志
 */
export async function getRequestLogs(
  limit: number = 100,
  startTime?: number,
  endTime?: number
): Promise<RequestLog[]> {
  const redis = getRedisClient()

  try {
    // 使用 XREVRANGE 获取最新的日志
    const start = endTime ? String(endTime) : '+'
    const end = startTime ? String(startTime) : '-'

    const entries = await redis.xrevrange(REQUEST_LOGS_STREAM, start, end, 'COUNT', limit)

    return entries.map(([, fields]) => {
      const data: Record<string, string> = {}
      for (let i = 0; i < fields.length; i += 2) {
        data[fields[i]] = fields[i + 1]
      }

      return {
        id: data.id,
        timestamp: parseInt(data.timestamp, 10),
        path: data.path,
        model: data.model,
        accountId: data.accountId,
        machineId: data.machineId,
        inputTokens: parseInt(data.inputTokens, 10),
        outputTokens: parseInt(data.outputTokens, 10),
        credits: data.credits ? parseFloat(data.credits) : undefined,
        cacheCreationTokens: data.cacheCreationTokens ? parseInt(data.cacheCreationTokens, 10) : undefined,
        cacheReadTokens: data.cacheReadTokens ? parseInt(data.cacheReadTokens, 10) : undefined,
        cost: data.cost ? parseFloat(data.cost) : undefined,
        responseTime: parseInt(data.responseTime, 10),
        success: data.success === 'true',
        error: data.error
      }
    })
  } catch (error) {
    logger.error('Failed to get request logs', { error: (error as Error).message })
    return []
  }
}

/**
 * 添加系统日志
 */
export async function addSystemLog(log: Omit<SystemLog, 'id'>): Promise<string> {
  const redis = getRedisClient()

  try {
    const id = uuidv4()
    const entry: Record<string, string> = {
      id,
      timestamp: String(log.timestamp),
      level: log.level,
      category: log.category,
      message: log.message
    }

    if (log.data) {
      entry.data = JSON.stringify(log.data)
    }

    // 将对象展开为键值对数组
    const args: string[] = []
    for (const [key, value] of Object.entries(entry)) {
      args.push(key, value)
    }

    await redis.xadd(SYSTEM_LOGS_STREAM, '*', ...args)

    // 限制日志数量
    await redis.xtrim(SYSTEM_LOGS_STREAM, 'MAXLEN', '~', MAX_SYSTEM_LOGS)

    return id
  } catch (error) {
    logger.error('Failed to add system log', { error: (error as Error).message })
    throw error
  }
}

/**
 * 获取系统日志
 */
export async function getSystemLogs(
  limit: number = 100,
  level?: SystemLog['level'],
  category?: string
): Promise<SystemLog[]> {
  const redis = getRedisClient()

  try {
    const entries = await redis.xrevrange(SYSTEM_LOGS_STREAM, '+', '-', 'COUNT', limit * 2)

    const logs: SystemLog[] = []

    for (const [, fields] of entries) {
      if (logs.length >= limit) break

      const data: Record<string, string> = {}
      for (let i = 0; i < fields.length; i += 2) {
        data[fields[i]] = fields[i + 1]
      }

      // 过滤
      if (level && data.level !== level) continue
      if (category && data.category !== category) continue

      logs.push({
        id: data.id,
        timestamp: parseInt(data.timestamp, 10),
        level: data.level as SystemLog['level'],
        category: data.category,
        message: data.message,
        data: data.data ? JSON.parse(data.data) : undefined
      })
    }

    return logs
  } catch (error) {
    logger.error('Failed to get system logs', { error: (error as Error).message })
    return []
  }
}

/**
 * 清空请求日志
 */
export async function clearRequestLogs(): Promise<void> {
  const redis = getRedisClient()

  try {
    await redis.del(REQUEST_LOGS_STREAM)
    logger.info('Request logs cleared')
  } catch (error) {
    logger.error('Failed to clear request logs', { error: (error as Error).message })
    throw error
  }
}

/**
 * 清空系统日志
 */
export async function clearSystemLogs(): Promise<void> {
  const redis = getRedisClient()

  try {
    await redis.del(SYSTEM_LOGS_STREAM)
    logger.info('System logs cleared')
  } catch (error) {
    logger.error('Failed to clear system logs', { error: (error as Error).message })
    throw error
  }
}

/**
 * 获取请求日志数量
 */
export async function getRequestLogCount(): Promise<number> {
  const redis = getRedisClient()

  try {
    return await redis.xlen(REQUEST_LOGS_STREAM)
  } catch (error) {
    logger.error('Failed to get request log count', { error: (error as Error).message })
    return 0
  }
}

/**
 * 获取系统日志数量
 */
export async function getSystemLogCount(): Promise<number> {
  const redis = getRedisClient()

  try {
    return await redis.xlen(SYSTEM_LOGS_STREAM)
  } catch (error) {
    logger.error('Failed to get system log count', { error: (error as Error).message })
    return 0
  }
}
