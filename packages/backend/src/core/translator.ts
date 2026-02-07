/**
 * Claude 格式与 Kiro 格式转换器
 * 从 Electron 主进程迁移，适配 Express 网关
 */

import { v4 as uuidv4 } from 'uuid'
import type {
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

// 执行导向指令（防止 AI 在探索过程中丢失目标）
const EXECUTION_DIRECTIVE = `
<execution_discipline>
当用户要求执行特定任务时，你必须遵循以下纪律：
1. **目标锁定**：在整个会话中始终牢记用户的原始目标，不要在代码探索过程中迷失方向
2. **行动优先**：优先执行任务而非仅分析或总结，除非用户明确只要求分析
3. **计划执行**：为任务创建明确的步骤计划，逐步执行并标记完成状态
4. **禁止确认性收尾**：在任务未完成前，禁止输出"需要我继续吗？"、"需要深入分析吗？"等确认性问题
5. **持续推进**：如果发现部分任务已完成，立即继续执行剩余未完成的任务
6. **完整交付**：直到所有任务步骤都执行完毕才算完成
</execution_discipline>
`

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

  // 注入执行导向指令
  systemPrompt = systemPrompt + '\n\n' + EXECUTION_DIRECTIVE

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

  // 调试：打印工具转换结果
  // console.log('[claudeToKiro] Tools conversion:', {
  //   hasRequestTools: !!request.tools,
  //   requestToolsCount: request.tools?.length || 0,
  //   kiroToolsCount: kiroTools.length,
  //   toolNames: kiroTools.map(t => t.toolSpecification.name)
  // })

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
  let thinkingContent = ''
  let textContent = ''

  if (typeof msg.content === 'string') {
    textContent = msg.content
  } else if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'thinking' && block.thinking) {
        thinkingContent += block.thinking
      } else if (block.type === 'text' && block.text) {
        textContent += block.text
      } else if (block.type === 'tool_use' && block.id && block.name) {
        toolUses.push({
          toolUseId: block.id,
          name: block.name,
          input: (block.input as Record<string, unknown>) || {}
        })
      }
    }
  }

  // 将 thinking 内容以 <thinking> 标签包裹后拼接到正文前面，供上游理解上下文
  let content = ''
  if (thinkingContent) {
    content = `<thinking>${thinkingContent}</thinking>\n\n`
  }
  content += textContent

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
 * 支持 cacheWriteTokens (Kiro 格式) 和 cacheCreationTokens (Claude 格式) 两种字段名
 */
export function kiroToClaudeResponse(
  content: string,
  toolUses: KiroToolUse[],
  usage: {
    inputTokens: number
    outputTokens: number
    cacheCreationTokens?: number  // Claude 格式
    cacheWriteTokens?: number     // Kiro 格式
    cacheReadTokens?: number
  },
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

  // 兼容两种字段名: cacheWriteTokens (Kiro) 和 cacheCreationTokens (Claude)
  const cacheCreationTokens = usage.cacheCreationTokens || usage.cacheWriteTokens || 0
  const cacheReadTokens = usage.cacheReadTokens || 0

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
      output_tokens: usage.outputTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      cache_read_input_tokens: cacheReadTokens,
      // 上游 API 格式的详细 cache 信息
      cache_creation: {
        ephemeral_1h_input_tokens: 0,  // Kiro API 暂不区分，全部计入 5m
        ephemeral_5m_input_tokens: cacheCreationTokens
      }
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
