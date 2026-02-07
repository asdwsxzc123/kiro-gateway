/**
 * 账号管理路由
 * 提供账号的增删改查、Token 刷新、连通性测试等接口
 */

import { Router, Request, Response } from 'express'
import type { Router as IRouter } from 'express'
import { createLogger } from '../utils/logger.js'
import * as accountService from '../services/accountService.js'
import { refreshProxyServerAccounts } from './proxy.js'
import type { AddAccountRequest, UpdateAccountRequest, ApiResponse } from '../core/types.js'

const logger = createLogger('AccountsRoute')
const router: IRouter = Router()

/**
 * 批量获取所有账号使用量
 * GET /api/accounts/usage/all
 * 注意：此路由必须放在 /:id 路由之前，否则 "usage" 会被当作 id 参数
 */
router.get('/usage/all', async (_req: Request, res: Response) => {
  try {
    const usages = await accountService.getAllAccountsUsage()

    res.json({
      success: true,
      data: usages
    } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get all accounts usage', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取所有账号
 * GET /api/accounts
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const accounts = await accountService.getAllAccounts()

    // 隐藏敏感信息
    const safeAccounts = accounts.map(acc => ({
      id: acc.id,
      email: acc.email,
      userId: acc.userId,
      authMethod: acc.authMethod,
      provider: acc.provider,
      region: acc.region,
      machineId: acc.machineId,
      machineIdCreatedAt: acc.machineIdCreatedAt,
      isAvailable: acc.isAvailable,
      errorCount: acc.errorCount,
      requestCount: acc.requestCount,
      lastUsed: acc.lastUsed,
      expiresAt: acc.expiresAt,
      createdAt: acc.createdAt
    }))

    res.json({ success: true, data: safeAccounts } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get accounts', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取账号详情
 * GET /api/accounts/:id
 * 注意：返回包含敏感字段（Token、Secret）的完整账号信息，方便编辑
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string
    const account = await accountService.getAccountById(id)

    if (!account) {
      res.status(404).json({
        success: false,
        error: { message: 'Account not found' }
      } as ApiResponse)
      return
    }

    // 返回完整账号信息（包含敏感字段）
    const fullAccount = {
      id: account.id,
      email: account.email,
      userId: account.userId,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      clientId: account.clientId,
      clientSecret: account.clientSecret,
      authMethod: account.authMethod,
      provider: account.provider,
      region: account.region,
      profileArn: account.profileArn,
      machineId: account.machineId,
      machineIdCreatedAt: account.machineIdCreatedAt,
      isAvailable: account.isAvailable,
      errorCount: account.errorCount,
      requestCount: account.requestCount,
      lastUsed: account.lastUsed,
      expiresAt: account.expiresAt,
      cooldownUntil: account.cooldownUntil,
      createdAt: account.createdAt
    }

    res.json({ success: true, data: fullAccount } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get account', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 添加账号
 * POST /api/accounts
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const request = req.body as AddAccountRequest

    // if (!request.accessToken) {
    //   res.status(400).json({
    //     success: false,
    //     error: { message: 'accessToken is required' }
    //   } as ApiResponse)
    //   return
    // }

    const account = await accountService.addAccount(request)

    res.status(201).json({
      success: true,
      data: {
        id: account.id,
        email: account.email,
        authMethod: account.authMethod,
        provider: account.provider,
        machineId: account.machineId,
        isAvailable: account.isAvailable,
        createdAt: account.createdAt
      }
    } as ApiResponse)
  } catch (error) {
    logger.error('Failed to add account', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 更新账号
 * PUT /api/accounts/:id
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string
    const updates = req.body as UpdateAccountRequest
    const account = await accountService.updateAccount(id, updates)

    if (!account) {
      res.status(404).json({
        success: false,
        error: { message: 'Account not found' }
      } as ApiResponse)
      return
    }

    res.json({
      success: true,
      data: {
        id: account.id,
        email: account.email,
        machineId: account.machineId,
        isAvailable: account.isAvailable
      }
    } as ApiResponse)
  } catch (error) {
    logger.error('Failed to update account', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 删除账号
 * DELETE /api/accounts/:id
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string
    const result = await accountService.deleteAccount(id)

    if (!result) {
      res.status(404).json({
        success: false,
        error: { message: 'Account not found' }
      } as ApiResponse)
      return
    }

    // 刷新 ProxyServer 内存中的账号池，移除已删除的账号
    await refreshProxyServerAccounts()

    res.json({ success: true } as ApiResponse)
  } catch (error) {
    logger.error('Failed to delete account', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 刷新账号 Token
 * POST /api/accounts/:id/refresh
 */
router.post('/:id/refresh', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string
    const result = await accountService.refreshAccountToken(id)

    if (!result.success) {
      res.status(400).json({
        success: false,
        error: { message: result.error || 'Token refresh failed' }
      } as ApiResponse)
      return
    }

    res.json({
      success: true,
      data: {
        id: result.account?.id,
        expiresAt: result.account?.expiresAt
      }
    } as ApiResponse)
  } catch (error) {
    logger.error('Failed to refresh token', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 测试账号连通性
 * POST /api/accounts/:id/test
 */
router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string
    const result = await accountService.testAccountConnection(id)

    res.json({
      success: result.success,
      data: result.success ? { response: result.response, model: result.model } : undefined,
      error: result.success ? undefined : { message: result.error }
    } as ApiResponse)
  } catch (error) {
    logger.error('Failed to test connection', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 重新生成账号机器码
 * POST /api/accounts/:id/regenerate-machine-id
 */
router.post('/:id/regenerate-machine-id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string
    const account = await accountService.regenerateMachineId(id)

    if (!account) {
      res.status(404).json({
        success: false,
        error: { message: 'Account not found' }
      } as ApiResponse)
      return
    }

    res.json({
      success: true,
      data: {
        id: account.id,
        machineId: account.machineId,
        machineIdCreatedAt: account.machineIdCreatedAt
      }
    } as ApiResponse)
  } catch (error) {
    logger.error('Failed to regenerate machine ID', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 批量导入账号
 * POST /api/accounts/batch/import
 */
router.post('/batch/import', async (req: Request, res: Response) => {
  try {
    const accounts = req.body.accounts as AddAccountRequest[]

    if (!accounts || !Array.isArray(accounts)) {
      res.status(400).json({
        success: false,
        error: { message: 'accounts array is required' }
      } as ApiResponse)
      return
    }

    const result = await accountService.batchImportAccounts(accounts)

    res.json({
      success: true,
      data: result
    } as ApiResponse)
  } catch (error) {
    logger.error('Failed to batch import', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 获取账号使用量
 * GET /api/accounts/:id/usage
 */
router.get('/:id/usage', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string
    const usage = await accountService.getAccountUsage(id)

    res.json({
      success: true,
      data: usage
    } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get account usage', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

export default router
