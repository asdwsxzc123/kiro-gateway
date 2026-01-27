/**
 * 错误处理中间件
 */

import { Request, Response, NextFunction } from 'express'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('ErrorHandler')

/**
 * 404 处理中间件
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.warn('Route not found', { path: req.path, method: req.method })

  res.status(404).json({
    error: {
      message: `Route ${req.method} ${req.path} not found`,
      type: 'not_found_error'
    }
  })
}

/**
 * 全局错误处理中间件
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  })

  // 检查是否是已知错误类型
  if (err.name === 'SyntaxError' && 'body' in err) {
    res.status(400).json({
      error: {
        message: 'Invalid JSON in request body',
        type: 'invalid_request_error'
      }
    })
    return
  }

  if (err.name === 'ValidationError') {
    res.status(400).json({
      error: {
        message: err.message,
        type: 'validation_error'
      }
    })
    return
  }

  // 默认 500 错误
  res.status(500).json({
    error: {
      message: process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message,
      type: 'internal_error'
    }
  })
}

/**
 * 异步错误包装器
 * 用于包装异步路由处理函数，自动捕获错误
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
