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
import { KiroApiError } from './types.js'
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
import * as accountStore from '../storage/accountStore.js'
import * as dailyStatsStore from '../storage/dailyStatsStore.js'
import * as apiKeyStore from '../storage/apiKeyStore.js'
import { calculateCost } from './pricing.js'
import { calculateCacheRatio, splitTokensByRatio, estimateUserOnlyTokens, estimateRequestWeight, extractUserInputText } from './cacheTracker.js'
import type { CacheRatio, CacheCalculation } from './cacheTracker.js'
import { computeSessionHash, getSessionAccount, setSessionAccount } from './sessionCache.js'
import { RequestQueue } from './requestQueue.js'

const logger = createLogger('ProxyServer')

// 计费 token 上限
const MAX_BILLING_TOKENS_200K = 200000
const MAX_BILLING_TOKENS_1M = 1000000

/**
 * 判断是否为 1M 上下文模型
 */
function is1MModel(model: string): boolean {
  return /1m/i.test(model)
}

/**
 * 限制计费 token 不超过模型上限
 * 1M 模型上限 1000000，其他模型上限 200000
 * 超出时返回上限 75%-99.5% 之间的随机值
 */
function capBillingTokens(tokens: number, model: string): number {
  const max = is1MModel(model) ? MAX_BILLING_TOKENS_1M : MAX_BILLING_TOKENS_200K
  if (tokens <= max) return tokens
  return Math.floor(max * (0.75 + Math.random() * 0.245))
}

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

export interface InflightRequest {
  id: string
  startTime: number
  model: string
}

export class ProxyServer {
  private config: ProxyConfig
  private accountPool: AccountPool
  private stats: ProxyStats
  private events: ProxyServerEvents
  private refreshingTokens: Set<string> = new Set()
  private apiKeys: Map<string, ApiKey> = new Map()
  private requestQueue: RequestQueue
  private inflightRequests: Map<string, InflightRequest> = new Map()

  constructor(config: Partial<ProxyConfig> = {}, events: ProxyServerEvents = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.accountPool = new AccountPool()
    this.events = events
    this.stats = this.initStats()
    this.requestQueue = new RequestQueue(this.config.maxConcurrent, {
      enabled: this.config.queueEnabled,
      maxSize: this.config.queueMaxSize,
      timeoutMs: this.config.queueTimeoutMs
    })
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
    this.requestQueue.updateConfig(this.config.maxConcurrent, {
      enabled: this.config.queueEnabled,
      maxSize: this.config.queueMaxSize,
      timeoutMs: this.config.queueTimeoutMs
    })
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
        this.accountPool.setStatus(account.id, 'active')
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

  // ============ 统一账号调度 ============

  /**
   * 统一账号选择器
   * 优先级：粘性会话 → 绑定账号子集(LRU+并发) → 全局共享池(LRU+并发)
   * 同时处理 region 兜底和 Token 刷新
   */
  async selectAccount(
    sessionHash?: string | null,
    boundAccountIds?: string[]
  ): Promise<ProxyAccount | null> {
    let account: ProxyAccount | null = null

    // 1. 粘性会话绑定
    if (sessionHash) {
      const stickyAccountId = await getSessionAccount(sessionHash)
      if (stickyAccountId) {
        const inBoundList = !boundAccountIds || boundAccountIds.length === 0 || boundAccountIds.includes(stickyAccountId)
        if (inBoundList) {
          account = this.accountPool.getAccountIfAvailable(stickyAccountId)
          if (account) {
            logger.debug('Using sticky session account', { accountId: account.id })
          }
        }
      }
    }

    // 2. 从绑定账号子集或全局池中选择（LRU + 并发感知）
    if (!account) {
      if (boundAccountIds && boundAccountIds.length > 0) {
        account = this.accountPool.getNextAccountFromSubset(boundAccountIds)
      } else {
        account = this.accountPool.getNextAccount()
      }
    }

    if (!account) {
      logger.warn('No available accounts', {
        bound: boundAccountIds?.length ?? 0
      })
      return null
    }

    // 3. Region 兜底
    if (!account.region && this.config.defaultRegion) {
      account = { ...account, region: this.config.defaultRegion }
    }

    // 4. Token 刷新检查
    if (this.isTokenExpiringSoon(account) || needsTokenRefresh(account)) {
      logger.info('Token expiring soon, refreshing', { accountId: account.id })
      const refreshed = await this.refreshToken(account)
      if (!refreshed) {
        const nextAccount = this.accountPool.getNextAvailableAccount(account.id)
        if (nextAccount) {
          return nextAccount
        }
      }
      return this.accountPool.getAccount(account.id)
    }

    return account
  }

  // ============ 统计管理 ============

  getStats(): ProxyStats {
    return { ...this.stats }
  }

  /**
   * 获取所有正在进行中的请求（用于死锁检测）
   */
  getInflightRequests(): InflightRequest[] {
    return Array.from(this.inflightRequests.values())
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
      kiroCredits: log.kiroCredits,
      cacheCreationTokens: log.cacheCreationTokens,
      cacheReadTokens: log.cacheReadTokens,
      cost: log.cost,
      responseTime: log.responseTime || 0,
      success: log.success ?? true,
      error: log.error,
      auxiliary: log.auxiliary,
      userInput: log.userInput
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

  /**
   * 检测主题检测请求（haiku + 无工具 = Claude Code 生成对话标题）
   * 这类请求完全跳过：不计费、不记录日志
   */
  private isTopicDetection(request: ClaudeRequest): boolean {
    return (!request.tools || request.tools.length === 0) && /haiku/i.test(request.model)
  }

  /**
   * 根据网关配置对请求做轻量裁剪（如禁用 tools）
   */
  private getEffectiveRequest(request: ClaudeRequest): ClaudeRequest {
    if (!this.config.disableTools || !request.tools || request.tools.length === 0) {
      return request
    }

    logger.info('Tools disabled by config, stripping tools from request', {
      model: request.model,
      originalToolsCount: request.tools.length
    })

    return {
      ...request,
      // tools: undefined,
      // tool_choice: undefined
    }
  }

  // ============ 重试机制 ============

  /**
   * 获取错误对应的冷却时间（毫秒）
   */
  private getErrorCooldownMs(error: Error): number {
    if (error instanceof KiroApiError) {
      switch (error.errorCode) {
        case 'QUOTA_EXHAUSTED':
          return this.config.errorCooldown429 ?? 60000
        case 'OVERLOADED':
          return this.config.errorCooldown529 ?? 120000
        case 'SERVER_ERROR':
          return this.config.errorCooldown5xx ?? 15000
        default:
          return 0
      }
    }
    // Fallback for plain Error: check message
    const msg = error.message
    if (msg.includes('429') || msg.includes('quota')) return this.config.errorCooldown429 ?? 60000
    if (msg.includes('529') || msg.includes('overloaded')) return this.config.errorCooldown529 ?? 120000
    if (msg.includes('500') || msg.includes('502') || msg.includes('503')) return this.config.errorCooldown5xx ?? 15000
    return 0
  }

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

        // 402: 月度用量耗尽，自动暂停并切换账号
        if (errorMsg.includes('402') || errorMsg.includes('MONTHLY_REQUEST_COUNT')) {
          this.accountPool.setStatus(currentAccount.id, 'paused')
          accountStore.updateAccount(currentAccount.id, { status: 'paused' }).catch(() => {})
          logger.warn('Account auto-paused due to monthly limit', { accountId: currentAccount.id })
          const nextAccount = this.accountPool.getNextAvailableAccount(currentAccount.id)
          if (nextAccount) {
            currentAccount = nextAccount
            continue
          }
          break
        }

        // 检测账号被封禁（TEMPORARILY_SUSPENDED）
        if (errorMsg.includes('TEMPORARILY_SUSPENDED') || errorMsg.includes('temporarily is suspended')) {
          this.accountPool.setStatus(currentAccount.id, 'suspended')
          accountStore.updateAccount(currentAccount.id, { status: 'suspended' }).catch(() => {})
          logger.warn('Account suspended (banned by Kiro), switching account', { accountId: currentAccount.id })
          const nextAccount = this.accountPool.getNextAvailableAccount(currentAccount.id)
          if (nextAccount) {
            currentAccount = nextAccount
            continue
          }
          break
        }

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
          const cooldownMs = this.getErrorCooldownMs(lastError!)
          this.accountPool.recordErrorWithType(currentAccount.id, 'QUOTA_EXHAUSTED', cooldownMs)

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

        // 529: 服务过载，较长退避 + jitter
        if (errorMsg.includes('529') || errorMsg.includes('overloaded')) {
          const cooldownMs529 = this.getErrorCooldownMs(lastError!)
          this.accountPool.recordErrorWithType(currentAccount.id, 'OVERLOADED', cooldownMs529)
          const baseDelay = this.config.retryDelayMs * Math.pow(2, attempt + 2)  // start higher for overload
          const jitter = baseDelay * (0.8 + Math.random() * 0.4)
          await new Promise(resolve => setTimeout(resolve, jitter))

          // Try switching to a different account for overload
          const nextAccount = this.accountPool.getNextAvailableAccount(currentAccount.id)
          if (nextAccount) {
            currentAccount = nextAccount
          }
          continue
        }

        // 5xx: 服务器错误，指数退避 + jitter 重试
        if (errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503')) {
          const baseDelay = this.config.retryDelayMs * Math.pow(2, attempt)
          const jitter = baseDelay * (0.8 + Math.random() * 0.4)  // ±20% jitter
          await new Promise(resolve => setTimeout(resolve, jitter))
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
    boundAccountIds?: string[],
    signal?: AbortSignal
  ): Promise<{ success: boolean; response?: unknown; error?: string }> {
    let release: (() => void) | undefined
    const reqId = uuidv4()
    try {
      release = await this.requestQueue.acquire(signal)
      this.inflightRequests.set(reqId, {
        id: reqId,
        startTime: Date.now(),
        model: request.model || 'unknown',
      })
      return await this._handleClaudeRequest(request, _headers, boundAccountIds, signal)
    } catch (error) {
      if (!release) {
        // Queue full or timeout — not yet acquired
        return { success: false, error: (error as Error).message }
      }
      throw error
    } finally {
      this.inflightRequests.delete(reqId)
      release?.()
    }
  }

  private async _handleClaudeRequest(
    request: ClaudeRequest,
    _headers?: Record<string, string>,
    boundAccountIds?: string[],
    signal?: AbortSignal
  ): Promise<{ success: boolean; response?: unknown; error?: string }> {
    this.recordNewRequest()
    this.events.onRequest?.({ path: '/v1/messages', method: 'POST' })
    const effectiveRequest = this.getEffectiveRequest(request)

    // Debug: Log request structure
    logger.info('Incoming Claude request', {
      model: effectiveRequest.model,
      hasSystem: !!effectiveRequest.system,
      systemType: typeof effectiveRequest.system,
      systemLength: typeof effectiveRequest.system === 'string' ? effectiveRequest.system.length : Array.isArray(effectiveRequest.system) ? effectiveRequest.system.length : 0,
      hasTools: !!effectiveRequest.tools,
      toolsCount: effectiveRequest.tools?.length || 0,
      originalToolsCount: request.tools?.length || 0,
      toolsDisabled: !!this.config.disableTools,
      messageCount: effectiveRequest.messages.length
    })

    // 统一账号选择
    const sessionHash = computeSessionHash(effectiveRequest, _headers?.['x-session-id'])
    const account = await this.selectAccount(sessionHash, boundAccountIds)
    if (!account) {
      this.recordRequestFailed()
      return { success: false, error: 'No available accounts' }
    }

    // 追踪账号并发
    this.accountPool.incrementConcurrency(account.id)
    const startTime = Date.now()

    try {
      const buildPayload = (acc: ProxyAccount) => claudeToKiro(effectiveRequest, acc.profileArn)
      const { result, account: usedAccount } = await this.callWithRetry(
        account,
        async (acc) => callKiroApi(acc, buildPayload(acc), signal, this.config.preferredEndpoint),
        '/v1/messages'
      )

      // 统一使用 Claude 请求格式估算输入 token（system + tools + user messages）
      const selfInputTokens = estimateRequestWeight(effectiveRequest)
      // Calculate cache ratio (atomic check + write)
      const cacheRatio = await calculateCacheRatio(usedAccount.id, effectiveRequest)
      // Deterministic user-only tokens (no Redis dependency)
      const userOnlyTokens = estimateUserOnlyTokens(effectiveRequest)

      // 检测主题检测（haiku 无 tools）：完全跳过计费和日志
      const topicDetection = this.isTopicDetection(effectiveRequest)
      // 仅主题检测（haiku 无 tools）跳过计费和日志
      const skipBilling = topicDetection

      // 用自计算的 input tokens 做 cache 拆分，并限制不超过 200k
      const cacheCalc = splitTokensByRatio(cacheRatio, selfInputTokens)
      const uncachedInputTokens = capBillingTokens(userOnlyTokens ?? cacheCalc.uncachedTokens, effectiveRequest.model)
      const cacheWriteTokens = capBillingTokens(cacheCalc.cacheCreationTokens, effectiveRequest.model)
      const cacheReadTokens = capBillingTokens(cacheCalc.cacheReadTokens, effectiveRequest.model)
      const totalInputTokens = uncachedInputTokens + cacheWriteTokens + cacheReadTokens

      logger.info('=== INPUT TOKEN DEBUG (non-stream) ===', {
        selfInputTokens,
        userOnlyTokens,
        skipBilling,
        cacheRatio: {
          cacheCreationWeight: cacheRatio.cacheCreationWeight,
          cacheReadWeight: cacheRatio.cacheReadWeight,
          uncachedWeight: cacheRatio.uncachedWeight,
          totalWeight: cacheRatio.totalWeight
        },
        cacheCalc: {
          uncachedTokens: cacheCalc.uncachedTokens,
          cacheCreationTokens: cacheCalc.cacheCreationTokens,
          cacheReadTokens: cacheCalc.cacheReadTokens
        },
        finalInputTokens: uncachedInputTokens,
        finalTotal: totalInputTokens
      })
      // output tokens 由 kiroApi parseEventStream 自计算（tiktoken），限制不超过 200k
      const outputTokens = capBillingTokens(result.usage.outputTokens, effectiveRequest.model)
      const kiroCredits = result.usage.kiroCredits

      const response = kiroToClaudeResponse(
        result.content,
        result.toolUses,
        {
          inputTokens: uncachedInputTokens,
          outputTokens,
          cacheWriteTokens,
          cacheReadTokens
        },
        effectiveRequest.model
      )

      // 辅助请求：记录日志但跳过计费统计
      this.recordRequestSuccess()
      this.accountPool.recordSuccess(usedAccount.id, totalInputTokens + outputTokens)

      this.events.onResponse?.({
        path: '/v1/messages',
        model: effectiveRequest.model,
        status: 200,
        tokens: totalInputTokens + outputTokens,
        inputTokens: uncachedInputTokens,
        outputTokens
      })

      // Bind Sticky Session
      if (sessionHash) {
        setSessionAccount(sessionHash, usedAccount.id).catch(() => {})
      }

      // Cache-aware cost calculation（辅助请求 cost=0）
      const cost2 = skipBilling ? { totalCost: 0 } : calculateCost(
        effectiveRequest.model,
        totalInputTokens,
        outputTokens,
        cacheWriteTokens,
        cacheReadTokens
      )

      // 提取用户输入内容
      const userInput = extractUserInputText(effectiveRequest)

      // 主题检测请求不记录日志；其他辅助请求带 auxiliary 标记
      if (!topicDetection) {
        this.recordRequest({
          path: '/v1/messages',
          model: effectiveRequest.model,
          accountId: usedAccount.id,
          machineId: usedAccount.machineId,
          inputTokens: uncachedInputTokens,
          outputTokens,
          kiroCredits,
          cacheCreationTokens: cacheWriteTokens,
          cacheReadTokens,
          cost: cost2.totalCost,
          responseTime: Date.now() - startTime,
          success: true,
          auxiliary: false,
          userInput
        })
      }

      // 仅非辅助请求更新计费统计
      if (!skipBilling) {
        this.stats.totalTokens += totalInputTokens + outputTokens
        this.stats.inputTokens += uncachedInputTokens
        this.stats.outputTokens += outputTokens

        // Update memory stats
        this.stats.cacheCreationTokens += cacheWriteTokens
        this.stats.cacheReadTokens += cacheReadTokens

        // Persist to Redis
        statsStore.updateGlobalStats(
          true,
          uncachedInputTokens,
          outputTokens,
          0,
          cost2.totalCost,
          cacheWriteTokens,
          cacheReadTokens
        ).catch(err => {
          logger.error('Failed to persist global stats', { error: (err as Error).message })
        })

        // Update daily stats (fire-and-forget, 不阻塞响应)
        const today = new Date().toISOString().split('T')[0]

        Promise.all([
          dailyStatsStore.updateDailyGlobalStats(
            today, true, uncachedInputTokens, outputTokens, 0,
            cost2.totalCost, cacheWriteTokens, cacheReadTokens
          ),
          dailyStatsStore.updateDailyAccountStats(
            usedAccount.id, today, true, uncachedInputTokens, outputTokens,
            Date.now() - startTime, cost2.totalCost, cacheWriteTokens, cacheReadTokens
          ),
          dailyStatsStore.updateDailyModelStats(
            effectiveRequest.model, today, uncachedInputTokens, outputTokens, cost2.totalCost
          )
        ]).catch(err => {
          logger.error('Failed to persist daily stats', { error: (err as Error).message })
        })
      }

      return { success: true, response }
    } catch (error) {
      this.recordRequestFailed()
      this.accountPool.recordError(account.id, false)

      this.events.onResponse?.({
        path: '/v1/messages',
        model: effectiveRequest.model,
        status: 500,
        error: (error as Error).message
      })

      return { success: false, error: (error as Error).message }
    } finally {
      this.accountPool.decrementConcurrency(account.id)
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
    boundAccountIds?: string[],
    signal?: AbortSignal
  ): Promise<void> {
    let release: (() => void) | undefined
    const reqId = uuidv4()
    try {
      release = await this.requestQueue.acquire(signal)
      this.inflightRequests.set(reqId, {
        id: reqId,
        startTime: Date.now(),
        model: request.model || 'unknown',
      })
      await this._handleClaudeStreamRequest(request, callbacks, headers, matchedApiKey, boundAccountIds, signal)
    } catch (error) {
      if (!release) {
        // Queue full or timeout — not yet acquired
        callbacks.onError(error as Error)
        return
      }
      throw error
    } finally {
      this.inflightRequests.delete(reqId)
      release?.()
    }
  }

  private async _handleClaudeStreamRequest(
    request: ClaudeRequest,
    callbacks: {
      onChunk: (chunk: string) => void
      onComplete: () => void
      onError: (error: Error) => void
    },
    headers?: Record<string, string>,
    matchedApiKey?: ApiKey,
    boundAccountIds?: string[],
    signal?: AbortSignal
  ): Promise<void> {
    this.recordNewRequest()
    this.events.onRequest?.({ path: '/v1/messages', method: 'POST' })
    const effectiveRequest = this.getEffectiveRequest(request)

    // 统一账号选择
    const sessionHash = computeSessionHash(effectiveRequest, headers?.['x-session-id'])
    const account = await this.selectAccount(sessionHash, boundAccountIds)
    if (!account) {
      this.recordRequestFailed()
      callbacks.onError(new Error('No available accounts'))
      return
    }

    // 追踪账号并发
    this.accountPool.incrementConcurrency(account.id)
    const startTime = Date.now()

    // 检查是否为 WebSearch 请求，完全绕过 Kiro generateAssistantResponse
    if (hasWebSearchTool(effectiveRequest)) {
      logger.info('WebSearch tool detected, routing to WebSearch handler')
      try {
        await handleWebSearchStream(effectiveRequest, account, callbacks, matchedApiKey)
      } catch (error) {
        callbacks.onError(error as Error)
      } finally {
        this.accountPool.decrementConcurrency(account.id)
      }
      return
    }

    // 检查是否启用 Thinking 模式
    const modelThinkingEnabled = this.config.modelThinkingMode?.[effectiveRequest.model]
    const headerThinking = headers?.['anthropic-beta']?.toLowerCase().includes('thinking')
    const requestThinking = effectiveRequest.thinking?.type === 'enabled'
    const thinkingEnabled = modelThinkingEnabled || headerThinking || requestThinking

    try {
      let kiroPayload = claudeToKiro(effectiveRequest, account.profileArn)

      // 注入 thinking 提示到系统消息位置（payload 第一条 history user 消息前）
      if (thinkingEnabled) {
        const thinkingPrompt = `<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>${effectiveRequest.thinking?.budget_tokens || 200000}</max_thinking_length>`
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
      const cacheRatio = await calculateCacheRatio(account.id, effectiveRequest)
      const estimatedTotalInputTokens = estimateRequestWeight(effectiveRequest)
      // Deterministic user-only tokens (no Redis dependency)
      const userOnlyTokens = estimateUserOnlyTokens(effectiveRequest) ?? undefined
      // 提取用户输入内容
      const userInput = extractUserInputText(effectiveRequest)

      // 检测主题检测（haiku 无 tools）：完全跳过计费和日志
      const topicDetection = this.isTopicDetection(effectiveRequest)
      // 仅主题检测（haiku 无 tools）跳过计费和日志
      const skipBilling = topicDetection
      if (skipBilling) {
        logger.info('Auxiliary request detected, skipping billing', {
          model: effectiveRequest.model,
          topicDetection,
          messagesCount: effectiveRequest.messages.length,
          toolsCount: effectiveRequest.tools?.length || 0,
          userOnlyTokens
        })
      }

      // Debug: 关键排查日志
      const debugCacheCalc = splitTokensByRatio(cacheRatio, estimatedTotalInputTokens)
      logger.info('=== CACHE DEBUG (stream) ===', {
        model: effectiveRequest.model,
        hasSystem: !!effectiveRequest.system,
        systemType: typeof effectiveRequest.system,
        systemIsArray: Array.isArray(effectiveRequest.system),
        systemArrayLen: Array.isArray(effectiveRequest.system) ? effectiveRequest.system.length : 0,
        hasTools: !!effectiveRequest.tools,
        toolsCount: effectiveRequest.tools?.length || 0,
        originalToolsCount: request.tools?.length || 0,
        toolsDisabled: !!this.config.disableTools,
        messageCount: effectiveRequest.messages.length,
        cacheRatio: {
          cacheCreationWeight: cacheRatio.cacheCreationWeight,
          cacheReadWeight: cacheRatio.cacheReadWeight,
          uncachedWeight: cacheRatio.uncachedWeight,
          totalWeight: cacheRatio.totalWeight
        },
        estimatedTotalInputTokens,
        userOnlyTokens,
        split: {
          uncachedTokens: debugCacheCalc.uncachedTokens,
          cacheCreationTokens: debugCacheCalc.cacheCreationTokens,
          cacheReadTokens: debugCacheCalc.cacheReadTokens
        }
      })

      await this.handleClaudeStream(
        callbacks,
        account,
        kiroPayload,
        effectiveRequest.model,
        startTime,
        0,
        undefined,
        false,
        0,
        matchedApiKey,
        cacheRatio,
        sessionHash,
        estimatedTotalInputTokens,
        userOnlyTokens,
        skipBilling,
        userInput,
        topicDetection,
        signal
      )

      callbacks.onComplete()
    } catch (error) {
      this.events.onResponse?.({
        path: '/v1/messages',
        model: effectiveRequest.model,
        status: 500,
        error: (error as Error).message
      })

      callbacks.onError(error as Error)
    } finally {
      this.accountPool.decrementConcurrency(account.id)
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
    sessionHash?: string | null,
    estimatedTotalInputTokens?: number,
    userOnlyTokens?: number,
    skipBilling?: boolean,
    userInput?: string,
    skipRecording?: boolean,
    signal?: AbortSignal
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

    // 自计算输入 tokens（优先使用调用方已计算值，fallback 给 1 因为 splitTokensByRatio 仅在 totalWeight===0 时用）
    const estimatedInputTokens = estimatedTotalInputTokens ?? 1
    const estimatedCacheCalc = cacheRatio ? splitTokensByRatio(cacheRatio, estimatedInputTokens) : null

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
      logger.info('=== STREAM TOKEN DECISION (message_start) ===', {
        userOnlyTokens,
        estimatedCacheCalcUncached: estimatedCacheCalc?.uncachedTokens,
        estimatedInputTokens,
        chosen_input_tokens: userOnlyTokens ?? estimatedCacheCalc?.uncachedTokens ?? estimatedInputTokens,
        source: userOnlyTokens != null ? 'userOnlyTokens' : estimatedCacheCalc ? 'cacheCalc.uncachedTokens' : 'estimatedInputTokens'
      })
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
            input_tokens: capBillingTokens(userOnlyTokens ?? estimatedCacheCalc?.uncachedTokens ?? estimatedInputTokens, model),
            output_tokens: 0,
            cache_creation_input_tokens: capBillingTokens(estimatedCacheCalc?.cacheCreationTokens ?? 0, model),
            cache_read_input_tokens: capBillingTokens(estimatedCacheCalc?.cacheReadTokens ?? 0, model)
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

          // 自计算 token：input 使用预算值，output 由 kiroApi 自计算，限制不超过 200k
          const outputTokens = capBillingTokens(usage.outputTokens, model)
          const kiroCredits = usage.kiroCredits

          // 用自计算的 input tokens 做 cache 拆分，限制不超过模型上限
          let cacheCalc: CacheCalculation | null = null
          if (cacheRatio) {
            cacheCalc = splitTokensByRatio(cacheRatio, estimatedInputTokens)
            this.stats.cacheCreationTokens += capBillingTokens(cacheCalc.cacheCreationTokens, model)
            this.stats.cacheReadTokens += capBillingTokens(cacheCalc.cacheReadTokens, model)
          }
          const cacheWriteTokens = capBillingTokens(cacheCalc?.cacheCreationTokens ?? 0, model)
          const cacheReadTokens = capBillingTokens(cacheCalc?.cacheReadTokens ?? 0, model)
          const uncachedInputTokens = capBillingTokens(userOnlyTokens ?? cacheCalc?.uncachedTokens ?? estimatedInputTokens, model)
          const totalInputTokens = uncachedInputTokens + cacheWriteTokens + cacheReadTokens

          logger.info('=== STREAM TOKEN DECISION (completion) ===', {
            userOnlyTokens,
            cacheCalcUncachedTokens: cacheCalc?.uncachedTokens,
            estimatedInputTokens,
            uncachedInputTokens,
            cacheWriteTokens,
            cacheReadTokens,
            totalInputTokens,
            source: userOnlyTokens != null ? 'userOnlyTokens' : cacheCalc ? 'cacheCalc.uncachedTokens' : 'estimatedInputTokens'
          })

          // 辅助请求（主题检测、自动建议）：记录日志但跳过计费统计
          this.recordRequestSuccess()
          this.accountPool.recordSuccess(account.id, totalInputTokens + outputTokens)

          // Bind Sticky Session
          if (sessionHash) {
            setSessionAccount(sessionHash, account.id).catch(() => {})
          }

          this.events.onResponse?.({
            path: '/v1/messages',
            model,
            status: 200,
            tokens: totalInputTokens + outputTokens,
            inputTokens: uncachedInputTokens,
            outputTokens,
            credits: 0
          })

          const costStream2 = skipBilling ? { totalCost: 0 } : calculateCost(
            model,
            totalInputTokens,
            outputTokens,
            cacheWriteTokens,
            cacheReadTokens
          )

          // 主题检测请求不记录日志；其他辅助请求带 auxiliary 标记
          if (!skipRecording) {
            this.recordRequest({
              path: '/v1/messages',
              model,
              accountId: account.id,
              machineId: account.machineId,
              inputTokens: uncachedInputTokens,
              outputTokens,
              kiroCredits,
              cacheCreationTokens: cacheWriteTokens,
              cacheReadTokens,
              cost: costStream2.totalCost,
              credits: 0,
              responseTime: Date.now() - startTime,
              success: true,
              auxiliary: false,
              userInput
            })
          }

          // 仅非辅助请求更新计费统计
          if (!skipBilling) {
            this.stats.totalTokens += totalInputTokens + outputTokens
            this.stats.inputTokens += uncachedInputTokens
            this.stats.outputTokens += outputTokens
            this.stats.totalCredits += 0

            statsStore.updateGlobalStats(
              true,
              uncachedInputTokens,
              outputTokens,
              0,
              costStream2.totalCost,
              cacheWriteTokens,
              cacheReadTokens
            ).catch(err => {
              logger.error('Failed to persist global stats', { error: (err as Error).message })
            })

            // Update daily stats (fire-and-forget, 不阻塞流式响应)
            const today = new Date().toISOString().split('T')[0]

            Promise.all([
              dailyStatsStore.updateDailyGlobalStats(
                today, true, uncachedInputTokens, outputTokens, 0,
                costStream2.totalCost, cacheWriteTokens, cacheReadTokens
              ),
              dailyStatsStore.updateDailyAccountStats(
                account.id, today, true, uncachedInputTokens, outputTokens,
                Date.now() - startTime, costStream2.totalCost, cacheWriteTokens, cacheReadTokens
              ),
              dailyStatsStore.updateDailyModelStats(
                model, today, uncachedInputTokens, outputTokens, costStream2.totalCost
              )
            ]).catch(err => {
              logger.error('Failed to persist daily stats', { error: (err as Error).message })
            })

            if (matchedApiKey) {
              this.recordApiKeyUsage(matchedApiKey.id, 0, uncachedInputTokens, outputTokens, costStream2.totalCost, model, '/v1/messages')
            }
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
                sessionHash,   // keep session hash for binding
                undefined,     // estimatedTotalInputTokens
                undefined,     // userOnlyTokens
                skipBilling,   // preserve billing flag
                userInput,     // preserve user input
                skipRecording, // preserve recording flag
                signal         // propagate abort signal
              )
            } catch (error) {
              logger.error('Claude auto-continue error', { error: (error as Error).message })
            }
            resolve()
          } else {
            // 发送 message_delta（全部使用自计算的 token 值）
            const stopReason = hasToolCalls ? 'tool_use' : 'end_turn'
            const messageDelta = createClaudeStreamEvent('message_delta', {
              delta: { stop_reason: stopReason, stop_sequence: null },
              usage: {
                input_tokens: uncachedInputTokens,
                output_tokens: outputTokens,
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

          // 402 月度用量耗尽，自动暂停
          if (error.message.includes('402') || error.message.includes('MONTHLY_REQUEST_COUNT')) {
            this.accountPool.setStatus(account.id, 'paused')
            accountStore.updateAccount(account.id, { status: 'paused' }).catch(() => {})
            logger.warn('Account auto-paused due to monthly limit (stream)', { accountId: account.id })
          }

          const errorEvent = createClaudeStreamEvent('error', {
            error: { type: 'api_error', message: error.message }
          })
          callbacks.onChunk(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`)

          this.recordRequestFailed()
          this.accountPool.recordError(account.id, error.message.includes('429'))
          reject(error)
        },
        signal,
        this.config.preferredEndpoint
      )
    })
  }
}
