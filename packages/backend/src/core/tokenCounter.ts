/**
 * Token 计算模块
 * 使用 js-tiktoken (cl100k_base) 进行 token 计数
 *
 * 基于 Anthropic count_tokens API 基准测试校准（2026-02-21）：
 * - cl100k_base 对 ASCII 内容（英文/代码/JSON）**低估** 15-27%
 * - cl100k_base 对 CJK 内容（中文长文本）**高估** 8%
 * - 采用三层内容感知修正：CJK 比例 + 代码密度 + 文本长度
 * - 消息结构开销基于 API 实测校准（~20 tokens/message）
 *
 * 详见: src/scripts/TOKEN_BENCHMARK_RESULTS.md
 */

import { getEncoding as getTiktokenEncoding, type Tiktoken } from 'js-tiktoken'
import type {
  ClaudeMessage,
  ClaudeContentBlock,
  ClaudeTool,
  ClaudeSystemBlock,
} from './types.js'

// ============ 修正系数（基于基准测试） ============

/**
 * ASCII 散文修正系数（英文、Markdown 普通文本）
 * v2 校准：1.23 导致英文 +11-15%，降至 1.15 使英文 ~+3-7%
 * 理想值推导：(actual - overhead) / contentTokens ≈ 1.06-1.08
 * 取 1.15 保留少量安全余量
 */
const FACTOR_NON_CJK = 1.15

/**
 * 纯代码/JSON 修正系数（高代码密度 > 0.10）
 * 特殊标点 {}[]();:, 在 Claude tokenizer 中产生更多 token
 * 基准测试：Code 1.26-1.33, JSON 1.29-1.37
 */
const FACTOR_CODE = 1.32

/**
 * CJK 内容修正系数 — 中等文本（<1000 raw tokens）
 * 基准测试：Chinese medium 1.06
 */
const FACTOR_CJK_MEDIUM = 1.05

/**
 * CJK 内容修正系数 — 长文本（>=1000 raw tokens）
 * cl100k_base 对长 CJK 文本高估约 8%
 * 基准测试：Long Chinese 0.92
 */
const FACTOR_CJK_LONG = 0.92

/**
 * CJK raw token 阈值，区分"中等"和"长"文本
 */
const CJK_LONG_THRESHOLD = 500

// ============ 结构开销常量（基于 API 实测校准） ============

/**
 * 每条消息的结构开销
 * Claude 的消息格式包含 role 标记、分隔符、特殊 token 等
 * 基准测试推导：短文本 actual - content_tokens ≈ 20
 * 拆分为 MESSAGE_OVERHEAD(10) + REQUEST_OVERHEAD(10)
 */
export const MESSAGE_OVERHEAD_TOKENS = 1

/**
 * 请求级开销（服务前缀 + 终止标记）
 * 每个请求固定开销，与消息数量无关
 */
const REQUEST_OVERHEAD_TOKENS = 10

/**
 * 每个工具/tool_call 开销
 */
const TOOL_OVERHEAD_TOKENS = 4

/**
 * 图片 token 估算
 * Claude 图片 token 取决于分辨率，范围约 85-1590 tokens
 * 使用保守的中等估算值
 */
const IMAGE_ESTIMATE_TOKENS = 200

// ============ 内容检测 ============

/**
 * 计算文本中 CJK 字符的比例
 */
function detectCJKRatio(text: string): number {
  if (!text) return 0

  let cjkCount = 0
  for (const char of text) {
    const code = char.codePointAt(0) || 0
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK 统一表意文字
      (code >= 0x3400 && code <= 0x4DBF) ||   // CJK 扩展 A
      (code >= 0x20000 && code <= 0x2A6DF) || // CJK 扩展 B
      (code >= 0x3000 && code <= 0x303F) ||   // CJK 符号和标点
      (code >= 0xFF00 && code <= 0xFFEF) ||   // 全角字符
      (code >= 0x3040 && code <= 0x309F) ||   // 平假名
      (code >= 0x30A0 && code <= 0x30FF) ||   // 片假名
      (code >= 0xAC00 && code <= 0xD7AF)      // 韩文音节
    ) {
      cjkCount++
    }
  }

  return cjkCount / text.length
}

/**
 * 代码/JSON 特征密度检测
 * 仅统计强代码特征标点（排除 : , 等散文中也常见的字符）
 */
const CODE_PATTERN = /[{}[\]();<>|\\]/g

function detectCodeDensity(text: string): number {
  if (!text || text.length < 20) return 0
  const matches = text.match(CODE_PATTERN)
  return matches ? matches.length / text.length : 0
}

/**
 * 代码密度阈值
 * - 低阈值：开始混入代码特征（渐变起点）
 * - 高阈值：纯代码/JSON（使用完整 FACTOR_CODE）
 *
 * 散文 ~0.01-0.02, 混合 ~0.03-0.06, 纯代码 ~0.08-0.15
 */
const CODE_DENSITY_LOW = 0.03
const CODE_DENSITY_HIGH = 0.08

/**
 * 根据文本内容和长度计算自适应修正系数
 *
 * 决策逻辑：
 * 1. CJK 主导 (ratio > 0.3) → 按文本长度选择 CJK 系数，混合内容插值
 * 2. 高代码密度 (> HIGH) → FACTOR_CODE
 * 3. 中等代码密度 (LOW ~ HIGH) → NON_CJK 与 CODE 之间渐变
 * 4. 低代码密度 (< LOW) → FACTOR_NON_CJK
 */
function getCorrectionFactor(text: string, rawTokens: number): number {
  const cjkRatio = detectCJKRatio(text)
  const codeDensity = detectCodeDensity(text)

  // CJK 主导
  if (cjkRatio > 0.3) {
    const cjkFactor = rawTokens >= CJK_LONG_THRESHOLD
      ? FACTOR_CJK_LONG
      : FACTOR_CJK_MEDIUM
    // 非 CJK 部分的基准系数
    const nonCjkFactor = getCodeBlendedFactor(codeDensity)
    return nonCjkFactor + (cjkFactor - nonCjkFactor) * Math.min(cjkRatio * 2, 1)
  }

  // 非 CJK：按代码密度渐变
  return getCodeBlendedFactor(codeDensity)
}

/**
 * 根据代码密度在 NON_CJK 和 CODE 之间线性插值
 */
function getCodeBlendedFactor(codeDensity: number): number {
  if (codeDensity <= CODE_DENSITY_LOW) return FACTOR_NON_CJK
  if (codeDensity >= CODE_DENSITY_HIGH) return FACTOR_CODE

  // 线性插值
  const t = (codeDensity - CODE_DENSITY_LOW) / (CODE_DENSITY_HIGH - CODE_DENSITY_LOW)
  return FACTOR_NON_CJK + (FACTOR_CODE - FACTOR_NON_CJK) * t
}

// ============ 编码器缓存 ============

let _encoding: Tiktoken | false | null = null

function getTokenEncoder(): Tiktoken | null {
  if (_encoding === null) {
    try {
      _encoding = getTiktokenEncoding('cl100k_base')
    } catch {
      console.warn('[TokenCounter] tiktoken not available, using fallback estimation')
      _encoding = false
    }
  }
  return _encoding || null
}

// ============ 核心计数函数 ============

/**
 * 计算文本的 token 数量
 * @param text - 要计算的文本
 * @param applyCorrection - 是否应用内容感知修正系数（默认 true）
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
      baseTokens = Math.floor(text.length / 4) + 1
    }
  } else {
    baseTokens = Math.floor(text.length / 4) + 1
  }

  if (!applyCorrection) return baseTokens

  const factor = getCorrectionFactor(text, baseTokens)
  return Math.floor(baseTokens * factor)
}

/**
 * 计算 Claude 内容块的 token 数量（不含修正系数）
 */
function countClaudeContentBlocks(blocks: ClaudeContentBlock[]): number {
  let total = 0

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        total += countTokens(block.text || '', false)
        break

      case 'thinking':
        total += countTokens(block.thinking || '', false)
        break

      case 'image':
        total += IMAGE_ESTIMATE_TOKENS
        break

      case 'tool_use':
        total += TOOL_OVERHEAD_TOKENS
        total += countTokens(block.name || '', false)
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
        total += TOOL_OVERHEAD_TOKENS
        total += countTokens(block.tool_use_id || '', false)
        if (typeof block.content === 'string') {
          total += countTokens(block.content, false)
        } else if (Array.isArray(block.content)) {
          total += countClaudeContentBlocks(block.content)
        }
        break
    }
  }

  return total
}

/**
 * 收集消息中所有文本内容，用于计算整体修正系数
 */
function collectMessageText(messages: ClaudeMessage[]): string {
  const parts: string[] = []

  for (const msg of messages) {
    const content = msg.content
    if (typeof content === 'string') {
      parts.push(content)
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && block.text) parts.push(block.text)
        if (block.type === 'thinking' && block.thinking) parts.push(block.thinking)
      }
    }
  }

  return parts.join('')
}

/**
 * 获取文本的 raw token 数（不含修正）
 */
function getRawTokenCount(text: string): number {
  return countTokens(text, false)
}

/**
 * 计算 Claude 格式消息的 token 数量
 *
 * 关键：修正系数只应用于内容 token（cl100k 编码的部分），
 * 固定开销 token（MESSAGE_OVERHEAD、REQUEST_OVERHEAD）不需修正，
 * 因为它们已经是 Claude token 空间的已知常量。
 */
function countClaudeMessageTokens(
  messages: ClaudeMessage[],
  applyCorrection = true
): number {
  let contentTokens = 0 // 需要修正的内容 token
  let overheadTokens = 0 // 不需修正的固定开销

  for (const msg of messages) {
    overheadTokens += MESSAGE_OVERHEAD_TOKENS
    contentTokens += countTokens(msg.role, false)

    const content = msg.content
    if (typeof content === 'string') {
      contentTokens += countTokens(content, false)
    } else if (Array.isArray(content)) {
      contentTokens += countClaudeContentBlocks(content)
    }
  }

  overheadTokens += REQUEST_OVERHEAD_TOKENS

  if (!applyCorrection) return contentTokens + overheadTokens

  const allText = collectMessageText(messages)
  const rawTokens = getRawTokenCount(allText)
  const factor = getCorrectionFactor(allText, rawTokens)
  return Math.floor(contentTokens * factor) + overheadTokens
}

/**
 * 计算 Claude 格式工具定义的 token 数量
 * 工具定义以 JSON schema 为主，使用 FACTOR_CODE 系数
 * 固定开销 (TOOL_OVERHEAD_TOKENS) 不参与修正
 */
function countClaudeToolsTokens(
  tools: ClaudeTool[] | undefined,
  applyCorrection = true
): number {
  if (!tools?.length) return 0

  let contentTokens = 0
  let overheadTokens = 0

  for (const tool of tools) {
    overheadTokens += TOOL_OVERHEAD_TOKENS
    contentTokens += countTokens(tool.name, false)
    if (tool.description) {
      contentTokens += countTokens(tool.description, false)
    }
    if (tool.input_schema) {
      contentTokens += countTokens(JSON.stringify(tool.input_schema), false)
    }
  }

  return applyCorrection
    ? Math.floor(contentTokens * FACTOR_CODE) + overheadTokens
    : contentTokens + overheadTokens
}

// ============ 导出函数 ============

/**
 * 估算请求的输入 tokens（本地计算）
 * 支持 Claude API 的 count_tokens 请求格式
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
