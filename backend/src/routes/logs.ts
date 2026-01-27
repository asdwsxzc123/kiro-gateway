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
 * 获取请求日志
 * GET /api/logs/requests
 */
router.get('/requests', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 100
    const startTime = req.query.startTime ? parseInt(req.query.startTime as string, 10) : undefined
    const endTime = req.query.endTime ? parseInt(req.query.endTime as string, 10) : undefined

    const logs = await logService.getRequestLogs(limit, startTime, endTime)
    res.json({ success: true, data: logs } as ApiResponse)
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

export default router
