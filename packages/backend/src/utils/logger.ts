/**
 * 日志工具
 * 使用 winston 进行日志记录
 * 支持 console + 文件日志（按天轮转）
 */

import path from 'path'
import fs from 'fs'
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import { getConfig } from '../config/index.js'

const config = getConfig()
const logDir = config.log.dir

// 确保日志目录存在
for (const sub of ['requests', 'system']) {
  const dir = path.join(logDir, sub)
  fs.mkdirSync(dir, { recursive: true })
}

// 控制台日志格式
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, category, ...meta }) => {
    const categoryStr = category ? `[${category}]` : ''
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
    return `${timestamp} ${level} ${categoryStr} ${message}${metaStr}`
  })
)

// 主 logger（控制台输出）
export const logger = winston.createLogger({
  level: config.log.level,
  transports: [
    new winston.transports.Console({ format: consoleFormat })
  ]
})

// 请求日志文件 logger（JSON Lines，按天轮转）
export const requestFileLogger = winston.createLogger({
  transports: [
    new DailyRotateFile({
      dirname: path.join(logDir, 'requests'),
      filename: 'requests-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ]
})

// 系统日志文件 logger（JSON Lines，按天轮转）
export const systemFileLogger = winston.createLogger({
  transports: [
    new DailyRotateFile({
      dirname: path.join(logDir, 'system'),
      filename: 'system-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
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
