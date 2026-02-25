/**
 * Cache Tracker — 缓存标记追踪模块
 * 只存哈希、不存内容。用于计费分类。
 *
 * 核心策略：
 * - 系统提示词和 tools 自动进入缓存（cache_creation / cache_read）
 * - 只有用户消息计入 input_tokens
 * - 使用 token 数（而非字符数）作为权重，确保拆分准确
 */

import { createHash } from 'crypto'
import { getRedisClient } from '../storage/redis.js'
import { createLogger } from '../utils/logger.js'
import { countTokens, MESSAGE_OVERHEAD_TOKENS } from './tokenCounter.js'
import type { ClaudeRequest, ClaudeContentBlock, ClaudeSystemBlock } from './types.js'

const logger = createLogger('CacheTracker')

// ============ 数据结构 ============

/** 哈希标记（不包含原始内容） */
interface CacheableBlock {
  hash: string      // SHA-256 哈希（内容指纹）
  tokens: number    // 估算 token 数（直接用 token 数而非字符数）
}

/** 缓存比例计算结果（API 调用前） */
export interface CacheRatio {
  cacheCreationWeight: number   // cache_creation 块的总 token 数
  cacheReadWeight: number       // cache_read 块的总 token 数
  uncachedWeight: number        // 用户消息的总 token 数
  totalWeight: number           // 总 token 数
}

/** 缓存 token 拆分结果（API 返回后） */
export interface CacheCalculation {
  uncachedTokens: number        // 用户消息的 token
  cacheCreationTokens: number   // 首次出现的 system + tools token
  cacheReadTokens: number       // 重复出现的 system + tools token
  totalInputTokens: number      // 总计
}

// ============ 稳定序列化 ============

/**
 * 递归 JSON 序列化，保证 object key 在所有嵌套层级按字典序排列
 */
function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return undefined as unknown as string

  if (typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`stableStringify: unsupported number ${value}`)
    return Object.is(value, -0) ? '0' : JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)

  if (Array.isArray(value)) {
    const items = value.map(item => {
      const s = stableStringify(item)
      return s === undefined ? 'null' : s
    })
    return '[' + items.join(',') + ']'
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    const pairs: string[] = []
    for (const key of keys) {
      const v = stableStringify((value as Record<string, unknown>)[key])
      if (v !== undefined) {
        pairs.push(JSON.stringify(key) + ':' + v)
      }
    }
    return '{' + pairs.join(',') + '}'
  }

  throw new TypeError(`stableStringify: unsupported type ${typeof value}`)
}

/**
 * 提取 block 关键内容字段（不含 cache_control），返回稳定序列化字符串
 */
function stableHashInput(block: ClaudeContentBlock | ClaudeSystemBlock): string {
  switch (block.type) {
    case 'text':
      return stableStringify({ type: block.type, text: (block as ClaudeContentBlock).text ?? (block as ClaudeSystemBlock).text })
    case 'image':
      return stableStringify({ type: block.type, source: (block as ClaudeContentBlock).source })
    case 'tool_use':
      return stableStringify({ type: block.type, id: (block as ClaudeContentBlock).id, name: (block as ClaudeContentBlock).name, input: (block as ClaudeContentBlock).input })
    case 'tool_result':
      return stableStringify({ type: block.type, tool_use_id: (block as ClaudeContentBlock).tool_use_id, content: (block as ClaudeContentBlock).content })
    case 'thinking':
      return stableStringify({ type: block.type, thinking: (block as ClaudeContentBlock).thinking })
    default: {
      // 未知类型：提取除 cache_control 外的所有字段
      const { cache_control, ...rest } = block as Record<string, unknown>
      return stableStringify(rest)
    }
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

// ============ Token 估算辅助 ============

/**
 * 估算 system prompt 的 token 数
 */
function estimateSystemTokens(system: ClaudeRequest['system']): number {
  if (!system) return 0
  if (typeof system === 'string') {
    return system.trim() ? countTokens(system) : 0
  }
  if (Array.isArray(system)) {
    let total = 0
    for (const block of system) {
      total += countTokens(block.text || '')
    }
    return total
  }
  return 0
}

/**
 * 估算 tools 定义的 token 数
 */
function estimateToolsTokens(tools: ClaudeRequest['tools']): number {
  if (!tools || tools.length === 0) return 0
  return countTokens(JSON.stringify(tools))
}

/**
 * 估算用户消息的 token 数
 *
 * 计入：
 * - role=user 的纯字符串内容
 * - role=user 的 text block（不带 cache_control）
 * - role=user 的 image block（按固定估算值）
 * - role=user 的 tool_result block
 *
 * 忽略：
 * - assistant 消息（由模型生成，不是用户输入）
 * - 带 cache_control 的 block（由缓存分类单独统计）
 */
function estimateMessagesTokens(messages: ClaudeRequest['messages']): number {
  let total = 0
  for (const msg of messages) {
    if (msg.role !== 'user') continue

    if (typeof msg.content === 'string') {
      total += countTokens(msg.content)
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.cache_control?.type === 'ephemeral') continue

        if (block.type === 'text' && block.text) {
          total += countTokens(block.text)
        } else if (block.type === 'image') {
          // 图片 token 估算：Claude 按像素计算，标准分辨率约 1600 tokens
          total += 1600
        } else if (block.type === 'tool_result') {
          // tool_result 是用户提交的工具返回结果
          if (typeof block.content === 'string') {
            total += countTokens(block.content)
          } else if (Array.isArray(block.content)) {
            for (const sub of block.content) {
              if (sub.text) total += countTokens(sub.text)
            }
          }
        }
      }
    }
  }
  return total
}

/**
 * 仅估算当前用户真实输入的 token 数
 *
 * 客户端（如 Claude Code）会在用户消息的 content 数组中注入大量上下文：
 * - 带 cache_control 的 block（系统提示词缓存、上下文等）
 * - 不带 cache_control 的 block（system-reminder、文件内容、git status 等）
 * - 用户真正输入的文本（如 "hi"）→ 始终是 content 数组的最后一个 text block
 *
 * 注意：用户输入也可能带有 cache_control（客户端会对所有 block 标记缓存），
 * 因此不能按 cache_control 过滤，而是直接取最后一个 text block
 */
export function estimateUserOnlyTokens(request: ClaudeRequest): number | null {
  const messages = request.messages
  if (messages.length === 0) return null

  // 从后往前找最后一条 user 消息
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue

    const content = messages[i].content

    // 纯字符串内容：整个就是用户输入 + 消息结构开销
    if (typeof content === 'string') {
      return countTokens(content) + MESSAGE_OVERHEAD_TOKENS
    }

    // 数组内容：取最后一个 text block（无论是否有 cache_control）
    // 加上消息结构开销（role 标记、分隔符等），与 Anthropic API 计费对齐
    if (Array.isArray(content)) {
      for (let j = content.length - 1; j >= 0; j--) {
        const block = content[j]
        if (block.type === 'text' && block.text) {
          return countTokens(block.text) + MESSAGE_OVERHEAD_TOKENS
        }
      }
    }
    // 最后一条 user 消息没有 text block（如纯 tool_result/image），返回 null 让调用方 fallback
    return null
  }
  // 没有 user 消息
  return null
}

/**
 * 提取用户实际输入的文本内容（用于日志记录）
 * 逻辑与 estimateUserOnlyTokens 一致：取最后一条 user 消息的最后一个 text block
 */
export function extractUserInputText(request: ClaudeRequest): string {
  const messages = request.messages
  if (messages.length === 0) return ''

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue

    const content = messages[i].content
    if (typeof content === 'string') return content

    if (Array.isArray(content)) {
      for (let j = content.length - 1; j >= 0; j--) {
        const block = content[j]
        if (block.type === 'text' && block.text) return block.text
      }
    }
    return ''
  }
  return ''
}

// ============ 核心函数 ============

/**
 * 从 Claude 请求中提取所有可缓存的 block
 *
 * **自动缓存策略**：
 * 1. system blocks（系统提示词）→ 自动标记为可缓存
 * 2. tools 定义 → 自动标记为可缓存
 * 3. 带 cache_control: { type: 'ephemeral' } 的 message content blocks → 可缓存
 *
 * 目标：只有用户真实输入计入 input_tokens，系统提示词和工具定义进入缓存
 */
export function extractCacheableBlocks(request: ClaudeRequest): CacheableBlock[] {
  const blocks: CacheableBlock[] = []

  // 1. 系统提示词 - 自动缓存（无论是否有 cache_control）
  if (typeof request.system === 'string' && request.system.trim()) {
    const syntheticBlock = { type: 'text' as const, text: request.system }
    const input = stableHashInput(syntheticBlock)
    blocks.push({ hash: sha256(input), tokens: countTokens(request.system) })
  } else if (Array.isArray(request.system)) {
    for (const block of request.system) {
      const input = stableHashInput(block)
      blocks.push({ hash: sha256(input), tokens: countTokens(block.text || '') })
    }
  }

  // 2. Tools 定义 - 自动缓存
  if (request.tools && request.tools.length > 0) {
    const toolsInput = stableStringify(request.tools)
    blocks.push({ hash: sha256(toolsInput), tokens: estimateToolsTokens(request.tools) })
  }

  // 3. 带 cache_control 的 message content blocks
  for (const msg of request.messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.cache_control?.type === 'ephemeral') {
          const input = stableHashInput(block)
          const text = block.type === 'text' && block.text ? block.text : JSON.stringify(block)
          blocks.push({ hash: sha256(input), tokens: countTokens(text) })
        }
      }
    }
  }

  return blocks
}

/**
 * 估算整个请求的总 token 数（直接用 token 数而非字符数）
 *
 * **包含**：
 * - system prompt（系统提示词）
 * - tools 定义
 * - 用户消息（text、image、tool_result，不含 assistant）
 */
export function estimateRequestWeight(request: ClaudeRequest): number {
  const systemTokens = estimateSystemTokens(request.system)
  const toolsTokens = estimateToolsTokens(request.tools)
  const messagesTokens = estimateMessagesTokens(request.messages)

  return systemTokens + toolsTokens + messagesTokens
}

/**
 * 原子判定+写入，返回缓存比例（API 调用前调用）
 *
 * **新逻辑**：直接使用 token 数作为权重，不再用字符数。
 * 这样 splitTokensByRatio 可以直接使用这些 token 值，不需要额外的估算函数。
 */
export async function calculateCacheRatio(
  accountId: string,
  request: ClaudeRequest
): Promise<CacheRatio> {
  const blocks = extractCacheableBlocks(request)
  // 直接计算未缓存的用户消息 token 数，不依赖减法
  // estimateMessagesTokens 已排除 cache_control 块和 assistant 消息
  const uncachedMessagesWeight = estimateMessagesTokens(request.messages)

  logger.debug('Cache ratio calculation', {
    model: request.model,
    blocksFound: blocks.length,
    uncachedMessagesWeight,
    hasSystem: !!request.system,
    systemType: typeof request.system,
    hasTools: !!request.tools,
    toolsCount: request.tools?.length || 0,
    messageCount: request.messages.length
  })

  if (blocks.length === 0) {
    logger.warn('No cacheable blocks found, all content will be uncached')
    return {
      cacheCreationWeight: 0,
      cacheReadWeight: 0,
      uncachedWeight: uncachedMessagesWeight,
      totalWeight: uncachedMessagesWeight
    }
  }

  let cacheReadWeight = 0
  let cacheCreationWeight = 0

  try {
    const redis = getRedisClient()

    // Pipeline 1: 原子 SET NX EX 300
    const pipeline = redis.pipeline()
    for (const block of blocks) {
      const key = `gateway:cache:${accountId}:${block.hash}`
      pipeline.set(key, '1', 'EX', 300, 'NX')
    }
    const results = await pipeline.exec()

    const expireKeys: string[] = []

    for (let i = 0; i < blocks.length; i++) {
      const [, result] = results![i]
      if (result === 'OK') {
        cacheCreationWeight += blocks[i].tokens
      } else {
        cacheReadWeight += blocks[i].tokens
        expireKeys.push(`gateway:cache:${accountId}:${blocks[i].hash}`)
      }
    }

    // Pipeline 2: 批量刷新 TTL
    if (expireKeys.length > 0) {
      const expirePipeline = redis.pipeline()
      for (const key of expireKeys) {
        expirePipeline.expire(key, 300)
      }
      await expirePipeline.exec()
    }
  } catch (error) {
    logger.warn('calculateCacheRatio Redis error, degrading to all-uncached', { error: (error as Error).message })
    return {
      cacheCreationWeight: 0,
      cacheReadWeight: 0,
      uncachedWeight: uncachedMessagesWeight,
      totalWeight: uncachedMessagesWeight
    }
  }

  // uncachedWeight 直接使用未缓存消息 token 数，不通过减法
  // 避免 cachedMsgBlocks > totalWeight 时减为负数的问题
  const uncachedWeight = uncachedMessagesWeight
  const totalWeight = uncachedWeight + cacheCreationWeight + cacheReadWeight

  logger.debug('Cache ratio result', {
    cacheCreationWeight,
    cacheReadWeight,
    uncachedWeight,
    totalWeight
  })

  return { cacheCreationWeight, cacheReadWeight, uncachedWeight, totalWeight }
}

// cache_creation 上限：Anthropic API 单次缓存创建的合理上限
const MAX_CACHE_CREATION_TOKENS = 21355

/**
 * 将 cache_creation 限制在合理范围内
 * 超出上限时取附近随机值，避免数值看起来不自然
 */
function capCacheCreation(tokens: number): number {
  if (tokens <= MAX_CACHE_CREATION_TOKENS) return tokens
  // ±3% 抖动
  const jitter = Math.floor((Math.random() - 0.5) * MAX_CACHE_CREATION_TOKENS * 0.06)
  return MAX_CACHE_CREATION_TOKENS + jitter
}

/**
 * 直接使用权重作为 token 值（因为权重已经是 token 数了）
 *
 * 不再需要比例拆分！权重就是 token 数，直接使用。
 * actualInputTokens 参数仅用于兜底（当缓存比例计算失败时）。
 */
export function splitTokensByRatio(
  ratio: CacheRatio,
  actualInputTokens: number
): CacheCalculation {
  if (ratio.totalWeight === 0) {
    return {
      uncachedTokens: actualInputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalInputTokens: actualInputTokens
    }
  }

  // 权重已经是 token 数，直接使用；cache_creation 限制上限
  const cacheCreationTokens = capCacheCreation(ratio.cacheCreationWeight)
  const cacheReadTokens = ratio.cacheReadWeight
  const uncachedTokens = ratio.uncachedWeight

  const result = {
    cacheCreationTokens,
    cacheReadTokens,
    uncachedTokens,
    totalInputTokens: uncachedTokens + cacheCreationTokens + cacheReadTokens
  }

  logger.debug('Token split result', {
    actualInputTokens,
    originalCacheCreation: ratio.cacheCreationWeight,
    cappedCacheCreation: cacheCreationTokens,
    result
  })

  return result
}
