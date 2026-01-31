/**
 * 限流中间件
 * 使用 Redis 实现滑动窗口限流
 */

import { Request, Response, NextFunction } from 'express'
import { createLogger } from '../utils/logger.js'
import { getRedisClient } from '../storage/redis.js'
import { getConfig } from '../config/index.js'

const logger = createLogger('RateLimitMiddleware')

const RATE_LIMIT_PREFIX = 'ratelimit:'

/**
 * 限流中间件
 */
export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const config = getConfig()

  // 如果未启用限流，直接放行
  if (!config.rateLimit.enabled) {
    next()
    return
  }

  // 健康检查端点不限流
  if (req.path === '/health' || req.path === '/api/admin/health') {
    next()
    return
  }

  const redis = getRedisClient()
  const windowMs = config.rateLimit.windowMs
  const maxRequests = config.rateLimit.maxRequests

  // 使用 IP 作为限流 key
  const clientId = req.ip || req.socket.remoteAddress || 'unknown'
  const key = RATE_LIMIT_PREFIX + clientId

  try {
    const now = Date.now()
    const windowStart = now - windowMs

    // 使用 Redis 事务实现滑动窗口
    const pipeline = redis.pipeline()

    // 移除窗口外的请求记录
    pipeline.zremrangebyscore(key, 0, windowStart)

    // 获取当前窗口内的请求数
    pipeline.zcard(key)

    // 添加当前请求
    pipeline.zadd(key, now, `${now}-${Math.random()}`)

    // 设置过期时间
    pipeline.expire(key, Math.ceil(windowMs / 1000))

    const results = await pipeline.exec()

    if (results) {
      const currentCount = results[1][1] as number

      // 设置响应头
      res.setHeader('X-RateLimit-Limit', maxRequests)
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - currentCount - 1))
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000))

      if (currentCount >= maxRequests) {
        logger.warn('Rate limit exceeded', { clientId, count: currentCount })

        res.status(429).json({
          error: {
            message: 'Too many requests, please try again later',
            type: 'rate_limit_error'
          }
        })
        return
      }
    }

    next()
  } catch (error) {
    // 限流失败时放行，避免影响正常请求
    logger.error('Rate limit check failed', { error: (error as Error).message })
    next()
  }
}

/**
 * 创建自定义限流中间件
 */
export function createRateLimiter(options: {
  windowMs: number
  maxRequests: number
  keyPrefix?: string
}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const redis = getRedisClient()
    const { windowMs, maxRequests, keyPrefix = 'custom:' } = options

    const clientId = req.ip || req.socket.remoteAddress || 'unknown'
    const key = RATE_LIMIT_PREFIX + keyPrefix + clientId

    try {
      const now = Date.now()
      const windowStart = now - windowMs

      const pipeline = redis.pipeline()
      pipeline.zremrangebyscore(key, 0, windowStart)
      pipeline.zcard(key)
      pipeline.zadd(key, now, `${now}-${Math.random()}`)
      pipeline.expire(key, Math.ceil(windowMs / 1000))

      const results = await pipeline.exec()

      if (results) {
        const currentCount = results[1][1] as number

        res.setHeader('X-RateLimit-Limit', maxRequests)
        res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - currentCount - 1))

        if (currentCount >= maxRequests) {
          res.status(429).json({
            error: {
              message: 'Too many requests',
              type: 'rate_limit_error'
            }
          })
          return
        }
      }

      next()
    } catch (error) {
      logger.error('Custom rate limit check failed', { error: (error as Error).message })
      next()
    }
  }
}
