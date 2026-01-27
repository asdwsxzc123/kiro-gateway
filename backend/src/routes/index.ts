/**
 * 路由聚合
 * 统一导出所有路由模块
 */

import { Router } from 'express'
import type { Router as IRouter } from 'express'
import proxyRouter from './proxy.js'
import accountsRouter from './accounts.js'
import statsRouter from './stats.js'
import logsRouter from './logs.js'
import adminRouter from './admin.js'

const router: IRouter = Router()

// 代理路由 - /v1/*
router.use('/v1', proxyRouter)

// 账号管理路由 - /api/accounts/*
router.use('/api/accounts', accountsRouter)

// 统计路由 - /api/stats/*
router.use('/api/stats', statsRouter)

// 日志路由 - /api/logs/*
router.use('/api/logs', logsRouter)

// 管理路由 - /api/admin/*
router.use('/api/admin', adminRouter)

export default router
