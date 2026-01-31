/**
 * API Key 认证中间件
 */

import { Request, Response, NextFunction } from 'express'
import { createLogger } from '../utils/logger.js'
import { validateApiKey } from '../storage/configStore.js'
import { getConfig } from '../config/index.js'

const logger = createLogger('AuthMiddleware')

/**
 * API Key 认证中间件
 * 从 Authorization header 或 x-api-key header 中提取 API Key
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const config = getConfig()

  // 如果未启用认证，直接放行
  if (!config.security.requireApiKey) {
    next()
    return
  }

  // 健康检查端点不需要认证
  if (req.path === '/health' || req.path === '/api/admin/health') {
    next()
    return
  }

  // 提取 API Key
  let apiKey: string | undefined

  // 从 Authorization header 提取 (Bearer token)
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    apiKey = authHeader.substring(7)
  }

  // 从 x-api-key header 提取
  if (!apiKey) {
    apiKey = req.headers['x-api-key'] as string
  }

  // 从查询参数提取（不推荐，但支持）
  if (!apiKey && req.query.api_key) {
    apiKey = req.query.api_key as string
  }

  if (!apiKey) {
    logger.warn('Missing API key', { path: req.path, ip: req.ip })
    res.status(401).json({
      error: {
        message: 'API key is required',
        type: 'authentication_error'
      }
    })
    return
  }

  // 验证 API Key
  const isValid = await validateApiKey(apiKey)

  if (!isValid) {
    logger.warn('Invalid API key', { path: req.path, ip: req.ip })
    res.status(401).json({
      error: {
        message: 'Invalid API key',
        type: 'authentication_error'
      }
    })
    return
  }

  next()
}

/**
 * 可选认证中间件
 * 如果提供了 API Key 则验证，否则放行
 */
export async function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization
  const xApiKey = req.headers['x-api-key'] as string

  // 如果没有提供任何认证信息，直接放行
  if (!authHeader && !xApiKey) {
    next()
    return
  }

  // 如果提供了认证信息，则验证
  await authMiddleware(req, res, next)
}
