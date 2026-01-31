/**
 * 统计路由
 * 提供统计数据查询接口
 */

import { Router, Request, Response } from 'express'
import type { Router as IRouter } from 'express'
import { createLogger } from '../utils/logger.js'
import * as statsService from '../services/statsService.js'
import type { ApiResponse } from '../core/types.js'

const logger = createLogger('StatsRoute')
const router: IRouter = Router()

/**
 * 获取统计概览
 * GET /api/stats
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const overview = await statsService.getStatsOverview()
    res.json({ success: true, data: overview } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get stats overview', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取全局统计
 * GET /api/stats/global
 */
router.get('/global', async (_req: Request, res: Response) => {
  try {
    const stats = await statsService.getGlobalStats()
    res.json({ success: true, data: stats } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get global stats', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取所有账号统计
 * GET /api/stats/accounts
 */
router.get('/accounts', async (_req: Request, res: Response) => {
  try {
    const stats = await statsService.getAllAccountStats()
    res.json({ success: true, data: stats } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get account stats', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取指定账号统计
 * GET /api/stats/accounts/:id
 */
router.get('/accounts/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string
    const stats = await statsService.getAccountStats(id)
    res.json({ success: true, data: stats } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get account stats', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取所有模型统计
 * GET /api/stats/models
 */
router.get('/models', async (_req: Request, res: Response) => {
  try {
    const stats = await statsService.getAllModelStats()
    res.json({ success: true, data: stats } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get model stats', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取详细统计报告
 * GET /api/stats/report
 */
router.get('/report', async (_req: Request, res: Response) => {
  try {
    const report = await statsService.getDetailedReport()
    res.json({ success: true, data: report } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get stats report', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 重置所有统计
 * POST /api/stats/reset
 */
router.post('/reset', async (_req: Request, res: Response) => {
  try {
    await statsService.resetAllStats()
    res.json({ success: true } as ApiResponse)
  } catch (error) {
    logger.error('Failed to reset stats', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

export default router
