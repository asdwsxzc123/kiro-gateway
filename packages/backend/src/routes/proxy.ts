/**
 * 代理路由
 * 提供 OpenAI/Claude 兼容的 API 端点
 * 使用 ProxyServer 类处理请求
 */

import { Router, Request, Response } from 'express'
import type { Router as IRouter } from 'express'
import { createLogger } from '../utils/logger.js'
import { ProxyServer } from '../core/proxyServer.js'
import type { OpenAIChatRequest, ClaudeRequest } from '../core/types.js'
import * as accountStore from '../storage/accountStore.js'
import * as configStore from '../storage/configStore.js'
import { countAllTokens } from '../core/tokenCounter.js'

const logger = createLogger('ProxyRoute')
const router: IRouter = Router()

// 创建 ProxyServer 实例
let proxyServer: ProxyServer | null = null

/**
 * 初始化 ProxyServer
 */
async function getProxyServer(): Promise<ProxyServer> {
  if (!proxyServer) {
    // 获取配置
    const config = await configStore.getGatewayConfig()

    proxyServer = new ProxyServer({
      enabled: true,
      port: config.port,
      host: config.host,
      enableMultiAccount: config.enableMultiAccount,
      selectedAccountIds: [],
      logRequests: true,
      maxConcurrent: config.maxConcurrent,
      maxRetries: config.maxRetries,
      retryDelayMs: config.retryDelay,
      tokenRefreshBeforeExpiry: 300,
      autoStart: false,
      preferredEndpoint: config.preferredEndpoint,
      // 可以从配置中读取这些值
      autoContinueRounds: 0,
      thinkingOutputFormat: 'thinking'
    })

    // 加载账号
    const accounts = await accountStore.getAvailableAccounts()
    proxyServer.addAccounts(accounts)

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
    logger.info('ProxyServer accounts refreshed', { count: accounts.length })
  }
}

/**
 * OpenAI Chat Completions API
 * POST /v1/chat/completions
 */
router.post('/chat/completions', async (req: Request, res: Response) => {
  const request = req.body as OpenAIChatRequest

  if (!request.messages || !Array.isArray(request.messages)) {
    res.status(400).json({ error: { message: 'messages is required' } })
    return
  }

  const isStream = request.stream === true

  logger.info('OpenAI request received', {
    model: request.model,
    stream: isStream,
    messagesCount: request.messages.length
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

    if (isStream) {
      // 流式响应
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')

      await server.handleOpenAIStreamRequest(
        request,
        {
          onChunk: (chunk) => {
            res.write(chunk)
          },
          onComplete: () => {
            res.end()
          },
          onError: (error) => {
            logger.error('Stream error', { error: error.message })
            const errorChunk = JSON.stringify({
              error: { message: error.message, type: 'api_error' }
            })
            res.write(`data: ${errorChunk}\n\n`)
            res.end()
          }
        },
        headers
      )
    } else {
      // 非流式响应
      const result = await server.handleOpenAIRequest(request, headers)

      if (result.success && result.response) {
        res.json(result.response)
      } else {
        res.status(500).json({
          error: { message: result.error || 'Unknown error', type: 'api_error' }
        })
      }
    }
  } catch (error) {
    logger.error('Request failed', { error: (error as Error).message })
    res.status(500).json({
      error: { message: (error as Error).message, type: 'api_error' }
    })
  }
})

/**
 * Claude Messages API
 * POST /v1/messages
 */
router.post('/messages', async (req: Request, res: Response) => {
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

  logger.info('Claude request received', {
    model: request.model,
    stream: isStream,
    messagesCount: request.messages.length,
    hasTools: !!request.tools,
    toolsCount: request.tools?.length || 0
  })

  // 调试：打印原始请求中的 tools 字段
  if (request.tools && request.tools.length > 0) {
    logger.debug('Request tools', { tools: request.tools.map(t => t.name) })
  } else {
    logger.warn('No tools in request - AI will not be able to call tools!')
  }

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
            res.write(chunk)
          },
          onComplete: () => {
            res.end()
          },
          onError: (error) => {
            logger.error('Stream error', { error: error.message })
            res.end()
          }
        },
        headers
      )
    } else {
      // 非流式响应
      const result = await server.handleClaudeRequest(request, headers)

      if (result.success && result.response) {
        res.json(result.response)
      } else {
        res.status(500).json({
          type: 'error',
          error: { type: 'api_error', message: result.error || 'Unknown error' }
        })
      }
    }
  } catch (error) {
    logger.error('Request failed', { error: (error as Error).message })
    res.status(500).json({
      type: 'error',
      error: { type: 'api_error', message: (error as Error).message }
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
  const models = [
    { id: 'claude-sonnet-4.5', object: 'model', owned_by: 'kiro' },
    { id: 'claude-sonnet-4', object: 'model', owned_by: 'kiro' },
    { id: 'claude-haiku-4.5', object: 'model', owned_by: 'kiro' },
    { id: 'claude-opus-4.5', object: 'model', owned_by: 'kiro' },
    { id: 'gpt-4', object: 'model', owned_by: 'kiro' },
    { id: 'gpt-4o', object: 'model', owned_by: 'kiro' }
  ]

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
