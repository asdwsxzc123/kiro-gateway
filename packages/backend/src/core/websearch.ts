/**
 * WebSearch 工具处理模块
 *
 * 实现 Anthropic WebSearch 请求到 Kiro MCP 的转换和响应生成
 * 参考 kiro.rs 实现 (commit 0d66014)
 */

import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '../utils/logger.js'
import { getKiroUserAgent, getKiroAmzUserAgent } from './kiroApi.js'
import type { ClaudeRequest, ProxyAccount, ApiKey } from './types.js'

const logger = createLogger('WebSearch')

// ============= MCP Types =============

interface McpRequest {
  id: string
  jsonrpc: string
  method: string
  params: {
    name: string
    arguments: { query: string }
  }
}

interface McpResponse {
  error?: { code?: number; message?: string }
  id: string
  jsonrpc: string
  result?: {
    content: { type: string; text: string }[]
    isError: boolean
  }
}

interface WebSearchResult {
  title: string
  url: string
  snippet?: string
  publishedDate?: number
  id?: string
  domain?: string
}

interface WebSearchResults {
  results: WebSearchResult[]
  totalResults?: number
  query?: string
  error?: string
}

// ============= Detection & Extraction =============

/**
 * 检查请求是否为纯 WebSearch 请求
 * 条件：tools 有且只有一个，且 name 为 web_search
 */
export function hasWebSearchTool(request: ClaudeRequest): boolean {
  return (
    !!request.tools &&
    request.tools.length === 1 &&
    request.tools[0].name === 'web_search'
  )
}

/**
 * 从消息中提取搜索查询
 * 读取最后一条 user 消息的第一个文本内容块
 * 并去除 "Perform a web search for the query: " 前缀
 */
function extractSearchQuery(request: ClaudeRequest): string | null {
  // 找最后一条 user 消息
  const userMessages = request.messages.filter(m => m.role === 'user')
  const lastMsg = userMessages[userMessages.length - 1]
  if (!lastMsg) return null

  let text: string | null = null

  if (typeof lastMsg.content === 'string') {
    text = lastMsg.content
  } else if (Array.isArray(lastMsg.content)) {
    const textBlock = lastMsg.content.find(b => b.type === 'text')
    if (textBlock?.text) {
      text = textBlock.text
    }
  }

  if (!text) return null

  // 去除前缀
  const PREFIX = 'Perform a web search for the query: '
  const query = text.startsWith(PREFIX) ? text.slice(PREFIX.length) : text

  return query.trim() || null
}

// ============= Random ID Generators =============

function randomAlphanumeric(length: number, lowercase = false): string {
  const charset = lowercase
    ? 'abcdefghijklmnopqrstuvwxyz0123456789'
    : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += charset[Math.floor(Math.random() * charset.length)]
  }
  return result
}

// ============= MCP Request =============

/**
 * 创建 MCP 请求
 * ID 格式: web_search_tooluse_{22位随机}_{毫秒时间戳}_{8位随机}
 */
function createMcpRequest(query: string): { toolUseId: string; request: McpRequest } {
  const random22 = randomAlphanumeric(22)
  const timestamp = Date.now()
  const random8 = randomAlphanumeric(8, true)

  const requestId = `web_search_tooluse_${random22}_${timestamp}_${random8}`
  const toolUseId = `srvtoolu_${uuidv4().replace(/-/g, '').slice(0, 32)}`

  return {
    toolUseId,
    request: {
      id: requestId,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'web_search',
        arguments: { query }
      }
    }
  }
}

// ============= MCP API Call =============

/**
 * 调用 Kiro MCP API
 */
async function callMcpApi(
  account: ProxyAccount,
  mcpRequest: McpRequest
): Promise<WebSearchResults | null> {
  const machineId = account.machineId
  const url = 'https://q.us-east-1.amazonaws.com/mcp'

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': getKiroUserAgent(machineId),
    'X-Amz-User-Agent': getKiroAmzUserAgent(machineId),
    'Amz-Sdk-Invocation-Id': uuidv4(),
    'Amz-Sdk-Request': 'attempt=1; max=3',
    'Authorization': `Bearer ${account.accessToken}`
  }

  // 注意：不添加 x-amzn-device-id header，machineId 已通过 User-Agent 传递（与 kiro-m 保持一致）

  const body = JSON.stringify(mcpRequest)
  logger.debug('MCP request', { url, bodyLength: body.length })

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('MCP request failed', { status: response.status, error: errorText })
      return null
    }

    const data = await response.json() as McpResponse

    if (data.error) {
      logger.error('MCP error', {
        code: data.error.code,
        message: data.error.message
      })
      return null
    }

    // 解析搜索结果
    const content = data.result?.content?.[0]
    if (!content || content.type !== 'text') return null

    return JSON.parse(content.text) as WebSearchResults
  } catch (error) {
    logger.error('MCP API call error', { error: (error as Error).message })
    return null
  }
}

// ============= SSE Event Generation =============

function sseEvent(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * 生成搜索结果摘要文本
 */
function generateSearchSummary(query: string, results: WebSearchResults | null): string {
  let summary = `Here are the search results for "${query}":\n\n`

  if (results && results.results.length > 0) {
    for (let i = 0; i < results.results.length; i++) {
      const r = results.results[i]
      summary += `${i + 1}. **${r.title}**\n`
      if (r.snippet) {
        const truncated = r.snippet.length > 200
          ? r.snippet.slice(0, 200) + '...'
          : r.snippet
        summary += `   ${truncated}\n`
      }
      summary += `   Source: ${r.url}\n\n`
    }
  } else {
    summary += 'No results found.\n'
  }

  summary += '\nPlease note that these are web search results and may not be fully accurate or up-to-date.'
  return summary
}

/**
 * 生成完整的 Claude SSE 事件序列
 */
function generateWebSearchSSE(
  model: string,
  query: string,
  toolUseId: string,
  results: WebSearchResults | null,
  inputTokens: number
): string[] {
  const events: string[] = []
  const messageId = `msg_${uuidv4().replace(/-/g, '').slice(0, 24)}`

  // 1. message_start
  events.push(sseEvent('message_start', {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0
      }
    }
  }))

  // 2. content_block_start (server_tool_use)
  events.push(sseEvent('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: {
      id: toolUseId,
      type: 'server_tool_use',
      name: 'web_search',
      input: {}
    }
  }))

  // 3. content_block_delta (input_json_delta)
  events.push(sseEvent('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'input_json_delta',
      partial_json: JSON.stringify({ query })
    }
  }))

  // 4. content_block_stop (server_tool_use)
  events.push(sseEvent('content_block_stop', {
    type: 'content_block_stop',
    index: 0
  }))

  // 5. content_block_start (web_search_tool_result)
  const searchContent = results
    ? results.results.map(r => ({
        type: 'web_search_result',
        title: r.title,
        url: r.url,
        encrypted_content: r.snippet || '',
        page_age: null
      }))
    : []

  events.push(sseEvent('content_block_start', {
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'web_search_tool_result',
      tool_use_id: toolUseId,
      content: searchContent
    }
  }))

  // 6. content_block_stop (web_search_tool_result)
  events.push(sseEvent('content_block_stop', {
    type: 'content_block_stop',
    index: 1
  }))

  // 7. content_block_start (text)
  events.push(sseEvent('content_block_start', {
    type: 'content_block_start',
    index: 2,
    content_block: {
      type: 'text',
      text: ''
    }
  }))

  // 8. content_block_delta (text_delta) - 分块发送摘要
  const summary = generateSearchSummary(query, results)
  const CHUNK_SIZE = 100
  const chars = [...summary]
  for (let i = 0; i < chars.length; i += CHUNK_SIZE) {
    const chunk = chars.slice(i, i + CHUNK_SIZE).join('')
    events.push(sseEvent('content_block_delta', {
      type: 'content_block_delta',
      index: 2,
      delta: {
        type: 'text_delta',
        text: chunk
      }
    }))
  }

  // 9. content_block_stop (text)
  events.push(sseEvent('content_block_stop', {
    type: 'content_block_stop',
    index: 2
  }))

  // 10. message_delta
  const outputTokens = Math.ceil((summary.length + 3) / 4)
  events.push(sseEvent('message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: 'end_turn',
      stop_sequence: null
    },
    usage: {
      output_tokens: outputTokens
    }
  }))

  // 11. message_stop
  events.push(sseEvent('message_stop', {
    type: 'message_stop'
  }))

  return events
}

// ============= Main Handler =============

/**
 * 处理 WebSearch 流式请求
 * 完全绕过 Kiro generateAssistantResponse，直接调用 MCP 端点
 */
export async function handleWebSearchStream(
  request: ClaudeRequest,
  account: ProxyAccount,
  callbacks: {
    onChunk: (chunk: string) => void
    onComplete: () => void
    onError: (error: Error) => void
  },
  _matchedApiKey?: ApiKey
): Promise<void> {
  // 1. 提取搜索查询
  const query = extractSearchQuery(request)
  if (!query) {
    callbacks.onError(new Error('无法从消息中提取搜索查询'))
    return
  }

  logger.info('WebSearch request', { query, accountId: account.id })

  // 2. 创建 MCP 请求
  const { toolUseId, request: mcpRequest } = createMcpRequest(query)

  // 3. 调用 Kiro MCP API
  const searchResults = await callMcpApi(account, mcpRequest)

  // 4. 估算 input tokens
  const inputTokens = Math.max(1, Math.round(JSON.stringify(request).length / 3))

  // 5. 生成 SSE 事件并发送
  const events = generateWebSearchSSE(
    request.model,
    query,
    toolUseId,
    searchResults,
    inputTokens
  )

  for (const event of events) {
    callbacks.onChunk(event)
  }

  callbacks.onComplete()
}
