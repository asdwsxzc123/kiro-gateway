/**
 * 认证路由
 * 处理登录、获取用户信息、修改密码等操作
 */

import { Router, Request, Response } from 'express'
import type { Router as IRouter } from 'express'
import { createLogger } from '../utils/logger.js'
import { validatePassword, updatePassword, getAdmin } from '../storage/adminStore.js'
import { generateToken, decodeToken } from '../middleware/jwtAuth.js'
import { storeToken, removeToken } from '../storage/tokenStore.js'
import { getConfig } from '../config/index.js'

const logger = createLogger('AuthRouter')
const router: IRouter = Router()

/**
 * POST /api/auth/login
 * 用户登录
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body

    // 验证请求参数
    if (!username || !password) {
      res.status(400).json({
        error: {
          message: 'Username and password are required',
          type: 'validation_error'
        }
      })
      return
    }

    // 验证用户名和密码
    const isValid = await validatePassword(username, password)

    if (!isValid) {
      logger.warn('Login failed', { username, ip: req.ip })
      res.status(401).json({
        error: {
          message: 'Invalid username or password',
          type: 'authentication_error'
        }
      })
      return
    }

    // 生成 JWT Token
    const token = generateToken(username)

    // 存储 token 到 Redis
    const config = getConfig()
    // 解析 expiresIn 配置（如 "24h"）转换为秒
    const expiresIn = config.jwt.expiresIn
    let expiresInSeconds = 24 * 60 * 60 // 默认 24 小时
    const match = expiresIn.match(/^(\d+)([smhd])$/)
    if (match) {
      const value = parseInt(match[1], 10)
      const unit = match[2]
      switch (unit) {
        case 's': expiresInSeconds = value; break
        case 'm': expiresInSeconds = value * 60; break
        case 'h': expiresInSeconds = value * 60 * 60; break
        case 'd': expiresInSeconds = value * 24 * 60 * 60; break
      }
    }
    await storeToken(token, username, expiresInSeconds)

    logger.info('Login successful', { username, ip: req.ip })

    res.json({
      success: true,
      data: {
        token,
        user: { username }
      }
    })
  } catch (error) {
    logger.error('Login error', { error: (error as Error).message })
    res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'server_error'
      }
    })
  }
})

/**
 * GET /api/auth/me
 * 获取当前用户信息
 */
router.get('/me', (req: Request, res: Response) => {
  try {
    const user = req.user

    if (!user) {
      res.status(401).json({
        error: {
          message: 'Not authenticated',
          type: 'authentication_error'
        }
      })
      return
    }

    const admin = getAdmin()

    res.json({
      success: true,
      data: {
        user: {
          username: user.username
        },
        createdAt: admin?.createdAt,
        updatedAt: admin?.updatedAt
      }
    })
  } catch (error) {
    logger.error('Get user info error', { error: (error as Error).message })
    res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'server_error'
      }
    })
  }
})

/**
 * PUT /api/auth/password
 * 修改密码
 */
router.put('/password', async (req: Request, res: Response) => {
  try {
    const user = req.user

    if (!user) {
      res.status(401).json({
        error: {
          message: 'Not authenticated',
          type: 'authentication_error'
        }
      })
      return
    }

    const { oldPassword, newPassword } = req.body

    // 验证请求参数
    if (!oldPassword || !newPassword) {
      res.status(400).json({
        error: {
          message: 'Old password and new password are required',
          type: 'validation_error'
        }
      })
      return
    }

    // 验证新密码长度
    if (newPassword.length < 6) {
      res.status(400).json({
        error: {
          message: 'New password must be at least 6 characters',
          type: 'validation_error'
        }
      })
      return
    }

    // 更新密码
    const success = await updatePassword(oldPassword, newPassword)

    if (!success) {
      res.status(400).json({
        error: {
          message: 'Old password is incorrect',
          type: 'validation_error'
        }
      })
      return
    }

    logger.info('Password updated', { username: user.username, ip: req.ip })

    res.json({
      success: true,
      message: 'Password updated successfully'
    })
  } catch (error) {
    logger.error('Update password error', { error: (error as Error).message })
    res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'server_error'
      }
    })
  }
})

/**
 * POST /api/auth/logout
 * 用户登出，删除 Redis 中的 token
 */
router.post('/logout', async (req: Request, res: Response) => {
  try {
    // 从 Authorization header 提取 token
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(400).json({
        error: {
          message: 'No token provided',
          type: 'validation_error'
        }
      })
      return
    }

    const token = authHeader.substring(7)
    const decoded = decodeToken(token)

    if (!decoded) {
      res.status(400).json({
        error: {
          message: 'Invalid token',
          type: 'validation_error'
        }
      })
      return
    }

    // 从 Redis 删除 token
    await removeToken(token)

    logger.info('User logged out', { username: decoded.username, ip: req.ip })

    res.json({
      success: true,
      message: 'Logged out successfully'
    })
  } catch (error) {
    logger.error('Logout error', { error: (error as Error).message })
    res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'server_error'
      }
    })
  }
})

export default router
