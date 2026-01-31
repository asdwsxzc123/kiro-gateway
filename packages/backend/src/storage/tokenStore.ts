/**
 * Token 存储模块
 * 使用 Redis 存储有效的 JWT Token
 */

import { getRedisClient } from './redis.js'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('TokenStore')

// Token key 前缀
const TOKEN_KEY_PREFIX = 'token:'

/**
 * 存储 token 到 Redis
 * @param token JWT token
 * @param username 用户名
 * @param expiresInSeconds token 过期时间（秒）
 */
export async function storeToken(token: string, username: string, expiresInSeconds: number): Promise<void> {
  const redis = getRedisClient()
  const key = TOKEN_KEY_PREFIX + token

  await redis.setex(key, expiresInSeconds, username)
  logger.info('Token stored in Redis', { key, username, expiresIn: expiresInSeconds, tokenPrefix: token.substring(0, 20) })
}

/**
 * 检查 token 是否有效（存在于 Redis）
 * @param token JWT token
 * @returns 是否有效
 */
export async function isTokenValid(token: string): Promise<boolean> {
  const redis = getRedisClient()
  const key = TOKEN_KEY_PREFIX + token

  const exists = await redis.exists(key)
  logger.info('Token validation check', { key, exists, tokenPrefix: token.substring(0, 20) })
  return exists === 1
}

/**
 * 删除 token（登出时调用）
 * @param token JWT token
 */
export async function removeToken(token: string): Promise<void> {
  const redis = getRedisClient()
  const key = TOKEN_KEY_PREFIX + token

  await redis.del(key)
  logger.info('Token removed from Redis')
}

/**
 * 获取 token 关联的用户名
 * @param token JWT token
 * @returns 用户名或 null
 */
export async function getTokenUser(token: string): Promise<string | null> {
  const redis = getRedisClient()
  const key = TOKEN_KEY_PREFIX + token

  return await redis.get(key)
}
