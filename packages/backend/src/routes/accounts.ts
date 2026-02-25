/**
 * 账号管理路由
 * 提供账号的增删改查、Token 刷新、连通性测试、暂停/恢复等接口
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
 * 批量暂停账号调度
 * POST /api/accounts/batch/pause
 */
router.post('/batch/pause', async (req: Request, res: Response) => {
  try {
    const { accountIds } = req.body as { accountIds: string[] }

    if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
      res.status(400).json({
        success: false,
        error: { message: 'accountIds array is required' }
      } as ApiResponse)
      return
    }

    const updated = await accountService.batchPauseAccounts(accountIds)
    await refreshProxyServerAccounts()

    res.json({
      success: true,
      data: { updated }
    } as ApiResponse)
  } catch (error) {
    logger.error('Failed to batch pause accounts', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 批量恢复账号调度
 * POST /api/accounts/batch/resume
 */
router.post('/batch/resume', async (req: Request, res: Response) => {
  try {
    const { accountIds } = req.body as { accountIds: string[] }

    if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
      res.status(400).json({
        success: false,
        error: { message: 'accountIds array is required' }
      } as ApiResponse)
      return
    }

    const updated = await accountService.batchResumeAccounts(accountIds)
    await refreshProxyServerAccounts()

    res.json({
      success: true,
      data: { updated }
    } as ApiResponse)
  } catch (error) {
    logger.error('Failed to batch resume accounts', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 批量导入账号
 * POST /api/accounts/batch/import
 * 支持两种 body 格式:
 *   1. { accounts: AddAccountRequest[] }
 *   2. 直接传入导出格式的 JSON 数组 (含 refreshToken/clientId/clientSecret/region/provider/machineId 等)
 */
router.post('/batch/import', async (req: Request, res: Response) => {
  try {
    let accounts: AddAccountRequest[]

    if (Array.isArray(req.body)) {
      // 直接传入数组（导出格式）
      accounts = (req.body as Record<string, unknown>[]).map(item => ({
        accessToken: (item.accessToken as string) || '',
        refreshToken: (item.refreshToken as string) || undefined,
        clientId: (item.clientId as string) || undefined,
        clientSecret: (item.clientSecret as string) || undefined,
        region: (item.region as string) || 'us-east-1',
        authMethod: (item.startUrl ? 'idc' : (item.authMethod as 'social' | 'idc')) || 'idc',
        provider: (item.provider as string) || 'Enterprise',
        machineId: (item.machineId as string) || undefined,
        email: (item.email as string) || undefined,
        alias: (item.alias as string) || undefined,
        proxyUrl: (item.proxyUrl as string) || undefined,
      }))
    } else {
      accounts = req.body.accounts as AddAccountRequest[]
    }

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      res.status(400).json({
        success: false,
        error: { message: 'accounts array is required' }
      } as ApiResponse)
      return
    }

    const result = await accountService.batchImportAccounts(accounts)

    // Bug fix: 批量导入后同步内存号池
    await refreshProxyServerAccounts()

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
 * 获取所有账号
 * GET /api/accounts
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const accounts = await accountService.getAllAccounts()

    // 隐藏敏感信息（Token、Secret 等不返回）
    const safeAccounts = accounts.map(acc => ({
      id: acc.id,
      alias: acc.alias,
      email: acc.email,
      userId: acc.userId,
      authMethod: acc.authMethod,
      provider: acc.provider,
      region: acc.region,
      machineId: acc.machineId,
      machineIdCreatedAt: acc.machineIdCreatedAt,
      maxConcurrency: acc.maxConcurrency,
      proxyUrl: acc.proxyUrl,
      status: acc.status || 'active',
      statusChangedAt: acc.statusChangedAt,
      statusReason: acc.statusReason,
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
      alias: account.alias,
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
      maxConcurrency: account.maxConcurrency,
      proxyUrl: account.proxyUrl,
      status: account.status || 'active',
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

    const account = await accountService.addAccount(request)

    // Bug fix: 新增账号后同步内存号池
    await refreshProxyServerAccounts()

    res.status(201).json({
      success: true,
      data: {
        id: account.id,
        email: account.email,
        authMethod: account.authMethod,
        provider: account.provider,
        machineId: account.machineId,
        status: account.status || 'active',
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

    // Bug fix: 更新账号后同步内存号池
    await refreshProxyServerAccounts()

    res.json({
      success: true,
      data: {
        id: account.id,
        email: account.email,
        machineId: account.machineId,
        status: account.status || 'active'
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
 * 暂停账号调度
 * POST /api/accounts/:id/pause
 */
router.post('/:id/pause', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string
    const account = await accountService.pauseAccount(id)

    if (!account) {
      res.status(404).json({
        success: false,
        error: { message: 'Account not found' }
      } as ApiResponse)
      return
    }

    await refreshProxyServerAccounts()

    res.json({
      success: true,
      data: { id: account.id, status: account.status }
    } as ApiResponse)
  } catch (error) {
    logger.error('Failed to pause account', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 恢复账号调度
 * POST /api/accounts/:id/resume
 */
router.post('/:id/resume', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string
    const account = await accountService.resumeAccount(id)

    if (!account) {
      res.status(404).json({
        success: false,
        error: { message: 'Account not found' }
      } as ApiResponse)
      return
    }

    await refreshProxyServerAccounts()

    res.json({
      success: true,
      data: { id: account.id, status: account.status }
    } as ApiResponse)
  } catch (error) {
    logger.error('Failed to resume account', { error: (error as Error).message })
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

    // Bug fix: 刷新 Token 后同步内存号池
    await refreshProxyServerAccounts()

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

    // Bug fix: 重新生成机器码后同步内存号池
    await refreshProxyServerAccounts()

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
