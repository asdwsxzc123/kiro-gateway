/**
 * 账号存储模块
 * 使用 Redis 存储账号数据，支持机器码绑定
 */

import { getRedisClient } from './redis.js'
import { createLogger } from '../utils/logger.js'
import { encrypt, decrypt } from '../utils/crypto.js'
import { generateMachineId, isValidMachineId, normalizeMachineId } from '../core/machineId.js'
import type { ProxyAccount, AddAccountRequest, UpdateAccountRequest } from '../core/types.js'
import { v4 as uuidv4 } from 'uuid'

const logger = createLogger('AccountStore')

// Redis Key 前缀
const ACCOUNT_KEY = 'account:'
const ACCOUNTS_INDEX = 'accounts:index'
const ACCOUNTS_AVAILABLE = 'accounts:available'
const MACHINE_IDS = 'machineIds'

// 敏感字段列表（不再加密，改为明文存储以方便管理）
const SENSITIVE_FIELDS: string[] = []

/**
 * 序列化账号数据（加密敏感字段）
 */
function serializeAccount(account: ProxyAccount): Record<string, string> {
  const data: Record<string, string> = {}

  for (const [key, value] of Object.entries(account)) {
    if (value === undefined || value === null) continue

    if (SENSITIVE_FIELDS.includes(key) && typeof value === 'string') {
      data[key] = encrypt(value)
    } else if (typeof value === 'boolean') {
      data[key] = value ? 'true' : 'false'
    } else if (typeof value === 'number') {
      data[key] = String(value)
    } else if (typeof value === 'string') {
      data[key] = value
    }
  }

  return data
}

/**
 * 反序列化账号数据（解密敏感字段）
 */
function deserializeAccount(data: Record<string, string>): ProxyAccount {
  const account: Partial<ProxyAccount> = {}

  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_FIELDS.includes(key)) {
      (account as Record<string, unknown>)[key] = decrypt(value)
    } else if (['expiresAt', 'lastUsed', 'requestCount', 'errorCount', 'cooldownUntil', 'createdAt', 'machineIdCreatedAt'].includes(key)) {
      (account as Record<string, unknown>)[key] = parseInt(value, 10)
    } else {
      (account as Record<string, unknown>)[key] = value
    }
  }

  // 向后兼容：旧数据中 isAvailable 迁移为 status
  const raw = account as Record<string, unknown>
  if (raw.isAvailable !== undefined && !raw.status) {
    account.status = raw.isAvailable === 'true' || raw.isAvailable === true ? 'active' : 'error_suspended'
    delete raw.isAvailable
  }
  // 确保 status 有默认值
  if (!account.status) {
    account.status = 'active'
  }

  return account as ProxyAccount
}

/**
 * 获取所有账号
 */
export async function getAllAccounts(): Promise<ProxyAccount[]> {
  const redis = getRedisClient()

  try {
    // 获取所有账号 ID
    const accountIds = await redis.zrange(ACCOUNTS_INDEX, 0, -1)

    if (accountIds.length === 0) {
      return []
    }

    // 批量获取账号数据
    const pipeline = redis.pipeline()
    for (const id of accountIds) {
      pipeline.hgetall(ACCOUNT_KEY + id)
    }

    const results = await pipeline.exec()
    const accounts: ProxyAccount[] = []

    if (results) {
      for (const [err, data] of results) {
        if (!err && data && typeof data === 'object' && Object.keys(data).length > 0) {
          accounts.push(deserializeAccount(data as Record<string, string>))
        }
      }
    }

    return accounts
  } catch (error) {
    logger.error('Failed to get all accounts', { error: (error as Error).message })
    return []
  }
}

/**
 * 根据 ID 获取账号
 */
export async function getAccountById(id: string): Promise<ProxyAccount | null> {
  const redis = getRedisClient()

  try {
    const data = await redis.hgetall(ACCOUNT_KEY + id)

    if (!data || Object.keys(data).length === 0) {
      return null
    }

    return deserializeAccount(data)
  } catch (error) {
    logger.error('Failed to get account', { id, error: (error as Error).message })
    return null
  }
}

/**
 * 添加账号
 */
export async function addAccount(request: AddAccountRequest): Promise<ProxyAccount> {
  const redis = getRedisClient()

  const id = `acc_${uuidv4().substring(0, 8)}`
  const now = Date.now()

  // 处理机器码
  let machineId = request.machineId
  if (!machineId || !isValidMachineId(machineId)) {
    machineId = generateMachineId()
    logger.info('Generated new machine ID for account', { id, machineId })
  } else {
    machineId = normalizeMachineId(machineId)
  }

  const account: ProxyAccount = {
    id,
    email: request.email,
    accessToken: request.accessToken,
    refreshToken: request.refreshToken,
    clientId: request.clientId,
    clientSecret: request.clientSecret,
    region: request.region || 'us-east-1',
    authMethod: request.authMethod || 'social',
    provider: request.provider,
    profileArn: request.profileArn,
    machineId,
    machineIdCreatedAt: now,
    status: 'active',
    errorCount: 0,
    requestCount: 0,
    createdAt: now
  }

  try {
    const serialized = serializeAccount(account)

    // 使用事务保存
    const pipeline = redis.pipeline()
    pipeline.hset(ACCOUNT_KEY + id, serialized)
    pipeline.zadd(ACCOUNTS_INDEX, now, id)
    pipeline.sadd(ACCOUNTS_AVAILABLE, id)
    pipeline.sadd(MACHINE_IDS, machineId)
    await pipeline.exec()

    logger.info('Account added', { id, email: account.email, machineId })
    return account
  } catch (error) {
    logger.error('Failed to add account', { error: (error as Error).message })
    throw error
  }
}

/**
 * 更新账号
 */
export async function updateAccount(id: string, updates: UpdateAccountRequest): Promise<ProxyAccount | null> {
  const redis = getRedisClient()

  try {
    const existing = await getAccountById(id)
    if (!existing) {
      return null
    }

    // 如果更新机器码，需要处理索引
    if (updates.machineId && updates.machineId !== existing.machineId) {
      updates.machineId = normalizeMachineId(updates.machineId)

      // 移除旧机器码，添加新机器码
      await redis.srem(MACHINE_IDS, existing.machineId)
      await redis.sadd(MACHINE_IDS, updates.machineId)
    }

    const updated: ProxyAccount = { ...existing, ...updates }
    const serialized = serializeAccount(updated)

    await redis.hset(ACCOUNT_KEY + id, serialized)

    // 更新可用状态索引（只有 active 才参与调度）
    if (updates.status !== undefined) {
      if (updates.status === 'active') {
        await redis.sadd(ACCOUNTS_AVAILABLE, id)
      } else {
        await redis.srem(ACCOUNTS_AVAILABLE, id)
      }
    }

    logger.info('Account updated', { id })
    return updated
  } catch (error) {
    logger.error('Failed to update account', { id, error: (error as Error).message })
    throw error
  }
}

/**
 * 删除账号
 */
export async function deleteAccount(id: string): Promise<boolean> {
  const redis = getRedisClient()

  try {
    const account = await getAccountById(id)
    if (!account) {
      return false
    }

    const pipeline = redis.pipeline()
    pipeline.del(ACCOUNT_KEY + id)
    pipeline.zrem(ACCOUNTS_INDEX, id)
    pipeline.srem(ACCOUNTS_AVAILABLE, id)
    pipeline.srem(MACHINE_IDS, account.machineId)
    await pipeline.exec()

    logger.info('Account deleted', { id })
    return true
  } catch (error) {
    logger.error('Failed to delete account', { id, error: (error as Error).message })
    return false
  }
}

/**
 * 获取可用账号列表
 */
export async function getAvailableAccounts(): Promise<ProxyAccount[]> {
  const redis = getRedisClient()

  try {
    const availableIds = await redis.smembers(ACCOUNTS_AVAILABLE)

    if (availableIds.length === 0) {
      return []
    }

    const pipeline = redis.pipeline()
    for (const id of availableIds) {
      pipeline.hgetall(ACCOUNT_KEY + id)
    }

    const results = await pipeline.exec()
    const accounts: ProxyAccount[] = []

    if (results) {
      for (const [err, data] of results) {
        if (!err && data && typeof data === 'object' && Object.keys(data).length > 0) {
          const account = deserializeAccount(data as Record<string, string>)
          // 仅加载 status=active 且不在冷却期的账号
          if (account.status !== 'paused' && account.status !== 'error_suspended') {
            if (!account.cooldownUntil || account.cooldownUntil < Date.now()) {
              accounts.push(account)
            }
          }
        }
      }
    }

    return accounts
  } catch (error) {
    logger.error('Failed to get available accounts', { error: (error as Error).message })
    return []
  }
}

/**
 * 重新生成账号机器码
 */
export async function regenerateMachineId(id: string): Promise<ProxyAccount | null> {
  const redis = getRedisClient()

  try {
    const account = await getAccountById(id)
    if (!account) {
      return null
    }

    const oldMachineId = account.machineId
    const newMachineId = generateMachineId()

    // 更新机器码索引
    const pipeline = redis.pipeline()
    pipeline.srem(MACHINE_IDS, oldMachineId)
    pipeline.sadd(MACHINE_IDS, newMachineId)
    pipeline.hset(ACCOUNT_KEY + id, {
      machineId: newMachineId,
      machineIdCreatedAt: String(Date.now())
    })
    await pipeline.exec()

    logger.info('Machine ID regenerated', { id, oldMachineId, newMachineId })

    return { ...account, machineId: newMachineId, machineIdCreatedAt: Date.now() }
  } catch (error) {
    logger.error('Failed to regenerate machine ID', { id, error: (error as Error).message })
    throw error
  }
}

/**
 * 更新账号使用统计
 */
export async function updateAccountUsage(
  id: string,
  success: boolean,
  _responseTime?: number
): Promise<void> {
  const redis = getRedisClient()

  try {
    const updates: Record<string, string> = {
      lastUsed: String(Date.now())
    }

    if (success) {
      await redis.hincrby(ACCOUNT_KEY + id, 'requestCount', 1)
    } else {
      await redis.hincrby(ACCOUNT_KEY + id, 'errorCount', 1)
    }

    await redis.hset(ACCOUNT_KEY + id, updates)

    // 更新排序索引
    await redis.zadd(ACCOUNTS_INDEX, Date.now(), id)
  } catch (error) {
    logger.error('Failed to update account usage', { id, error: (error as Error).message })
  }
}

/**
 * 设置账号冷却
 */
export async function setAccountCooldown(id: string, durationMs: number): Promise<void> {
  const redis = getRedisClient()

  try {
    const cooldownUntil = Date.now() + durationMs
    await redis.hset(ACCOUNT_KEY + id, { cooldownUntil: String(cooldownUntil) })
    logger.info('Account cooldown set', { id, durationMs, cooldownUntil })
  } catch (error) {
    logger.error('Failed to set account cooldown', { id, error: (error as Error).message })
  }
}

/**
 * 获取账号数量
 */
export async function getAccountCount(): Promise<number> {
  const redis = getRedisClient()

  try {
    return await redis.zcard(ACCOUNTS_INDEX)
  } catch (error) {
    logger.error('Failed to get account count', { error: (error as Error).message })
    return 0
  }
}
