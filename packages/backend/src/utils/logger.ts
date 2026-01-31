/**
 * 日志工具
 * 使用 winston 进行日志记录
 */

import winston from 'winston'
import { getConfig } from '../config/index.js'

// 日志格式
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, category, ...meta }) => {
    const categoryStr = category ? `[${category}]` : ''
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
    return `${timestamp} ${level.toUpperCase()} ${categoryStr} ${message}${metaStr}`
  })
)

// 创建 logger 实例
const config = getConfig()

export const logger = winston.createLogger({
  level: config.log.level,
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    })
  ]
})

// 创建带类别的 logger
export function createLogger(category: string) {
  return {
    debug: (message: string, meta?: Record<string, unknown>) =>
      logger.debug(message, { category, ...meta }),
    info: (message: string, meta?: Record<string, unknown>) =>
      logger.info(message, { category, ...meta }),
    warn: (message: string, meta?: Record<string, unknown>) =>
      logger.warn(message, { category, ...meta }),
    error: (message: string, meta?: Record<string, unknown>) =>
      logger.error(message, { category, ...meta })
  }
}

// 导出默认 logger
export default logger
