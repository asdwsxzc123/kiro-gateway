/**
 * 日志服务
 * 提供日志的查询和管理
 */

import * as logStore from '../storage/logStore.js'
import { createLogger } from '../utils/logger.js'
import type { RequestLog, SystemLog } from '../core/types.js'
import fs from 'fs/promises'
import path from 'path'
import { getConfig } from '../config/index.js'

const logger = createLogger('LogService')

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
  return logStore.getRequestLogs(limit, offset, startTime, endTime, model)
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
  const result = await logStore.getRequestLogs(10000, 0, startTime)
  const logs = result.data

  const total = logs.length
  const success = logs.filter(l => l.success).length
  const failed = total - success
  const avgResponseTime = total > 0
    ? logs.reduce((sum, l) => sum + l.responseTime, 0) / total
    : 0

  return { total, success, failed, avgResponseTime }
}

/**
 * 获取所有日志文件列表
 */
export async function getLogFiles(): Promise<Array<{
  filename: string
  type: 'requests' | 'system'
  size: number
  date: string
}>> {
  const logDir = getConfig().log.dir
  const files: Array<{ filename: string; type: 'requests' | 'system'; size: number; date: string }> = []

  for (const type of ['requests', 'system'] as const) {
    const dir = path.join(logDir, type)
    try {
      await fs.access(dir)
    } catch {
      continue
    }

    const entries = await fs.readdir(dir)
    for (const entry of entries) {
      if (!entry.endsWith('.log')) continue
      const filePath = path.join(dir, entry)
      const stat = await fs.stat(filePath)
      // 从文件名提取日期，如 requests-2026-02-23.log → 2026-02-23
      const dateMatch = entry.match(/\d{4}-\d{2}-\d{2}/)
      files.push({
        filename: entry,
        type,
        size: stat.size,
        date: dateMatch ? dateMatch[0] : ''
      })
    }
  }

  // 按日期降序排列
  files.sort((a, b) => b.date.localeCompare(a.date))
  return files
}

/**
 * 获取日志文件的绝对路径（含安全校验）
 */
export async function getLogFilePath(type: string, filename: string): Promise<string | null> {
  // 安全校验：只允许合法文件名
  const validFilename = /^(requests|system)-\d{4}-\d{2}-\d{2}\.log$/
  if (!validFilename.test(filename)) return null
  if (type !== 'requests' && type !== 'system') return null
  if (filename.includes('..') || filename.includes('/')) return null

  const logDir = getConfig().log.dir
  const filePath = path.join(logDir, type, filename)

  try {
    await fs.access(filePath)
    return filePath
  } catch {
    return null
  }
}
