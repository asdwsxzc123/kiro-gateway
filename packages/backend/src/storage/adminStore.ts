/**
 * Admin 账户存储模块
 * 使用 JSON 文件存储管理员账户数据
 */

import fs from 'fs'
import path from 'path'
import bcrypt from 'bcryptjs'
import { createLogger } from '../utils/logger.js'
import { getConfig } from '../config/index.js'

const logger = createLogger('AdminStore')

// 数据文件路径
const DATA_DIR = path.join(process.cwd(), 'data')
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json')

// Admin 账户接口
export interface AdminUser {
  username: string
  passwordHash: string
  createdAt: number
  updatedAt: number
}

/**
 * 确保数据目录存在
 */
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    logger.info('Created data directory', { path: DATA_DIR })
  }
}

/**
 * 读取 Admin 数据
 */
function readAdminData(): AdminUser | null {
  try {
    if (!fs.existsSync(ADMIN_FILE)) {
      return null
    }
    const data = fs.readFileSync(ADMIN_FILE, 'utf-8')
    return JSON.parse(data) as AdminUser
  } catch (error) {
    logger.error('Failed to read admin data', { error: (error as Error).message })
    return null
  }
}

/**
 * 写入 Admin 数据
 */
function writeAdminData(admin: AdminUser): void {
  try {
    ensureDataDir()
    fs.writeFileSync(ADMIN_FILE, JSON.stringify(admin, null, 2), 'utf-8')
    logger.info('Admin data saved')
  } catch (error) {
    logger.error('Failed to write admin data', { error: (error as Error).message })
    throw error
  }
}

/**
 * 初始化 Admin 账户
 * 如果不存在则从环境变量创建默认账户
 */
export async function initAdmin(): Promise<void> {
  const existing = readAdminData()

  if (existing) {
    logger.info('Admin account already exists', { username: existing.username })
    return
  }

  const config = getConfig()
  const { username, password } = config.admin

  const salt = await bcrypt.genSalt(10)
  const passwordHash = await bcrypt.hash(password, salt)

  const admin: AdminUser = {
    username,
    passwordHash,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  writeAdminData(admin)
  logger.info('Admin account initialized', { username })
}

/**
 * 获取 Admin 账户
 */
export function getAdmin(): AdminUser | null {
  return readAdminData()
}

/**
 * 验证密码
 */
export async function validatePassword(username: string, password: string): Promise<boolean> {
  const admin = readAdminData()

  if (!admin) {
    logger.warn('Admin account not found')
    return false
  }

  if (admin.username !== username) {
    logger.warn('Invalid username', { provided: username })
    return false
  }

  const isValid = await bcrypt.compare(password, admin.passwordHash)

  if (!isValid) {
    logger.warn('Invalid password for user', { username })
  }

  return isValid
}

/**
 * 更新密码
 */
export async function updatePassword(oldPassword: string, newPassword: string): Promise<boolean> {
  const admin = readAdminData()

  if (!admin) {
    logger.error('Admin account not found')
    return false
  }

  // 验证旧密码
  const isValid = await bcrypt.compare(oldPassword, admin.passwordHash)
  if (!isValid) {
    logger.warn('Old password verification failed')
    return false
  }

  // 生成新密码哈希
  const salt = await bcrypt.genSalt(10)
  const passwordHash = await bcrypt.hash(newPassword, salt)

  // 更新账户
  admin.passwordHash = passwordHash
  admin.updatedAt = Date.now()

  writeAdminData(admin)
  logger.info('Admin password updated')

  return true
}
