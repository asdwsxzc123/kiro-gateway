/**
 * 错误处理中间件
 */

import { Request, Response, NextFunction } from 'express'
import { createLogger } from '../utils/logger.js'
import { sendError, ErrorTypes } from '../utils/response.js'

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

  sendError(
    res,
    `Route ${req.method} ${req.path} not found`,
    ErrorTypes.NOT_FOUND,
    404
  )
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
    sendError(res, 'Invalid JSON in request body', ErrorTypes.VALIDATION_ERROR, 400)
    return
  }

  if (err.name === 'ValidationError') {
    sendError(res, err.message, ErrorTypes.VALIDATION_ERROR, 400)
    return
  }

  // 默认 500 错误
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message

  sendError(res, message, ErrorTypes.SERVER_ERROR, 500)
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
