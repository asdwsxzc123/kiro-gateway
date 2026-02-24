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
import { KiroApiError } from './types.js'
import { createLogger } from '../utils/logger.js'
import { countTokens } from './tokenCounter.js'

const logger = createLogger('KiroAPI')

// Kiro REST API 仅部署在 us-east-1 和 eu-central-1，需要将 SSO 区域映射到最近的 API 区域
const SUPPORTED_API_REGIONS = ['us-east-1', 'eu-central-1'] as const
export function mapToApiRegion(ssoRegion?: string): string {
  if (!ssoRegion) return 'us-east-1'
  if (SUPPORTED_API_REGIONS.includes(ssoRegion as typeof SUPPORTED_API_REGIONS[number])) return ssoRegion
  if (ssoRegion.startsWith('eu-')) return 'eu-central-1'
  return 'us-east-1'
}

// Kiro API 端点配置
export function getKiroEndpoints(region: string = 'us-east-1') {
  const apiRegion = mapToApiRegion(region)
  return [
    {
      url: `https://codewhisperer.${apiRegion}.amazonaws.com/generateAssistantResponse`,
      origin: 'AI_EDITOR',
      amzTarget: 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse',
      name: 'CodeWhisperer'
    },
    {
      url: `https://q.${apiRegion}.amazonaws.com/generateAssistantResponse`,
      origin: 'CLI',
      amzTarget: 'AmazonQDeveloperStreamingService.SendMessage',
      name: 'AmazonQ'
    }
  ]
}

// 保留默认端点常量，兼容外部引用
export const KIRO_ENDPOINTS = getKiroEndpoints()

// Kiro 版本
const KIRO_VERSION = '0.6.18'

// User-Agent 生成函数 - Social 认证方式（包含 machineId）
export function getKiroUserAgent(machineId?: string): string {
  const suffix = machineId ? `KiroIDE-${KIRO_VERSION}-${machineId}` : `KiroIDE-${KIRO_VERSION}`
  return `aws-sdk-js/1.0.18 ua/2.1 os/windows lang/js md/nodejs#20.16.0 api/codewhispererstreaming#1.0.18 m/E ${suffix}`
}

export function getKiroAmzUserAgent(machineId?: string): string {
  const suffix = machineId ? `KiroIDE ${KIRO_VERSION} ${machineId}` : `KiroIDE-${KIRO_VERSION}`
  return `aws-sdk-js/1.0.18 ${suffix}`
}

// User-Agent 配置 - IDC 认证方式 (Amazon Q CLI 样式)
const KIRO_CLI_USER_AGENT = 'aws-sdk-rust/1.3.9 os/macos lang/rust/1.87.0'
const KIRO_CLI_AMZ_USER_AGENT = 'aws-sdk-rust/1.3.9 ua/2.1 api/ssooidc/1.88.0 os/macos lang/rust/1.87.0 m/E app/AmazonQ-For-CLI'

// Agent 模式
const AGENT_MODE_SPEC = 'spec'
const AGENT_MODE_VIBE = 'vibe'

// 模型 ID 映射
const MODEL_ID_MAP: Record<string, string> = {
  'claude-sonnet-4-6': 'claude-sonnet-4.6',
  'claude-sonnet-4.6': 'claude-sonnet-4.6',
  'claude-sonnet-4-5': 'claude-sonnet-4.5',
  'claude-sonnet-4.5': 'claude-sonnet-4.5',
  'claude-haiku-4-5': 'claude-haiku-4.5',
  'claude-haiku-4.5': 'claude-haiku-4.5',
  'claude-opus-4-6': 'claude-opus-4.6',
  'claude-opus-4.6': 'claude-opus-4.6',
  'claude-opus-4-6-20260207': 'claude-opus-4.6',
  'claude-opus-4-5': 'claude-opus-4.5',
  'claude-opus-4.5': 'claude-opus-4.5',
  'claude-sonnet-4': 'claude-sonnet-4',
  'claude-sonnet-4-20250514': 'claude-sonnet-4',
  'claude-sonnet-4-20250529': 'claude-sonnet-4',
  'claude-3-5-sonnet': 'claude-sonnet-4.5',
  'claude-3-opus': 'claude-sonnet-4.5',
  'claude-3-sonnet': 'claude-sonnet-4',
  'claude-3-haiku': 'claude-haiku-4.5',
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

// Agentic 模式系统提示 - 防止大文件写入超时
const AGENTIC_SYSTEM_PROMPT = `# CRITICAL: CHUNKED WRITE PROTOCOL (MANDATORY)

You MUST follow these rules for ALL file operations. Violation causes server timeouts and task failure.

## ABSOLUTE LIMITS
- **MAXIMUM 350 LINES** per single write/edit operation - NO EXCEPTIONS
- **RECOMMENDED 300 LINES** or less for optimal performance
- **NEVER** write entire files in one operation if >300 lines

## MANDATORY CHUNKED WRITE STRATEGY

### For NEW FILES (>300 lines total):
1. FIRST: Write initial chunk (first 250-300 lines) using write_to_file/fsWrite
2. THEN: Append remaining content in 250-300 line chunks using file append operations
3. REPEAT: Continue appending until complete

### For EDITING EXISTING FILES:
1. Use surgical edits (apply_diff/targeted edits) - change ONLY what's needed
2. NEVER rewrite entire files - use incremental modifications
3. Split large refactors into multiple small, focused edits

REMEMBER: When in doubt, write LESS per operation. Multiple small operations > one large operation.`

/**
 * 注入系统提示
 * 注意：Kiro API 不支持通过系统提示中的 XML 标签启用 thinking 模式
 * 如果注入 <thinking_mode> 标签，模型会自己生成 <thinking>...</thinking> 内容
 * 但这些内容会被当作普通 assistantResponseEvent 返回，而不是 reasoningContentEvent
 */
export function injectSystemPrompts(
  content: string,
  isAgentic: boolean,
  _thinkingEnabled: boolean  // 保留参数但不使用，避免破坏调用方
): string {
  let result = content

  // 注入时间戳
  const timestamp = new Date().toISOString()
  const timestampPrompt = `Current time: ${timestamp}`

  // 注入 Agentic 模式提示
  if (isAgentic) {
    result = result + '\n\n' + AGENTIC_SYSTEM_PROMPT
  }

  // 注入时间戳
  result = timestampPrompt + '\n\n' + result

  return result
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
 * 支持携带账号绑定的机器码，并将 machineId 嵌入 User-Agent
 * @param skipAgentMode - 是否跳过 x-amzn-kiro-agent-mode header（用于测试等场景）
 */
function getAuthHeaders(account: ProxyAccount, endpoint: typeof KIRO_ENDPOINTS[0], skipAgentMode = false): Record<string, string> {
  const isIDC = false
  // 根本走不到这里 IdC ，我看了 kiro的代码，这里的 isIDC 永远是 false
  // const isIDC = account.authMethod === 'idc'
  const machineId = account.machineId

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'X-Amz-Target': endpoint.amzTarget,
    'User-Agent': isIDC ? KIRO_CLI_USER_AGENT : getKiroUserAgent(machineId),
    'X-Amz-User-Agent': isIDC ? KIRO_CLI_AMZ_USER_AGENT : getKiroAmzUserAgent(machineId),
    'x-amzn-codewhisperer-optout': 'true',
    'Amz-Sdk-Request': 'attempt=1; max=3',
    'Amz-Sdk-Invocation-Id': uuidv4(),
    'Authorization': `Bearer ${account.accessToken}`
  }

  // 只有在不跳过 agent mode 时才添加此 header
  // 某些订阅不支持 Kiro Agent 模式，会返回 403 错误
  if (!skipAgentMode) {
    headers['x-amzn-kiro-agent-mode'] = isIDC ? AGENT_MODE_VIBE : AGENT_MODE_SPEC
  }

  // 注意：不添加 x-amzn-device-id header，machineId 已通过 User-Agent 传递（与 kiro-m 保持一致）

  return headers
}

/**
 * 获取排序后的端点列表
 */
function getSortedEndpoints(preferredEndpoint?: 'codewhisperer' | 'amazonq', region?: string): typeof KIRO_ENDPOINTS {
  const endpoints = region ? getKiroEndpoints(region) : [...KIRO_ENDPOINTS]
  if (!preferredEndpoint) return endpoints

  const sorted = [...endpoints]
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

// parseTokenUsage / toSafeNumber 已移除
// Token 计算现在完全由 tokenCounter.ts 自行完成，不再依赖 API 返回

/**
 * 解析 AWS Event Stream 二进制格式
 */
async function parseEventStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string, toolUse?: KiroToolUse, isThinking?: boolean) => void,
  onComplete: (usage: { outputTokens: number; credits: number; kiroCredits: number }) => void,
  onError: (error: Error) => void
): Promise<void> {
  const reader = body.getReader()
  let buffer = new Uint8Array(0)
  // 自计算 token：仅累积模型原生输出（assistant/reasoning/tool_use），不含网关拼接文本
  let allOutputText = ''
  // Kiro 上游实际消耗的积分（来自 meteringEvent）
  let kiroCredits = 0

  let currentToolUse: ToolUseState | null = null
  const processedIds = new Set<string>()

  console.log(`[parseEventStream] 开始（自计算 token 模式）`)

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

            // console.log(`[Event] data=${JSON.stringify(event).slice(0, 200)}`)

            // 处理 assistantResponseEvent
            if (eventType === 'assistantResponseEvent' || event.assistantResponseEvent) {
              const assistantResp = event.assistantResponseEvent || event
              const content = assistantResp.content
              // console.log(`[assistantResponse] content=${content?.slice(0, 150)}`)
              if (content) {
                onChunk(content)
                allOutputText += content
              }
            }

            // 处理 toolUseEvent
            if (eventType === 'toolUseEvent' || event.toolUseEvent) {
              const toolUseData = event.toolUseEvent || event
              const toolUseId = toolUseData.toolUseId
              const toolName = toolUseData.name
              const isStop = toolUseData.stop === true

              // 调试日志：查看原始 toolUseEvent 数据
              logger.debug('toolUseEvent received', {
                toolUseId,
                toolName,
                isStop,
                inputType: typeof toolUseData.input,
                inputValue: typeof toolUseData.input === 'string'
                  ? toolUseData.input.substring(0, 200)
                  : JSON.stringify(toolUseData.input)?.substring(0, 200),
                rawKeys: Object.keys(toolUseData)
              })

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

              // 累积 input 片段
              if (currentToolUse && inputFragment) {
                currentToolUse.inputBuffer += inputFragment
                logger.debug('toolUse input fragment accumulated', {
                  toolUseId: currentToolUse.toolUseId,
                  fragmentLength: inputFragment.length,
                  bufferLength: currentToolUse.inputBuffer.length
                })
              }

              // 处理完整的 input 对象
              if (currentToolUse && inputObj) {
                currentToolUse.inputBuffer = JSON.stringify(inputObj)
                logger.debug('toolUse input object set', {
                  toolUseId: currentToolUse.toolUseId,
                  inputObjKeys: Object.keys(inputObj),
                  bufferLength: currentToolUse.inputBuffer.length
                })
              }

              // 处理 stop 事件，输出最终的 tool use
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

                logger.debug('toolUse completed (stop)', {
                  toolUseId: currentToolUse.toolUseId,
                  name: currentToolUse.name,
                  inputBufferLength: currentToolUse.inputBuffer.length,
                  finalInputKeys: Object.keys(finalInput),
                  finalInputPreview: JSON.stringify(finalInput).substring(0, 300)
                })

                onChunk('', {
                  toolUseId: currentToolUse.toolUseId,
                  name: currentToolUse.name,
                  input: finalInput
                })

                // 累积 tool use 输出到 allOutputText（用于自计算 output tokens）
                allOutputText += currentToolUse.name + JSON.stringify(finalInput)

                processedIds.add(currentToolUse.toolUseId)
                currentToolUse = null
              }
            }

            // 处理 messageMetadataEvent — 提取 Kiro 上游积分
            if (eventType === 'messageMetadataEvent' || event.messageMetadataEvent) {
              const metadata = event.messageMetadataEvent || event
              logger.debug('messageMetadataEvent received', {
                tokenUsage: metadata.tokenUsage,
                usage: metadata.usage,
                raw: JSON.stringify(metadata).slice(0, 500)
              })
              // 尝试从 messageMetadataEvent 中提取积分
              // Kiro API 可能将积分放在 usage.credits / usage / tokenUsage.credits 等字段
              const credits = metadata.usage?.credits
                ?? metadata.credits
                ?? metadata.tokenUsage?.credits
              if (credits != null && typeof credits === 'number' && credits > 0) {
                kiroCredits += credits
                logger.info(`messageMetadataEvent credits: ${credits}, total kiroCredits=${kiroCredits}`)
              }
            }
          // 调试：打印所有事件类型（包括常见类型）
            logger.debug( 'Kiro Event: ' + (eventType || 'unknown') + ' ' + JSON.stringify(event).slice(0, 500))
            // 处理 meteringEvent — 记录 Kiro 上游实际消耗的积分
            if (eventType === 'meteringEvent' || event.meteringEvent) {
              const metering = event.meteringEvent || event
              if (metering.usage && typeof metering.usage === 'number') {
                kiroCredits += metering.usage
                logger.debug(`meteringEvent: kiroCredits=${metering.usage}, total=${kiroCredits}`)
              }
            }

            // 处理 reasoningContentEvent - Thinking 模式的推理内容
            if (eventType === 'reasoningContentEvent' || event.reasoningContentEvent) {
              const reasoning = event.reasoningContentEvent || event
              if (reasoning.text) {
                // 传递 isThinking=true 标记这是思考内容
                onChunk(reasoning.text, undefined, true)
                // 累积到输出文本（用于自计算 output tokens）
                allOutputText += reasoning.text
              }
            }

            // 处理 supplementaryWebLinksEvent - 网页链接引用
            if (eventType === 'supplementaryWebLinksEvent' || event.supplementaryWebLinksEvent) {
              const webLinksEvent = event.supplementaryWebLinksEvent || event
              if (webLinksEvent.supplementaryWebLinks && Array.isArray(webLinksEvent.supplementaryWebLinks)) {
                const links = webLinksEvent.supplementaryWebLinks
                  .filter((link: { url?: string; title?: string }) => link.url)
                  .map((link: { url?: string; title?: string }) => {
                    const title = link.title || link.url
                    return `- [${title}](${link.url})`
                  })
                if (links.length > 0) {
                  const linkText = `\n\n🔗 **Web References:**\n${links.join('\n')}`
                  onChunk(linkText)
                }
              }
            }

            // 处理 contextUsageEvent - 上下文使用百分比
            if (eventType === 'contextUsageEvent' || event.contextUsageEvent) {
              const contextEvent = event.contextUsageEvent || event
              if (contextEvent.contextUsagePercentage !== undefined) {
                const percentage = contextEvent.contextUsagePercentage
                logger.debug(`contextUsageEvent - Context usage: ${percentage.toFixed(2)}%`)
                if (percentage > 80) {
                  logger.warn(`Warning: Context usage is high: ${percentage.toFixed(2)}%`)
                }
              }
            }

            // 处理 codeReferenceEvent - 代码引用/许可证信息
            if (eventType === 'codeReferenceEvent' || event.codeReferenceEvent) {
              const codeRef = event.codeReferenceEvent || event
              if (codeRef.references && Array.isArray(codeRef.references)) {
                const refTexts = codeRef.references
                  .filter((ref: { licenseName?: string; repository?: string; url?: string }) => ref.licenseName || ref.repository)
                  .map((ref: { licenseName?: string; repository?: string; url?: string }) => {
                    const parts: string[] = []
                    if (ref.licenseName) parts.push(`License: ${ref.licenseName}`)
                    if (ref.repository) parts.push(`Repo: ${ref.repository}`)
                    if (ref.url) parts.push(`URL: ${ref.url}`)
                    return parts.join(', ')
                  })
                if (refTexts.length > 0) {
                  const refText = `\n\n📚 **Code References:**\n${refTexts.join('\n')}`
                  onChunk(refText)
                }
              }
            }

            // 处理 followupPromptEvent - 后续提示建议
            if (eventType === 'followupPromptEvent' || event.followupPromptEvent) {
              const followup = event.followupPromptEvent || event
              if (followup.followupPrompt) {
                const prompt = followup.followupPrompt
                if (prompt.content || prompt.userIntent) {
                  const suggestion = prompt.content || prompt.userIntent
                  const followUpText = `\n\n💡 **Suggested follow-up:** ${suggestion}`
                  onChunk(followUpText)
                }
              }
            }

            // 处理 citationEvent - 引用事件
            if (eventType === 'citationEvent' || event.citationEvent) {
              const citation = event.citationEvent || event
              if (citation.citations && Array.isArray(citation.citations)) {
                const citationTexts = citation.citations
                  .filter((c: { title?: string; url?: string }) => c.title || c.url)
                  .map((c: { title?: string; url?: string }, i: number) => {
                    const parts = [`[${i + 1}]`]
                    if (c.title) parts.push(c.title)
                    if (c.url) parts.push(`(${c.url})`)
                    return parts.join(' ')
                  })
                if (citationTexts.length > 0) {
                  const citationText = `\n\n📖 **Citations:**\n${citationTexts.join('\n')}`
                  onChunk(citationText)
                }
              }
            }

            // 处理 intentsEvent - 意图事件（artifact、deeplinks 等）
            if (eventType === 'intentsEvent' || event.intentsEvent) {
              // 意图事件主要用于 UI 渲染，记录日志即可
              logger.debug('intentsEvent received')
            }

            // 处理 interactionComponentsEvent - 交互组件事件
            if (eventType === 'interactionComponentsEvent' || event.interactionComponentsEvent) {
              // 交互组件主要用于 UI 渲染，记录日志即可
              logger.debug('interactionComponentsEvent received')
            }

            // 处理 invalidStateEvent - 无效状态事件（错误处理）
            if (eventType === 'invalidStateEvent' || event.invalidStateEvent) {
              const invalid = event.invalidStateEvent || event
              const reason = invalid.reason || 'UNKNOWN'
              const message = invalid.message || 'Invalid state detected'
              logger.error(`invalidStateEvent: ${reason} - ${message}`)
              const warnText = `\n\n⚠️ **Warning:** ${message} (reason: ${reason})`
              onChunk(warnText)
            }

            // 处理错误
            if (event._type || event.error) {
              const errMsg = event.message || event.error?.message || 'Unknown stream error'
              // Try to detect specific error codes in stream errors
              if (errMsg.includes('MONTHLY_REQUEST_COUNT')) {
                throw new KiroApiError(errMsg, 402, 'MONTHLY_LIMIT', false)
              }
              if (errMsg.includes('TEMPORARILY_SUSPENDED') || errMsg.includes('temporarily is suspended')) {
                throw new KiroApiError(errMsg, 0, 'ACCOUNT_SUSPENDED', false)
              }
              if (errMsg.includes('overloaded') || errMsg.includes('529')) {
                throw new KiroApiError(errMsg, 529, 'OVERLOADED', true)
              }
              throw new KiroApiError(errMsg, 0, 'UNKNOWN', false)
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

    // 完成未处理的 tool use（流结束但没有收到 stop 事件）
    if (currentToolUse && !processedIds.has(currentToolUse.toolUseId)) {
      let finalInput: Record<string, unknown> = {}
      try {
        if (currentToolUse.inputBuffer) {
          finalInput = JSON.parse(currentToolUse.inputBuffer)
        }
      } catch { /* ignore */ }

      logger.debug('toolUse completed (stream end, no stop)', {
        toolUseId: currentToolUse.toolUseId,
        name: currentToolUse.name,
        inputBufferLength: currentToolUse.inputBuffer.length,
        finalInputKeys: Object.keys(finalInput),
        finalInputPreview: JSON.stringify(finalInput).substring(0, 300)
      })

      onChunk('', {
        toolUseId: currentToolUse.toolUseId,
        name: currentToolUse.name,
        input: finalInput
      })

      // 累积未完成 tool use 的输出到 allOutputText
      allOutputText += currentToolUse.name + JSON.stringify(finalInput)
    }

    // 自计算 output tokens（用 tiktoken 而非依赖 API 返回）
    const selfOutputTokens = countTokens(allOutputText)

    onComplete({
      outputTokens: selfOutputTokens,
      credits: 0,
      kiroCredits
    })
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
  onChunk: (text: string, toolUse?: KiroToolUse, isThinking?: boolean) => void,
  onComplete: (usage: { outputTokens: number; credits: number; kiroCredits: number }) => void,
  onError: (error: Error) => void,
  signal?: AbortSignal,
  preferredEndpoint?: 'codewhisperer' | 'amazonq',
  skipAgentMode = false
): Promise<void> {
  const endpoints = getSortedEndpoints(preferredEndpoint, account.region)
  let lastError: Error | null = null

  for (const endpoint of endpoints) {
    try {
      if (payload.conversationState.currentMessage.userInputMessage) {
        payload.conversationState.currentMessage.userInputMessage.origin = endpoint.origin
      }

      const payloadStr = JSON.stringify(payload)
      // console.log(`[Request] payloadSize=${payloadStr.length} payload=${payloadStr.slice(0, 200)}`)
      // logger.debug(`Request to ${endpoint.name}`, {
      //   contentLength: payload.conversationState.currentMessage.userInputMessage?.content?.length || 0,
      //   toolsCount: payload.conversationState.currentMessage.userInputMessage?.userInputMessageContext?.tools?.length || 0,
      //   payloadSize: payloadStr.length
      // })

      const headers = getAuthHeaders(account, endpoint, skipAgentMode)
      // console.log(`[Request] headers=${JSON.stringify(headers).slice(0, 200)}`)
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers,
        body: payloadStr,
        signal
      })

      if (!response.ok) {
        const body = await response.text()
        const kiroError = KiroApiError.fromHttpResponse(response.status, body, endpoint.name)

        // 429: try next endpoint
        if (response.status === 429) {
          logger.warn(`Endpoint ${endpoint.name} quota exhausted, trying next...`)
          lastError = kiroError
          continue
        }

        // Auth errors: don't try next endpoint
        if (kiroError.errorCode === 'AUTH_ERROR') {
          throw kiroError
        }

        throw kiroError
      }
      console.log(`[Response] status=${response.status} ok=${response.ok}`)

      await parseEventStream(response.body!, onChunk, onComplete, onError)
      return
    } catch (error) {
      lastError = error as Error
      logger.error(`Endpoint ${endpoint.name} failed`, { error: (error as Error).message })

      // Auth error 不再重新抛出，而是通过 onError 回调处理
      if ((error as Error).message.includes('Auth error')) {
        onError(error as Error)
        return
      }
    }
  }

  if (lastError) {
    onError(lastError)
  }
}

/**
 * 非流式调用（等待完整响应）
 * usage 仅返回自计算的 outputTokens；credits 在自计费模式下固定为 0
 * inputTokens 由调用方（proxyServer）使用 countAllTokens() 自行计算
 */
export async function callKiroApi(
  account: ProxyAccount,
  payload: KiroPayload,
  signal?: AbortSignal,
  preferredEndpoint?: 'codewhisperer' | 'amazonq'
): Promise<{
  content: string
  toolUses: KiroToolUse[]
  usage: {
    outputTokens: number
    credits: number
    kiroCredits: number
  }
}> {
  return new Promise((resolve, reject) => {
    let content = ''
    const toolUses: KiroToolUse[] = []

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
        // outputTokens 已在 parseEventStream 中用 tiktoken 自计算
        // credits 在自计费模式下固定为 0（仅保留字段兼容）
        resolve({
          content,
          toolUses,
          usage: {
            outputTokens: u.outputTokens,
            credits: u.credits,
            kiroCredits: u.kiroCredits
          }
        })
      },
      reject,
      signal,
      preferredEndpoint
    )
  })
}

/**
 * 获取 Kiro 官方模型列表
 */
export async function fetchKiroModels(account: ProxyAccount): Promise<{
  models: { modelId: string; modelName: string; description: string }[]
  error?: string
}> {
  const apiRegion = mapToApiRegion(account.region)
  const fallbackRegion = apiRegion === 'eu-central-1' ? 'us-east-1' : 'eu-central-1'
  const queryString = 'origin=AI_EDITOR&maxResults=50'
  const machineId = account.machineId

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${account.accessToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': getKiroUserAgent(machineId),
    'x-amz-user-agent': getKiroAmzUserAgent(machineId),
    'x-amzn-codewhisperer-optout': 'true'
  }

  // 注意：不添加 x-amzn-device-id header，machineId 已通过 User-Agent 传递（与 kiro-m 保持一致）

  try {
    let response = await fetch(`https://codewhisperer.${apiRegion}.amazonaws.com/ListAvailableModels?${queryString}`, { method: 'GET', headers })

    // 主端点返回 403 时，尝试备用区域端点
    if (response.status === 403) {
      logger.info(`ListAvailableModels primary (${apiRegion}) returned 403, trying fallback (${fallbackRegion})`)
      response = await fetch(`https://codewhisperer.${fallbackRegion}.amazonaws.com/ListAvailableModels?${queryString}`, { method: 'GET', headers })
    }

    if (!response.ok) {
      const errorMsg = `ListAvailableModels failed with status ${response.status}`
      logger.error(errorMsg)
      return { models: [], error: errorMsg }
    }

    const data = await response.json() as { models?: { modelId: string; modelName: string; description: string }[] }
    return { models: data.models || [] }
  } catch (error) {
    const errorMsg = `ListAvailableModels network error: ${(error as Error).message}`
    logger.error(errorMsg)
    return { models: [], error: errorMsg }
  }
}

// ============= 使用量查询 API =============

/**
 * 使用量响应类型
 */
export interface UsageLimitsResponse {
  usageBreakdownList?: Array<{
    resourceType?: string
    displayName?: string
    displayNamePlural?: string
    currentUsage?: number
    currentUsageWithPrecision?: number
    usageLimit?: number
    usageLimitWithPrecision?: number
    currency?: string
    unit?: string
    overageRate?: number
    overageCap?: number
    type?: string
    freeTrialInfo?: {
      freeTrialStatus?: string
      usageLimit?: number
      usageLimitWithPrecision?: number
      currentUsage?: number
      currentUsageWithPrecision?: number
      freeTrialExpiry?: string
    }
    bonuses?: Array<{
      bonusCode?: string
      displayName?: string
      description?: string
      usageLimit?: number
      usageLimitWithPrecision?: number
      currentUsage?: number
      currentUsageWithPrecision?: number
      expiresAt?: string
      redeemedAt?: string
      status?: string
    }>
  }>
  nextDateReset?: string
  subscriptionInfo?: {
    subscriptionName?: string
    subscriptionTitle?: string
    subscriptionType?: string
    status?: string
    type?: string
    subscriptionManagementTarget?: string
    upgradeCapability?: string
    overageCapability?: string
  }
  overageConfiguration?: {
    overageEnabled?: boolean
  }
  userInfo?: {
    email?: string
    userId?: string
  }
}

/**
 * 将 Unix 时间戳（秒）转换为 ISO 字符串
 */
function normalizeTimestamp(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') {
    return new Date(value * 1000).toISOString()
  }
  return value
}

/**
 * 获取账号使用量限制
 * 调用 Kiro REST API: GET /getUsageLimits
 */
export async function fetchUsageLimits(account: ProxyAccount): Promise<UsageLimitsResponse> {
  const params = new URLSearchParams({
    origin: 'AI_EDITOR',
    resourceType: 'AGENTIC_REQUEST',
    isEmailRequired: 'true'
  })

  if (account.profileArn) {
    params.set('profileArn', account.profileArn)
  }

  const apiRegion = mapToApiRegion(account.region)
  const fallbackRegion = apiRegion === 'eu-central-1' ? 'us-east-1' : 'eu-central-1'
  const queryString = params.toString()
  const machineId = account.machineId

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${account.accessToken}`,
    'User-Agent': getKiroUserAgent(machineId),
    'x-amz-user-agent': getKiroAmzUserAgent(machineId)
  }

  // 注意：不添加 x-amzn-device-id header，machineId 已通过 User-Agent 传递（与 kiro-m 保持一致）

  logger.debug('Fetching usage limits', { accountId: account.id, apiRegion })

  let response = await fetch(`https://q.${apiRegion}.amazonaws.com/getUsageLimits?${queryString}`, { method: 'GET', headers })

  // 主端点返回 403 时，尝试备用区域端点（参考 Kiro 官方插件 fallback 逻辑）
  if (response.status === 403) {
    logger.info(`GetUsageLimits primary (${apiRegion}) returned 403, trying fallback (${fallbackRegion})`)
    response = await fetch(`https://q.${fallbackRegion}.amazonaws.com/getUsageLimits?${queryString}`, { method: 'GET', headers })
  }

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('GetUsageLimits failed', { status: response.status, error: errorText })
    throw new Error(`HTTP ${response.status}: ${errorText}`)
  }

  const result = await response.json() as {
    usageBreakdownList?: Array<{
      resourceType?: string
      type?: string
      displayName?: string
      displayNamePlural?: string
      currentUsage?: number
      currentUsageWithPrecision?: number
      usageLimit?: number
      usageLimitWithPrecision?: number
      currency?: string
      unit?: string
      overageRate?: number
      overageCap?: number
      freeTrialInfo?: {
        freeTrialStatus?: string
        usageLimit?: number
        usageLimitWithPrecision?: number
        currentUsage?: number
        currentUsageWithPrecision?: number
        freeTrialExpiry?: number | string
      }
      bonuses?: Array<{
        bonusCode?: string
        displayName?: string
        description?: string
        usageLimit?: number
        usageLimitWithPrecision?: number
        currentUsage?: number
        currentUsageWithPrecision?: number
        expiresAt?: number | string
        redeemedAt?: number | string
        status?: string
      }>
    }>
    nextDateReset?: number | string
    subscriptionInfo?: {
      subscriptionName?: string
      subscriptionTitle?: string
      subscriptionType?: string
      status?: string
      type?: string
      subscriptionManagementTarget?: string
      upgradeCapability?: string
      overageCapability?: string
    }
    overageConfiguration?: {
      overageEnabled?: boolean
    }
    userInfo?: {
      email?: string
      userId?: string
    }
  }

  // 转换时间戳为 ISO 字符串
  return {
    usageBreakdownList: result.usageBreakdownList?.map(b => ({
      resourceType: b.resourceType || b.type,
      displayName: b.displayName,
      displayNamePlural: b.displayNamePlural,
      currentUsage: b.currentUsage,
      currentUsageWithPrecision: b.currentUsageWithPrecision,
      usageLimit: b.usageLimit,
      usageLimitWithPrecision: b.usageLimitWithPrecision,
      currency: b.currency,
      unit: b.unit,
      overageRate: b.overageRate,
      overageCap: b.overageCap,
      type: b.type,
      freeTrialInfo: b.freeTrialInfo ? {
        freeTrialStatus: b.freeTrialInfo.freeTrialStatus,
        usageLimit: b.freeTrialInfo.usageLimit,
        usageLimitWithPrecision: b.freeTrialInfo.usageLimitWithPrecision,
        currentUsage: b.freeTrialInfo.currentUsage,
        currentUsageWithPrecision: b.freeTrialInfo.currentUsageWithPrecision,
        freeTrialExpiry: normalizeTimestamp(b.freeTrialInfo.freeTrialExpiry)
      } : undefined,
      bonuses: b.bonuses?.map(bonus => ({
        ...bonus,
        expiresAt: normalizeTimestamp(bonus.expiresAt),
        redeemedAt: normalizeTimestamp(bonus.redeemedAt)
      }))
    })),
    nextDateReset: normalizeTimestamp(result.nextDateReset),
    subscriptionInfo: result.subscriptionInfo,
    overageConfiguration: result.overageConfiguration,
    userInfo: result.userInfo
  }
}
