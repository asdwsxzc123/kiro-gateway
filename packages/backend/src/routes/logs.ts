/**
 * 日志路由
 * 提供日志查询和管理接口
 */

import { Router, Request, Response } from 'express'
import type { Router as IRouter } from 'express'
import { createLogger } from '../utils/logger.js'
import * as logService from '../services/logService.js'
import type { ApiResponse, SystemLog } from '../core/types.js'

const logger = createLogger('LogsRoute')
const router: IRouter = Router()

/**
 * 获取请求日志（支持分页和过滤）
 * GET /api/logs/requests
 * @query limit - 每页数量，默认 20
 * @query offset - 偏移量，默认 0
 * @query startTime - 开始时间戳
 * @query endTime - 结束时间戳
 * @query model - 模型名称过滤
 */
router.get('/requests', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 20
    const offset = parseInt(req.query.offset as string, 10) || 0
    const startTime = req.query.startTime ? parseInt(req.query.startTime as string, 10) : undefined
    const endTime = req.query.endTime ? parseInt(req.query.endTime as string, 10) : undefined
    const model = req.query.model as string | undefined

    const result = await logService.getRequestLogs(limit, offset, startTime, endTime, model)

    // 返回分页格式的响应
    res.json({
      success: true,
      data: {
        data: result.data,
        total: result.total,
        limit,
        offset
      }
    } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get request logs', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取系统日志
 * GET /api/logs/system
 */
router.get('/system', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 100
    const level = req.query.level as SystemLog['level'] | undefined
    const category = req.query.category as string | undefined

    const logs = await logService.getSystemLogs(limit, level, category)
    res.json({ success: true, data: logs } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get system logs', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取日志统计
 * GET /api/logs/stats
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await logService.getLogStats()
    res.json({ success: true, data: stats } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get log stats', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取最近错误
 * GET /api/logs/errors
 */
router.get('/errors', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50
    const errors = await logService.getRecentErrors(limit)
    res.json({ success: true, data: errors } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get recent errors', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取请求日志摘要
 * GET /api/logs/summary
 */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const hours = parseInt(req.query.hours as string, 10) || 24
    const summary = await logService.getRequestLogSummary(hours)
    res.json({ success: true, data: summary } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get log summary', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 清空请求日志
 * DELETE /api/logs/requests
 */
router.delete('/requests', async (_req: Request, res: Response) => {
  try {
    await logService.clearRequestLogs()
    res.json({ success: true } as ApiResponse)
  } catch (error) {
    logger.error('Failed to clear request logs', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 清空系统日志
 * DELETE /api/logs/system
 */
router.delete('/system', async (_req: Request, res: Response) => {
  try {
    await logService.clearSystemLogs()
    res.json({ success: true } as ApiResponse)
  } catch (error) {
    logger.error('Failed to clear system logs', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取日志文件列表
 * GET /api/logs/files
 */
router.get('/files', async (_req: Request, res: Response) => {
  try {
    const files = await logService.getLogFiles()
    res.json({ success: true, data: files } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get log files', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 下载日志文件
 * GET /api/logs/files/download?type=requests&filename=requests-2026-02-23.log
 */
router.get('/files/download', async (req: Request, res: Response) => {
  try {
    const type = req.query.type as string
    const filename = req.query.filename as string

    if (!type || !filename) {
      res.status(400).json({
        success: false,
        error: { message: 'Missing type or filename parameter' }
      } as ApiResponse)
      return
    }

    const filePath = await logService.getLogFilePath(type, filename)
    if (!filePath) {
      res.status(404).json({
        success: false,
        error: { message: 'File not found or invalid filename' }
      } as ApiResponse)
      return
    }

    res.download(filePath, filename)
  } catch (error) {
    logger.error('Failed to download log file', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

export default router
