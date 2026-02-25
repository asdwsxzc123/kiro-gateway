/**
 * Session Cache — Sticky Session 路由模块
 * 确保同一会话路由到同一账号，使缓存哈希追踪有效
 *
 * 功能特性：
 * - 多层 fallback 的 sessionHash 生成策略
 * - 智能会话续期机制
 * - 会话验证和自动清理
 * - 支持 cache_control 标记的内容识别
 */

import { createHash } from 'crypto'
import { getRedisClient } from '../storage/redis.js'
import { createLogger } from '../utils/logger.js'
import { getConfig } from '../config/index.js'
import type { ClaudeRequest, ClaudeSystemBlock, ClaudeContentBlock } from './types.js'

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
 * 提取带有 cache_control 标记的内容
 * 参考 claude-relay-service 的实现
 */
function extractCacheableContent(request: ClaudeRequest): string | null {
  const config = getConfig()
  if (!config.session.enableCacheControl) {
    return null
  }

  let cacheableContent = ''

  // 检查 system 中的 cacheable 内容
  if (Array.isArray(request.system)) {
    for (const part of request.system) {
      if (part && part.cache_control && part.cache_control.type === 'ephemeral') {
        cacheableContent += part.text || ''
      }
    }
  }

  // 检查 messages 中的 cacheable 内容
  for (const msg of request.messages) {
    const content = msg.content
    let hasCacheControl = false

    if (Array.isArray(content)) {
      for (const part of content) {
        if (part && part.cache_control && part.cache_control.type === 'ephemeral') {
          hasCacheControl = true
          break
        }
      }
    } else if (typeof content === 'string') {
      // 字符串类型的 content 不支持 cache_control
      continue
    }

    if (hasCacheControl) {
      // 提取所有消息的文本内容
      for (const message of request.messages) {
        let messageText = ''
        if (typeof message.content === 'string') {
          messageText = message.content
        } else if (Array.isArray(message.content)) {
          messageText = message.content
            .filter((part: ClaudeContentBlock) => part.type === 'text')
            .map((part: ClaudeContentBlock) => part.text || '')
            .join('')
        }

        if (messageText) {
          cacheableContent += messageText
          break
        }
      }
      break
    }
  }

  return cacheableContent || null
}

/**
 * 计算会话哈希
 * 优先级策略（参考 claude-relay-service）：
 * 1. x-session-id header（最高优先级）
 * 2. cache_control 标记的内容哈希
 * 3. system prompt 哈希
 * 4. 第一条 user message 哈希（最后 fallback）
 */
export function computeSessionHash(request: ClaudeRequest, sessionHeader?: string): string | null {
  // 优先级 1: x-session-id header（SHA-256 前 16 字符限长）
  if (sessionHeader) {
    const hash = sha256(sessionHeader).substring(0, 16)
    logger.debug('Session hash from header', { hash })
    return hash
  }

  // 优先级 2: cache_control 标记的内容哈希
  const cacheableContent = extractCacheableContent(request)
  if (cacheableContent) {
    const hash = sha256(cacheableContent).substring(0, 16)
    logger.debug('Session hash from cacheable content', { hash, contentLength: cacheableContent.length })
    return hash
  }

  // 优先级 3: system prompt 哈希
  const systemHash = hashSystemPrompt(request.system)
  if (systemHash) {
    logger.debug('Session hash from system prompt', { hash: systemHash })
    return systemHash
  }

  // 优先级 4: 第一条 user message 哈希
  const firstUserMsg = request.messages.find(m => m.role === 'user')
  if (firstUserMsg) {
    const content = typeof firstUserMsg.content === 'string'
      ? firstUserMsg.content
      : JSON.stringify(firstUserMsg.content)
    const hash = sha256(content).substring(0, 16)
    logger.debug('Session hash from first user message', { hash })
    return hash
  }

  logger.debug('Unable to generate session hash - no suitable content found')
  return null
}

/**
 * 获取 Redis 键名
 */
function getSessionKey(hash: string): string {
  return `gateway:session:${hash}`
}

/**
 * 查询会话绑定的账号
 */
export async function getSessionAccount(hash: string): Promise<string | null> {
  try {
    const redis = getRedisClient()
    const key = getSessionKey(hash)
    return await redis.get(key)
  } catch (error) {
    logger.warn('getSessionAccount Redis error', { error: (error as Error).message })
    return null
  }
}

/**
 * 绑定会话到账号
 * 使用配置的 TTL，支持智能续期
 */
export async function setSessionAccount(hash: string, accountId: string): Promise<void> {
  try {
    const config = getConfig()
    const redis = getRedisClient()
    const key = getSessionKey(hash)
    const ttl = config.session.ttlSeconds

    await redis.set(key, accountId, 'EX', ttl)
    logger.debug('Session mapping created', { hash, accountId, ttl })
  } catch (error) {
    logger.warn('setSessionAccount Redis error', { error: (error as Error).message })
  }
}

/**
 * 删除会话映射
 */
export async function deleteSessionAccount(hash: string): Promise<void> {
  try {
    const redis = getRedisClient()
    const key = getSessionKey(hash)
    await redis.del(key)
    logger.debug('Session mapping deleted', { hash })
  } catch (error) {
    logger.warn('deleteSessionAccount Redis error', { error: (error as Error).message })
  }
}

/**
 * 智能续期会话映射 TTL
 * 参考 claude-relay-service 的实现：
 * - 检查剩余 TTL
 * - 如果低于续期阈值，则续期到完整 TTL
 * - 如果高于阈值，则不操作
 */
export async function extendSessionTTL(hash: string): Promise<boolean> {
  try {
    const config = getConfig()
    const redis = getRedisClient()
    const key = getSessionKey(hash)

    // 获取剩余 TTL
    const remainingTTL = await redis.ttl(key)

    // -2: key 不存在
    if (remainingTTL === -2) {
      logger.debug('Session key does not exist', { hash })
      return false
    }

    // -1: key 存在但没有过期时间（永久）
    if (remainingTTL === -1) {
      logger.debug('Session key has no expiration', { hash })
      return true
    }

    const fullTTL = config.session.ttlSeconds
    const threshold = config.session.renewalThresholdSeconds

    // 如果续期阈值为 0，则不续期
    if (threshold === 0) {
      return true
    }

    // 剩余时间低于阈值，执行续期
    if (remainingTTL < threshold) {
      await redis.expire(key, fullTTL)
      logger.debug('Session TTL renewed', {
        hash,
        remainingMinutes: Math.round(remainingTTL / 60),
        renewedToHours: Math.round(fullTTL / 3600)
      })
    } else {
      logger.debug('Session TTL sufficient', {
        hash,
        remainingMinutes: Math.round(remainingTTL / 60)
      })
    }

    return true
  } catch (error) {
    logger.error('extendSessionTTL Redis error', { error: (error as Error).message })
    return false
  }
}

/**
 * 获取会话统计信息（用于调试和监控）
 */
export async function getSessionStats(): Promise<{
  totalSessions: number
  sessions: Array<{ hash: string; accountId: string; ttl: number }>
}> {
  try {
    const redis = getRedisClient()
    const pattern = 'gateway:session:*'
    const keys = await redis.keys(pattern)

    const sessions: Array<{ hash: string; accountId: string; ttl: number }> = []

    for (const key of keys) {
      const hash = key.replace('gateway:session:', '')
      const accountId = await redis.get(key)
      const ttl = await redis.ttl(key)

      if (accountId) {
        sessions.push({ hash, accountId, ttl })
      }
    }

    return {
      totalSessions: sessions.length,
      sessions
    }
  } catch (error) {
    logger.error('getSessionStats Redis error', { error: (error as Error).message })
    return { totalSessions: 0, sessions: [] }
  }
}
