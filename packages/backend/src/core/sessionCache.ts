/**
 * Session Cache — Sticky Session 路由模块
 * 确保同一会话路由到同一账号，使缓存哈希追踪有效
 */

import { createHash } from 'crypto'
import { getRedisClient } from '../storage/redis.js'
import { createLogger } from '../utils/logger.js'
import type { ClaudeRequest, ClaudeSystemBlock } from './types.js'

const logger = createLogger('SessionCache')

/**
 * 稳定序列化（与 cacheTracker.ts 中相同逻辑，此处内联避免循环依赖）
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

function stableHashInput(block: ClaudeSystemBlock): string {
  return stableStringify({ type: block.type, text: block.text })
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * 计算 system prompt 哈希
 */
function hashSystemPrompt(system: string | ClaudeSystemBlock[] | undefined): string | null {
  if (!system) return null
  if (typeof system === 'string') {
    return sha256(system).substring(0, 16)
  }
  // ClaudeSystemBlock[]: 对每个 block 用 stableHashInput 序列化后拼接
  // 假设客户端保持 block 数组顺序稳定
  const parts = system.map(block => stableHashInput(block))
  return sha256(parts.join('|')).substring(0, 16)
}

/**
 * 计算会话哈希
 * 优先级: x-session-id > system prompt hash > first user message hash
 */
export function computeSessionHash(request: ClaudeRequest, sessionHeader?: string): string | null {
  // 优先级 1: x-session-id header（SHA-256 前 16 字符限长）
  if (sessionHeader) {
    return sha256(sessionHeader).substring(0, 16)
  }

  // 优先级 2: system prompt 哈希
  const systemHash = hashSystemPrompt(request.system)
  if (systemHash) {
    return systemHash
  }

  // 优先级 3: 第一条 user message 哈希
  const firstUserMsg = request.messages.find(m => m.role === 'user')
  if (firstUserMsg) {
    const content = typeof firstUserMsg.content === 'string'
      ? firstUserMsg.content
      : JSON.stringify(firstUserMsg.content)
    return sha256(content).substring(0, 16)
  }

  return null
}

/**
 * 查询会话绑定的账号
 */
export async function getSessionAccount(hash: string): Promise<string | null> {
  try {
    const redis = getRedisClient()
    return await redis.get(`gateway:session:${hash}`)
  } catch (error) {
    logger.warn('getSessionAccount Redis error', { error: (error as Error).message })
    return null
  }
}

/**
 * 绑定会话到账号（SET EX 300，每次请求刷新 TTL）
 */
export async function setSessionAccount(hash: string, accountId: string): Promise<void> {
  try {
    const redis = getRedisClient()
    await redis.set(`gateway:session:${hash}`, accountId, 'EX', 300)
  } catch (error) {
    logger.warn('setSessionAccount Redis error', { error: (error as Error).message })
  }
}
