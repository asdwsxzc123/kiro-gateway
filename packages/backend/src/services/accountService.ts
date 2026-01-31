/**
 * 账号管理服务
 * 提供账号的增删改查、Token 刷新、连通性测试等功能
 */

import * as accountStore from '../storage/accountStore.js'
import { createLogger } from '../utils/logger.js'
import { refreshTokenByMethod, needsTokenRefresh, isTokenExpired } from '../core/tokenRefresh.js'
import { fetchKiroModels, fetchUsageLimits, callKiroApiStream } from '../core/kiroApi.js'
import { claudeToKiro } from '../core/translator.js'
import { generateMachineId } from '../core/machineId.js'
import type { ProxyAccount, AddAccountRequest, UpdateAccountRequest, ClaudeRequest } from '../core/types.js'
import type { UsageLimitsResponse, AccountUsage } from '@kiro-gateway/shared'

// 默认测试消息
const DEFAULT_TEST_MESSAGE = 'hi'

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
 * 1. 如果有 refreshToken，先刷新 token 验证凭证有效性
 * 2. 调用 fetchUsageLimits 获取 userInfo（email 和 userId）
 * 3. 验证通过后才保存账号
 */
export async function addAccount(request: AddAccountRequest): Promise<ProxyAccount> {
  logger.info('Adding new account', { email: request.email, authMethod: request.authMethod })

  // 生成临时 machineId 用于验证
  const tempMachineId = request.machineId || generateMachineId()

  // 如果有 refreshToken，先刷新 token 验证凭证有效性
  let accessToken = request.accessToken
  let refreshToken = request.refreshToken
  let expiresAt: number | undefined

  if (request.refreshToken) {
    // 构建临时账号对象用于刷新 token
    const tempAccount: ProxyAccount = {
      id: 'temp',
      accessToken: request.accessToken || '',
      refreshToken: request.refreshToken,
      clientId: request.clientId,
      clientSecret: request.clientSecret,
      region: request.region,
      authMethod: request.authMethod,
      machineId: tempMachineId
    }

    logger.info('Refreshing token for new account')
    const refreshResult = await refreshTokenByMethod(tempAccount)

    if (!refreshResult.success || !refreshResult.accessToken) {
      const errorMsg = `Token 刷新失败: ${refreshResult.error || 'Unknown error'}`
      logger.error(errorMsg)
      throw new Error(errorMsg)
    }

    accessToken = refreshResult.accessToken
    refreshToken = refreshResult.refreshToken
    expiresAt = refreshResult.expiresAt
    logger.info('Token refreshed successfully for new account')
  }

  // 构建临时账号对象用于获取 userInfo
  const tempAccountForUsage: ProxyAccount = {
    id: 'temp',
    accessToken: accessToken || '',
    refreshToken,
    clientId: request.clientId,
    clientSecret: request.clientSecret,
    region: request.region,
    authMethod: request.authMethod,
    profileArn: request.profileArn,
    machineId: tempMachineId
  }

  // 获取 userInfo（同时验证 token 有效性）
  let email = request.email
  let userId: string | undefined

  try {
    logger.info('Fetching user info for new account')
    const usageData = await fetchUsageLimits(tempAccountForUsage)

    if (usageData.userInfo?.email) {
      email = usageData.userInfo.email
    }
    if (usageData.userInfo?.userId) {
      userId = usageData.userInfo.userId
    }
    logger.info('User info fetched', { email, userId })
  } catch (error) {
    // 如果获取 userInfo 失败，说明 token 无效
    const errorMsg = `验证账号失败: ${(error as Error).message}`
    logger.error(errorMsg)
    throw new Error(errorMsg)
  }

  // 验证通过，保存账号
  const accountData: AddAccountRequest = {
    ...request,
    accessToken,
    refreshToken,
    email,
    machineId: tempMachineId
  }

  const account = await accountStore.addAccount(accountData)

  // 更新 userId 和 expiresAt
  if (userId || expiresAt) {
    const updates: UpdateAccountRequest = {}
    if (userId) updates.userId = userId
    if (expiresAt) updates.expiresAt = expiresAt
    await accountStore.updateAccount(account.id, updates)
  }

  logger.info('Account added successfully', { id: account.id, email, userId })

  // 返回完整的账号信息
  const finalAccount = await accountStore.getAccountById(account.id)
  return finalAccount || account
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
 * 通过实际调用 /v1/messages 接口发送测试消息来验证账号是否可用
 */
export async function testAccountConnection(id: string): Promise<{
  success: boolean
  response?: string
  model?: string
  error?: string
}> {
  const account = await accountStore.getAccountById(id)
  if (!account) {
    return { success: false, error: 'Account not found' }
  }

  logger.info('Testing connection for account', { id })

  try {
    // 先获取可用模型列表
    const models = await fetchKiroModels(account)
    if (models.length === 0) {
      return { success: false, error: 'No available models' }
    }

    // 优先使用默认模型，如果不可用则使用第一个可用模型
    let selectedModel = models.find(m =>
      m.modelId.toLowerCase().includes('sonnet') &&
      (m.modelId.includes('4-5') || m.modelId.includes('4.5'))
    )
    if (!selectedModel) {
      selectedModel = models[0]
    }

    logger.info('Selected model for testing', { id, model: selectedModel.modelId })

    // 构建测试请求
    const testRequest: ClaudeRequest = {
      model: selectedModel.modelId,
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: DEFAULT_TEST_MESSAGE
        }
      ]
    }

    // 转换为 Kiro 格式
    const payload = claudeToKiro(testRequest, account.profileArn)

    // 发送请求并收集响应
    let responseContent = ''
    let usage = { inputTokens: 0, outputTokens: 0, credits: 0 }

    await new Promise<void>((resolve, reject) => {
      callKiroApiStream(
        account,
        payload,
        (text) => {
          responseContent += text
        },
        (u) => {
          usage = u
          resolve()
        },
        reject,
        undefined,  // signal
        undefined,  // preferredEndpoint
        true        // skipAgentMode - 跳过 x-amzn-kiro-agent-mode header，避免某些订阅不支持导致 403 错误
      )
    })

    logger.info('Connection test successful', {
      id,
      model: selectedModel.modelId,
      responseLength: responseContent.length,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens
    })

    return {
      success: true,
      response: responseContent,
      model: selectedModel.modelName || selectedModel.modelId
    }
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

/**
 * 获取单个账号使用量
 */
export async function getAccountUsage(id: string): Promise<UsageLimitsResponse> {
  const account = await accountStore.getAccountById(id)
  if (!account) {
    throw new Error('Account not found')
  }

  logger.info('Fetching usage for account', { id })
  return fetchUsageLimits(account)
}

/**
 * 批量获取所有账号使用量
 */
export async function getAllAccountsUsage(): Promise<AccountUsage[]> {
  const accounts = await accountStore.getAllAccounts()
  const results: AccountUsage[] = []

  // 并行获取所有账号的使用量
  const promises = accounts.map(async (account) => {
    try {
      const usage = await fetchUsageLimits(account)
      return {
        accountId: account.id,
        usage,
        updatedAt: Date.now()
      }
    } catch (error) {
      logger.error('Failed to fetch usage for account', {
        id: account.id,
        error: (error as Error).message
      })
      return {
        accountId: account.id,
        error: (error as Error).message,
        updatedAt: Date.now()
      }
    }
  })

  const settled = await Promise.all(promises)
  results.push(...settled)

  logger.info('Fetched usage for all accounts', {
    total: accounts.length,
    success: results.filter(r => r.usage).length,
    failed: results.filter(r => r.error).length
  })

  return results
}
