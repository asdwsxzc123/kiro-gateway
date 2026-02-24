/**
 * 账号管理服务
 * 提供账号的增删改查、Token 刷新、连通性测试等功能
 */

import * as accountStore from '../storage/accountStore.js'
import * as configStore from '../storage/configStore.js'
import { createLogger } from '../utils/logger.js'
import { refreshTokenByMethod, needsTokenRefresh, isTokenExpired } from '../core/tokenRefresh.js'
import { fetchUsageLimits, callKiroApiStream } from '../core/kiroApi.js'
import { claudeToKiro } from '../core/translator.js'
import { generateMachineId } from '../core/machineId.js'
import type { ProxyAccount, AddAccountRequest, UpdateAccountRequest, ClaudeRequest } from '../core/types.js'
import type { UsageLimitsResponse, AccountUsage } from '@kiro-gateway/shared'
import { notify } from '../core/webhook.js'

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
      machineId: tempMachineId,
      proxyUrl: request.proxyUrl
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
    machineId: tempMachineId,
    proxyUrl: request.proxyUrl
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
 * 级联清理：API Key 绑定、selectedAccounts
 */
export async function deleteAccount(id: string): Promise<boolean> {
  const result = await accountStore.deleteAccount(id)
  if (result) {
    logger.info('Account deleted, starting cascade cleanup', { id })

    // 1. 从所有 API Key 的 boundAccountIds 中移除该账号
    const updatedKeys = await configStore.removeAccountFromApiKeys(id)
    if (updatedKeys > 0) {
      logger.info('Removed account from API key bindings', { accountId: id, updatedKeys })
    }

    // 2. 从 selectedAccounts 中移除该账号
    await configStore.removeSelectedAccount(id)

    logger.info('Account cascade cleanup completed', { id })
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
    // 从配置读取测试模型 ID
    const gatewayConfig = await configStore.getGatewayConfig()
    const testModelId = gatewayConfig.testModelId || 'claude-sonnet-4.5'
    const selectedModel = { modelId: testModelId, modelName: testModelId }

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
    let usage = { outputTokens: 0, credits: 0 }

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
      outputTokens: usage.outputTokens
    })

    return {
      success: true,
      response: responseContent,
      model: selectedModel.modelName || selectedModel.modelId
    }
  } catch (error) {
    const errorMsg = (error as Error).message
    logger.error('Connection test failed', { id, error: errorMsg })
    await accountStore.updateAccount(id, { status: 'error_suspended', statusReason: `测试失败: ${errorMsg}` })
    notify({
      type: 'account_error',
      timestamp: new Date().toISOString(),
      account: { id, alias: account.alias, email: account.email },
      detail: { status: 'error_suspended', reason: 'Connection test failed', error: errorMsg }
    }).catch(() => {})
    return { success: false, error: errorMsg }
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

  checked = accounts.length

  // 并行刷新，每批最多 5 个
  const BATCH_SIZE = 5
  const needsRefresh = accounts.filter(a => needsTokenRefresh(a))

  for (let i = 0; i < needsRefresh.length; i += BATCH_SIZE) {
    const batch = needsRefresh.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(batch.map(async (account) => {
      logger.info('Token needs refresh', { id: account.id })
      const result = await refreshTokenByMethod(account)

      if (result.success && result.accessToken) {
        await accountStore.updateAccount(account.id, {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: result.expiresAt
        })
        logger.info('Token auto-refreshed', { id: account.id })

        // 验证刷新后的账号可用性（通过实际请求验证，而非模型列表）
        const refreshedAccount: ProxyAccount = { ...account, accessToken: result.accessToken }
        try {
          const gwConfig = await configStore.getGatewayConfig()
          const testReq: ClaudeRequest = {
            model: gwConfig.testModelId || 'claude-sonnet-4.5',
            max_tokens: 10,
            messages: [{ role: 'user', content: DEFAULT_TEST_MESSAGE }]
          }
          const payload = claudeToKiro(testReq, refreshedAccount.profileArn)
          await new Promise<void>((resolve, reject) => {
            callKiroApiStream(
              refreshedAccount,
              payload,
              () => {},
              () => resolve(),
              reject,
              undefined,
              undefined,
              true // skipAgentMode
            )
          })
        } catch (verifyError) {
          const errorMsg = (verifyError as Error).message
          logger.error('Post-refresh verification failed', { id: account.id, error: errorMsg })
          await accountStore.updateAccount(account.id, { status: 'error_suspended', statusReason: `Token 刷新后验证失败: ${errorMsg}` })
          notify({
            type: 'account_error',
            timestamp: new Date().toISOString(),
            account: { id: account.id, alias: account.alias, email: account.email },
            detail: { status: 'error_suspended', reason: 'Verification request failed after token refresh', error: errorMsg }
          }).catch(() => {})
          return false
        }

        return true
      } else {
        logger.error('Token auto-refresh failed', { id: account.id, error: result.error })
        notify({
          type: 'token_refresh_fail',
          timestamp: new Date().toISOString(),
          account: { id: account.id, alias: account.alias, email: account.email },
          detail: { error: result.error, authMethod: account.authMethod }
        }).catch(() => {})
        return false
      }
    }))

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) refreshed++
      else failed++
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

    // 刷新失败，标记为异常挂起
    await accountStore.updateAccount(selected.id, { status: 'error_suspended', statusReason: 'Token 刷新失败' })
    logger.error('Account marked unavailable due to token refresh failure', { id: selected.id })
    notify({
      type: 'account_error',
      timestamp: new Date().toISOString(),
      account: { id: selected.id, alias: selected.alias, email: selected.email },
      detail: { status: 'error_suspended', reason: 'token_refresh_failure' }
    }).catch(() => {})

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
      const errorMsg = (error as Error).message
      logger.error('Failed to fetch usage for account', {
        id: account.id,
        error: errorMsg
      })

      // 检测账号被封禁（TEMPORARILY_SUSPENDED），自动标记为 suspended
      if (errorMsg.includes('TEMPORARILY_SUSPENDED') || errorMsg.includes('temporarily is suspended')) {
        if (account.status !== 'suspended') {
          await accountStore.updateAccount(account.id, { status: 'suspended', statusReason: '账号被封禁 (TEMPORARILY_SUSPENDED)' })
          logger.warn('Account marked as suspended (banned by Kiro)', { id: account.id })
          notify({
            type: 'account_error',
            timestamp: new Date().toISOString(),
            account: { id: account.id, alias: account.alias, email: account.email },
            detail: { status: 'suspended', reason: 'TEMPORARILY_SUSPENDED', error: errorMsg }
          }).catch(() => {})
        }
      }

      return {
        accountId: account.id,
        error: errorMsg,
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

/**
 * 暂停账号调度
 */
export async function pauseAccount(id: string): Promise<ProxyAccount | null> {
  const account = await accountStore.getAccountById(id)
  if (!account) return null

  const updated = await accountStore.updateAccount(id, { status: 'paused', statusReason: '手动暂停' })
  if (updated) {
    logger.info('Account paused', { id })
    notify({
      type: 'account_error',
      timestamp: new Date().toISOString(),
      account: { id, alias: account.alias, email: account.email },
      detail: { status: 'paused', reason: 'manual' }
    }).catch(() => {})
  }
  return updated
}

/**
 * 恢复账号调度
 */
export async function resumeAccount(id: string): Promise<ProxyAccount | null> {
  const account = await accountStore.getAccountById(id)
  if (!account) return null

  const updated = await accountStore.updateAccount(id, { status: 'active' })
  if (updated) {
    logger.info('Account resumed', { id })
  }
  return updated
}

/**
 * 批量暂停账号调度
 */
export async function batchPauseAccounts(accountIds: string[]): Promise<number> {
  let updated = 0
  for (const id of accountIds) {
    const result = await accountStore.updateAccount(id, { status: 'paused', statusReason: '批量暂停' })
    if (result) {
      updated++
      notify({
        type: 'account_error',
        timestamp: new Date().toISOString(),
        account: { id, alias: result.alias, email: result.email },
        detail: { status: 'paused', reason: 'batch' }
      }).catch(() => {})
    }
  }
  logger.info('Batch pause completed', { requested: accountIds.length, updated })
  return updated
}

/**
 * 批量恢复账号调度
 */
export async function batchResumeAccounts(accountIds: string[]): Promise<number> {
  let updated = 0
  for (const id of accountIds) {
    const result = await accountStore.updateAccount(id, { status: 'active' })
    if (result) {
      updated++
    }
  }
  logger.info('Batch resume completed', { requested: accountIds.length, updated })
  return updated
}
