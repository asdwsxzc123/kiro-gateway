/**
 * Redis 客户端
 */

import Redis from 'ioredis'
import { getConfig } from '../config/index.js'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('Redis')

let redisClient: Redis | null = null

/**
 * 获取 Redis 客户端实例
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    const config = getConfig()

    redisClient = new Redis(config.redis.url, {
      password: config.redis.password || undefined,
      db: config.redis.db,
      keyPrefix: config.redis.keyPrefix,
      retryStrategy: (times) => {
        if (times > 10) {
          logger.error('Redis connection failed after 10 retries')
          return null
        }
        const delay = Math.min(times * 100, 3000)
        logger.warn(`Redis connection retry in ${delay}ms (attempt ${times})`)
        return delay
      },
      maxRetriesPerRequest: 3
    })

    redisClient.on('connect', () => {
      logger.info('Redis connected')
    })

    redisClient.on('error', (err) => {
      logger.error('Redis error', { error: err.message })
    })

    redisClient.on('close', () => {
      logger.warn('Redis connection closed')
    })
  }

  return redisClient
}

/**
 * 关闭 Redis 连接
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
    logger.info('Redis connection closed')
  }
}

/**
 * 检查 Redis 连接状态
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getRedisClient()
    const result = await client.ping()
    return result === 'PONG'
  } catch {
    return false
  }
}

// 导出 Redis 类型
export { Redis }
