/**
 * OpenAI/Claude 格式与 Kiro 格式转换器
 * 从 Electron 主进程迁移，适配 Express 网关
 */

import { v4 as uuidv4 } from 'uuid'
import type {
  OpenAIChatRequest,
  OpenAIMessage,
  OpenAITool,
  OpenAIChatResponse,
  OpenAIStreamChunk,
  ClaudeRequest,
  ClaudeMessage,
  ClaudeResponse,
  ClaudeStreamEvent,
  ClaudeContentBlock,
  KiroPayload,
  KiroHistoryMessage,
  KiroToolWrapper,
  KiroToolResult,
  KiroImage,
  KiroToolUse,
  KiroUserInputMessage
} from './types.js'
import { buildKiroPayload, mapModelId } from './kiroApi.js'

// Kiro API 工具描述最大长度
const KIRO_MAX_TOOL_DESC_LEN = 10237

// ============ OpenAI -> Kiro 转换 ============

/**
 * 将 OpenAI 格式请求转换为 Kiro 格式
 */
export function openaiToKiro(
  request: OpenAIChatRequest,
  profileArn?: string
): KiroPayload {
  const modelId = mapModelId(request.model)
  const origin = 'AI_EDITOR'

  // 提取系统提示
  let systemPrompt = ''
  const nonSystemMessages: OpenAIMessage[] = []

  for (const msg of request.messages) {
    if (msg.role === 'system') {
      if (typeof msg.content === 'string') {
        systemPrompt += (systemPrompt ? '\n' : '') + msg.content
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) {
            systemPrompt += (systemPrompt ? '\n' : '') + part.text
          }
        }
      }
    } else {
      nonSystemMessages.push(msg)
    }
  }

  // 注入时间戳
  const timestamp = new Date().toISOString()
  systemPrompt = `[Context: Current time is ${timestamp}]\n\n${systemPrompt}`

  // 构建历史消息
  const history: KiroHistoryMessage[] = []
  const toolResults: KiroToolResult[] = []
  let currentContent = ''
  const images: KiroImage[] = []
  let systemPromptMerged = false

  for (let i = 0; i < nonSystemMessages.length; i++) {
    const msg = nonSystemMessages[i]
    const isLast = i === nonSystemMessages.length - 1

    if (msg.role === 'user') {
      const { content: userContent, images: userImages } = extractOpenAIContent(msg)

      let mergedContent = userContent || 'Continue'
      if (!systemPromptMerged && systemPrompt) {
        mergedContent = `${systemPrompt}\n\n${mergedContent}`
        systemPromptMerged = true
      }

      if (isLast) {
        currentContent = mergedContent
        images.push(...userImages)
      } else {
        history.push({
          userInputMessage: {
            content: mergedContent,
            modelId,
            origin,
            images: userImages.length > 0 ? userImages : undefined
          }
        })
      }
    } else if (msg.role === 'assistant') {
      let assistantContent = typeof msg.content === 'string' ? msg.content : ''
      if (!assistantContent.trim() && msg.tool_calls && msg.tool_calls.length > 0) {
        assistantContent = 'Using tools.'
      } else if (!assistantContent.trim()) {
        assistantContent = 'I understand.'
      }
      const toolUses: KiroToolUse[] = []

      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.type === 'function') {
            let input = {}
            try {
              input = JSON.parse(tc.function.arguments)
            } catch { /* ignore */ }
            toolUses.push({
              toolUseId: tc.id,
              name: tc.function.name,
              input
            })
          }
        }
      }

      history.push({
        assistantResponseMessage: {
          content: assistantContent,
          toolUses: toolUses.length > 0 ? toolUses : undefined
        }
      })
    } else if (msg.role === 'tool') {
      if (msg.tool_call_id) {
        toolResults.push({
          toolUseId: msg.tool_call_id,
          content: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }],
          status: 'success'
        })
      }

      const nextMsg = nonSystemMessages[i + 1]
      const shouldFlush = !nextMsg || nextMsg.role !== 'tool'

      if (shouldFlush && toolResults.length > 0 && !isLast) {
        history.push({
          userInputMessage: {
            content: 'Tool results provided.',
            modelId,
            origin,
            userInputMessageContext: {
              toolResults: [...toolResults]
            }
          }
        })
        toolResults.length = 0
      }
    }
  }

  if (history.length > 0 && history[history.length - 1].assistantResponseMessage && !currentContent) {
    currentContent = 'Continue.'
  }

  if (!currentContent && toolResults.length > 0) {
    currentContent = 'Tool results provided.'
  }

  let finalContent = currentContent || 'Continue.'
  if (!systemPromptMerged && systemPrompt) {
    finalContent = `${systemPrompt}\n\n${finalContent}`
  }

  const kiroTools = convertOpenAITools(request.tools)

  return buildKiroPayload(
    finalContent,
    modelId,
    origin,
    history,
    kiroTools,
    toolResults,
    images,
    profileArn,
    {
      maxTokens: request.max_tokens,
      temperature: request.temperature,
      topP: request.top_p
    }
  )
}

function extractOpenAIContent(msg: OpenAIMessage): { content: string; images: KiroImage[] } {
  const images: KiroImage[] = []
  let content = ''

  if (typeof msg.content === 'string') {
    content = msg.content
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === 'text' && part.text) {
        content += part.text
      } else if (part.type === 'image_url' && part.image_url?.url) {
        const image = parseImageUrl(part.image_url.url)
        if (image) {
          images.push(image)
        }
      }
    }
  }

  return { content, images }
}

function parseImageUrl(url: string): KiroImage | null {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:image\/(\w+);base64,(.+)$/)
    if (match) {
      return {
        format: normalizeImageFormat(match[1]),
        source: { bytes: match[2] }
      }
    }
  }
  return null
}

function normalizeImageFormat(format: string): string {
  const lower = format.toLowerCase()
  const formatMap: Record<string, string> = {
    'jpg': 'jpeg',
    'jpeg': 'jpeg',
    'png': 'png',
    'gif': 'gif',
    'webp': 'webp'
  }
  return formatMap[lower] || 'png'
}

function convertOpenAITools(tools?: OpenAITool[]): KiroToolWrapper[] {
  if (!tools) return []

  return tools.map(tool => {
    let description = tool.function.description || `Tool: ${tool.function.name}`
    if (description.length > KIRO_MAX_TOOL_DESC_LEN) {
      description = description.substring(0, KIRO_MAX_TOOL_DESC_LEN) + '...'
    }
    return {
      toolSpecification: {
        name: shortenToolName(tool.function.name),
        description,
        inputSchema: { json: tool.function.parameters }
      }
    }
  })
}

function shortenToolName(name: string): string {
  const limit = 64
  if (name.length <= limit) return name

  if (name.startsWith('mcp__')) {
    const lastIdx = name.lastIndexOf('__')
    if (lastIdx > 5) {
      const shortened = 'mcp__' + name.substring(lastIdx + 2)
      return shortened.length > limit ? shortened.substring(0, limit) : shortened
    }
  }

  return name.substring(0, limit)
}

// ============ Kiro -> OpenAI 转换 ============

/**
 * 将 Kiro 响应转换为 OpenAI 格式
 */
export function kiroToOpenaiResponse(
  content: string,
  toolUses: KiroToolUse[],
  usage: { inputTokens: number; outputTokens: number },
  model: string
): OpenAIChatResponse {
  return {
    id: `chatcmpl-${uuidv4()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: toolUses.length > 0 ? null : content,
        tool_calls: toolUses.length > 0 ? toolUses.map(tu => ({
          id: tu.toolUseId,
          type: 'function' as const,
          function: {
            name: tu.name,
            arguments: JSON.stringify(tu.input)
          }
        })) : undefined
      },
      finish_reason: toolUses.length > 0 ? 'tool_calls' : 'stop'
    }],
    usage: {
      prompt_tokens: usage.inputTokens,
      completion_tokens: usage.outputTokens,
      total_tokens: usage.inputTokens + usage.outputTokens
    }
  }
}

export interface OpenAIUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

/**
 * 创建 OpenAI 流式响应块
 */
export function createOpenaiStreamChunk(
  id: string,
  model: string,
  delta: {
    role?: 'assistant'
    content?: string
    tool_calls?: { index: number; id?: string; type?: 'function'; function?: { name?: string; arguments?: string } }[]
  },
  finishReason: 'stop' | 'tool_calls' | null = null,
  usage?: OpenAIUsage
): OpenAIStreamChunk & { usage?: OpenAIUsage } {
  const chunk: OpenAIStreamChunk & { usage?: OpenAIUsage } = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: delta as OpenAIStreamChunk['choices'][0]['delta'],
      finish_reason: finishReason
    }]
  }
  if (usage) {
    chunk.usage = usage
  }
  return chunk
}

// ============ Claude -> Kiro 转换 ============

/**
 * 将 Claude 格式请求转换为 Kiro 格式
 */
export function claudeToKiro(
  request: ClaudeRequest,
  profileArn?: string
): KiroPayload {
  const modelId = mapModelId(request.model)
  const origin = 'AI_EDITOR'

  // 提取系统提示
  let systemPrompt = ''
  if (typeof request.system === 'string') {
    systemPrompt = request.system
  } else if (Array.isArray(request.system)) {
    systemPrompt = request.system.map(b => b.text).join('\n')
  }

  // 注入时间戳
  const timestamp = new Date().toISOString()
  systemPrompt = `[Context: Current time is ${timestamp}]\n\n${systemPrompt}`

  // 构建历史消息
  const history: KiroHistoryMessage[] = []
  let currentToolResults: KiroToolResult[] = []
  let currentContent = ''
  const images: KiroImage[] = []

  let pendingUserContent = ''
  let pendingUserImages: KiroImage[] = []
  let pendingToolResults: KiroToolResult[] = []

  for (let i = 0; i < request.messages.length; i++) {
    const msg = request.messages[i]
    const isLast = i === request.messages.length - 1

    if (msg.role === 'user') {
      const { content: userContent, images: userImages, toolResults: userToolResults } = extractClaudeContent(msg)

      if (isLast) {
        currentContent = pendingUserContent ? pendingUserContent + '\n' + userContent : userContent
        images.push(...pendingUserImages, ...userImages)
        currentToolResults = [...pendingToolResults, ...userToolResults]
        pendingUserContent = ''
        pendingUserImages = []
        pendingToolResults = []
      } else {
        const nextMsg = request.messages[i + 1]
        if (nextMsg && nextMsg.role === 'assistant') {
          const finalUserContent = pendingUserContent ? pendingUserContent + '\n' + userContent : userContent
          const finalUserImages = [...pendingUserImages, ...userImages]
          const finalToolResults = [...pendingToolResults, ...userToolResults]

          if (finalUserContent.trim() || finalUserImages.length > 0 || finalToolResults.length > 0) {
            const userInputMessage: KiroUserInputMessage = {
              content: finalUserContent || (finalToolResults.length > 0 ? 'Tool results provided.' : 'Continue'),
              modelId,
              origin,
              images: finalUserImages.length > 0 ? finalUserImages : undefined
            }
            if (finalToolResults.length > 0) {
              userInputMessage.userInputMessageContext = { toolResults: finalToolResults }
            }
            history.push({ userInputMessage })
          }
          pendingUserContent = ''
          pendingUserImages = []
          pendingToolResults = []
        } else {
          pendingUserContent = pendingUserContent ? pendingUserContent + '\n' + userContent : userContent
          pendingUserImages.push(...userImages)
          pendingToolResults.push(...userToolResults)
        }
      }
    } else if (msg.role === 'assistant') {
      const { content: assistantContent, toolUses } = extractClaudeAssistantContent(msg)

      if (pendingUserContent.trim() || pendingUserImages.length > 0 || pendingToolResults.length > 0) {
        const userInputMessage: KiroUserInputMessage = {
          content: pendingUserContent || (pendingToolResults.length > 0 ? 'Tool results provided.' : 'Continue'),
          modelId,
          origin,
          images: pendingUserImages.length > 0 ? pendingUserImages : undefined
        }
        if (pendingToolResults.length > 0) {
          userInputMessage.userInputMessageContext = { toolResults: pendingToolResults }
        }
        history.push({ userInputMessage })
        pendingUserContent = ''
        pendingUserImages = []
        pendingToolResults = []
      }

      history.push({
        assistantResponseMessage: {
          content: assistantContent,
          toolUses: toolUses.length > 0 ? toolUses : undefined
        }
      })
    }
  }

  if (pendingUserContent.trim() || pendingUserImages.length > 0 || pendingToolResults.length > 0) {
    currentContent = pendingUserContent + (currentContent ? '\n' + currentContent : '')
    images.unshift(...pendingUserImages)
    currentToolResults = [...pendingToolResults, ...currentToolResults]
  }

  if (history.length > 0 && history[0].assistantResponseMessage) {
    history.unshift({
      userInputMessage: { content: 'Begin conversation', modelId, origin }
    })
  }

  let finalContent = ''
  if (systemPrompt) {
    finalContent = `--- SYSTEM PROMPT ---\n${systemPrompt}\n--- END SYSTEM PROMPT ---\n\n`
  }
  finalContent += currentContent || (currentToolResults.length > 0 ? 'Tool results provided.' : 'Continue')

  const kiroTools = convertClaudeTools(request.tools)

  return buildKiroPayload(
    finalContent,
    modelId,
    origin,
    history,
    kiroTools,
    currentToolResults,
    images,
    profileArn,
    {
      maxTokens: request.max_tokens,
      temperature: request.temperature,
      topP: request.top_p
    }
  )
}

function extractClaudeContent(msg: ClaudeMessage): { content: string; images: KiroImage[]; toolResults: KiroToolResult[] } {
  const images: KiroImage[] = []
  const toolResults: KiroToolResult[] = []
  let content = ''

  if (typeof msg.content === 'string') {
    content = msg.content
  } else if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) {
        content += block.text
      } else if (block.type === 'image' && block.source) {
        images.push({
          format: block.source.media_type.split('/')[1] || 'png',
          source: { bytes: block.source.data }
        })
      } else if (block.type === 'tool_result' && block.tool_use_id) {
        let resultContent = ''
        if (typeof block.content === 'string') {
          resultContent = block.content
        } else if (Array.isArray(block.content)) {
          resultContent = block.content.map(b => b.text || '').join('')
        }
        toolResults.push({
          toolUseId: block.tool_use_id,
          content: [{ text: resultContent }],
          status: 'success'
        })
      }
    }
  }

  return { content, images, toolResults }
}

function extractClaudeAssistantContent(msg: ClaudeMessage): { content: string; toolUses: KiroToolUse[] } {
  const toolUses: KiroToolUse[] = []
  let content = ''

  if (typeof msg.content === 'string') {
    content = msg.content
  } else if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) {
        content += block.text
      } else if (block.type === 'tool_use' && block.id && block.name) {
        toolUses.push({
          toolUseId: block.id,
          name: block.name,
          input: (block.input as Record<string, unknown>) || {}
        })
      }
    }
  }

  if (!content.trim() && toolUses.length > 0) {
    content = 'Using tools.'
  }

  return { content, toolUses }
}

function convertClaudeTools(tools?: { name: string; description: string; input_schema: unknown }[]): KiroToolWrapper[] {
  if (!tools) return []

  return tools.map(tool => {
    let description = tool.description || `Tool: ${tool.name}`
    if (description.length > KIRO_MAX_TOOL_DESC_LEN) {
      description = description.substring(0, KIRO_MAX_TOOL_DESC_LEN) + '...'
    }
    return {
      toolSpecification: {
        name: shortenToolName(tool.name),
        description,
        inputSchema: { json: tool.input_schema }
      }
    }
  })
}

// ============ Kiro -> Claude 转换 ============

/**
 * 将 Kiro 响应转换为 Claude 格式
 */
export function kiroToClaudeResponse(
  content: string,
  toolUses: KiroToolUse[],
  usage: { inputTokens: number; outputTokens: number },
  model: string
): ClaudeResponse {
  const contentBlocks: ClaudeContentBlock[] = []

  if (content) {
    contentBlocks.push({ type: 'text', text: content })
  }

  for (const tu of toolUses) {
    contentBlocks.push({
      type: 'tool_use',
      id: tu.toolUseId,
      name: tu.name,
      input: tu.input
    })
  }

  return {
    id: `msg_${uuidv4()}`,
    type: 'message',
    role: 'assistant',
    content: contentBlocks,
    model,
    stop_reason: toolUses.length > 0 ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens
    }
  }
}

/**
 * 创建 Claude 流式事件
 */
export function createClaudeStreamEvent(
  type: ClaudeStreamEvent['type'],
  data?: Partial<ClaudeStreamEvent>
): ClaudeStreamEvent {
  return { type, ...data } as ClaudeStreamEvent
}
