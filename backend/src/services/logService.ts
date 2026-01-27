/**
 * 日志服务
 * 提供日志的查询和管理
 */

import * as logStore from '../storage/logStore.js'
import { createLogger } from '../utils/logger.js'
import type { RequestLog, SystemLog } from '../core/types.js'

const logger = createLogger('LogService')

/**
 * 获取请求日志
 */
export async function getRequestLogs(
  limit: number = 100,
  startTime?: number,
  endTime?: number
): Promise<RequestLog[]> {
  return logStore.getRequestLogs(limit, startTime, endTime)
}

/**
 * 获取系统日志
 */
export async function getSystemLogs(
  limit: number = 100,
  level?: SystemLog['level'],
  category?: string
): Promise<SystemLog[]> {
  return logStore.getSystemLogs(limit, level, category)
}

/**
 * 添加系统日志
 */
export async function addSystemLog(
  level: SystemLog['level'],
  category: string,
  message: string,
  data?: Record<string, unknown>
): Promise<void> {
  await logStore.addSystemLog({
    timestamp: Date.now(),
    level,
    category,
    message,
    data
  })
}

/**
 * 清空请求日志
 */
export async function clearRequestLogs(): Promise<void> {
  await logStore.clearRequestLogs()
  logger.info('Request logs cleared')
}

/**
 * 清空系统日志
 */
export async function clearSystemLogs(): Promise<void> {
  await logStore.clearSystemLogs()
  logger.info('System logs cleared')
}

/**
 * 获取日志统计
 */
export async function getLogStats(): Promise<{
  requestLogs: number
  systemLogs: number
}> {
  const [requestLogs, systemLogs] = await Promise.all([
    logStore.getRequestLogCount(),
    logStore.getSystemLogCount()
  ])

  return { requestLogs, systemLogs }
}

/**
 * 获取最近的错误日志
 */
export async function getRecentErrors(limit: number = 50): Promise<SystemLog[]> {
  return logStore.getSystemLogs(limit, 'error')
}

/**
 * 获取请求日志摘要
 */
export async function getRequestLogSummary(hours: number = 24): Promise<{
  total: number
  success: number
  failed: number
  avgResponseTime: number
}> {
  const startTime = Date.now() - hours * 60 * 60 * 1000
  const logs = await logStore.getRequestLogs(10000, startTime)

  const total = logs.length
  const success = logs.filter(l => l.success).length
  const failed = total - success
  const avgResponseTime = total > 0
    ? logs.reduce((sum, l) => sum + l.responseTime, 0) / total
    : 0

  return { total, success, failed, avgResponseTime }
}
