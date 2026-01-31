/**
 * 管理路由
 * 提供配置管理和 API Key 管理接口
 */

import { Router, Request, Response } from 'express'
import type { Router as IRouter } from 'express'
import { createLogger } from '../utils/logger.js'
import * as configStore from '../storage/configStore.js'
import { checkRedisHealth } from '../storage/redis.js'
import { v4 as uuidv4 } from 'uuid'
import type { ApiResponse } from '../core/types.js'

const logger = createLogger('AdminRoute')
const router: IRouter = Router()

/**
 * 获取网关配置
 * GET /api/admin/config
 */
router.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = await configStore.getGatewayConfig()
    res.json({ success: true, data: config } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get config', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 更新网关配置
 * PUT /api/admin/config
 */
router.put('/config', async (req: Request, res: Response) => {
  try {
    const updates = req.body
    const config = await configStore.updateGatewayConfig(updates)
    res.json({ success: true, data: config } as ApiResponse)
  } catch (error) {
    logger.error('Failed to update config', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取选中的账号
 * GET /api/admin/selected-accounts
 */
router.get('/selected-accounts', async (_req: Request, res: Response) => {
  try {
    const accounts = await configStore.getSelectedAccounts()
    res.json({ success: true, data: accounts } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get selected accounts', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 设置选中的账号
 * PUT /api/admin/selected-accounts
 */
router.put('/selected-accounts', async (req: Request, res: Response) => {
  try {
    const { accountIds } = req.body
    if (!Array.isArray(accountIds)) {
      res.status(400).json({
        success: false,
        error: { message: 'accountIds must be an array' }
      } as ApiResponse)
      return
    }
    await configStore.setSelectedAccounts(accountIds)
    res.json({ success: true } as ApiResponse)
  } catch (error) {
    logger.error('Failed to set selected accounts', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取所有 API Key
 * GET /api/admin/apikeys
 */
router.get('/apikeys', async (_req: Request, res: Response) => {
  try {
    const keys = await configStore.getAllApiKeys()
    // 返回完整 key 和预览
    const safeKeys = keys.map(k => ({
      id: k.id,
      name: k.name,
      key: k.key,  // 完整 key，用于复制
      keyPreview: k.key.substring(0, 8) + '...',  // 预览，用于显示
      createdAt: k.createdAt,
      lastUsed: k.lastUsed
    }))
    res.json({ success: true, data: safeKeys } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get API keys', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 创建 API Key
 * POST /api/admin/apikeys
 */
router.post('/apikeys', async (req: Request, res: Response) => {
  try {
    const { name } = req.body
    if (!name) {
      res.status(400).json({
        success: false,
        error: { message: 'name is required' }
      } as ApiResponse)
      return
    }

    const id = uuidv4()
    const key = `sk-${uuidv4().replace(/-/g, '')}`

    await configStore.addApiKey({
      id,
      key,
      name,
      createdAt: Date.now()
    })

    // 返回完整 key（仅在创建时显示一次）
    res.status(201).json({
      success: true,
      data: { id, key, name }
    } as ApiResponse)
  } catch (error) {
    logger.error('Failed to create API key', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 删除 API Key
 * DELETE /api/admin/apikeys/:id
 */
router.delete('/apikeys/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string
    const result = await configStore.deleteApiKey(id)
    if (!result) {
      res.status(404).json({
        success: false,
        error: { message: 'API key not found' }
      } as ApiResponse)
      return
    }
    res.json({ success: true } as ApiResponse)
  } catch (error) {
    logger.error('Failed to delete API key', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 健康检查
 * GET /api/admin/health
 */
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const redisHealthy = await checkRedisHealth()

    res.json({
      success: true,
      data: {
        status: redisHealthy ? 'healthy' : 'degraded',
        redis: redisHealthy ? 'connected' : 'disconnected',
        timestamp: Date.now()
      }
    } as ApiResponse)
  } catch (error) {
    res.status(500).json({
      success: false,
      data: {
        status: 'unhealthy',
        error: (error as Error).message
      }
    } as ApiResponse)
  }
})

export default router
