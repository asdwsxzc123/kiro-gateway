/**
 * 代理路由
 * 提供 Claude 兼容的 API 端点
 * 使用 ProxyServer 类处理请求
 */

import { Router, Request, Response } from 'express'
import type { Router as IRouter } from 'express'
import { createLogger } from '../utils/logger.js'
import { ProxyServer } from '../core/proxyServer.js'
import { KiroApiError, type ClaudeRequest } from '../core/types.js'
import * as accountStore from '../storage/accountStore.js'
import * as configStore from '../storage/configStore.js'
import { countAllTokens } from '../core/tokenCounter.js'
import { findModelPrice } from '../core/pricing.js'

const logger = createLogger('ProxyRoute')
const router: IRouter = Router()

/**
 * 从错误中提取 HTTP 状态码
 * 429 → 429 (rate limit / quota exhausted)
 * 529 → 529 (overloaded)
 * 402 → 402 (monthly limit)
 * 401/403 → 401/403 (auth error)
 * 其他 → 原始状态码或 500
 */
function getHttpStatusFromError(error: Error): number {
  if (error instanceof KiroApiError) {
    return error.statusCode
  }
  const msg = error.message
  if (msg.includes('429') || msg.includes('quota')) return 429
  if (msg.includes('529') || msg.includes('overloaded') || msg.includes('Too many concurrent')) return 502
  if (msg.includes('402') || msg.includes('MONTHLY_REQUEST_COUNT')) return 402
  if (msg.includes('No available accounts')) return 403
  if (msg.includes('All accounts at concurrency limit')) return 503
  return 500
}

/**
 * 将 HTTP 状态码映射为 Claude API 错误类型
 */
function getClaudeErrorType(statusCode: number): string {
  switch (statusCode) {
    case 429: return 'rate_limit_error'
    case 502: return 'overloaded_error'
    case 529: return 'overloaded_error'
    case 402: return 'rate_limit_error'
    case 401: case 403: return 'authentication_error'
    case 503: return 'api_error'
    default: return 'api_error'
  }
}

/**
 * 计算动态 Retry-After 值（秒）
 * 区分本地并发超限 vs 上游配额耗尽
 */
function computeRetryAfter(statusCode: number, errorKindOrError?: string | Error): number {
  const status = getConcurrencyStatus()
  const { active, queued, maxConcurrent } = status.queue

  // 区分 429 来源
  if (statusCode === 429) {
    const isUpstream = typeof errorKindOrError === 'string'
      ? (errorKindOrError === 'upstream_quota')
      : (errorKindOrError instanceof KiroApiError
        || errorKindOrError?.message?.includes('quota')
        || errorKindOrError?.message?.includes('Quota'))
    if (isUpstream) {
      // 上游配额耗尽：用较长冷却
      return 30
    }
    // 本地限流：基于队列压力，1~15s
    if (maxConcurrent <= 0) return 1
    const pressure = queued / Math.max(1, maxConcurrent)
    return Math.max(1, Math.min(15, Math.ceil(pressure * 3)))
  }

  if (statusCode === 502 || statusCode === 529) {
    // 过载：基于活跃请求比例，2~30s
    if (maxConcurrent <= 0) return 5
    const utilization = active / Math.max(1, maxConcurrent)
    return Math.max(2, Math.min(30, Math.ceil(utilization * 10)))
  }

  if (statusCode === 403) {
    // 无 active 账号：固定 30s
    return 30
  }

  if (statusCode === 503) {
    // 并发满：固定 30s
    return 30
  }

  return 5
}

/**
 * 过载前置检查：在消耗 CPU 处理请求前快速拒绝
 * 使用 accountPool.availableCount 而非 concurrency map 的 accounts.length
 */
function checkOverload(): { reject: boolean; reason?: string; statusCode?: number } {
  // 冷启动阶段允许继续，后续由 getProxyServer() 完成懒初始化
  if (!proxyServer) return { reject: false }

  const status = proxyServer.getConcurrencyStatus()
  const { queued, maxConcurrent } = status.queue

  const availableCount = proxyServer.getAvailableAccountCount()
  if (availableCount === 0) {
    return { reject: true, reason: 'No available accounts', statusCode: 403 }
  }

  // 队列深度超过上限的 2 倍：过载拒绝
  if (maxConcurrent > 0 && queued > maxConcurrent * 2) {
    return { reject: true, reason: 'Queue overloaded', statusCode: 502 }
  }

  return { reject: false }
}

// 创建 ProxyServer 实例
let proxyServer: ProxyServer | null = null

/**
 * 初始化 ProxyServer
 */
async function getProxyServer(): Promise<ProxyServer> {
  if (!proxyServer) {
    // 获取配置
    const config = await configStore.getGatewayConfig()
    const disableTools = config.disableTools ?? config.disableToolCalls ?? false
    const autoContinueRounds = config.autoContinueRounds ?? config.toolCallAutoRounds ?? 0

    proxyServer = new ProxyServer({
      enabled: true,
      port: config.port,
      host: config.host,
      enableMultiAccount: config.enableMultiAccount,
      selectedAccountIds: [],
      logRequests: config.enableRequestLogging ?? true,
      maxConcurrent: config.maxConcurrent,
      maxRetries: config.maxRetries,
      retryDelayMs: config.retryDelay,
      tokenRefreshBeforeExpiry: config.tokenRefreshBeforeExpiry ?? 300,
      autoStart: false,
      preferredEndpoint: config.preferredEndpoint,
      defaultRegion: config.defaultRegion,
      autoContinueRounds,
      disableTools,
      autoSwitchOnQuotaExhausted: config.autoSwitchOnQuotaExhausted,
      errorCooldown429: config.errorCooldownTime ?? 60000,
      thinkingOutputFormat: 'thinking',
      queueEnabled: config.queueEnabled ?? false,
      queueMaxSize: config.queueMaxSize,
      queueTimeoutMs: config.queueTimeoutMs,
      concurrencyMultiplier: config.concurrencyMultiplier,
      queueSizeMultiplier: config.queueSizeMultiplier,
    })

    // 应用账号池配置
    proxyServer.updatePoolConfig({
      errorCooldownMs: config.errorCooldownTime ?? 60000,
      maxConsecutiveErrors: config.maxConsecutiveErrors ?? 3
    })

    // 加载账号
    const accounts = await accountStore.getAvailableAccounts()
    proxyServer.addAccounts(accounts)

    // addAccounts 内部已无条件调用 recalculateDynamicConcurrency

    logger.info('ProxyServer initialized', { accountCount: accounts.length })
  }

  return proxyServer
}

/**
 * 刷新 ProxyServer 账号
 */
export async function refreshProxyServerAccounts(): Promise<void> {
  if (proxyServer) {
    const accounts = await accountStore.getAvailableAccounts()
    // 清空并重新添加账号
    for (const account of proxyServer['accountPool'].getAllAccounts()) {
      proxyServer.removeAccount(account.id)
    }
    proxyServer.addAccounts(accounts)
    // 账号数变化后重新计算动态并发
    proxyServer.recalculateDynamicConcurrency()
    logger.info('ProxyServer accounts refreshed', { count: accounts.length })
  }
}

/**
 * 获取当前所有进行中的请求（用于死锁检测）
 */
export function getInflightRequests(): import('../core/proxyServer.js').InflightRequest[] {
  if (!proxyServer) return []
  return proxyServer.getInflightRequests()
}

/**
 * 获取并发状态概览（队列 + 每账号并发数）
 */
export function getConcurrencyStatus() {
  if (!proxyServer) return { queue: { active: 0, queued: 0, maxConcurrent: 0 }, accounts: [] }
  return proxyServer.getConcurrencyStatus()
}

/**
 * 热更新 ProxyServer 配置（配置修改后立即生效，无需重启）
 */
export async function updateProxyServerConfig(): Promise<void> {
  if (!proxyServer) return

  const config = await configStore.getGatewayConfig()
  const disableTools = config.disableTools ?? config.disableToolCalls ?? false
  const autoContinueRounds = config.autoContinueRounds ?? config.toolCallAutoRounds ?? 0

  proxyServer.updateConfig({
    enableMultiAccount: config.enableMultiAccount,
    logRequests: config.enableRequestLogging ?? true,
    maxConcurrent: config.maxConcurrent,
    maxRetries: config.maxRetries,
    retryDelayMs: config.retryDelay,
    tokenRefreshBeforeExpiry: config.tokenRefreshBeforeExpiry ?? 300,
    preferredEndpoint: config.preferredEndpoint,
    defaultRegion: config.defaultRegion,
    autoContinueRounds,
    disableTools,
    autoSwitchOnQuotaExhausted: config.autoSwitchOnQuotaExhausted,
    errorCooldown429: config.errorCooldownTime ?? 60000,
    queueEnabled: config.queueEnabled ?? false,
    queueMaxSize: config.queueMaxSize,
    queueTimeoutMs: config.queueTimeoutMs,
    concurrencyMultiplier: config.concurrencyMultiplier,
    queueSizeMultiplier: config.queueSizeMultiplier,
    accountWaitEnabled: config.accountWaitEnabled,
    accountWaitTimeoutMs: config.accountWaitTimeoutMs,
    accountWaitMaxSize: config.accountWaitMaxSize,
  })

  proxyServer.updatePoolConfig({
    errorCooldownMs: config.errorCooldownTime ?? 60000,
    maxConsecutiveErrors: config.maxConsecutiveErrors ?? 3
  })

  logger.info('ProxyServer config hot-reloaded')
}

/**
 * Claude Messages API
 * POST /v1/messages
 */
router.post('/messages', async (req: Request, res: Response) => {
  // 过载前置拒绝：在解析请求体前快速检查
  const overload = checkOverload()
  if (overload.reject) {
    const statusCode = overload.statusCode || 502
    const retryAfter = computeRetryAfter(statusCode)
    res.setHeader('Retry-After', String(retryAfter))
    res.status(statusCode).json({
      type: 'error',
      error: { type: getClaudeErrorType(statusCode), message: overload.reason || 'Service overloaded' }
    })
    return
  }

  const request = req.body as ClaudeRequest

  if (!request.messages || !Array.isArray(request.messages)) {
    res.status(400).json({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'messages is required' }
    })
    return
  }

  if (!request.max_tokens) {
    request.max_tokens = 4096
  }

  const isStream = request.stream === true

  logger.debug('Claude request received', {
    model: request.model,
    stream: isStream,
    messagesCount: request.messages.length,
    hasTools: !!request.tools,
    toolsCount: request.tools?.length || 0
  })

  // 调试：打印原始请求中的 tools 字段
  if (request.tools && request.tools.length > 0) {
    // logger.debug('Request tools', { tools: request.tools.map(t => t.name) })
  } else {
    // logger.warn('No tools in request - AI will not be able to call tools!')
  }

  // 客户端断开检测：创建 AbortController，客户端断开时取消上游请求
  const abortController = new AbortController()
  let clientDisconnected = false
  req.on('close', () => {
    if (!res.writableEnded) {
      clientDisconnected = true
      abortController.abort()
      logger.info('Client disconnected, aborting upstream request', { model: request.model })
    }
  })

  try {
    const server = await getProxyServer()

    // 获取请求头
    const headers: Record<string, string> = {}
    if (req.headers['anthropic-beta']) {
      headers['anthropic-beta'] = req.headers['anthropic-beta'] as string
    }
    if (req.headers['x-session-id']) {
      headers['x-session-id'] = req.headers['x-session-id'] as string
    }

    // 从 API Key 记录中获取绑定的账号列表
    const boundAccountIds = req.matchedApiKeyRecord?.boundAccountIds
    const matchedApiKeyId = req.matchedApiKeyRecord?.id

    if (isStream) {
      // 流式响应
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')

      await server.handleClaudeStreamRequest(
        request,
        {
          onChunk: (chunk) => {
            if (!clientDisconnected) {
              res.write(chunk)
            }
          },
          onComplete: () => {
            if (!clientDisconnected) {
              res.end()
            }
          },
          onError: (error) => {
            if (!clientDisconnected) {
              const statusCode = getHttpStatusFromError(error)
              const errorType = getClaudeErrorType(statusCode)
              logger.error('Stream error', { error: error.message, statusCode })

              if (!res.headersSent) {
                // Headers 未发送，直接返回 JSON 错误响应
                res.setHeader('Content-Type', 'application/json')
                if ([429, 502, 503, 529].includes(statusCode)) {
                  res.setHeader('Retry-After', String(computeRetryAfter(statusCode, error)))
                }
                res.status(statusCode).json({
                  type: 'error',
                  error: { type: errorType, message: error.message }
                })
              } else {
                // 已发送 SSE headers，通过 SSE event 发送错误
                const errorEvent = JSON.stringify({
                  type: 'error',
                  error: { type: errorType, message: error.message }
                })
                res.write(`event: error\ndata: ${errorEvent}\n\n`)
                res.end()
              }
            }
          }
        },
        headers,
        matchedApiKeyId,   // API Key ID for usage tracking
        boundAccountIds,   // 绑定的账号 ID 列表
        abortController.signal  // AbortSignal for client disconnect
      )
    } else {
      // 非流式响应
      const result = await server.handleClaudeRequest(request, headers, boundAccountIds, abortController.signal, matchedApiKeyId)

      if (!clientDisconnected) {
        if (result.success && result.response) {
          res.json(result.response)
        } else {
          const statusCode = result.statusCode || 500
          const errorType = getClaudeErrorType(statusCode)
          if ([429, 502, 503, 529].includes(statusCode)) {
            res.setHeader('Retry-After', String(computeRetryAfter(statusCode, result.errorKind)))
          }
          res.status(statusCode).json({
            type: 'error',
            error: { type: errorType, message: result.error || 'Unknown error' }
          })
        }
      }
    }
  } catch (error) {
    const statusCode = getHttpStatusFromError(error as Error)
    const errorType = getClaudeErrorType(statusCode)
    logger.error('Request failed', { error: (error as Error).message, statusCode })
    if (!res.headersSent && [429, 502, 503, 529].includes(statusCode)) {
      res.setHeader('Retry-After', String(computeRetryAfter(statusCode, error as Error)))
    }
    res.status(statusCode).json({
      type: 'error',
      error: { type: errorType, message: (error as Error).message }
    })
  }
})

/**
 * Claude Count Tokens API
 * POST /v1/messages/count_tokens
 */
router.post('/messages/count_tokens', async (req: Request, res: Response) => {
  const { model, messages, system, tools } = req.body

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'messages is required' }
    })
    return
  }

  try {
    const inputTokens = countAllTokens(model || 'claude-sonnet-4.5', system, messages, tools)

    res.json({
      input_tokens: inputTokens
    })
  } catch (error) {
    logger.error('Count tokens failed', { error: (error as Error).message })
    res.status(500).json({
      type: 'error',
      error: { type: 'api_error', message: (error as Error).message }
    })
  }
})

/**
 * 模型列表
 * GET /v1/models
 */
router.get('/models', (_req: Request, res: Response) => {
  const modelIds = [
    'claude-opus-4.6',
    'claude-opus-4.6-1m',
    'claude-sonnet-4.6',
    'claude-sonnet-4.5',
    'claude-sonnet-4',
    'claude-haiku-4.5',
    'claude-opus-4.5'
  ]

  const models = modelIds.map(id => {
    const price = findModelPrice(id)
    return {
      id,
      object: 'model',
      owned_by: 'kiro',
      max_input_tokens: price.max_input_tokens,
      max_output_tokens: price.max_output_tokens
    }
  })

  res.json({
    object: 'list',
    data: models
  })
})

/**
 * 获取 ProxyServer 统计信息
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const server = await getProxyServer()
    const stats = server.getStats()
    res.json({
      success: true,
      data: {
        totalRequests: stats.totalRequests,
        successRequests: stats.successRequests,
        failedRequests: stats.failedRequests,
        totalTokens: stats.totalTokens,
        totalCredits: stats.totalCredits,
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
        uptime: Date.now() - stats.startTime
      }
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message
    })
  }
})

export default router
