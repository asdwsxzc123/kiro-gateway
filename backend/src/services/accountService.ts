/**
 * 账号管理服务
 * 提供账号的增删改查、Token 刷新、连通性测试等功能
 */

import * as accountStore from '../storage/accountStore.js'
import { createLogger } from '../utils/logger.js'
import { refreshTokenByMethod, needsTokenRefresh, isTokenExpired } from '../core/tokenRefresh.js'
import { fetchKiroModels } from '../core/kiroApi.js'
import type { ProxyAccount, AddAccountRequest, UpdateAccountRequest } from '../core/types.js'

const logger = createLogger('AccountService')

/**
 * 获取所有账号
 */
export async function getAllAccounts(): Promise<ProxyAccount[]> {
  return accountStore.getAllAccounts()
}

/**
 * 根据 ID 获取账号
 */
export async function getAccountById(id: string): Promise<ProxyAccount | null> {
  return accountStore.getAccountById(id)
}

/**
 * 添加账号
 */
export async function addAccount(request: AddAccountRequest): Promise<ProxyAccount> {
  const account = await accountStore.addAccount(request)
  logger.info('Account added', { id: account.id, email: account.email })
  return account
}

/**
 * 更新账号
 */
export async function updateAccount(id: string, updates: UpdateAccountRequest): Promise<ProxyAccount | null> {
  const account = await accountStore.updateAccount(id, updates)
  if (account) {
    logger.info('Account updated', { id })
  }
  return account
}

/**
 * 删除账号
 */
export async function deleteAccount(id: string): Promise<boolean> {
  const result = await accountStore.deleteAccount(id)
  if (result) {
    logger.info('Account deleted', { id })
  }
  return result
}

/**
 * 获取可用账号列表
 */
export async function getAvailableAccounts(): Promise<ProxyAccount[]> {
  return accountStore.getAvailableAccounts()
}

/**
 * 重新生成账号机器码
 */
export async function regenerateMachineId(id: string): Promise<ProxyAccount | null> {
  return accountStore.regenerateMachineId(id)
}

/**
 * 刷新账号 Token
 */
export async function refreshAccountToken(id: string): Promise<{
  success: boolean
  account?: ProxyAccount
  error?: string
}> {
  const account = await accountStore.getAccountById(id)
  if (!account) {
    return { success: false, error: 'Account not found' }
  }

  logger.info('Refreshing token for account', { id, authMethod: account.authMethod })

  const result = await refreshTokenByMethod(account)

  if (result.success && result.accessToken) {
    const updated = await accountStore.updateAccount(id, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt
    })

    logger.info('Token refreshed successfully', { id })
    return { success: true, account: updated || undefined }
  }

  logger.error('Token refresh failed', { id, error: result.error })
  return { success: false, error: result.error }
}

/**
 * 测试账号连通性
 */
export async function testAccountConnection(id: string): Promise<{
  success: boolean
  models?: { modelId: string; modelName: string }[]
  error?: string
}> {
  const account = await accountStore.getAccountById(id)
  if (!account) {
    return { success: false, error: 'Account not found' }
  }

  logger.info('Testing connection for account', { id })

  try {
    const models = await fetchKiroModels(account)

    if (models.length > 0) {
      logger.info('Connection test successful', { id, modelCount: models.length })
      return {
        success: true,
        models: models.map(m => ({ modelId: m.modelId, modelName: m.modelName }))
      }
    }

    return { success: false, error: 'No models returned' }
  } catch (error) {
    logger.error('Connection test failed', { id, error: (error as Error).message })
    return { success: false, error: (error as Error).message }
  }
}

/**
 * 检查并刷新过期的 Token
 */
export async function checkAndRefreshExpiredTokens(): Promise<{
  checked: number
  refreshed: number
  failed: number
}> {
  const accounts = await accountStore.getAllAccounts()
  let checked = 0
  let refreshed = 0
  let failed = 0

  for (const account of accounts) {
    checked++

    if (needsTokenRefresh(account)) {
      logger.info('Token needs refresh', { id: account.id })

      const result = await refreshTokenByMethod(account)

      if (result.success && result.accessToken) {
        await accountStore.updateAccount(account.id, {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: result.expiresAt
        })
        refreshed++
        logger.info('Token auto-refreshed', { id: account.id })
      } else {
        failed++
        logger.error('Token auto-refresh failed', { id: account.id, error: result.error })
      }
    }
  }

  return { checked, refreshed, failed }
}

/**
 * 选择一个可用账号（轮询策略）
 */
export async function selectAvailableAccount(): Promise<ProxyAccount | null> {
  const accounts = await accountStore.getAvailableAccounts()

  if (accounts.length === 0) {
    logger.warn('No available accounts')
    return null
  }

  // 按最后使用时间排序，选择最久未使用的
  accounts.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0))

  const selected = accounts[0]

  // 检查 Token 是否过期
  if (isTokenExpired(selected)) {
    logger.warn('Selected account token expired, attempting refresh', { id: selected.id })

    const result = await refreshTokenByMethod(selected)
    if (result.success && result.accessToken) {
      await accountStore.updateAccount(selected.id, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt
      })
      return { ...selected, accessToken: result.accessToken }
    }

    // 刷新失败，标记为不可用
    await accountStore.updateAccount(selected.id, { isAvailable: false })
    logger.error('Account marked unavailable due to token refresh failure', { id: selected.id })

    // 递归选择下一个
    return selectAvailableAccount()
  }

  return selected
}

/**
 * 更新账号使用统计
 */
export async function updateAccountUsage(
  id: string,
  success: boolean,
  responseTime?: number
): Promise<void> {
  await accountStore.updateAccountUsage(id, success, responseTime)
}

/**
 * 设置账号冷却（配额耗尽时）
 */
export async function setAccountCooldown(id: string, durationMs: number = 60000): Promise<void> {
  await accountStore.setAccountCooldown(id, durationMs)
}

/**
 * 获取账号数量
 */
export async function getAccountCount(): Promise<number> {
  return accountStore.getAccountCount()
}

/**
 * 批量导入账号
 */
export async function batchImportAccounts(accounts: AddAccountRequest[]): Promise<{
  success: number
  failed: number
  errors: string[]
}> {
  let success = 0
  let failed = 0
  const errors: string[] = []

  for (const accountData of accounts) {
    try {
      await accountStore.addAccount(accountData)
      success++
    } catch (error) {
      failed++
      errors.push(`Failed to import account ${accountData.email || 'unknown'}: ${(error as Error).message}`)
    }
  }

  logger.info('Batch import completed', { success, failed })
  return { success, failed, errors }
}
