/**
 * 请求日志中间件
 */

import { Request, Response, NextFunction } from 'express'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('RequestLogger')

/**
 * 请求日志中间件
 * 记录所有请求的基本信息
 */
export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now()

  // 记录请求开始
  logger.debug('Request started', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers['user-agent']?.substring(0, 50)
  })

  // 监听响应完成
  res.on('finish', () => {
    const duration = Date.now() - startTime
    const level = res.statusCode >= 400 ? 'warn' : 'info'

    logger[level]('Request completed', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`
    })
  })

  next()
}

/**
 * 详细请求日志中间件
 * 记录请求体和响应体（用于调试）
 */
export function verboseRequestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now()

  // 记录请求详情
  logger.debug('Request details', {
    method: req.method,
    path: req.path,
    query: req.query,
    headers: {
      'content-type': req.headers['content-type'],
      'authorization': req.headers.authorization ? '[REDACTED]' : undefined
    },
    bodySize: req.body ? JSON.stringify(req.body).length : 0
  })

  // 捕获响应
  const originalSend = res.send.bind(res)
  res.send = function (body: unknown): Response {
    const duration = Date.now() - startTime

    logger.debug('Response details', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      bodySize: typeof body === 'string' ? body.length : 0
    })

    return originalSend(body)
  }

  next()
}
