/**
 * 代理路由
 * 提供 OpenAI/Claude 兼容的 API 端点
 */

import { Router, Request, Response } from 'express'
import type { Router as IRouter } from 'express'
import { createLogger } from '../utils/logger.js'
import * as proxyService from '../services/proxyService.js'
import type { OpenAIChatRequest, ClaudeRequest } from '../core/types.js'

const logger = createLogger('ProxyRoute')
const router: IRouter = Router()

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
    if (isStream) {
      // 流式响应
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')

      await proxyService.handleOpenAIStreamRequest(
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
        undefined,
        undefined // AbortSignal not available in Express Request
      )
    } else {
      // 非流式响应
      const result = await proxyService.handleOpenAIRequest(request)

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
    messagesCount: request.messages.length
  })

  try {
    if (isStream) {
      // 流式响应
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')

      await proxyService.handleClaudeStreamRequest(
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
        undefined,
        undefined // AbortSignal not available in Express Request
      )
    } else {
      // 非流式响应
      const result = await proxyService.handleClaudeRequest(request)

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

export default router
