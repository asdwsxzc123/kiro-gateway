/**
 * Express 应用配置
 */

import express, { Express } from 'express'
import cors from 'cors'
import path from 'path'
import { createLogger } from './utils/logger.js'
import routes from './routes/index.js'
import { jwtAuthMiddleware } from './middleware/jwtAuth.js'
import { requestLoggerMiddleware } from './middleware/requestLogger.js'
import { rateLimitMiddleware } from './middleware/rateLimit.js'
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js'
import { initAdmin } from './storage/adminStore.js'

const logger = createLogger('App')

/**
 * 创建 Express 应用
 */
export async function createApp(): Promise<Express> {
  // 初始化 Admin 账户
  await initAdmin()

  const app = express()

  // 基础中间件
  app.use(cors())
  app.use(express.json({ limit: '50mb' }))
  app.use(express.urlencoded({ extended: true }))

  // 请求日志
  app.use(requestLoggerMiddleware)

  // 限流中间件
  app.use(rateLimitMiddleware)

  // Claude Code 遥测端点 - 直接返回 200 OK（无需认证）
  app.post('/api/event_logging/batch', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // JWT 认证（仅管理接口，/v1 代理接口不需要 JWT）
  app.use('/api', jwtAuthMiddleware)

  // 健康检查（不需要认证）
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      version: '1.0.0'
    })
  })

  // 注册路由
  app.use(routes)

  // 静态文件服务 - 服务前端 dist 目录
  // __dirname 在编译后是 dist 目录，所以 ../public 指向 packages/backend/public
  const staticPath = path.join(__dirname, '../public')
  app.use(express.static(staticPath))

  // SPA 路由回退 - 所有非 API 路由返回 index.html
  app.get('*', (req, res, next) => {
    // 跳过 API 和代理路由
    if (req.path.startsWith('/api') || req.path.startsWith('/v1') || req.path === '/health') {
      return next()
    }
    res.sendFile(path.join(staticPath, 'index.html'))
  })

  // 404 处理
  app.use(notFoundHandler)

  // 错误处理
  app.use(errorHandler)

  logger.info('Express app created')

  return app
}
