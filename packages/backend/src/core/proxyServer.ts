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
  OpenAIChatRequest,
  ClaudeRequest,
  KiroPayload,
  RequestLog
} from './types.js'
import { AccountPool } from './accountPool.js'
import {
  openaiToKiro,
  claudeToKiro,
  kiroToOpenaiResponse,
  kiroToClaudeResponse,
  createOpenaiStreamChunk,
  createClaudeStreamEvent
} from './translator.js'
import { callKiroApiStream, callKiroApi } from './kiroApi.js'
import { createLogger } from '../utils/logger.js'
import { refreshTokenByMethod, needsTokenRefresh } from './tokenRefresh.js'

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
    apiKey.lastUsedAt = Date.now()

    // 更新日统计
    if (!apiKey.usage.daily[today]) {
      apiKey.usage.daily[today] = { requests: 0, credits: 0, inputTokens: 0, outputTokens: 0 }
    }
    apiKey.usage.daily[today].requests++
    apiKey.usage.daily[today].credits += credits
    apiKey.usage.daily[today].inputTokens += inputTokens
    apiKey.usage.daily[today].outputTokens += outputTokens

    // 更新模型统计
    if (!apiKey.usage.byModel) apiKey.usage.byModel = {}
    if (!apiKey.usage.byModel[model]) {
      apiKey.usage.byModel[model] = { requests: 0, credits: 0, inputTokens: 0, outputTokens: 0 }
    }
    apiKey.usage.byModel[model].requests++
    apiKey.usage.byModel[model].credits += credits
    apiKey.usage.byModel[model].inputTokens += inputTokens
    apiKey.usage.byModel[model].outputTokens += outputTokens

    // 添加到用量历史
    if (!apiKey.usageHistory) apiKey.usageHistory = []
    apiKey.usageHistory.unshift({
      timestamp: Date.now(),
      model,
      inputTokens,
      outputTokens,
      credits,
      path
    })
    // 保留最近 100 条
    if (apiKey.usageHistory.length > 100) {
      apiKey.usageHistory = apiKey.usageHistory.slice(0, 100)
    }
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

  async getAvailableAccount(): Promise<ProxyAccount | null> {
    const account = this.accountPool.getNextAccount()
    if (!account) {
      logger.warn('No available accounts')
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
      inputTokens: log.inputTokens || 0,
      outputTokens: log.outputTokens || 0,
      credits: log.credits,
      responseTime: log.responseTime || 0,
      success: log.success ?? true,
      error: log.error
    }

    this.stats.recentRequests.unshift(requestLog)
    if (this.stats.recentRequests.length > 100) {
      this.stats.recentRequests = this.stats.recentRequests.slice(0, 100)
    }

    this.events.onStatsUpdate?.(this.stats)
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

  // ============ OpenAI 请求处理 ============

  async handleOpenAIRequest(
    request: OpenAIChatRequest,
    _headers?: Record<string, string>
  ): Promise<{ success: boolean; response?: unknown; error?: string }> {
    this.recordNewRequest()
    this.events.onRequest?.({ path: '/v1/chat/completions', method: 'POST' })

    const account = await this.getAvailableAccount()
    if (!account) {
      this.recordRequestFailed()
      return { success: false, error: 'No available accounts' }
    }

    const startTime = Date.now()

    try {

      const { result, account: usedAccount } = await this.callWithRetry(
        account,
        async (acc) => callKiroApi(acc, openaiToKiro(request, acc.profileArn)),
        '/v1/chat/completions'
      )

      const response = kiroToOpenaiResponse(result.content, result.toolUses, result.usage, request.model)

      this.recordRequestSuccess()
      this.stats.totalTokens += result.usage.inputTokens + result.usage.outputTokens
      this.stats.inputTokens += result.usage.inputTokens
      this.stats.outputTokens += result.usage.outputTokens
      this.accountPool.recordSuccess(usedAccount.id, result.usage.inputTokens + result.usage.outputTokens)

      this.events.onResponse?.({
        path: '/v1/chat/completions',
        model: request.model,
        status: 200,
        tokens: result.usage.inputTokens + result.usage.outputTokens,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens
      })

      this.recordRequest({
        path: '/v1/chat/completions',
        model: request.model,
        accountId: usedAccount.id,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        responseTime: Date.now() - startTime,
        success: true
      })

      return { success: true, response }
    } catch (error) {
      this.recordRequestFailed()
      this.accountPool.recordError(account.id, false)

      this.events.onResponse?.({
        path: '/v1/chat/completions',
        model: request.model,
        status: 500,
        error: (error as Error).message
      })

      this.recordRequest({
        path: '/v1/chat/completions',
        model: request.model,
        accountId: account.id,
        responseTime: Date.now() - startTime,
        success: false,
        error: (error as Error).message
      })

      return { success: false, error: (error as Error).message }
    }
  }

  // ============ Claude 请求处理 ============

  async handleClaudeRequest(
    request: ClaudeRequest,
    _headers?: Record<string, string>
  ): Promise<{ success: boolean; response?: unknown; error?: string }> {
    this.recordNewRequest()
    this.events.onRequest?.({ path: '/v1/messages', method: 'POST' })

    const account = await this.getAvailableAccount()
    if (!account) {
      this.recordRequestFailed()
      return { success: false, error: 'No available accounts' }
    }

    const startTime = Date.now()

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

      this.recordRequest({
        path: '/v1/messages',
        model: request.model,
        accountId: usedAccount.id,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
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

      this.recordRequest({
        path: '/v1/messages',
        model: request.model,
        accountId: account.id,
        responseTime: Date.now() - startTime,
        success: false,
        error: (error as Error).message
      })

      return { success: false, error: (error as Error).message }
    }
  }

  // ============ OpenAI 流式处理 ============

  async handleOpenAIStreamRequest(
    request: OpenAIChatRequest,
    callbacks: {
      onChunk: (chunk: string) => void
      onComplete: () => void
      onError: (error: Error) => void
    },
    headers?: Record<string, string>,
    matchedApiKey?: ApiKey
  ): Promise<void> {
    this.recordNewRequest()
    this.events.onRequest?.({ path: '/v1/chat/completions', method: 'POST' })

    const account = await this.getAvailableAccount()
    if (!account) {
      this.recordRequestFailed()
      callbacks.onError(new Error('No available accounts'))
      return
    }

    const startTime = Date.now()
    const id = `chatcmpl-${uuidv4()}`
    const format = this.config.thinkingOutputFormat || 'thinking'

    // 检查是否启用 Thinking 模式
    const modelThinkingEnabled = this.config.modelThinkingMode?.[request.model]
    const headerThinking = headers?.['anthropic-beta']?.toLowerCase().includes('thinking')
    const thinkingEnabled = modelThinkingEnabled || headerThinking

    // 用于检测 <thinking> 标签
    let textBuffer = ''
    let inThinkingBlock = false
    let hasLoggedThinkingFormat = false
    let hasStartedContent = false
    let collectedContent = ''
    const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map()

    // 处理文本输出，检测并转换 <thinking> 标签
    const processText = (text: string, forceFlush = false) => {
      textBuffer += text

      while (true) {
        if (!inThinkingBlock) {
          const thinkingStart = textBuffer.indexOf('<thinking>')
          if (thinkingStart !== -1) {
            // 输出 thinking 标签之前的内容
            if (thinkingStart > 0) {
              const beforeThinking = textBuffer.substring(0, thinkingStart)
              collectedContent += beforeThinking
              if (!hasStartedContent) {
                const roleChunk = createOpenaiStreamChunk(id, request.model, { role: 'assistant' })
                callbacks.onChunk(`data: ${JSON.stringify(roleChunk)}\n\n`)
                hasStartedContent = true
              }
              const contentChunk = createOpenaiStreamChunk(id, request.model, { content: beforeThinking })
              callbacks.onChunk(`data: ${JSON.stringify(contentChunk)}\n\n`)
            }
            textBuffer = textBuffer.substring(thinkingStart + 10)
            inThinkingBlock = true
            if (!hasLoggedThinkingFormat) {
              logger.info('Detected <thinking> tag', { format })
              hasLoggedThinkingFormat = true
            }
          } else if (forceFlush || textBuffer.length > 50) {
            const safeLength = forceFlush ? textBuffer.length : Math.max(0, textBuffer.length - 15)
            if (safeLength > 0) {
              const safeText = textBuffer.substring(0, safeLength)
              collectedContent += safeText
              if (!hasStartedContent) {
                const roleChunk = createOpenaiStreamChunk(id, request.model, { role: 'assistant' })
                callbacks.onChunk(`data: ${JSON.stringify(roleChunk)}\n\n`)
                hasStartedContent = true
              }
              const contentChunk = createOpenaiStreamChunk(id, request.model, { content: safeText })
              callbacks.onChunk(`data: ${JSON.stringify(contentChunk)}\n\n`)
              textBuffer = textBuffer.substring(safeLength)
            }
            break
          } else {
            break
          }
        } else {
          const thinkingEnd = textBuffer.indexOf('</thinking>')
          if (thinkingEnd !== -1) {
            const thinkingContent = textBuffer.substring(0, thinkingEnd)
            if (thinkingContent && (format === 'thinking' || format === 'think')) {
              if (!hasStartedContent) {
                const roleChunk = createOpenaiStreamChunk(id, request.model, { role: 'assistant' })
                callbacks.onChunk(`data: ${JSON.stringify(roleChunk)}\n\n`)
                hasStartedContent = true
              }
              const tag = format === 'thinking' ? 'thinking' : 'think'
              const contentChunk = createOpenaiStreamChunk(id, request.model, { content: `<${tag}>${thinkingContent}</${tag}>` })
              callbacks.onChunk(`data: ${JSON.stringify(contentChunk)}\n\n`)
            }
            // reasoning_content 格式：过滤掉 thinking 内容
            textBuffer = textBuffer.substring(thinkingEnd + 11)
            inThinkingBlock = false
          } else if (forceFlush && textBuffer) {
            if (format === 'thinking' || format === 'think') {
              if (!hasStartedContent) {
                const roleChunk = createOpenaiStreamChunk(id, request.model, { role: 'assistant' })
                callbacks.onChunk(`data: ${JSON.stringify(roleChunk)}\n\n`)
                hasStartedContent = true
              }
              const tag = format === 'thinking' ? 'thinking' : 'think'
              const contentChunk = createOpenaiStreamChunk(id, request.model, { content: `<${tag}>${textBuffer}</${tag}>` })
              callbacks.onChunk(`data: ${JSON.stringify(contentChunk)}\n\n`)
            }
            textBuffer = ''
            break
          } else {
            break
          }
        }
      }
    }

    try {
      let kiroPayload = openaiToKiro(request, account.profileArn)

      // 注入 thinking 提示
      if (thinkingEnabled) {
        const thinkingPrompt = `<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>200000</max_thinking_length>\n\n`
        const currentMessage = kiroPayload.conversationState?.currentMessage?.userInputMessage
        if (currentMessage && typeof currentMessage.content === 'string') {
          currentMessage.content = thinkingPrompt + currentMessage.content
        }
        logger.info('Thinking mode enabled for OpenAI request')
      }

      await new Promise<void>((resolve, reject) => {
        callKiroApiStream(
          account,
          kiroPayload,
          (text, toolUse, isThinking) => {
            if (text) {
              if (isThinking) {
                // reasoningContentEvent 的思考内容
                if (format === 'thinking' || format === 'think') {
                  if (!hasStartedContent) {
                    const roleChunk = createOpenaiStreamChunk(id, request.model, { role: 'assistant' })
                    callbacks.onChunk(`data: ${JSON.stringify(roleChunk)}\n\n`)
                    hasStartedContent = true
                  }
                  const tag = format === 'thinking' ? 'thinking' : 'think'
                  const contentChunk = createOpenaiStreamChunk(id, request.model, { content: `<${tag}>${text}</${tag}>` })
                  callbacks.onChunk(`data: ${JSON.stringify(contentChunk)}\n\n`)
                }
                // reasoning_content 格式：过滤掉思考内容
              } else {
                processText(text)
              }
            }
            if (toolUse) {
              const toolIndex = pendingToolCalls.size
              pendingToolCalls.set(toolIndex, {
                id: toolUse.toolUseId,
                name: toolUse.name,
                arguments: JSON.stringify(toolUse.input)
              })
              // 发送 tool_calls
              const toolChunk = createOpenaiStreamChunk(id, request.model, {
                tool_calls: [{
                  index: toolIndex,
                  id: toolUse.toolUseId,
                  type: 'function',
                  function: { name: toolUse.name, arguments: JSON.stringify(toolUse.input) }
                }]
              })
              callbacks.onChunk(`data: ${JSON.stringify(toolChunk)}\n\n`)
            }
          },
          (usage) => {
            processText('', true)

            this.recordRequestSuccess()
            this.stats.totalTokens += usage.inputTokens + usage.outputTokens
            this.stats.inputTokens += usage.inputTokens
            this.stats.outputTokens += usage.outputTokens
            this.stats.totalCredits += usage.credits || 0
            this.accountPool.recordSuccess(account.id, usage.inputTokens + usage.outputTokens)

            // 发送完成 chunk
            const finishReason = pendingToolCalls.size > 0 ? 'tool_calls' : 'stop'
            const finalChunk = createOpenaiStreamChunk(id, request.model, {}, finishReason, {
              prompt_tokens: usage.inputTokens,
              completion_tokens: usage.outputTokens,
              total_tokens: usage.inputTokens + usage.outputTokens
            })
            callbacks.onChunk(`data: ${JSON.stringify(finalChunk)}\n\n`)
            callbacks.onChunk('data: [DONE]\n\n')

            this.events.onResponse?.({
              path: '/v1/chat/completions',
              model: request.model,
              status: 200,
              tokens: usage.inputTokens + usage.outputTokens,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              credits: usage.credits
            })

            this.recordRequest({
              path: '/v1/chat/completions',
              model: request.model,
              accountId: account.id,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              credits: usage.credits,
              responseTime: Date.now() - startTime,
              success: true
            })

            if (matchedApiKey) {
              this.recordApiKeyUsage(matchedApiKey.id, usage.credits || 0, usage.inputTokens, usage.outputTokens, request.model, '/v1/chat/completions')
            }

            resolve()
          },
          (error) => {
            this.recordRequestFailed()
            this.accountPool.recordError(account.id, error.message.includes('429'))
            reject(error)
          }
        )
      })

      callbacks.onComplete()
    } catch (error) {
      this.events.onResponse?.({
        path: '/v1/chat/completions',
        model: request.model,
        status: 500,
        error: (error as Error).message
      })

      this.recordRequest({
        path: '/v1/chat/completions',
        model: request.model,
        accountId: account.id,
        responseTime: Date.now() - startTime,
        success: false,
        error: (error as Error).message
      })

      callbacks.onError(error as Error)
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
    matchedApiKey?: ApiKey
  ): Promise<void> {
    this.recordNewRequest()
    this.events.onRequest?.({ path: '/v1/messages', method: 'POST' })

    const account = await this.getAvailableAccount()
    if (!account) {
      this.recordRequestFailed()
      callbacks.onError(new Error('No available accounts'))
      return
    }

    const startTime = Date.now()

    // 检查是否启用 Thinking 模式
    const modelThinkingEnabled = this.config.modelThinkingMode?.[request.model]
    const headerThinking = headers?.['anthropic-beta']?.toLowerCase().includes('thinking')
    const thinkingEnabled = modelThinkingEnabled || headerThinking

    try {
      let kiroPayload = claudeToKiro(request, account.profileArn)

      // 注入 thinking 提示
      if (thinkingEnabled) {
        const thinkingPrompt = `<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>200000</max_thinking_length>\n\n`
        const currentMessage = kiroPayload.conversationState?.currentMessage?.userInputMessage
        if (currentMessage && typeof currentMessage.content === 'string') {
          currentMessage.content = thinkingPrompt + currentMessage.content
        }
        logger.info('Thinking mode enabled for Claude request')
      }

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
        matchedApiKey
      )

      callbacks.onComplete()
    } catch (error) {
      this.events.onResponse?.({
        path: '/v1/messages',
        model: request.model,
        status: 500,
        error: (error as Error).message
      })

      this.recordRequest({
        path: '/v1/messages',
        model: request.model,
        accountId: account.id,
        responseTime: Date.now() - startTime,
        success: false,
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
    matchedApiKey?: ApiKey
  ): Promise<void> {
    const id = msgId || `msg_${uuidv4()}`
    let currentBlockIndex = contentBlockIndex
    let hasStartedTextBlock = false
    let collectedContent = ''
    const pendingToolCalls: Map<string, { name: string; input: Record<string, unknown> }> = new Map()
    let hasLoggedThinkingFormat = false
    const format = this.config.thinkingOutputFormat || 'thinking'

    // 用于检测 <thinking> 标签
    let textBuffer = ''
    let inThinkingBlock = false

    // 估算输入 tokens
    const estimatedInputTokens = Math.max(1, Math.round(JSON.stringify(kiroPayload).length / 3))

    // 处理文本输出，检测并转换 <thinking> 标签
    const processClaudeText = (text: string, forceFlush = false) => {
      textBuffer += text

      while (true) {
        if (!inThinkingBlock) {
          const thinkingStart = textBuffer.indexOf('<thinking>')
          if (thinkingStart !== -1) {
            if (thinkingStart > 0) {
              const beforeThinking = textBuffer.substring(0, thinkingStart)
              collectedContent += beforeThinking
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
                delta: { type: 'text_delta', text: beforeThinking }
              })
              callbacks.onChunk(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`)
            }
            textBuffer = textBuffer.substring(thinkingStart + 10)
            inThinkingBlock = true
            if (!hasLoggedThinkingFormat) {
              logger.info('Detected <thinking> tag in Claude response', { format })
              hasLoggedThinkingFormat = true
            }
          } else if (forceFlush || textBuffer.length > 50) {
            const safeLength = forceFlush ? textBuffer.length : Math.max(0, textBuffer.length - 15)
            if (safeLength > 0) {
              const safeText = textBuffer.substring(0, safeLength)
              collectedContent += safeText
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
                delta: { type: 'text_delta', text: safeText }
              })
              callbacks.onChunk(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`)
              textBuffer = textBuffer.substring(safeLength)
            }
            break
          } else {
            break
          }
        } else {
          const thinkingEnd = textBuffer.indexOf('</thinking>')
          if (thinkingEnd !== -1) {
            const thinkingContent = textBuffer.substring(0, thinkingEnd)
            if (thinkingContent && (format === 'thinking' || format === 'think')) {
              if (!hasStartedTextBlock) {
                const blockStart = createClaudeStreamEvent('content_block_start', {
                  index: currentBlockIndex,
                  content_block: { type: 'text', text: '' }
                })
                callbacks.onChunk(`event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`)
                hasStartedTextBlock = true
              }
              const tag = format === 'thinking' ? 'thinking' : 'think'
              const delta = createClaudeStreamEvent('content_block_delta', {
                index: currentBlockIndex,
                delta: { type: 'text_delta', text: `<${tag}>${thinkingContent}</${tag}>` }
              })
              callbacks.onChunk(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`)
            }
            textBuffer = textBuffer.substring(thinkingEnd + 11)
            inThinkingBlock = false
          } else if (forceFlush && textBuffer) {
            if (format === 'thinking' || format === 'think') {
              if (!hasStartedTextBlock) {
                const blockStart = createClaudeStreamEvent('content_block_start', {
                  index: currentBlockIndex,
                  content_block: { type: 'text', text: '' }
                })
                callbacks.onChunk(`event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`)
                hasStartedTextBlock = true
              }
              const tag = format === 'thinking' ? 'thinking' : 'think'
              const delta = createClaudeStreamEvent('content_block_delta', {
                index: currentBlockIndex,
                delta: { type: 'text_delta', text: `<${tag}>${textBuffer}</${tag}>` }
              })
              callbacks.onChunk(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`)
            }
            textBuffer = ''
            break
          } else {
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
          usage: { input_tokens: estimatedInputTokens, output_tokens: 0 }
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
              if (format === 'thinking' || format === 'think') {
                if (!hasStartedTextBlock) {
                  const blockStart = createClaudeStreamEvent('content_block_start', {
                    index: currentBlockIndex,
                    content_block: { type: 'text', text: '' }
                  })
                  callbacks.onChunk(`event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`)
                  hasStartedTextBlock = true
                }
                const tag = format === 'thinking' ? 'thinking' : 'think'
                const delta = createClaudeStreamEvent('content_block_delta', {
                  index: currentBlockIndex,
                  delta: { type: 'text_delta', text: `<${tag}>${text}</${tag}>` }
                })
                callbacks.onChunk(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`)
              }
            } else {
              processClaudeText(text)
            }
          }
          if (toolUse) {
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
              delta: { type: 'input_json_delta', partial_json: JSON.stringify(toolUse.input) }
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

          this.events.onResponse?.({
            path: '/v1/messages',
            model,
            status: 200,
            tokens: usage.inputTokens + usage.outputTokens,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            credits: usage.credits
          })

          this.recordRequest({
            path: '/v1/messages',
            model,
            accountId: account.id,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            credits: usage.credits,
            responseTime: Date.now() - startTime,
            success: true
          })

          if (matchedApiKey) {
            this.recordApiKeyUsage(matchedApiKey.id, usage.credits || 0, usage.inputTokens, usage.outputTokens, model, '/v1/messages')
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
                matchedApiKey
              )
            } catch (error) {
              logger.error('Claude auto-continue error', { error: (error as Error).message })
            }
            resolve()
          } else {
            // 发送 message_delta
            const stopReason = hasToolCalls ? 'tool_use' : 'end_turn'
            const messageDelta = createClaudeStreamEvent('message_delta', {
              delta: { type: 'message_delta', stop_reason: stopReason, stop_sequence: undefined },
              usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens }
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
