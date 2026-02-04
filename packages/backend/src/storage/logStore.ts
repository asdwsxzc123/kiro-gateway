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
 * 获取请求日志（支持分页和过滤）
 * @param limit 每页数量
 * @param offset 偏移量
 * @param startTime 开始时间
 * @param endTime 结束时间
 * @param model 模型名称过滤
 * @returns 日志列表和总数
 */
export async function getRequestLogs(
  limit: number = 100,
  offset: number = 0,
  startTime?: number,
  endTime?: number,
  model?: string
): Promise<{ data: RequestLog[]; total: number }> {
  const redis = getRedisClient()

  try {
    // 使用 XREVRANGE 获取日志
    const start = endTime ? String(endTime) : '+'
    const end = startTime ? String(startTime) : '-'

    // 如果有 model 过滤，需要获取更多数据进行过滤
    const fetchCount = model ? (offset + limit) * 10 : offset + limit
    const entries = await redis.xrevrange(REQUEST_LOGS_STREAM, start, end, 'COUNT', fetchCount)

    // 解析所有日志
    const allLogs: RequestLog[] = entries.map(([, fields]) => {
      const record: Record<string, string> = {}
      for (let i = 0; i < fields.length; i += 2) {
        record[fields[i]] = fields[i + 1]
      }

      return {
        id: record.id,
        timestamp: parseInt(record.timestamp, 10),
        path: record.path,
        model: record.model,
        accountId: record.accountId,
        machineId: record.machineId,
        inputTokens: parseInt(record.inputTokens, 10),
        outputTokens: parseInt(record.outputTokens, 10),
        credits: record.credits ? parseFloat(record.credits) : undefined,
        cacheCreationTokens: record.cacheCreationTokens ? parseInt(record.cacheCreationTokens, 10) : undefined,
        cacheReadTokens: record.cacheReadTokens ? parseInt(record.cacheReadTokens, 10) : undefined,
        cost: record.cost ? parseFloat(record.cost) : undefined,
        responseTime: parseInt(record.responseTime, 10),
        success: record.success === 'true',
        error: record.error
      }
    })

    // 应用 model 过滤
    const filteredLogs = model
      ? allLogs.filter(log => log.model === model)
      : allLogs

    // 计算过滤后的总数
    const total = model
      ? filteredLogs.length
      : await redis.xlen(REQUEST_LOGS_STREAM)

    // 分页
    const data = filteredLogs.slice(offset, offset + limit)

    return { data, total }
  } catch (error) {
    logger.error('Failed to get request logs', { error: (error as Error).message })
    return { data: [], total: 0 }
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
