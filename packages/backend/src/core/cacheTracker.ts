/**
 * Cache Tracker — 缓存标记追踪模块
 * 只存哈希、不存内容。用于计费分类。
 */

import { createHash } from 'crypto'
import { getRedisClient } from '../storage/redis.js'
import { createLogger } from '../utils/logger.js'
import type { ClaudeRequest, ClaudeContentBlock, ClaudeSystemBlock } from './types.js'

const logger = createLogger('CacheTracker')

// ============ 数据结构 ============

/** 哈希标记（不包含原始内容） */
interface CacheableBlock {
  hash: string      // SHA-256 哈希（内容指纹）
  weight: number    // 估算字符数（用于确定比例）
}

/** 缓存比例计算结果（API 调用前） */
export interface CacheRatio {
  cacheCreationWeight: number   // cache_creation 块的总权重
  cacheReadWeight: number       // cache_read 块的总权重
  uncachedWeight: number        // 未标记 cache_control 的内容权重
  totalWeight: number           // 总权重
}

/** 缓存 token 拆分结果（API 返回后） */
export interface CacheCalculation {
  uncachedTokens: number        // 未标记 cache_control 的 token
  cacheCreationTokens: number   // 首次出现的 cache_control token
  cacheReadTokens: number       // 重复出现的 cache_control token
  totalInputTokens: number      // 等于 API 返回的 inputTokens
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
    blocks.push({ hash: sha256(input), weight: input.length })
  } else if (Array.isArray(request.system)) {
    for (const block of request.system) {
      const input = stableHashInput(block)
      blocks.push({ hash: sha256(input), weight: input.length })
    }
  }

  // 2. Tools 定义 - 自动缓存
  if (request.tools && request.tools.length > 0) {
    const toolsInput = stableStringify(request.tools)
    blocks.push({ hash: sha256(toolsInput), weight: toolsInput.length })
  }

  // 3. 带 cache_control 的 message content blocks
  for (const msg of request.messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.cache_control?.type === 'ephemeral') {
          const input = stableHashInput(block)
          blocks.push({ hash: sha256(input), weight: input.length })
        }
      }
    }
  }

  return blocks
}

/**
 * 估算整个请求的总权重（包含标记和未标记的内容）
 * 使用 stableHashInput().length 确保与哈希权重口径一致
 *
 * **包含**：
 * - system prompt（系统提示词）
 * - tools 定义
 * - messages（用户消息和助手消息）
 */
export function estimateRequestWeight(request: ClaudeRequest): number {
  let totalWeight = 0

  // 1. system prompt
  if (typeof request.system === 'string' && request.system.trim()) {
    totalWeight += stableHashInput({ type: 'text', text: request.system } as ClaudeSystemBlock).length
  } else if (Array.isArray(request.system)) {
    for (const block of request.system) {
      totalWeight += stableHashInput(block).length
    }
  }

  // 2. tools 定义
  if (request.tools && request.tools.length > 0) {
    totalWeight += stableStringify(request.tools).length
  }

  // 3. messages
  for (const msg of request.messages) {
    if (typeof msg.content === 'string') {
      totalWeight += stableHashInput({ type: 'text', text: msg.content } as ClaudeSystemBlock).length
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        totalWeight += stableHashInput(block).length
      }
    }
  }

  return totalWeight
}

/**
 * 原子判定+写入，返回缓存比例（API 调用前调用）
 */
export async function calculateCacheRatio(
  accountId: string,
  request: ClaudeRequest
): Promise<CacheRatio> {
  const blocks = extractCacheableBlocks(request)
  const totalWeight = estimateRequestWeight(request)

  logger.info('Cache ratio calculation', {
    model: request.model,
    blocksFound: blocks.length,
    totalWeight,
    hasSystem: !!request.system,
    systemType: typeof request.system,
    hasTools: !!request.tools,
    toolsCount: request.tools?.length || 0,
    messageCount: request.messages.length,
    blockWeights: blocks.map(b => ({ hash: b.hash.substring(0, 8), weight: b.weight }))
  })

  if (blocks.length === 0) {
    logger.warn('No cacheable blocks found, all content will be uncached')
    return {
      cacheCreationWeight: 0,
      cacheReadWeight: 0,
      uncachedWeight: totalWeight,
      totalWeight
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
        cacheCreationWeight += blocks[i].weight
      } else {
        cacheReadWeight += blocks[i].weight
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
      uncachedWeight: totalWeight,
      totalWeight
    }
  }

  const markedWeight = cacheReadWeight + cacheCreationWeight
  const uncachedWeight = Math.max(0, totalWeight - markedWeight)

  return { cacheCreationWeight, cacheReadWeight, uncachedWeight, totalWeight }
}

/**
 * 最大余数法：根据比例和 API 返回的真实 token 总量，拆分为三类
 * 保证: cacheCreationTokens + cacheReadTokens + uncachedTokens === totalInputTokens
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

  const total = actualInputTokens

  // 1. 精确浮点值
  const exactCreation = total * (ratio.cacheCreationWeight / ratio.totalWeight)
  const exactRead = total * (ratio.cacheReadWeight / ratio.totalWeight)
  const exactUncached = total * (ratio.uncachedWeight / ratio.totalWeight)

  // 2. 全部 floor
  let creation = Math.floor(exactCreation)
  let read = Math.floor(exactRead)
  let uncached = Math.floor(exactUncached)

  // 3. 余数
  let remainder = total - creation - read - uncached

  // 4. 按小数部分降序分配（最大余数法）
  const fractions = [
    { key: 'creation' as const, frac: exactCreation - creation },
    { key: 'read' as const, frac: exactRead - read },
    { key: 'uncached' as const, frac: exactUncached - uncached }
  ]
  fractions.sort((a, b) => b.frac - a.frac)

  for (const item of fractions) {
    if (remainder <= 0) break
    if (item.key === 'creation') creation++
    else if (item.key === 'read') read++
    else uncached++
    remainder--
  }

  const result = {
    cacheCreationTokens: creation,
    cacheReadTokens: read,
    uncachedTokens: uncached,
    totalInputTokens: total
  }

  logger.info('Token split result', {
    ratio: {
      cacheCreationWeight: ratio.cacheCreationWeight,
      cacheReadWeight: ratio.cacheReadWeight,
      uncachedWeight: ratio.uncachedWeight,
      totalWeight: ratio.totalWeight
    },
    actualInputTokens,
    result
  })

  return result
}
