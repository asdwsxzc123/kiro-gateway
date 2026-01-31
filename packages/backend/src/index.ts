/**
 * Kiro Gateway 入口文件
 */

import { createApp } from './app.js'
import { getConfig, loadConfig } from './config/index.js'
import { getRedisClient, closeRedis } from './storage/redis.js'
import { createLogger } from './utils/logger.js'
import * as accountService from './services/accountService.js'

const logger = createLogger('Main')

// Token 刷新定时器
let tokenRefreshInterval: NodeJS.Timeout | null = null

/**
 * 启动服务器
 */
async function start(): Promise<void> {
  logger.info('Starting Kiro Gateway...')

  // 加载配置
  loadConfig()
  const config = getConfig()

  // 测试 Redis 连接
  try {
    const redis = getRedisClient()
    await redis.ping()
    logger.info('Redis connected')
  } catch (error) {
    logger.error('Failed to connect to Redis', { error: (error as Error).message })
    process.exit(1)
  }

  // 创建 Express 应用
  const app = await createApp()

  // 启动 HTTP 服务器
  const server = app.listen(config.server.port, config.server.host, () => {
    logger.info(`Server started on http://${config.server.host}:${config.server.port}`)
    logger.info('Available endpoints:')
    logger.info('  POST /v1/chat/completions - OpenAI Chat API')
    logger.info('  POST /v1/messages - Claude Messages API')
    logger.info('  GET  /v1/models - Model list')
    logger.info('  GET  /api/accounts - Account management')
    logger.info('  GET  /api/stats - Statistics')
    logger.info('  GET  /api/logs - Logs')
    logger.info('  GET  /api/admin - Admin')
    logger.info('  GET  /health - Health check')
  })

  // 启动 Token 刷新定时任务
  startTokenRefreshTask()

  // 优雅关闭
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`)

    // 停止定时任务
    if (tokenRefreshInterval) {
      clearInterval(tokenRefreshInterval)
    }

    // 关闭 HTTP 服务器
    server.close(() => {
      logger.info('HTTP server closed')
    })

    // 关闭 Redis 连接
    await closeRedis()

    logger.info('Shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

/**
 * 启动 Token 刷新定时任务
 */
function startTokenRefreshTask(): void {
  // 每 5 分钟检查一次
  const interval = 5 * 60 * 1000

  tokenRefreshInterval = setInterval(async () => {
    try {
      const result = await accountService.checkAndRefreshExpiredTokens()
      if (result.refreshed > 0 || result.failed > 0) {
        logger.info('Token refresh task completed', result)
      }
    } catch (error) {
      logger.error('Token refresh task failed', { error: (error as Error).message })
    }
  }, interval)

  logger.info('Token refresh task started (interval: 5 minutes)')
}

// 启动
start().catch((error) => {
  logger.error('Failed to start server', { error: error.message })
  process.exit(1)
})
