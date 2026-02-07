/**
 * ProxyServer 类
 * 代理服务核心类，参考 kiro-m 项目实现
 *
 * 功能：
 * - Thinking 模式支持
 * - 自动继续机制 (Auto-Continue)
 * - API Key 多租户管理
 * - Token 自动刷新
 * - 重试机制
 * - 流式处理增强
 */

import { v4 as uuidv4 } from 'uuid'
import type {
  ProxyAccount,
  ProxyConfig,
  ProxyStats,
  ApiKey,
  ClaudeRequest,
  KiroPayload,
  RequestLog
} from './types.js'
import { AccountPool } from './accountPool.js'
import {
  claudeToKiro,
  kiroToClaudeResponse,
  createClaudeStreamEvent
} from './translator.js'
import { callKiroApiStream, callKiroApi } from './kiroApi.js'
import { createLogger } from '../utils/logger.js'
import { refreshTokenByMethod, needsTokenRefresh } from './tokenRefresh.js'
import { hasWebSearchTool, handleWebSearchStream } from './websearch.js'
import * as logStore from '../storage/logStore.js'
import * as statsStore from '../storage/statsStore.js'
import * as dailyStatsStore from '../storage/dailyStatsStore.js'
import * as apiKeyStore from '../storage/apiKeyStore.js'
import { calculateCost } from './pricing.js'
import { calculateCacheRatio, splitTokensByRatio } from './cacheTracker.js'
import type { CacheRatio, CacheCalculation } from './cacheTracker.js'
import { computeSessionHash, getSessionAccount, setSessionAccount } from './sessionCache.js'

const logger = createLogger('ProxyServer')

// 默认配置
const DEFAULT_CONFIG: ProxyConfig = {
  enabled: true,
  port: 3000,
  host: '0.0.0.0',
  enableMultiAccount: true,
  selectedAccountIds: [],
  logRequests: true,
  maxConcurrent: 5,
  maxRetries: 3,
  retryDelayMs: 1000,
  tokenRefreshBeforeExpiry: 300,
  autoStart: false,
  autoContinueRounds: 0,
  thinkingOutputFormat: 'thinking'
}

// 事件回调接口
export interface ProxyServerEvents {
  onRequest?: (info: { path: string; method?: string; accountId?: string }) => void
  onResponse?: (info: { path: string; model?: string; status: number; tokens?: number; inputTokens?: number; outputTokens?: number; credits?: number; error?: string }) => void
  onTokenRefresh?: (account: ProxyAccount) => Promise<{ success: boolean; accessToken?: string; refreshToken?: string; expiresAt?: number; error?: string }>
  onCreditsUpdate?: (totalCredits: number) => void
  onTokensUpdate?: (inputTokens: number, outputTokens: number) => void
  onStatsUpdate?: (stats: ProxyStats) => void
}

export class ProxyServer {
  private config: ProxyConfig
  private accountPool: AccountPool
  private stats: ProxyStats
  private events: ProxyServerEvents
  private refreshingTokens: Set<string> = new Set()
  private apiKeys: Map<string, ApiKey> = new Map()

  constructor(config: Partial<ProxyConfig> = {}, events: ProxyServerEvents = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.accountPool = new AccountPool()
    this.events = events
    this.stats = this.initStats()
  }

  // 初始化统计
  private initStats(): ProxyStats {
    return {
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      totalTokens: 0,
      totalCredits: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      startTime: Date.now(),
      accountStats: new Map(),
      endpointStats: new Map(),
      modelStats: new Map(),
      recentRequests: []
    }
  }

  // ============ 配置管理 ============

  updateConfig(updates: Partial<ProxyConfig>): void {
    this.config = { ...this.config, ...updates }
    logger.info('Config updated', { updates })
  }

  getConfig(): ProxyConfig {
    return { ...this.config }
  }

  // ============ 账号管理 ============

  addAccount(account: ProxyAccount): void {
    this.accountPool.addAccount(account)
    logger.info('Account added', { id: account.id })
  }

  addAccounts(accounts: ProxyAccount[]): void {
    this.accountPool.addAccounts(accounts)
    logger.info('Accounts added', { count: accounts.length })
  }

  removeAccount(id: string): boolean {
    return this.accountPool.removeAccount(id)
  }

  updateAccount(id: string, updates: Partial<ProxyAccount>): void {
    this.accountPool.updateAccount(id, updates)
  }

  getAccountCount(): number {
    return this.accountPool.size
  }

  getAvailableAccountCount(): number {
    return this.accountPool.availableCount
  }

  // ============ API Key 管理 ============

  addApiKey(apiKey: ApiKey): void {
    this.apiKeys.set(apiKey.id, apiKey)
  }

  removeApiKey(id: string): boolean {
    return this.apiKeys.delete(id)
  }

  validateApiKey(key: string): ApiKey | null {
    if (this.apiKeys.size === 0) return null // 没有配置 API Key，返回 null

    for (const apiKey of this.apiKeys.values()) {
      if (apiKey.key === key && apiKey.enabled) {
        return apiKey
      }
    }
    return null
  }

  // 记录 API Key 用量
  recordApiKeyUsage(
    apiKeyId: string,
    credits: number,
    inputTokens: number,
    outputTokens: number,
    cost: number,
    model: string,
    path: string
  ): void {
    const apiKey = this.apiKeys.get(apiKeyId)
    if (!apiKey) return

    const today = new Date().toISOString().split('T')[0]

    // 更新总计
    apiKey.usage.totalRequests++
    apiKey.usage.totalCredits += credits
    apiKey.usage.totalInputTokens += inputTokens
    apiKey.usage.totalOutputTokens += outputTokens
    apiKey.usage.totalCost += cost
    apiKey.lastUsedAt = Date.now()

    // 更新日统计
    if (!apiKey.usage.daily[today]) {
      apiKey.usage.daily[today] = { requests: 0, credits: 0, inputTokens: 0, outputTokens: 0, cost: 0 }
    }
    apiKey.usage.daily[today].requests++
    apiKey.usage.daily[today].credits += credits
    apiKey.usage.daily[today].inputTokens += inputTokens
    apiKey.usage.daily[today].outputTokens += outputTokens
    apiKey.usage.daily[today].cost += cost

    // 更新模型统计
    if (!apiKey.usage.byModel) apiKey.usage.byModel = {}
    if (!apiKey.usage.byModel[model]) {
      apiKey.usage.byModel[model] = { requests: 0, credits: 0, inputTokens: 0, outputTokens: 0, cost: 0 }
    }
    apiKey.usage.byModel[model].requests++
    apiKey.usage.byModel[model].credits += credits
    apiKey.usage.byModel[model].inputTokens += inputTokens
    apiKey.usage.byModel[model].outputTokens += outputTokens
    apiKey.usage.byModel[model].cost += cost

    // 添加到用量历史
    if (!apiKey.usageHistory) apiKey.usageHistory = []
    apiKey.usageHistory.unshift({
      timestamp: Date.now(),
      model,
      inputTokens,
      outputTokens,
      credits,
      cost,
      path
    })
    // 保留最近 100 条
    if (apiKey.usageHistory.length > 100) {
      apiKey.usageHistory = apiKey.usageHistory.slice(0, 100)
    }

    // 持久化到 Redis
    apiKeyStore.updateDailyApiKeyStats(
      apiKeyId,
      credits,
      inputTokens,
      outputTokens,
      cost
    ).catch(err => {
      logger.error('Failed to persist API key daily stats', { error: (err as Error).message })
    })

    apiKeyStore.updateApiKeyTotalStats(
      apiKeyId,
      credits,
      inputTokens,
      outputTokens,
      cost
    ).catch(err => {
      logger.error('Failed to persist API key total stats', { error: (err as Error).message })
    })
  }

  // ============ Token 刷新 ============

  private async refreshToken(account: ProxyAccount): Promise<boolean> {
    // 防止并发刷新
    if (this.refreshingTokens.has(account.id)) {
      logger.debug('Token refresh already in progress', { accountId: account.id })
      return false
    }

    this.refreshingTokens.add(account.id)
    this.accountPool.markNeedsRefresh(account.id)

    try {
      let result: { success: boolean; accessToken?: string; refreshToken?: string; expiresAt?: number; error?: string }

      if (this.events.onTokenRefresh) {
        result = await this.events.onTokenRefresh(account)
      } else {
        result = await refreshTokenByMethod(account)
      }

      if (result.success && result.accessToken) {
        this.accountPool.updateAccount(account.id, {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: result.expiresAt
        })
        this.accountPool.clearNeedsRefresh(account.id)
        this.accountPool.setAvailable(account.id, true)
        logger.info('Token refreshed successfully', { accountId: account.id })
        return true
      } else {
        logger.error('Token refresh failed', { accountId: account.id, error: result.error })
        return false
      }
    } catch (error) {
      logger.error('Token refresh error', { accountId: account.id, error: (error as Error).message })
      return false
    } finally {
      this.refreshingTokens.delete(account.id)
    }
  }

  private isTokenExpiringSoon(account: ProxyAccount): boolean {
    if (!account.expiresAt) return false
    const now = Date.now()
    const expiresAt = account.expiresAt * 1000 // 转换为毫秒
    const threshold = this.config.tokenRefreshBeforeExpiry * 1000
    return expiresAt - now < threshold
  }

  // ============ 获取可用账号 ============

  /**
   * 获取可用账号
   * @param boundAccountIds 绑定的账号 ID 列表（API Key 维度），为空则使用全局轮询
   */
  async getAvailableAccount(boundAccountIds?: string[]): Promise<ProxyAccount | null> {
    let account: ProxyAccount | null = null

    // 如果指定了绑定账号，从子集中选择
    if (boundAccountIds && boundAccountIds.length > 0) {
      account = this.accountPool.getNextAccountFromSubset(boundAccountIds)
    } else {
      account = this.accountPool.getNextAccount()
    }

    if (!account) {
      logger.warn('No available accounts', {
        bound: boundAccountIds?.length ?? 0
      })
      return null
    }

    // 检查是否需要刷新 Token
    if (this.isTokenExpiringSoon(account) || needsTokenRefresh(account)) {
      logger.info('Token expiring soon, refreshing', { accountId: account.id })
      const refreshed = await this.refreshToken(account)
      if (!refreshed) {
        // 刷新失败，尝试获取下一个账号
        const nextAccount = this.accountPool.getNextAvailableAccount(account.id)
        if (nextAccount) {
          return nextAccount
        }
      }
      // 返回刷新后的账号
      return this.accountPool.getAccount(account.id)
    }

    return account
  }

  // ============ 统计管理 ============

  getStats(): ProxyStats {
    return { ...this.stats }
  }

  resetStats(): void {
    this.stats = this.initStats()
    this.accountPool.resetAllStats()
  }

  private recordNewRequest(): void {
    this.stats.totalRequests++
  }

  private recordRequestSuccess(): void {
    this.stats.successRequests++
  }

  private recordRequestFailed(): void {
    this.stats.failedRequests++
  }

  private recordRequest(log: Partial<RequestLog>): void {
    const requestLog: RequestLog = {
      id: uuidv4(),
      timestamp: Date.now(),
      path: log.path || '',
      model: log.model || '',
      accountId: log.accountId || '',
      machineId: log.machineId,
      inputTokens: log.inputTokens || 0,
      outputTokens: log.outputTokens || 0,
      credits: log.credits,
      cacheCreationTokens: log.cacheCreationTokens,
      cacheReadTokens: log.cacheReadTokens,
      cost: log.cost,
      responseTime: log.responseTime || 0,
      success: log.success ?? true,
      error: log.error
    }

    this.stats.recentRequests.unshift(requestLog)
    if (this.stats.recentRequests.length > 100) {
      this.stats.recentRequests = this.stats.recentRequests.slice(0, 100)
    }

    this.events.onStatsUpdate?.(this.stats)

    // 写入 Redis 持久化日志
    logStore.addRequestLog(requestLog).catch(err => {
      logger.error('Failed to persist request log', { error: (err as Error).message })
    })
  }

  // ============ 重试机制 ============

  private async callWithRetry<T>(
    account: ProxyAccount,
    apiCall: (acc: ProxyAccount) => Promise<T>,
    _path: string
  ): Promise<{ result: T; account: ProxyAccount }> {
    const maxRetries = this.config.maxRetries
    let currentAccount = account
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await apiCall(currentAccount)
        return { result, account: currentAccount }
      } catch (error) {
        lastError = error as Error
        const errorMsg = lastError.message

        logger.warn(`API call failed (attempt ${attempt + 1}/${maxRetries})`, {
          accountId: currentAccount.id,
          error: errorMsg
        })

        // 401/403: Token 过期，尝试刷新
        if (errorMsg.includes('401') || errorMsg.includes('403')) {
          const refreshed = await this.refreshToken(currentAccount)
          if (refreshed) {
            const updatedAccount = this.accountPool.getAccount(currentAccount.id)
            if (updatedAccount) {
              currentAccount = updatedAccount
              continue
            }
          }
        }

        // 429: 配额耗尽，切换账号
        if (errorMsg.includes('429') || errorMsg.includes('quota')) {
          this.accountPool.recordError(currentAccount.id, true)

          if (this.config.autoSwitchOnQuotaExhausted) {
            const nextAccount = this.accountPool.getNextAvailableAccount(currentAccount.id)
            if (nextAccount) {
              logger.info('Switching to next account due to quota', {
                from: currentAccount.id,
                to: nextAccount.id
              })
              currentAccount = nextAccount
              continue
            }
          }
        }

        // 5xx: 服务器错误，延迟重试
        if (errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503')) {
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs * (attempt + 1)))
          continue
        }

        // 其他错误，记录并继续
        this.accountPool.recordError(currentAccount.id, false)
      }
    }

    throw lastError || new Error('Max retries exceeded')
  }

  // ============ Claude 请求处理 ============

  async handleClaudeRequest(
    request: ClaudeRequest,
    _headers?: Record<string, string>,
    boundAccountIds?: string[]
  ): Promise<{ success: boolean; response?: unknown; error?: string }> {
    this.recordNewRequest()
    this.events.onRequest?.({ path: '/v1/messages', method: 'POST' })

    // Sticky Session: try routing to bound account
    const sessionHash = computeSessionHash(request, _headers?.['x-session-id'])
    let account: ProxyAccount | null = null

    if (sessionHash) {
      const stickyAccountId = await getSessionAccount(sessionHash)
      if (stickyAccountId) {
        // 如果 API Key 绑定了账号，sticky session 账号必须在绑定列表中
        const inBoundList = !boundAccountIds || boundAccountIds.length === 0 || boundAccountIds.includes(stickyAccountId)
        if (inBoundList) {
          account = this.accountPool.getAccountIfAvailable(stickyAccountId)
        }
      }
    }
    if (!account) {
      account = await this.getAvailableAccount(boundAccountIds)
    }
    if (!account) {
      this.recordRequestFailed()
      return { success: false, error: 'No available accounts' }
    }

    const startTime = Date.now()

    // Calculate cache ratio (atomic check + write)
    const cacheRatio = await calculateCacheRatio(account.id, request)

    try {
      const { result, account: usedAccount } = await this.callWithRetry(
        account,
        async (acc) => callKiroApi(acc, claudeToKiro(request, acc.profileArn)),
        '/v1/messages'
      )

      const response = kiroToClaudeResponse(result.content, result.toolUses, result.usage, request.model)

      this.recordRequestSuccess()
      this.stats.totalTokens += result.usage.inputTokens + result.usage.outputTokens
      this.stats.inputTokens += result.usage.inputTokens
      this.stats.outputTokens += result.usage.outputTokens
      this.accountPool.recordSuccess(usedAccount.id, result.usage.inputTokens + result.usage.outputTokens)

      this.events.onResponse?.({
        path: '/v1/messages',
        model: request.model,
        status: 200,
        tokens: result.usage.inputTokens + result.usage.outputTokens,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens
      })

      // Split tokens by cache ratio
      const cacheCalc = splitTokensByRatio(cacheRatio, result.usage.inputTokens)

      // Bind Sticky Session
      if (sessionHash) {
        setSessionAccount(sessionHash, usedAccount.id).catch(() => {})
      }

      // Cache-aware cost calculation
      const cost2 = calculateCost(
        request.model,
        cacheCalc.totalInputTokens,
        result.usage.outputTokens,
        cacheCalc.cacheCreationTokens,
        cacheCalc.cacheReadTokens
      )

      // Update memory stats
      this.stats.cacheCreationTokens += cacheCalc.cacheCreationTokens
      this.stats.cacheReadTokens += cacheCalc.cacheReadTokens

      // Persist to Redis
      statsStore.updateGlobalStats(
        true,
        result.usage.inputTokens,
        result.usage.outputTokens,
        0,
        cost2.totalCost,
        cacheCalc.cacheCreationTokens,
        cacheCalc.cacheReadTokens
      ).catch(err => {
        logger.error('Failed to persist global stats', { error: (err as Error).message })
      })

      // Update daily stats
      const today = new Date().toISOString().split('T')[0]

      // 更新全局日统计
      await dailyStatsStore.updateDailyGlobalStats(
        today,
        true,
        result.usage.inputTokens,
        result.usage.outputTokens,
        0,
        cost2.totalCost,
        cacheCalc.cacheCreationTokens,
        cacheCalc.cacheReadTokens
      ).catch(err => {
        logger.error('Failed to persist daily global stats', { error: (err as Error).message })
      })

      // 更新账号日统计
      await dailyStatsStore.updateDailyAccountStats(
        usedAccount.id,
        today,
        true,
        result.usage.inputTokens,
        result.usage.outputTokens,
        Date.now() - startTime,
        cost2.totalCost,
        cacheCalc.cacheCreationTokens,
        cacheCalc.cacheReadTokens
      ).catch(err => {
        logger.error('Failed to persist daily account stats', { error: (err as Error).message })
      })

      // 更新模型日统计
      await dailyStatsStore.updateDailyModelStats(
        request.model,
        today,
        result.usage.inputTokens,
        result.usage.outputTokens,
        cost2.totalCost
      ).catch(err => {
        logger.error('Failed to persist daily model stats', { error: (err as Error).message })
      })

      this.recordRequest({
        path: '/v1/messages',
        model: request.model,
        accountId: usedAccount.id,
        machineId: usedAccount.machineId,
        inputTokens: cacheCalc.uncachedTokens,
        outputTokens: result.usage.outputTokens,
        cacheCreationTokens: cacheCalc.cacheCreationTokens,
        cacheReadTokens: cacheCalc.cacheReadTokens,
        cost: cost2.totalCost,
        responseTime: Date.now() - startTime,
        success: true
      })

      return { success: true, response }
    } catch (error) {
      this.recordRequestFailed()
      this.accountPool.recordError(account.id, false)

      this.events.onResponse?.({
        path: '/v1/messages',
        model: request.model,
        status: 500,
        error: (error as Error).message
      })

      return { success: false, error: (error as Error).message }
    }
  }

  // ============ Claude 流式处理 ============

  async handleClaudeStreamRequest(
    request: ClaudeRequest,
    callbacks: {
      onChunk: (chunk: string) => void
      onComplete: () => void
      onError: (error: Error) => void
    },
    headers?: Record<string, string>,
    matchedApiKey?: ApiKey,
    boundAccountIds?: string[]
  ): Promise<void> {
    this.recordNewRequest()
    this.events.onRequest?.({ path: '/v1/messages', method: 'POST' })

    // Sticky Session: try routing to bound account
    const sessionHash = computeSessionHash(request, headers?.['x-session-id'])
    let account: ProxyAccount | null = null

    if (sessionHash) {
      const stickyAccountId = await getSessionAccount(sessionHash)
      if (stickyAccountId) {
        // 如果 API Key 绑定了账号，sticky session 账号必须在绑定列表中
        const inBoundList = !boundAccountIds || boundAccountIds.length === 0 || boundAccountIds.includes(stickyAccountId)
        if (inBoundList) {
          account = this.accountPool.getAccountIfAvailable(stickyAccountId)
        }
      }
    }
    if (!account) {
      account = await this.getAvailableAccount(boundAccountIds)
    }
    if (!account) {
      this.recordRequestFailed()
      callbacks.onError(new Error('No available accounts'))
      return
    }

    const startTime = Date.now()

    // 检查是否为 WebSearch 请求，完全绕过 Kiro generateAssistantResponse
    if (hasWebSearchTool(request)) {
      logger.info('WebSearch tool detected, routing to WebSearch handler')
      try {
        await handleWebSearchStream(request, account, callbacks, matchedApiKey)
      } catch (error) {
        callbacks.onError(error as Error)
      }
      return
    }

    // 检查是否启用 Thinking 模式
    const modelThinkingEnabled = this.config.modelThinkingMode?.[request.model]
    const headerThinking = headers?.['anthropic-beta']?.toLowerCase().includes('thinking')
    const requestThinking = request.thinking?.type === 'enabled'
    const thinkingEnabled = modelThinkingEnabled || headerThinking || requestThinking

    try {
      let kiroPayload = claudeToKiro(request, account.profileArn)

      // 注入 thinking 提示到系统消息位置（payload 第一条 history user 消息前）
      if (thinkingEnabled) {
        const thinkingPrompt = `<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>${request.thinking?.budget_tokens || 200000}</max_thinking_length>`
        const history = kiroPayload.conversationState?.history
        if (history && history.length > 0 && history[0].userInputMessage) {
          const content = history[0].userInputMessage.content
          if (typeof content === 'string' && !content.includes('<thinking_mode>')) {
            history[0].userInputMessage.content = thinkingPrompt + '\n\n' + content
          }
        } else {
          // 没有 history，注入到 currentMessage
          const currentMessage = kiroPayload.conversationState?.currentMessage?.userInputMessage
          if (currentMessage && typeof currentMessage.content === 'string' && !currentMessage.content.includes('<thinking_mode>')) {
            currentMessage.content = thinkingPrompt + '\n\n' + currentMessage.content
          }
        }
        logger.info('Thinking mode enabled for Claude request')
      }

      // Calculate cache ratio before the API call
      const cacheRatio = await calculateCacheRatio(account.id, request)

      await this.handleClaudeStream(
        callbacks,
        account,
        kiroPayload,
        request.model,
        startTime,
        0,
        undefined,
        false,
        0,
        matchedApiKey,
        cacheRatio,
        sessionHash
      )

      callbacks.onComplete()
    } catch (error) {
      this.events.onResponse?.({
        path: '/v1/messages',
        model: request.model,
        status: 500,
        error: (error as Error).message
      })

      callbacks.onError(error as Error)
    }
  }

  // Claude 流式处理核心（支持自动继续）
  private async handleClaudeStream(
    callbacks: {
      onChunk: (chunk: string) => void
      onComplete: () => void
      onError: (error: Error) => void
    },
    account: ProxyAccount,
    kiroPayload: KiroPayload,
    model: string,
    startTime: number,
    currentRound: number = 0,
    msgId?: string,
    _headersSent: boolean = false,
    contentBlockIndex: number = 0,
    matchedApiKey?: ApiKey,
    cacheRatio?: CacheRatio | null,
    sessionHash?: string | null
  ): Promise<void> {
    const id = msgId || `msg_${uuidv4()}`
    let currentBlockIndex = contentBlockIndex
    let hasStartedTextBlock = false
    let collectedContent = ''
    const pendingToolCalls: Map<string, { name: string; input: Record<string, unknown> }> = new Map()

    // Thinking 块状态
    let hasStartedThinkingBlock = false
    let thinkingBlockIndex = -1

    // 用于检测 <thinking> 标签（prompt 注入模式下的文本解析）
    let textBuffer = ''
    let inThinkingTagBlock = false

    // 估算输入 tokens（基于 payload 大小）
    const estimatedInputTokens = Math.max(1, Math.round(JSON.stringify(kiroPayload).length / 3))

    // 关闭 thinking 块的辅助函数
    const closeThinkingBlock = () => {
      if (!hasStartedThinkingBlock) return
      // 发送空 thinking_delta 作为关闭信号
      const emptyDelta = createClaudeStreamEvent('content_block_delta', {
        index: thinkingBlockIndex,
        delta: { type: 'thinking_delta', thinking: '' }
      })
      callbacks.onChunk(`event: content_block_delta\ndata: ${JSON.stringify(emptyDelta)}\n\n`)
      // 发送 content_block_stop
      const blockStop = createClaudeStreamEvent('content_block_stop', { index: thinkingBlockIndex })
      callbacks.onChunk(`event: content_block_stop\ndata: ${JSON.stringify(blockStop)}\n\n`)
      currentBlockIndex++
      hasStartedThinkingBlock = false
    }

    // 发送 thinking 内容的辅助函数
    const sendThinkingDelta = (thinkingText: string) => {
      if (!hasStartedThinkingBlock) {
        // 先关闭 text 块（如果有）
        if (hasStartedTextBlock) {
          const blockStop = createClaudeStreamEvent('content_block_stop', { index: currentBlockIndex })
          callbacks.onChunk(`event: content_block_stop\ndata: ${JSON.stringify(blockStop)}\n\n`)
          currentBlockIndex++
          hasStartedTextBlock = false
        }
        // 开始 thinking 块
        thinkingBlockIndex = currentBlockIndex
        const blockStart = createClaudeStreamEvent('content_block_start', {
          index: thinkingBlockIndex,
          content_block: { type: 'thinking', thinking: '' }
        })
        callbacks.onChunk(`event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`)
        hasStartedThinkingBlock = true
      }
      if (thinkingText) {
        const delta = createClaudeStreamEvent('content_block_delta', {
          index: thinkingBlockIndex,
          delta: { type: 'thinking_delta', thinking: thinkingText }
        })
        callbacks.onChunk(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`)
      }
    }

    // 发送 text 内容的辅助函数
    const sendTextDelta = (text: string) => {
      if (!text) return
      // 先关闭 thinking 块（如果有）
      if (hasStartedThinkingBlock) {
        closeThinkingBlock()
      }
      collectedContent += text
      if (!hasStartedTextBlock) {
        const blockStart = createClaudeStreamEvent('content_block_start', {
          index: currentBlockIndex,
          content_block: { type: 'text', text: '' }
        })
        callbacks.onChunk(`event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`)
        hasStartedTextBlock = true
      }
      const delta = createClaudeStreamEvent('content_block_delta', {
        index: currentBlockIndex,
        delta: { type: 'text_delta', text }
      })
      callbacks.onChunk(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`)
    }

    // 处理文本输出，检测并转换 <thinking> 标签
    const processClaudeText = (text: string, forceFlush = false) => {
      textBuffer += text

      while (true) {
        if (!inThinkingTagBlock) {
          const thinkingStart = textBuffer.indexOf('<thinking>')
          if (thinkingStart !== -1) {
            // 输出 <thinking> 之前的内容作为 text
            if (thinkingStart > 0) {
              sendTextDelta(textBuffer.substring(0, thinkingStart))
            }
            textBuffer = textBuffer.substring(thinkingStart + 10)
            inThinkingTagBlock = true
          } else if (forceFlush || textBuffer.length > 50) {
            // 保留末尾可能是部分 <thinking> 标签的内容
            const safeLength = forceFlush ? textBuffer.length : Math.max(0, textBuffer.length - 15)
            if (safeLength > 0) {
              sendTextDelta(textBuffer.substring(0, safeLength))
              textBuffer = textBuffer.substring(safeLength)
            }
            break
          } else {
            break
          }
        } else {
          const thinkingEnd = textBuffer.indexOf('</thinking>')
          if (thinkingEnd !== -1) {
            // 提取 thinking 内容，发送为 thinking_delta
            const thinkingContent = textBuffer.substring(0, thinkingEnd)
            if (thinkingContent) {
              sendThinkingDelta(thinkingContent)
            }
            // 关闭 thinking 块
            closeThinkingBlock()
            textBuffer = textBuffer.substring(thinkingEnd + 11)
            inThinkingTagBlock = false
          } else if (forceFlush && textBuffer) {
            // 流结束但 thinking 未闭合，flush 剩余内容
            sendThinkingDelta(textBuffer)
            closeThinkingBlock()
            textBuffer = ''
            inThinkingTagBlock = false
            break
          } else {
            // 保留末尾可能是部分 </thinking> 标签的内容，其余作为 thinking_delta 发送
            const safeLength = Math.max(0, textBuffer.length - 15)
            if (safeLength > 0) {
              sendThinkingDelta(textBuffer.substring(0, safeLength))
              textBuffer = textBuffer.substring(safeLength)
            }
            break
          }
        }
      }
    }

    // 发送 message_start（仅首轮）
    if (currentRound === 0) {
      const messageStart = createClaudeStreamEvent('message_start', {
        message: {
          id,
          type: 'message',
          role: 'assistant',
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: estimatedInputTokens,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0
          }
        }
      })
      callbacks.onChunk(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`)
    }

    return new Promise((resolve, reject) => {
      callKiroApiStream(
        account,
        kiroPayload,
        (text, toolUse, isThinking) => {
          if (text) {
            if (isThinking) {
              // reasoningContentEvent: 作为 thinking content block 发送
              sendThinkingDelta(text)
            } else {
              processClaudeText(text)
            }
          }
          if (toolUse) {
            // 先关闭 thinking 块（如果有）
            if (hasStartedThinkingBlock) {
              closeThinkingBlock()
            }
            // 刷新文本缓冲区
            if (textBuffer) {
              processClaudeText('', true)
            }
            // 结束之前的文本块
            if (hasStartedTextBlock) {
              const blockStop = createClaudeStreamEvent('content_block_stop', { index: currentBlockIndex })
              callbacks.onChunk(`event: content_block_stop\ndata: ${JSON.stringify(blockStop)}\n\n`)
              currentBlockIndex++
              hasStartedTextBlock = false
            }
            // 记录工具调用
            pendingToolCalls.set(toolUse.toolUseId, { name: toolUse.name, input: toolUse.input })
            // 开始工具块
            const toolBlockStart = createClaudeStreamEvent('content_block_start', {
              index: currentBlockIndex,
              content_block: { type: 'tool_use', id: toolUse.toolUseId, name: toolUse.name, input: {} }
            })
            callbacks.onChunk(`event: content_block_start\ndata: ${JSON.stringify(toolBlockStart)}\n\n`)
            // 发送工具输入
            const toolDelta = createClaudeStreamEvent('content_block_delta', {
              index: currentBlockIndex,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              delta: { type: 'input_json_delta', partial_json: JSON.stringify(toolUse.input) } as any
            })
            callbacks.onChunk(`event: content_block_delta\ndata: ${JSON.stringify(toolDelta)}\n\n`)
            // 结束工具块
            const toolBlockStop = createClaudeStreamEvent('content_block_stop', { index: currentBlockIndex })
            callbacks.onChunk(`event: content_block_stop\ndata: ${JSON.stringify(toolBlockStop)}\n\n`)
            currentBlockIndex++
          }
        },
        async (usage) => {
          // 刷新缓冲区
          processClaudeText('', true)

          // 关闭 thinking 块（如果还在）
          if (hasStartedThinkingBlock) {
            closeThinkingBlock()
          }

          // 结束最后的文本块
          if (hasStartedTextBlock) {
            const blockStop = createClaudeStreamEvent('content_block_stop', { index: currentBlockIndex })
            callbacks.onChunk(`event: content_block_stop\ndata: ${JSON.stringify(blockStop)}\n\n`)
            currentBlockIndex++
          }

          this.recordRequestSuccess()
          this.stats.totalTokens += usage.inputTokens + usage.outputTokens
          this.stats.inputTokens += usage.inputTokens
          this.stats.outputTokens += usage.outputTokens
          this.stats.totalCredits += usage.credits || 0
          this.accountPool.recordSuccess(account.id, usage.inputTokens + usage.outputTokens)

          // Split tokens by cache ratio (only when ratio was calculated in first round)
          let cacheCalc: CacheCalculation | null = null
          if (cacheRatio) {
            cacheCalc = splitTokensByRatio(cacheRatio, usage.inputTokens)
            this.stats.cacheCreationTokens += cacheCalc.cacheCreationTokens
            this.stats.cacheReadTokens += cacheCalc.cacheReadTokens
          }

          // Bind Sticky Session
          if (sessionHash) {
            setSessionAccount(sessionHash, account.id).catch(() => {})
          }

          this.events.onResponse?.({
            path: '/v1/messages',
            model,
            status: 200,
            tokens: usage.inputTokens + usage.outputTokens,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            credits: usage.credits
          })

          const costStream2 = calculateCost(
            model,
            cacheCalc ? cacheCalc.totalInputTokens : usage.inputTokens,
            usage.outputTokens,
            cacheCalc?.cacheCreationTokens ?? (usage.cacheWriteTokens || 0),
            cacheCalc?.cacheReadTokens ?? (usage.cacheReadTokens || 0)
          )
          this.recordRequest({
            path: '/v1/messages',
            model,
            accountId: account.id,
            machineId: account.machineId,
            inputTokens: cacheCalc?.uncachedTokens ?? usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheCreationTokens: cacheCalc?.cacheCreationTokens ?? (usage.cacheWriteTokens || 0),
            cacheReadTokens: cacheCalc?.cacheReadTokens ?? (usage.cacheReadTokens || 0),
            cost: costStream2.totalCost,
            credits: usage.credits,
            responseTime: Date.now() - startTime,
            success: true
          })

          statsStore.updateGlobalStats(
            true,
            usage.inputTokens,
            usage.outputTokens,
            usage.credits || 0,
            costStream2.totalCost,
            cacheCalc?.cacheCreationTokens ?? 0,
            cacheCalc?.cacheReadTokens ?? 0
          ).catch(err => {
            logger.error('Failed to persist global stats', { error: (err as Error).message })
          })

          // Update daily stats
          const today = new Date().toISOString().split('T')[0]

          // 更新全局日统计
          await dailyStatsStore.updateDailyGlobalStats(
            today,
            true,
            usage.inputTokens,
            usage.outputTokens,
            usage.credits || 0,
            costStream2.totalCost,
            cacheCalc?.cacheCreationTokens ?? 0,
            cacheCalc?.cacheReadTokens ?? 0
          ).catch(err => {
            logger.error('Failed to persist daily global stats', { error: (err as Error).message })
          })

          // 更新账号日统计
          await dailyStatsStore.updateDailyAccountStats(
            account.id,
            today,
            true,
            usage.inputTokens,
            usage.outputTokens,
            Date.now() - startTime,
            costStream2.totalCost,
            cacheCalc?.cacheCreationTokens ?? 0,
            cacheCalc?.cacheReadTokens ?? 0
          ).catch(err => {
            logger.error('Failed to persist daily account stats', { error: (err as Error).message })
          })

          // 更新模型日统计
          await dailyStatsStore.updateDailyModelStats(
            model,
            today,
            usage.inputTokens,
            usage.outputTokens,
            costStream2.totalCost
          ).catch(err => {
            logger.error('Failed to persist daily model stats', { error: (err as Error).message })
          })

          if (matchedApiKey) {
            this.recordApiKeyUsage(matchedApiKey.id, usage.credits || 0, usage.inputTokens, usage.outputTokens, costStream2.totalCost, model, '/v1/messages')
          }

          // 检查是否需要自动继续
          const maxRounds = this.config.autoContinueRounds || 0
          const hasToolCalls = pendingToolCalls.size > 0
          const shouldContinue = hasToolCalls && maxRounds > 0 && currentRound < maxRounds

          if (shouldContinue) {
            logger.info(`Claude auto-continue round ${currentRound + 1}/${maxRounds}`)

            // 构造继续请求
            const toolResults = Array.from(pendingToolCalls.entries()).map(([toolId]) => ({
              toolUseId: toolId,
              content: [{ text: 'Done. Continue with the next step.' }],
              status: 'success' as const
            }))

            const originalMsg = kiroPayload.conversationState?.currentMessage?.userInputMessage
            const modelId = originalMsg?.modelId || 'claude-sonnet-4.5'
            const origin = originalMsg?.origin || 'AI_EDITOR'

            const continuePayload: KiroPayload = {
              ...kiroPayload,
              conversationState: {
                ...kiroPayload.conversationState,
                currentMessage: {
                  userInputMessage: {
                    content: 'Continue.',
                    userInputMessageContext: { toolResults },
                    modelId,
                    origin
                  }
                },
                history: [
                  ...(kiroPayload.conversationState?.history || []),
                  {
                    assistantResponseMessage: {
                      content: collectedContent || 'I will continue with the task.',
                      toolUses: pendingToolCalls.size > 0
                        ? Array.from(pendingToolCalls.entries()).map(([toolId, toolData]) => ({
                            toolUseId: toolId,
                            name: toolData.name,
                            input: toolData.input
                          }))
                        : undefined
                    }
                  }
                ]
              }
            }

            try {
              await this.handleClaudeStream(
                callbacks,
                account,
                continuePayload,
                model,
                startTime,
                currentRound + 1,
                id,
                true,
                currentBlockIndex,
                matchedApiKey,
                null,          // don't recalculate cache ratio in auto-continue
                sessionHash    // keep session hash for binding
              )
            } catch (error) {
              logger.error('Claude auto-continue error', { error: (error as Error).message })
            }
            resolve()
          } else {
            // 发送 message_delta
            const stopReason = hasToolCalls ? 'tool_use' : 'end_turn'
            // 获取缓存 token 数据（优先使用 cacheCalc，否则使用 usage 中的原始数据）
            const cacheWriteTokens = cacheCalc?.cacheCreationTokens ?? (usage.cacheWriteTokens || 0)
            const cacheReadTokens = cacheCalc?.cacheReadTokens ?? (usage.cacheReadTokens || 0)
            const messageDelta = createClaudeStreamEvent('message_delta', {
              delta: { stop_reason: stopReason, stop_sequence: null },
              usage: {
                input_tokens: usage.inputTokens,
                output_tokens: usage.outputTokens,
                cache_creation_input_tokens: cacheWriteTokens,
                cache_read_input_tokens: cacheReadTokens,
                // 上游 API 格式的详细 cache 信息
                cache_creation: {
                  ephemeral_1h_input_tokens: 0,  // Kiro API 暂不区分，全部计入 5m
                  ephemeral_5m_input_tokens: cacheWriteTokens
                }
              }
            })
            callbacks.onChunk(`event: message_delta\ndata: ${JSON.stringify(messageDelta)}\n\n`)
            // 发送 message_stop
            const messageStop = createClaudeStreamEvent('message_stop')
            callbacks.onChunk(`event: message_stop\ndata: ${JSON.stringify(messageStop)}\n\n`)
            resolve()
          }
        },
        (error) => {
          logger.error('Claude stream error', { error: error.message })
          const errorEvent = createClaudeStreamEvent('error', {
            error: { type: 'api_error', message: error.message }
          })
          callbacks.onChunk(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`)

          this.recordRequestFailed()
          this.accountPool.recordError(account.id, error.message.includes('429'))
          reject(error)
        }
      )
    })
  }
}
