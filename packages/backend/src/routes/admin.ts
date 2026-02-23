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
import { getClaudePrices, updatePriceFromRemote, findModelPrice } from '../core/pricing.js'
import { sendTestNotification } from '../core/webhook.js'

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
 * 返回包含绑定账号信息的完整列表
 */
router.get('/apikeys', async (_req: Request, res: Response) => {
  try {
    const keys = await configStore.getAllApiKeys()
    // 返回完整 key、预览和绑定账号
    const safeKeys = keys.map(k => ({
      id: k.id,
      name: k.name,
      key: k.key,  // 完整 key，用于复制
      keyPreview: k.key.substring(0, 8) + '...',  // 预览，用于显示
      boundAccountIds: k.boundAccountIds || [],
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
 * Body: { name: string, boundAccountIds?: string[] }
 */
router.post('/apikeys', async (req: Request, res: Response) => {
  try {
    const { name, boundAccountIds } = req.body
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
      boundAccountIds: Array.isArray(boundAccountIds) ? boundAccountIds : undefined,
      createdAt: Date.now()
    })

    // 返回完整 key（仅在创建时显示一次）
    res.status(201).json({
      success: true,
      data: { id, key, name, boundAccountIds: boundAccountIds || [] }
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
 * 更新 API Key（名称、绑定账号）
 * PUT /api/admin/apikeys/:id
 * Body: { name?: string, boundAccountIds?: string[] }
 */
router.put('/apikeys/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string
    const { name, boundAccountIds } = req.body

    const updates: Partial<Pick<configStore.ApiKeyRecord, 'name' | 'boundAccountIds'>> = {}
    if (name !== undefined) updates.name = name
    if (boundAccountIds !== undefined) {
      updates.boundAccountIds = Array.isArray(boundAccountIds) ? boundAccountIds : []
    }

    const record = await configStore.updateApiKey(id, updates)
    if (!record) {
      res.status(404).json({
        success: false,
        error: { message: 'API key not found' }
      } as ApiResponse)
      return
    }

    res.json({
      success: true,
      data: {
        id: record.id,
        name: record.name,
        boundAccountIds: record.boundAccountIds || []
      }
    } as ApiResponse)
  } catch (error) {
    logger.error('Failed to update API key', { error: (error as Error).message })
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


/**
 * 获取价格表（Claude 模型）
 * GET /api/admin/prices
 */
router.get('/prices', async (req: Request, res: Response) => {
  try {
    const model = req.query.model as string | undefined
    if (model) {
      const price = findModelPrice(model)
      res.json({ success: true, data: price } as ApiResponse)
    } else {
      const prices = getClaudePrices()
      res.json({ success: true, data: prices } as ApiResponse)
    }
  } catch (error) {
    logger.error('Failed to get prices', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 从远程更新价格表
 * POST /api/admin/prices/update
 */
router.post('/prices/update', async (req: Request, res: Response) => {
  try {
    const { url } = req.body || {}
    const result = await updatePriceFromRemote(url)

    if (result.success) {
      res.json({
        success: true,
        data: { modelCount: result.modelCount, message: 'Price config updated successfully' }
      } as ApiResponse)
    } else {
      res.status(500).json({
        success: false,
        error: { message: result.error || 'Failed to update prices' }
      } as ApiResponse)
    }
  } catch (error) {
    logger.error('Failed to update prices', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 测试 Webhook
 * POST /api/admin/webhook/test
 */
router.post('/webhook/test', async (_req: Request, res: Response) => {
  try {
    const results = await sendTestNotification()
    res.json({ success: true, data: results } as ApiResponse)
  } catch (error) {
    logger.error('Failed to send test webhook', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取 Webhook 配置
 * GET /api/admin/webhook/config
 */
router.get('/webhook/config', async (_req: Request, res: Response) => {
  try {
    const config = await configStore.getWebhookConfig()
    res.json({ success: true, data: config } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get webhook config', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 更新 Webhook 配置
 * PUT /api/admin/webhook/config
 */
router.put('/webhook/config', async (req: Request, res: Response) => {
  try {
    const config = await configStore.updateWebhookConfig(req.body)
    res.json({ success: true, data: config } as ApiResponse)
  } catch (error) {
    logger.error('Failed to update webhook config', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

export default router
