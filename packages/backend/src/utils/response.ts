/**
 * 统一 API 响应格式工具
 */

import { Response } from 'express'

/**
 * 成功响应
 */
export interface SuccessResponse<T = unknown> {
  success: true
  data: T
}

/**
 * 错误响应
 */
export interface ErrorResponse {
  success: false
  error: {
    message: string
    type: string
    code?: string
  }
}

/**
 * 统一响应类型
 */
export type ApiResponse<T = unknown> = SuccessResponse<T> | ErrorResponse

/**
 * 发送成功响应
 */
export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json({
    success: true,
    data
  } as SuccessResponse<T>)
}

/**
 * 发送错误响应
 */
export function sendError(
  res: Response,
  message: string,
  type: string,
  statusCode = 400,
  code?: string
): void {
  const response: ErrorResponse = {
    success: false,
    error: {
      message,
      type
    }
  }
  if (code) {
    response.error.code = code
  }
  res.status(statusCode).json(response)
}

/**
 * 常用错误类型
 */
export const ErrorTypes = {
  VALIDATION_ERROR: 'validation_error',
  AUTHENTICATION_ERROR: 'authentication_error',
  AUTHORIZATION_ERROR: 'authorization_error',
  NOT_FOUND: 'not_found',
  SERVER_ERROR: 'server_error',
  RATE_LIMIT_ERROR: 'rate_limit_error'
} as const

/**
 * 快捷错误响应方法
 */
export const errors = {
  validation: (res: Response, message: string) =>
    sendError(res, message, ErrorTypes.VALIDATION_ERROR, 400),

  unauthorized: (res: Response, message = 'Not authenticated') =>
    sendError(res, message, ErrorTypes.AUTHENTICATION_ERROR, 401),

  forbidden: (res: Response, message = 'Access denied') =>
    sendError(res, message, ErrorTypes.AUTHORIZATION_ERROR, 403),

  notFound: (res: Response, message = 'Resource not found') =>
    sendError(res, message, ErrorTypes.NOT_FOUND, 404),

  server: (res: Response, message = 'Internal server error') =>
    sendError(res, message, ErrorTypes.SERVER_ERROR, 500),

  rateLimit: (res: Response, message = 'Too many requests') =>
    sendError(res, message, ErrorTypes.RATE_LIMIT_ERROR, 429)
}
