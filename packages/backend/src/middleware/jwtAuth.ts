/**
 * JWT 认证中间件
 */

import { Request, Response, NextFunction } from 'express'
import jwt, { SignOptions } from 'jsonwebtoken'
import { createLogger } from '../utils/logger.js'
import { getConfig } from '../config/index.js'
import { isTokenValid } from '../storage/tokenStore.js'

const logger = createLogger('JwtAuthMiddleware')

// JWT Payload 接口
export interface JwtPayload {
  username: string
  iat: number
  exp: number
}

// 扩展 Express Request 类型
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

// 不需要认证的路径（相对于挂载点，如 /api 下的 /auth/login）
const PUBLIC_PATHS = [
  '/auth/login',
  '/health',
  '/admin/health'
]

/**
 * 检查路径是否为公开路径（不需要认证）
 */
function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some(publicPath => path === publicPath || path.startsWith(publicPath + '/'))
}

/**
 * JWT 认证中间件
 * 验证 JWT Token，排除公开路径
 */
export async function jwtAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // 公开路径不需要认证
  if (isPublicPath(req.path)) {
    next()
    return
  }

  const config = getConfig()

  // 提取 Token
  let token: string | undefined

  // 从 Authorization header 提取 (Bearer token)
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7)
  }

  if (!token) {
    logger.warn('Missing JWT token', { path: req.path, ip: req.ip })
    res.status(401).json({
      error: {
        message: 'Authentication required',
        type: 'authentication_error'
      }
    })
    return
  }

  try {
    // 验证 Token
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload

    // 检查 Token 是否存在于 Redis（白名单验证）
    const valid = await isTokenValid(token)
    if (!valid) {
      logger.warn('Token not found in Redis (logged out or expired)', { path: req.path, ip: req.ip })
      res.status(401).json({
        error: {
          message: 'Token has been revoked',
          type: 'authentication_error'
        }
      })
      return
    }

    // 将用户信息附加到请求对象
    req.user = decoded

    next()
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.warn('JWT token expired', { path: req.path, ip: req.ip })
      res.status(401).json({
        error: {
          message: 'Token expired',
          type: 'authentication_error'
        }
      })
      return
    }

    if (error instanceof jwt.JsonWebTokenError) {
      logger.warn('Invalid JWT token', { path: req.path, ip: req.ip, error: (error as Error).message })
      res.status(401).json({
        error: {
          message: 'Invalid token',
          type: 'authentication_error'
        }
      })
      return
    }

    logger.error('JWT verification error', { path: req.path, error: (error as Error).message })
    res.status(500).json({
      error: {
        message: 'Authentication error',
        type: 'server_error'
      }
    })
  }
}

/**
 * 生成 JWT Token
 */
export function generateToken(username: string): string {
  const config = getConfig()

  // 使用类型断言解决 expiresIn 类型兼容性问题
  return jwt.sign(
    { username },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn } as SignOptions
  )
}

/**
 * 解析 JWT Token（不验证）
 */
export function decodeToken(token: string): JwtPayload | null {
  try {
    return jwt.decode(token) as JwtPayload
  } catch {
    return null
  }
}
