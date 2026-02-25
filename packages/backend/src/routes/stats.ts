/**
 * 统计路由
 * 提供统计数据查询接口
 */

import { Router, Request, Response } from 'express'
import type { Router as IRouter } from 'express'
import { createLogger } from '../utils/logger.js'
import * as statsService from '../services/statsService.js'
import { getConcurrencyStatus } from './proxy.js'
import { getSessionStats } from '../core/sessionCache.js'
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
 * 获取并发状态（每账号实时连接数 + 队列状态）
 * GET /api/stats/concurrency
 */
router.get('/concurrency', (_req: Request, res: Response) => {
  try {
    const status = getConcurrencyStatus()
    res.json({ success: true, data: status } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get concurrency status', { error: (error as Error).message })
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

/**
 * 获取缓存统计
 * GET /api/stats/cache
 */
router.get('/cache', async (_req: Request, res: Response) => {
  try {
    const stats = await statsService.getCacheStats()
    res.json({ success: true, data: stats } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get cache stats', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取今日全局费用
 * GET /api/stats/today/cost
 */
router.get('/today/cost', async (_req: Request, res: Response) => {
  try {
    const cost = await statsService.getTodayGlobalCost()
    res.json({ success: true, data: { cost } } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get today global cost', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取全局日费用范围
 * GET /api/stats/daily/global?startDate=2024-01-01&endDate=2024-01-31
 */
router.get('/daily/global', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: { message: 'startDate and endDate are required' }
      } as ApiResponse)
    }

    const startStr = (Array.isArray(startDate) ? startDate[0] : startDate) as any as string
    const endStr = (Array.isArray(endDate) ? endDate[0] : endDate) as any as string
    const costs = await statsService.getGlobalDailyCosts(startStr, endStr)
    return res.json({ success: true, data: costs } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get global daily costs', { error: (error as Error).message })
    return res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取账号日费用范围
 * GET /api/stats/daily/accounts/:id?startDate=2024-01-01&endDate=2024-01-31
 */
router.get('/daily/accounts/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { startDate, endDate } = req.query

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: { message: 'startDate and endDate are required' }
      } as ApiResponse)
    }

    const startStr = (Array.isArray(startDate) ? startDate[0] : startDate) as any as string
    const endStr = (Array.isArray(endDate) ? endDate[0] : endDate) as any as string
    const costs = await statsService.getAccountDailyCosts(id as any as string, startStr, endStr)
    return res.json({ success: true, data: costs } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get account daily costs', { error: (error as Error).message })
    return res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取 API Key 日费用范围
 * GET /api/stats/daily/apikeys/:id?startDate=2024-01-01&endDate=2024-01-31
 */
router.get('/daily/apikeys/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { startDate, endDate } = req.query

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: { message: 'startDate and endDate are required' }
      } as ApiResponse)
    }

    const startStr = (Array.isArray(startDate) ? startDate[0] : startDate) as any as string
    const endStr = (Array.isArray(endDate) ? endDate[0] : endDate) as any as string
    const costs = await statsService.getApiKeyDailyCosts(id as any as string, startStr, endStr)
    return res.json({ success: true, data: costs } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get API Key daily costs', { error: (error as Error).message })
    return res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取模型日费用范围
 * GET /api/stats/daily/models?startDate=2024-01-01&endDate=2024-01-31
 */
router.get('/daily/models', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: { message: 'startDate and endDate are required' }
      } as ApiResponse)
    }

    const startStr = (Array.isArray(startDate) ? startDate[0] : startDate) as any as string
    const endStr = (Array.isArray(endDate) ? endDate[0] : endDate) as any as string
    const costs = await statsService.getModelDailyCosts(startStr, endStr)
    return res.json({ success: true, data: costs } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get model daily costs', { error: (error as Error).message })
    return res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取所有 API Key 今日费用
 * GET /api/stats/today/apikeys
 */
router.get('/today/apikeys', async (_req: Request, res: Response) => {
  try {
    const costs = await statsService.getAllApiKeysTodayCost()
    res.json({ success: true, data: costs } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get all API Keys today cost', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取所有账号今日费用
 * GET /api/stats/today/accounts
 */
router.get('/today/accounts', async (_req: Request, res: Response) => {
  try {
    const costs = await statsService.getAllAccountsTodayCost()
    res.json({ success: true, data: costs } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get all accounts today cost', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取账号费用排行榜
 * GET /api/stats/top/accounts?limit=10&days=7
 */
router.get('/top/accounts', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10
    const days = parseInt(req.query.days as string) || 7

    const topAccounts = await statsService.getTopAccountsByCost(limit, days)
    res.json({ success: true, data: topAccounts } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get top accounts by cost', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取 API Key 费用排行榜
 * GET /api/stats/top/apikeys?limit=10&days=7
 */
router.get('/top/apikeys', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10
    const days = parseInt(req.query.days as string) || 7

    const topApiKeys = await statsService.getTopApiKeysByCost(limit, days)
    res.json({ success: true, data: topApiKeys } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get top API Keys by cost', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取 Session 粘性统计
 * GET /api/stats/sessions
 */
router.get('/sessions', async (_req: Request, res: Response) => {
  try {
    const stats = await getSessionStats()
    res.json({ success: true, data: stats } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get session stats', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

export default router
