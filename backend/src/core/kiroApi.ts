/**
 * Kiro API 调用核心模块
 * 从 Electron 主进程迁移，适配 Express 网关
 */

import { v4 as uuidv4 } from 'uuid'
import type {
  KiroPayload,
  KiroUserInputMessage,
  KiroHistoryMessage,
  KiroToolWrapper,
  KiroToolResult,
  KiroImage,
  KiroToolUse,
  ProxyAccount
} from './types.js'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('KiroAPI')

// Kiro API 端点配置
export const KIRO_ENDPOINTS = [
  {
    url: 'https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse',
    origin: 'AI_EDITOR',
    amzTarget: 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse',
    name: 'CodeWhisperer'
  },
  {
    url: 'https://q.us-east-1.amazonaws.com/generateAssistantResponse',
    origin: 'CLI',
    amzTarget: 'AmazonQDeveloperStreamingService.SendMessage',
    name: 'AmazonQ'
  }
]

// User-Agent 配置
const KIRO_USER_AGENT = 'aws-sdk-js/1.0.18 ua/2.1 os/windows lang/js md/nodejs#20.16.0 api/codewhispererstreaming#1.0.18 m/E KiroIDE-0.6.18'
const KIRO_AMZ_USER_AGENT = 'aws-sdk-js/1.0.18 KiroIDE-0.6.18'
const KIRO_CLI_USER_AGENT = 'aws-sdk-rust/1.3.9 os/macos lang/rust/1.87.0'
const KIRO_CLI_AMZ_USER_AGENT = 'aws-sdk-rust/1.3.9 ua/2.1 api/ssooidc/1.88.0 os/macos lang/rust/1.87.0 m/E app/AmazonQ-For-CLI'

// Agent 模式
const AGENT_MODE_SPEC = 'spec'
const AGENT_MODE_VIBE = 'vibe'

// 模型 ID 映射
const MODEL_ID_MAP: Record<string, string> = {
  'claude-sonnet-4-5': 'claude-sonnet-4.5',
  'claude-sonnet-4.5': 'claude-sonnet-4.5',
  'claude-haiku-4-5': 'claude-haiku-4.5',
  'claude-haiku-4.5': 'claude-haiku-4.5',
  'claude-opus-4-5': 'claude-opus-4.5',
  'claude-opus-4.5': 'claude-opus-4.5',
  'claude-sonnet-4': 'claude-sonnet-4',
  'claude-sonnet-4-20250514': 'claude-sonnet-4',
  'claude-3-5-sonnet': 'claude-sonnet-4.5',
  'claude-3-opus': 'claude-sonnet-4.5',
  'claude-3-sonnet': 'claude-sonnet-4',
  'claude-3-haiku': 'claude-haiku-4.5',
  'gpt-4': 'claude-sonnet-4.5',
  'gpt-4o': 'claude-sonnet-4.5',
  'gpt-4-turbo': 'claude-sonnet-4.5',
  'gpt-3.5-turbo': 'claude-sonnet-4.5',
  'default': 'claude-sonnet-4.5'
}

/**
 * 映射模型 ID 到 Kiro 支持的模型
 */
export function mapModelId(model: string): string {
  const lower = model.toLowerCase()
  for (const [key, value] of Object.entries(MODEL_ID_MAP)) {
    if (lower.includes(key)) {
      return value
    }
  }
  return MODEL_ID_MAP.default
}

/**
 * 检测是否为 Agentic 模式请求
 */
export function isAgenticRequest(model: string, tools?: unknown[]): boolean {
  const lower = model.toLowerCase()
  return lower.includes('-agentic') || lower.includes('agentic') || Boolean(tools && tools.length > 0)
}

/**
 * 检测是否启用 Thinking 模式
 */
export function isThinkingEnabled(headers?: Record<string, string>): boolean {
  if (!headers) return false
  const betaHeader = headers['anthropic-beta'] || headers['Anthropic-Beta'] || ''
  return betaHeader.toLowerCase().includes('thinking')
}

// ============= 消息清理逻辑 =============

const HELLO_MESSAGE: KiroHistoryMessage = {
  userInputMessage: { content: 'Hello', origin: 'AI_EDITOR' }
}

const CONTINUE_MESSAGE: KiroHistoryMessage = {
  userInputMessage: { content: 'Continue', origin: 'AI_EDITOR' }
}

const UNDERSTOOD_MESSAGE: KiroHistoryMessage = {
  assistantResponseMessage: { content: 'understood' }
}

function createFailedToolUseMessage(toolUseIds: string[]): KiroHistoryMessage {
  return {
    userInputMessage: {
      content: '',
      origin: 'AI_EDITOR',
      userInputMessageContext: {
        toolResults: toolUseIds.map(toolUseId => ({
          toolUseId,
          content: [{ text: 'Tool execution failed' }],
          status: 'error' as const
        }))
      }
    }
  }
}

function isUserInputMessage(message: KiroHistoryMessage): boolean {
  return message != null && 'userInputMessage' in message && message.userInputMessage != null
}

function isAssistantResponseMessage(message: KiroHistoryMessage): boolean {
  return message != null && 'assistantResponseMessage' in message && message.assistantResponseMessage != null
}

function hasToolResults(message: KiroHistoryMessage): boolean {
  return !!(message.userInputMessage?.userInputMessageContext?.toolResults?.length)
}

function hasToolUses(message: KiroHistoryMessage): boolean {
  return !!(message.assistantResponseMessage?.toolUses?.length)
}

function hasMatchingToolResults(
  toolUses: KiroToolUse[] | undefined,
  toolResults: KiroToolResult[] | undefined
): boolean {
  if (!toolUses || !toolUses.length) return true
  if (!toolResults || !toolResults.length) return false

  const allToolUsesHaveResults = toolUses.every(
    toolUse => toolResults.some(result => result.toolUseId === toolUse.toolUseId)
  )
  const allToolResultsHaveUses = toolResults.every(
    result => toolUses.some(toolUse => result.toolUseId === toolUse.toolUseId)
  )
  return allToolUsesHaveResults && allToolResultsHaveUses
}

function ensureStartsWithUserMessage(messages: KiroHistoryMessage[]): KiroHistoryMessage[] {
  if (messages.length === 0 || isUserInputMessage(messages[0])) {
    return messages
  }
  return [HELLO_MESSAGE, ...messages]
}

function ensureEndsWithUserMessage(messages: KiroHistoryMessage[]): KiroHistoryMessage[] {
  if (messages.length === 0) return [HELLO_MESSAGE]
  if (isUserInputMessage(messages[messages.length - 1])) return messages
  return [...messages, CONTINUE_MESSAGE]
}

function ensureAlternatingMessages(messages: KiroHistoryMessage[]): KiroHistoryMessage[] {
  if (messages.length <= 1) return messages

  const result: KiroHistoryMessage[] = [messages[0]]
  for (let i = 1; i < messages.length; i++) {
    const prevMessage = result[result.length - 1]
    const currentMessage = messages[i]

    if (isUserInputMessage(prevMessage) && isUserInputMessage(currentMessage)) {
      result.push(UNDERSTOOD_MESSAGE)
    } else if (isAssistantResponseMessage(prevMessage) && isAssistantResponseMessage(currentMessage)) {
      result.push(CONTINUE_MESSAGE)
    }
    result.push(currentMessage)
  }
  return result
}

function ensureValidToolUsesAndResults(messages: KiroHistoryMessage[]): KiroHistoryMessage[] {
  const result: KiroHistoryMessage[] = []

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    result.push(message)

    if (isAssistantResponseMessage(message) && hasToolUses(message)) {
      const nextMessage = i + 1 < messages.length ? messages[i + 1] : null

      if (!nextMessage || !isUserInputMessage(nextMessage) || !hasToolResults(nextMessage)) {
        const toolUses = message.assistantResponseMessage?.toolUses ?? []
        const toolUseIds = toolUses.map((tu, idx) => tu.toolUseId ?? `toolUse_${idx + 1}`)
        result.push(createFailedToolUseMessage(toolUseIds))
      } else if (!hasMatchingToolResults(
        message.assistantResponseMessage?.toolUses,
        nextMessage.userInputMessage?.userInputMessageContext?.toolResults
      )) {
        const toolUses = message.assistantResponseMessage?.toolUses ?? []
        const toolUseIds = toolUses.map((tu, idx) => tu.toolUseId ?? `toolUse_${idx + 1}`)
        result.push(createFailedToolUseMessage(toolUseIds))
      }
    }
  }
  return result
}

function removeEmptyUserMessages(messages: KiroHistoryMessage[]): KiroHistoryMessage[] {
  if (messages.length <= 1) return messages

  const firstUserMessageIndex = messages.findIndex(isUserInputMessage)
  return messages.filter((message, index) => {
    if (isAssistantResponseMessage(message)) return true
    if (isUserInputMessage(message) && index === firstUserMessageIndex) return true
    if (isUserInputMessage(message)) {
      const hasContent = message.userInputMessage?.content?.trim() !== ''
      return hasContent || hasToolResults(message)
    }
    return true
  })
}

function sanitizeConversation(messages: KiroHistoryMessage[]): KiroHistoryMessage[] {
  let sanitized = [...messages]
  sanitized = ensureStartsWithUserMessage(sanitized)
  sanitized = removeEmptyUserMessages(sanitized)
  sanitized = ensureValidToolUsesAndResults(sanitized)
  sanitized = ensureAlternatingMessages(sanitized)
  sanitized = ensureEndsWithUserMessage(sanitized)
  return sanitized
}

// ============= 构建 Kiro API 请求负载 =============

/**
 * 构建 Kiro API 请求负载
 */
export function buildKiroPayload(
  content: string,
  modelId: string,
  origin: string,
  history: KiroHistoryMessage[] = [],
  tools: KiroToolWrapper[] = [],
  toolResults: KiroToolResult[] = [],
  images: KiroImage[] = [],
  profileArn?: string,
  inferenceConfig?: { maxTokens?: number; temperature?: number; topP?: number }
): KiroPayload {
  const finalContent = content.trim() || (toolResults.length > 0 ? '' : 'Continue')

  const currentUserInputMessage: KiroUserInputMessage = {
    content: finalContent,
    modelId,
    origin
  }

  if (images.length > 0) {
    currentUserInputMessage.images = images
  }

  if (tools.length > 0 || toolResults.length > 0) {
    currentUserInputMessage.userInputMessageContext = {}
    if (tools.length > 0) {
      currentUserInputMessage.userInputMessageContext.tools = tools
    }
    if (toolResults.length > 0) {
      currentUserInputMessage.userInputMessageContext.toolResults = toolResults
    }
  }

  const currentMessage: KiroHistoryMessage = {
    userInputMessage: currentUserInputMessage
  }

  const allMessages = [...history, currentMessage]
  const sanitizedMessages = sanitizeConversation(allMessages)

  const sanitizedHistory = sanitizedMessages.slice(0, -1)
  let finalCurrentMessage = sanitizedMessages.at(-1)!

  if (!finalCurrentMessage.userInputMessage) {
    finalCurrentMessage = {
      userInputMessage: {
        content: finalContent || 'Continue',
        modelId,
        origin
      }
    }
  }

  if (tools.length > 0) {
    finalCurrentMessage.userInputMessage!.userInputMessageContext = {
      ...finalCurrentMessage.userInputMessage!.userInputMessageContext,
      tools
    }
  }

  const payload: KiroPayload = {
    conversationState: {
      chatTriggerType: 'MANUAL',
      conversationId: uuidv4(),
      currentMessage: {
        userInputMessage: finalCurrentMessage.userInputMessage!
      },
      history: sanitizedHistory.length > 0 ? sanitizedHistory : undefined
    }
  }

  if (profileArn) {
    payload.profileArn = profileArn
  }

  if (inferenceConfig && (inferenceConfig.maxTokens || inferenceConfig.temperature !== undefined || inferenceConfig.topP !== undefined)) {
    payload.inferenceConfig = {}
    if (inferenceConfig.maxTokens) {
      payload.inferenceConfig.maxTokens = inferenceConfig.maxTokens
    }
    if (inferenceConfig.temperature !== undefined) {
      payload.inferenceConfig.temperature = inferenceConfig.temperature
    }
    if (inferenceConfig.topP !== undefined) {
      payload.inferenceConfig.topP = inferenceConfig.topP
    }
  }

  logger.debug('Built payload', {
    contentLength: finalContent.length,
    originalHistoryLength: history.length,
    sanitizedHistoryLength: sanitizedHistory.length,
    toolsCount: tools.length,
    toolResultsCount: toolResults.length,
    hasProfileArn: !!profileArn
  })

  return payload
}

// ============= 获取认证请求头 =============

/**
 * 获取认证方式对应的请求头
 * 支持携带账号绑定的机器码
 */
function getAuthHeaders(account: ProxyAccount, endpoint: typeof KIRO_ENDPOINTS[0]): Record<string, string> {
  const isIDC = account.authMethod === 'idc'

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'X-Amz-Target': endpoint.amzTarget,
    'User-Agent': isIDC ? KIRO_CLI_USER_AGENT : KIRO_USER_AGENT,
    'X-Amz-User-Agent': isIDC ? KIRO_CLI_AMZ_USER_AGENT : KIRO_AMZ_USER_AGENT,
    'x-amzn-kiro-agent-mode': isIDC ? AGENT_MODE_VIBE : AGENT_MODE_SPEC,
    'x-amzn-codewhisperer-optout': 'true',
    'Amz-Sdk-Request': 'attempt=1; max=3',
    'Amz-Sdk-Invocation-Id': uuidv4(),
    'Authorization': `Bearer ${account.accessToken}`
  }

  // 携带账号绑定的机器码
  if (account.machineId) {
    headers['x-amzn-device-id'] = account.machineId
  }

  return headers
}

/**
 * 获取排序后的端点列表
 */
function getSortedEndpoints(preferredEndpoint?: 'codewhisperer' | 'amazonq'): typeof KIRO_ENDPOINTS {
  if (!preferredEndpoint) return [...KIRO_ENDPOINTS]

  const sorted = [...KIRO_ENDPOINTS]
  const preferredName = preferredEndpoint === 'codewhisperer' ? 'CodeWhisperer' : 'AmazonQ'

  sorted.sort((a, b) => {
    if (a.name === preferredName) return -1
    if (b.name === preferredName) return 1
    return 0
  })

  return sorted
}

// ============= Event Stream 解析 =============

/**
 * 从 headers 中提取 event type
 */
function extractEventType(headers: Uint8Array): string {
  let offset = 0
  while (offset < headers.length) {
    if (offset >= headers.length) break
    const nameLen = headers[offset]
    offset++
    if (offset + nameLen > headers.length) break
    const name = new TextDecoder().decode(headers.slice(offset, offset + nameLen))
    offset += nameLen
    if (offset >= headers.length) break
    const valueType = headers[offset]
    offset++

    if (valueType === 7) {
      if (offset + 2 > headers.length) break
      const valueLen = (headers[offset] << 8) | headers[offset + 1]
      offset += 2
      if (offset + valueLen > headers.length) break
      const value = new TextDecoder().decode(headers.slice(offset, offset + valueLen))
      offset += valueLen
      if (name === ':event-type') {
        return value
      }
      continue
    }

    const skipSizes: Record<number, number> = { 0: 0, 1: 0, 2: 1, 3: 2, 4: 4, 5: 8, 8: 8, 9: 16 }
    if (valueType === 6) {
      if (offset + 2 > headers.length) break
      const len = (headers[offset] << 8) | headers[offset + 1]
      offset += 2 + len
    } else if (skipSizes[valueType] !== undefined) {
      offset += skipSizes[valueType]
    } else {
      break
    }
  }
  return ''
}

interface ToolUseState {
  toolUseId: string
  name: string
  inputBuffer: string
}

/**
 * 解析 AWS Event Stream 二进制格式
 */
async function parseEventStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string, toolUse?: KiroToolUse) => void,
  onComplete: (usage: { inputTokens: number; outputTokens: number; credits: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number }) => void,
  onError: (error: Error) => void,
  inputChars: number = 0
): Promise<void> {
  const reader = body.getReader()
  let buffer = new Uint8Array(0)
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    credits: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0
  }

  let totalOutputChars = 0

  if (inputChars > 0) {
    usage.inputTokens = Math.max(1, Math.round(inputChars / 3))
  }

  let currentToolUse: ToolUseState | null = null
  const processedIds = new Set<string>()

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) break

      const newBuffer = new Uint8Array(buffer.length + value.length)
      newBuffer.set(buffer)
      newBuffer.set(value, buffer.length)
      buffer = newBuffer

      while (buffer.length >= 16) {
        const totalLength = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0, false)

        if (buffer.length < totalLength) break

        const headersLength = new DataView(buffer.buffer, buffer.byteOffset).getUint32(4, false)

        const headersStart = 12
        const headersEnd = 12 + headersLength
        const eventType = extractEventType(buffer.slice(headersStart, headersEnd))

        const payloadStart = 12 + headersLength
        const payloadEnd = totalLength - 4

        if (payloadStart < payloadEnd) {
          const payloadBytes = buffer.slice(payloadStart, payloadEnd)

          try {
            const payloadText = new TextDecoder().decode(payloadBytes)
            const event = JSON.parse(payloadText)

            // 处理 assistantResponseEvent
            if (eventType === 'assistantResponseEvent' || event.assistantResponseEvent) {
              const assistantResp = event.assistantResponseEvent || event
              const content = assistantResp.content
              if (content) {
                onChunk(content)
                totalOutputChars += content.length
              }
            }

            // 处理 toolUseEvent
            if (eventType === 'toolUseEvent' || event.toolUseEvent) {
              const toolUseData = event.toolUseEvent || event
              const toolUseId = toolUseData.toolUseId
              const toolName = toolUseData.name
              const isStop = toolUseData.stop === true

              let inputFragment = ''
              let inputObj: Record<string, unknown> | null = null
              if (typeof toolUseData.input === 'string') {
                inputFragment = toolUseData.input
              } else if (typeof toolUseData.input === 'object' && toolUseData.input !== null) {
                inputObj = toolUseData.input
              }

              if (toolUseId && toolName) {
                if (currentToolUse && currentToolUse.toolUseId !== toolUseId) {
                  if (!processedIds.has(currentToolUse.toolUseId)) {
                    let finalInput: Record<string, unknown> = {}
                    try {
                      if (currentToolUse.inputBuffer) {
                        finalInput = JSON.parse(currentToolUse.inputBuffer)
                      }
                    } catch { /* ignore */ }
                    onChunk('', {
                      toolUseId: currentToolUse.toolUseId,
                      name: currentToolUse.name,
                      input: finalInput
                    })
                    processedIds.add(currentToolUse.toolUseId)
                  }
                  currentToolUse = null
                }

                if (!currentToolUse && !processedIds.has(toolUseId)) {
                  currentToolUse = { toolUseId, name: toolName, inputBuffer: '' }
                }
              }

              if (currentToolUse && inputFragment) {
                currentToolUse.inputBuffer += inputFragment
              }

              if (currentToolUse && inputObj) {
                currentToolUse.inputBuffer = JSON.stringify(inputObj)
              }

              if (isStop && currentToolUse) {
                let finalInput: Record<string, unknown> = {}
                try {
                  if (currentToolUse.inputBuffer) {
                    finalInput = JSON.parse(currentToolUse.inputBuffer)
                  }
                } catch {
                  finalInput = {
                    _error: 'Tool input truncated by Kiro API',
                    _partialInput: currentToolUse.inputBuffer?.substring(0, 500) || ''
                  }
                }

                onChunk('', {
                  toolUseId: currentToolUse.toolUseId,
                  name: currentToolUse.name,
                  input: finalInput
                })

                processedIds.add(currentToolUse.toolUseId)
                currentToolUse = null
              }
            }

            // 处理 messageMetadataEvent
            if (eventType === 'messageMetadataEvent' || event.messageMetadataEvent) {
              const metadata = event.messageMetadataEvent || event
              if (metadata.tokenUsage) {
                const tokenUsage = metadata.tokenUsage
                const uncached = tokenUsage.uncachedInputTokens || 0
                const cacheRead = tokenUsage.cacheReadInputTokens || 0
                const cacheWrite = tokenUsage.cacheWriteInputTokens || 0
                const calculatedInput = uncached + cacheRead + cacheWrite

                if (calculatedInput > 0) usage.inputTokens = calculatedInput
                if (tokenUsage.outputTokens) usage.outputTokens = tokenUsage.outputTokens

                usage.cacheReadTokens = cacheRead
                usage.cacheWriteTokens = cacheWrite
              }
            }

            // 处理 meteringEvent
            if (eventType === 'meteringEvent' || event.meteringEvent) {
              const metering = event.meteringEvent || event
              if (metering.usage && typeof metering.usage === 'number') {
                usage.credits += metering.usage
              }
            }

            // 处理错误
            if (event._type || event.error) {
              const errMsg = event.message || event.error?.message || 'Unknown stream error'
              throw new Error(errMsg)
            }
          } catch (parseError) {
            if (!(parseError instanceof SyntaxError)) {
              throw parseError
            }
          }
        }

        buffer = buffer.slice(totalLength)
      }
    }

    // 完成未处理的 tool use
    if (currentToolUse && !processedIds.has(currentToolUse.toolUseId)) {
      let finalInput: Record<string, unknown> = {}
      try {
        if (currentToolUse.inputBuffer) {
          finalInput = JSON.parse(currentToolUse.inputBuffer)
        }
      } catch { /* ignore */ }
      onChunk('', {
        toolUseId: currentToolUse.toolUseId,
        name: currentToolUse.name,
        input: finalInput
      })
    }

    if (usage.outputTokens === 0 && totalOutputChars > 0) {
      usage.outputTokens = Math.max(1, Math.round(totalOutputChars / 3))
    }

    onComplete(usage)
  } catch (error) {
    onError(error as Error)
  } finally {
    reader.releaseLock()
  }
}

// ============= API 调用函数 =============

/**
 * 调用 Kiro API（流式）
 */
export async function callKiroApiStream(
  account: ProxyAccount,
  payload: KiroPayload,
  onChunk: (text: string, toolUse?: KiroToolUse) => void,
  onComplete: (usage: { inputTokens: number; outputTokens: number; credits: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number }) => void,
  onError: (error: Error) => void,
  signal?: AbortSignal,
  preferredEndpoint?: 'codewhisperer' | 'amazonq'
): Promise<void> {
  const endpoints = getSortedEndpoints(preferredEndpoint)
  let lastError: Error | null = null

  for (const endpoint of endpoints) {
    try {
      if (payload.conversationState.currentMessage.userInputMessage) {
        payload.conversationState.currentMessage.userInputMessage.origin = endpoint.origin
      }

      const payloadStr = JSON.stringify(payload)
      logger.debug(`Request to ${endpoint.name}`, {
        contentLength: payload.conversationState.currentMessage.userInputMessage?.content?.length || 0,
        toolsCount: payload.conversationState.currentMessage.userInputMessage?.userInputMessageContext?.tools?.length || 0,
        payloadSize: payloadStr.length
      })

      const headers = getAuthHeaders(account, endpoint)
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers,
        body: payloadStr,
        signal
      })

      if (response.status === 429) {
        logger.warn(`Endpoint ${endpoint.name} quota exhausted, trying next...`)
        lastError = new Error(`Quota exhausted on ${endpoint.name}`)
        continue
      }

      if (response.status === 401 || response.status === 403) {
        const body = await response.text()
        throw new Error(`Auth error ${response.status}: ${body}`)
      }

      if (!response.ok) {
        const body = await response.text()
        throw new Error(`API error ${response.status}: ${body}`)
      }

      const inputChars = payloadStr.length
      await parseEventStream(response.body!, onChunk, onComplete, onError, inputChars)
      return
    } catch (error) {
      lastError = error as Error
      logger.error(`Endpoint ${endpoint.name} failed`, { error: (error as Error).message })

      if ((error as Error).message.includes('Auth error')) {
        throw error
      }
    }
  }

  if (lastError) {
    onError(lastError)
  }
}

/**
 * 非流式调用（等待完整响应）
 */
export async function callKiroApi(
  account: ProxyAccount,
  payload: KiroPayload,
  signal?: AbortSignal
): Promise<{
  content: string
  toolUses: KiroToolUse[]
  usage: { inputTokens: number; outputTokens: number; credits: number }
}> {
  return new Promise((resolve, reject) => {
    let content = ''
    const toolUses: KiroToolUse[] = []
    let usage = { inputTokens: 0, outputTokens: 0, credits: 0 }

    callKiroApiStream(
      account,
      payload,
      (text, toolUse) => {
        content += text
        if (toolUse) {
          toolUses.push(toolUse)
        }
      },
      (u) => {
        usage = u
        resolve({ content, toolUses, usage })
      },
      reject,
      signal
    )
  })
}

/**
 * 获取 Kiro 官方模型列表
 */
export async function fetchKiroModels(account: ProxyAccount): Promise<{
  modelId: string
  modelName: string
  description: string
}[]> {
  const url = 'https://codewhisperer.us-east-1.amazonaws.com/ListAvailableModels?origin=AI_EDITOR&maxResults=50'

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${account.accessToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': KIRO_USER_AGENT
  }

  if (account.machineId) {
    headers['x-amzn-device-id'] = account.machineId
  }

  try {
    const response = await fetch(url, { method: 'GET', headers })

    if (!response.ok) {
      logger.error('ListAvailableModels failed', { status: response.status })
      return []
    }

    const data = await response.json() as { models?: { modelId: string; modelName: string; description: string }[] }
    return data.models || []
  } catch (error) {
    logger.error('ListAvailableModels error', { error: (error as Error).message })
    return []
  }
}
