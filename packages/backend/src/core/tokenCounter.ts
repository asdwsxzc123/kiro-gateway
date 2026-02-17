/**
 * Token 计算模块
 * 使用 js-tiktoken (cl100k_base) 进行 token 计数
 *
 * 注意事项：
 * - cl100k_base 是 GPT-4 的编码器，与 Claude 的实际 tokenizer 存在差异
 * - 使用 1.15 修正系数作为经验值补偿
 * - 用于预估和展示，关键场景应以 API 返回的实际 token 数为准
 */

import { getEncoding as getTiktokenEncoding, type Tiktoken } from 'js-tiktoken'
import type {
  ClaudeMessage,
  ClaudeContentBlock,
  ClaudeTool,
  ClaudeSystemBlock,
} from './types.js'

// ============ 常量定义 ============

/**
 * Claude 修正系数
 * 经验值：Claude 比 GPT-4 (cl100k_base) 多约 15% token
 */
const CLAUDE_CORRECTION_FACTOR = 1.15

/**
 * 消息结构开销（role + 分隔符）
 */
const MESSAGE_OVERHEAD_TOKENS = 4

/**
 * 最终服务 token
 */
const FINAL_SERVICE_TOKENS = 3

/**
 * 每个工具/tool_call 开销
 */
const TOOL_OVERHEAD_TOKENS = 4

/**
 * 图片 token 估算
 * Claude 图片 token 取决于分辨率，范围约 85-1590 tokens
 * 这里使用保守的中等估算值
 */
const IMAGE_ESTIMATE_TOKENS = 200

// ============ 编码器缓存 ============

/**
 * 编码器缓存
 * - null: 未初始化
 * - false: 初始化失败
 * - Tiktoken: 初始化成功
 */
let _encoding: Tiktoken | false | null = null

/**
 * 获取 tiktoken 编码器（懒加载 + 缓存）
 * @returns 编码器实例，初始化失败时返回 null
 */
function getTokenEncoder(): Tiktoken | null {
  if (_encoding === null) {
    try {
      _encoding = getTiktokenEncoding('cl100k_base')
    } catch (e) {
      console.warn('[TokenCounter] tiktoken not available, using fallback estimation')
      _encoding = false // 标记初始化失败
    }
  }
  return _encoding || null
}

// ============ 核心计数函数 ============

/**
 * 计算文本的 token 数量
 * @param text - 要计算的文本
 * @param applyCorrection - 是否应用 Claude 修正系数（默认 true）
 * @returns token 数量
 */
export function countTokens(text: string, applyCorrection = true): number {
  if (!text) return 0

  const encoder = getTokenEncoder()
  let baseTokens: number

  if (encoder) {
    try {
      baseTokens = encoder.encode(text).length
    } catch {
      // 编码失败时使用 fallback
      baseTokens = Math.floor(text.length / 4) + 1
    }
  } else {
    // Fallback: ~4 字符/token
    baseTokens = Math.floor(text.length / 4) + 1
  }

  return applyCorrection
    ? Math.floor(baseTokens * CLAUDE_CORRECTION_FACTOR)
    : baseTokens
}

/**
 * 计算 Claude 内容块的 token 数量
 * @param blocks - Claude 内容块数组
 * @returns token 数量（不含修正系数）
 */
function countClaudeContentBlocks(blocks: ClaudeContentBlock[]): number {
  let total = 0

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        // 文本内容
        total += countTokens(block.text || '', false)
        break

      case 'thinking':
        // 思考内容
        total += countTokens(block.thinking || '', false)
        break

      case 'image':
        // 图片 token 估算
        total += IMAGE_ESTIMATE_TOKENS
        break

      case 'tool_use':
        // 工具调用
        total += TOOL_OVERHEAD_TOKENS
        total += countTokens(block.name || '', false)
        // input 是对象，需要序列化
        if (block.input !== undefined) {
          total += countTokens(
            typeof block.input === 'string'
              ? block.input
              : JSON.stringify(block.input),
            false
          )
        }
        break

      case 'tool_result':
        // 工具结果
        total += TOOL_OVERHEAD_TOKENS
        total += countTokens(block.tool_use_id || '', false)
        if (typeof block.content === 'string') {
          total += countTokens(block.content, false)
        } else if (Array.isArray(block.content)) {
          // 递归处理嵌套内容块
          total += countClaudeContentBlocks(block.content)
        }
        break
    }
  }

  return total
}

/**
 * 计算 Claude 格式消息的 token 数量
 * @param messages - Claude 消息数组
 * @param applyCorrection - 是否应用 Claude 修正系数（默认 true）
 * @returns token 数量
 */
function countClaudeMessageTokens(
  messages: ClaudeMessage[],
  applyCorrection = true
): number {
  let total = 0

  for (const msg of messages) {
    // 消息结构开销
    total += MESSAGE_OVERHEAD_TOKENS

    // role
    total += countTokens(msg.role, false)

    // content
    const content = msg.content
    if (typeof content === 'string') {
      total += countTokens(content, false)
    } else if (Array.isArray(content)) {
      total += countClaudeContentBlocks(content)
    }
  }

  // 最终服务 token
  total += FINAL_SERVICE_TOKENS

  return applyCorrection
    ? Math.floor(total * CLAUDE_CORRECTION_FACTOR)
    : total
}

/**
 * 计算 Claude 格式工具定义的 token 数量
 * @param tools - Claude 工具定义数组
 * @param applyCorrection - 是否应用 Claude 修正系数（默认 true）
 * @returns token 数量
 */
function countClaudeToolsTokens(
  tools: ClaudeTool[] | undefined,
  applyCorrection = true
): number {
  if (!tools?.length) return 0

  let total = 0

  for (const tool of tools) {
    total += TOOL_OVERHEAD_TOKENS
    total += countTokens(tool.name, false)
    if (tool.description) {
      total += countTokens(tool.description, false)
    }
    if (tool.input_schema) {
      total += countTokens(JSON.stringify(tool.input_schema), false)
    }
  }

  return applyCorrection
    ? Math.floor(total * CLAUDE_CORRECTION_FACTOR)
    : total
}

// ============ 导出函数 ============

/**
 * 估算请求的输入 tokens（本地计算）
 * 支持 Claude API 的 count_tokens 请求格式
 *
 * @param _model - 模型名称（预留，当前未使用）
 * @param system - 系统消息（字符串或 ClaudeSystemBlock 数组）
 * @param messages - 消息列表
 * @param tools - 工具定义列表
 * @returns 估算的 token 数量
 */
export function countAllTokens(
  _model: string,
  system: unknown,
  messages: ClaudeMessage[],
  tools?: ClaudeTool[]
): number {
  let total = 0

  // 系统消息
  if (system) {
    if (typeof system === 'string') {
      total += countTokens(system)
    } else if (Array.isArray(system)) {
      for (const item of system as ClaudeSystemBlock[]) {
        if (typeof item === 'string') {
          total += countTokens(item)
        } else if (item?.text) {
          total += countTokens(item.text)
        }
      }
    }
  }

  // 消息（内部已应用修正系数）
  total += countClaudeMessageTokens(messages)

  // 工具（内部已应用修正系数）
  total += countClaudeToolsTokens(tools)

  return Math.max(total, 1)
}
