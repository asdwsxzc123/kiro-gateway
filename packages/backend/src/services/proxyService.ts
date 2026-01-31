/**
 * 代理服务
 * 处理 OpenAI/Claude 格式请求，转发到 Kiro API
 */

import { createLogger } from '../utils/logger.js'
import { openaiToKiro, claudeToKiro, kiroToOpenaiResponse, kiroToClaudeResponse, createOpenaiStreamChunk, createClaudeStreamEvent } from '../core/translator.js'
import { callKiroApiStream, mapModelId } from '../core/kiroApi.js'
import * as accountService from './accountService.js'
import * as statsStore from '../storage/statsStore.js'
import * as logStore from '../storage/logStore.js'
import type { OpenAIChatRequest, OpenAIChatResponse, ClaudeRequest, ClaudeResponse, KiroToolUse, ProxyAccount } from '../core/types.js'
import { v4 as uuidv4 } from 'uuid'

const logger = createLogger('ProxyService')

export interface ProxyResult {
  success: boolean
  response?: OpenAIChatResponse | ClaudeResponse
  error?: string
  usage?: {
    inputTokens: number
    outputTokens: number
    credits: number
  }
}

export interface StreamCallbacks {
  onChunk: (chunk: string) => void
  onComplete: (usage: { inputTokens: number; outputTokens: number; credits: number }) => void
  onError: (error: Error) => void
}

/**
 * 处理 OpenAI 格式请求（非流式）
 */
export async function handleOpenAIRequest(
  request: OpenAIChatRequest,
  account?: ProxyAccount
): Promise<ProxyResult> {
  const startTime = Date.now()
  const selectedAccount = account || await accountService.selectAvailableAccount()

  if (!selectedAccount) {
    return { success: false, error: 'No available accounts' }
  }

  logger.info('Processing OpenAI request', {
    model: request.model,
    accountId: selectedAccount.id,
    messagesCount: request.messages.length
  })

  try {
    const payload = openaiToKiro(request, selectedAccount.profileArn)

    let content = ''
    const toolUses: KiroToolUse[] = []
    let usage = { inputTokens: 0, outputTokens: 0, credits: 0 }

    await new Promise<void>((resolve, reject) => {
      callKiroApiStream(
        selectedAccount,
        payload,
        (text, toolUse) => {
          content += text
          if (toolUse) toolUses.push(toolUse)
        },
        (u) => {
          usage = u
          resolve()
        },
        reject
      )
    })

    const responseTime = Date.now() - startTime
    const response = kiroToOpenaiResponse(content, toolUses, usage, request.model)

    // 更新统计
    await updateStats(selectedAccount.id, true, usage, responseTime, request.model, '/v1/chat/completions', selectedAccount.machineId)

    logger.info('OpenAI request completed', {
      accountId: selectedAccount.id,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      responseTime
    })

    return { success: true, response, usage }
  } catch (error) {
    const responseTime = Date.now() - startTime
    const errorMessage = (error as Error).message

    // 处理配额耗尽
    if (errorMessage.includes('Quota exhausted') || errorMessage.includes('429')) {
      await accountService.setAccountCooldown(selectedAccount.id, 60000)
    }

    await updateStats(selectedAccount.id, false, { inputTokens: 0, outputTokens: 0, credits: 0 }, responseTime, request.model, '/v1/chat/completions', selectedAccount.machineId, errorMessage)

    logger.error('OpenAI request failed', { accountId: selectedAccount.id, error: errorMessage })
    return { success: false, error: errorMessage }
  }
}

/**
 * 处理 OpenAI 格式请求（流式）
 */
export async function handleOpenAIStreamRequest(
  request: OpenAIChatRequest,
  callbacks: StreamCallbacks,
  account?: ProxyAccount,
  signal?: AbortSignal
): Promise<void> {
  const startTime = Date.now()
  const selectedAccount = account || await accountService.selectAvailableAccount()

  if (!selectedAccount) {
    callbacks.onError(new Error('No available accounts'))
    return
  }

  const streamId = `chatcmpl-${uuidv4()}`

  logger.info('Processing OpenAI stream request', {
    model: request.model,
    accountId: selectedAccount.id
  })

  logger.debug('OpenAI stream request details', {
    streamId,
    messagesCount: request.messages.length,
    hasTools: !!request.tools?.length,
    maxTokens: request.max_tokens
  })

  try {
    const payload = openaiToKiro(request, selectedAccount.profileArn)
    logger.debug('Kiro payload prepared', { streamId, payloadSize: JSON.stringify(payload).length })

    // 发送初始 role chunk
    const initialChunk = createOpenaiStreamChunk(streamId, request.model, { role: 'assistant' })
    callbacks.onChunk(`data: ${JSON.stringify(initialChunk)}\n\n`)
    logger.debug('Initial role chunk sent', { streamId })

    const toolUses: KiroToolUse[] = []
    let toolCallIndex = 0

    let chunkCount = 0
    let totalTextLength = 0

    await callKiroApiStream(
      selectedAccount,
      payload,
      (text, toolUse) => {
        if (text) {
          chunkCount++
          totalTextLength += text.length
          const chunk = createOpenaiStreamChunk(streamId, request.model, { content: text })
          callbacks.onChunk(`data: ${JSON.stringify(chunk)}\n\n`)
          logger.debug('OpenAI text chunk sent', { streamId, chunkIndex: chunkCount, textLength: text.length })
        }

        if (toolUse) {
          toolUses.push(toolUse)
          logger.debug('OpenAI tool use received', { streamId, toolName: toolUse.name, toolUseId: toolUse.toolUseId })
          // 发送 tool call chunk
          const toolChunk = createOpenaiStreamChunk(streamId, request.model, {
            tool_calls: [{
              index: toolCallIndex,
              id: toolUse.toolUseId,
              type: 'function',
              function: {
                name: toolUse.name,
                arguments: JSON.stringify(toolUse.input)
              }
            }]
          })
          callbacks.onChunk(`data: ${JSON.stringify(toolChunk)}\n\n`)
          logger.debug('OpenAI tool call chunk sent', { streamId, toolCallIndex })
          toolCallIndex++
        }
      },
      async (usage) => {
        const responseTime = Date.now() - startTime

        logger.debug('OpenAI stream completing', {
          streamId,
          totalChunks: chunkCount,
          totalTextLength,
          toolUsesCount: toolUses.length,
          responseTime
        })

        // 发送完成 chunk
        const finishReason = toolUses.length > 0 ? 'tool_calls' : 'stop'
        const finalChunk = createOpenaiStreamChunk(streamId, request.model, {}, finishReason, {
          prompt_tokens: usage.inputTokens,
          completion_tokens: usage.outputTokens,
          total_tokens: usage.inputTokens + usage.outputTokens
        })
        callbacks.onChunk(`data: ${JSON.stringify(finalChunk)}\n\n`)
        callbacks.onChunk('data: [DONE]\n\n')

        logger.debug('OpenAI stream completed', {
          streamId,
          finishReason,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          credits: usage.credits
        })

        await updateStats(selectedAccount.id, true, usage, responseTime, request.model, '/v1/chat/completions', selectedAccount.machineId)
        callbacks.onComplete(usage)
      },
      async (error) => {
        const responseTime = Date.now() - startTime
        const errorMessage = error.message

        logger.debug('OpenAI stream error', { streamId, errorMessage, responseTime, chunksBeforeError: chunkCount })

        if (errorMessage.includes('Quota exhausted') || errorMessage.includes('429')) {
          await accountService.setAccountCooldown(selectedAccount.id, 60000)
        }

        await updateStats(selectedAccount.id, false, { inputTokens: 0, outputTokens: 0, credits: 0 }, responseTime, request.model, '/v1/chat/completions', selectedAccount.machineId, errorMessage)
        callbacks.onError(error)
      },
      signal
    )
  } catch (error) {
    callbacks.onError(error as Error)
  }
}

/**
 * 处理 Claude 格式请求（非流式）
 */
export async function handleClaudeRequest(
  request: ClaudeRequest,
  account?: ProxyAccount
): Promise<ProxyResult> {
  const startTime = Date.now()
  const selectedAccount = account || await accountService.selectAvailableAccount()

  if (!selectedAccount) {
    return { success: false, error: 'No available accounts' }
  }

  logger.info('Processing Claude request', {
    model: request.model,
    accountId: selectedAccount.id
  })

  try {
    const payload = claudeToKiro(request, selectedAccount.profileArn)

    let content = ''
    const toolUses: KiroToolUse[] = []
    let usage = { inputTokens: 0, outputTokens: 0, credits: 0 }

    await new Promise<void>((resolve, reject) => {
      callKiroApiStream(
        selectedAccount,
        payload,
        (text, toolUse) => {
          content += text
          if (toolUse) toolUses.push(toolUse)
        },
        (u) => {
          usage = u
          resolve()
        },
        reject
      )
    })

    const responseTime = Date.now() - startTime
    const response = kiroToClaudeResponse(content, toolUses, usage, request.model)

    await updateStats(selectedAccount.id, true, usage, responseTime, request.model, '/v1/messages', selectedAccount.machineId)

    return { success: true, response, usage }
  } catch (error) {
    const responseTime = Date.now() - startTime
    const errorMessage = (error as Error).message

    if (errorMessage.includes('Quota exhausted') || errorMessage.includes('429')) {
      await accountService.setAccountCooldown(selectedAccount.id, 60000)
    }

    await updateStats(selectedAccount.id, false, { inputTokens: 0, outputTokens: 0, credits: 0 }, responseTime, request.model, '/v1/messages', selectedAccount.machineId, errorMessage)

    return { success: false, error: errorMessage }
  }
}

/**
 * 处理 Claude 格式请求（流式）
 */
export async function handleClaudeStreamRequest(
  request: ClaudeRequest,
  callbacks: StreamCallbacks,
  account?: ProxyAccount,
  signal?: AbortSignal
): Promise<void> {
  const startTime = Date.now()
  const selectedAccount = account || await accountService.selectAvailableAccount()

  if (!selectedAccount) {
    callbacks.onError(new Error('No available accounts'))
    return
  }

  const messageId = `msg_${uuidv4()}`

  logger.info('Processing Claude stream request', {
    model: request.model,
    accountId: selectedAccount.id
  })

  logger.debug('Claude stream request details', {
    messageId,
    messagesCount: request.messages.length,
    hasTools: !!request.tools?.length,
    hasSystem: !!request.system,
    maxTokens: request.max_tokens
  })

  try {
    const payload = claudeToKiro(request, selectedAccount.profileArn)
    logger.debug('Kiro payload prepared for Claude', { messageId, payloadSize: JSON.stringify(payload).length })

    // 发送 message_start 事件
    const messageStart = createClaudeStreamEvent('message_start', {
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: request.model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    })
    callbacks.onChunk(`event: message_start\ndata: ${JSON.stringify(messageStart)}\n\n`)
    logger.debug('Claude message_start sent', { messageId })

    // 发送 content_block_start
    const blockStart = createClaudeStreamEvent('content_block_start', {
      index: 0,
      content_block: { type: 'text', text: '' }
    })
    callbacks.onChunk(`event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`)
    logger.debug('Claude content_block_start sent', { messageId, blockIndex: 0 })

    const toolUses: KiroToolUse[] = []
    let chunkCount = 0
    let totalTextLength = 0

    await callKiroApiStream(
      selectedAccount,
      payload,
      (text, toolUse) => {
        if (text) {
          chunkCount++
          totalTextLength += text.length
          const delta = createClaudeStreamEvent('content_block_delta', {
            index: 0,
            delta: { type: 'text_delta', text }
          })
          callbacks.onChunk(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`)
          logger.debug('Claude text_delta sent', { messageId, chunkIndex: chunkCount, textLength: text.length })
        }

        if (toolUse) {
          toolUses.push(toolUse)
          logger.debug('Claude tool use received', { messageId, toolName: toolUse.name, toolUseId: toolUse.toolUseId })
        }
      },
      async (usage) => {
        const responseTime = Date.now() - startTime

        logger.debug('Claude stream completing', {
          messageId,
          totalChunks: chunkCount,
          totalTextLength,
          toolUsesCount: toolUses.length,
          responseTime
        })

        // 发送 content_block_stop
        const blockStop = createClaudeStreamEvent('content_block_stop', { index: 0 })
        callbacks.onChunk(`event: content_block_stop\ndata: ${JSON.stringify(blockStop)}\n\n`)
        logger.debug('Claude content_block_stop sent', { messageId, blockIndex: 0 })

        // 发送 tool_use blocks
        for (let i = 0; i < toolUses.length; i++) {
          const tu = toolUses[i]
          const toolBlockStart = createClaudeStreamEvent('content_block_start', {
            index: i + 1,
            content_block: { type: 'tool_use', id: tu.toolUseId, name: tu.name, input: tu.input }
          })
          callbacks.onChunk(`event: content_block_start\ndata: ${JSON.stringify(toolBlockStart)}\n\n`)
          logger.debug('Claude tool_use block_start sent', { messageId, blockIndex: i + 1, toolName: tu.name })

          const toolBlockStop = createClaudeStreamEvent('content_block_stop', { index: i + 1 })
          callbacks.onChunk(`event: content_block_stop\ndata: ${JSON.stringify(toolBlockStop)}\n\n`)
          logger.debug('Claude tool_use block_stop sent', { messageId, blockIndex: i + 1 })
        }

        // 发送 message_delta
        const stopReason = toolUses.length > 0 ? 'tool_use' : 'end_turn'
        const messageDelta = createClaudeStreamEvent('message_delta', {
          delta: { type: 'message_delta', stop_reason: stopReason, stop_sequence: undefined },
          usage: { output_tokens: usage.outputTokens }
        })
        callbacks.onChunk(`event: message_delta\ndata: ${JSON.stringify(messageDelta)}\n\n`)
        logger.debug('Claude message_delta sent', { messageId, stopReason })

        // 发送 message_stop
        const messageStop = createClaudeStreamEvent('message_stop')
        callbacks.onChunk(`event: message_stop\ndata: ${JSON.stringify(messageStop)}\n\n`)

        logger.debug('Claude stream completed', {
          messageId,
          stopReason,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          credits: usage.credits
        })

        await updateStats(selectedAccount.id, true, usage, responseTime, request.model, '/v1/messages', selectedAccount.machineId)
        callbacks.onComplete(usage)
      },
      async (error) => {
        const responseTime = Date.now() - startTime
        const errorMessage = error.message

        logger.debug('Claude stream error', { messageId, errorMessage, responseTime, chunksBeforeError: chunkCount })

        if (errorMessage.includes('Quota exhausted') || errorMessage.includes('429')) {
          await accountService.setAccountCooldown(selectedAccount.id, 60000)
        }

        await updateStats(selectedAccount.id, false, { inputTokens: 0, outputTokens: 0, credits: 0 }, responseTime, request.model, '/v1/messages', selectedAccount.machineId, errorMessage)

        // 发送错误事件
        const errorEvent = createClaudeStreamEvent('error', {
          error: { type: 'api_error', message: errorMessage }
        })
        callbacks.onChunk(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`)
        logger.debug('Claude error event sent', { messageId })
        callbacks.onError(error)
      },
      signal
    )
  } catch (error) {
    callbacks.onError(error as Error)
  }
}

/**
 * 更新统计数据
 */
async function updateStats(
  accountId: string,
  success: boolean,
  usage: { inputTokens: number; outputTokens: number; credits: number },
  responseTime: number,
  model: string,
  path: string,
  machineId?: string,
  error?: string
): Promise<void> {
  try {
    // 更新全局统计
    await statsStore.updateGlobalStats(success, usage.inputTokens, usage.outputTokens, usage.credits)

    // 更新账号统计
    await statsStore.updateAccountStats(accountId, success, usage.inputTokens, usage.outputTokens, responseTime)

    // 更新模型统计
    await statsStore.updateModelStats(mapModelId(model), usage.inputTokens + usage.outputTokens)

    // 更新账号使用记录
    await accountService.updateAccountUsage(accountId, success, responseTime)

    // 添加请求日志
    await logStore.addRequestLog({
      timestamp: Date.now(),
      path,
      model,
      accountId,
      machineId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      credits: usage.credits,
      responseTime,
      success,
      error
    })
  } catch (err) {
    logger.error('Failed to update stats', { error: (err as Error).message })
  }
}
