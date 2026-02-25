/**
 * 配置存储模块
 * 使用 Redis 存储网关配置
 */

import { getRedisClient } from './redis.js'
import { createLogger } from '../utils/logger.js'
import type { WebhookConfig } from '@kiro-gateway/shared'

const logger = createLogger('ConfigStore')

// Redis Key
const CONFIG_KEY = 'config'
const SELECTED_ACCOUNTS_KEY = 'config:selectedAccounts'
const API_KEYS_KEY = 'config:apiKeys'
const API_KEYS_INDEX_KEY = 'config:apiKeyIndex'

export interface GatewayConfig {
  // 服务配置
  port: number
  host: string

  // 代理配置
  enableMultiAccount: boolean
  maxConcurrent: number
  maxRetries: number
  retryDelay: number
  requestTimeout: number
  preferredEndpoint?: 'codewhisperer' | 'amazonq'
  defaultRegion?: string
  disableTools?: boolean
  disableToolCalls?: boolean
  autoContinueRounds?: number
  toolCallAutoRounds?: number
  autoSwitchOnQuotaExhausted?: boolean
  enableRequestLogging?: boolean
  tokenRefreshBeforeExpiry?: number

  // 账号池配置
  errorCooldownTime?: number
  maxConsecutiveErrors?: number
  quotaResetTime?: number
  autoStopErrorCodes?: string
  autoStopErrorPatterns?: string
  quotaUsageThreshold?: number

  // 限流配置
  rateLimitEnabled: boolean
  rateLimitWindow: number
  rateLimitMax: number

  // 并发排队配置
  queueEnabled?: boolean
  queueMaxSize?: number
  queueTimeoutMs?: number

  // 动态并发配置
  concurrencyMultiplier?: number
  queueSizeMultiplier?: number

  // 测试配置
  testModelId?: string
}

const DEFAULT_CONFIG: GatewayConfig = {
  port: 3000,
  host: '0.0.0.0',
  enableMultiAccount: true,
  maxConcurrent: 8,
  maxRetries: 3,
  retryDelay: 1000,
  requestTimeout: 120000,
  defaultRegion: 'us-east-1',
  disableTools: false,
  autoContinueRounds: 0,
  autoSwitchOnQuotaExhausted: true,
  rateLimitEnabled: false,
  rateLimitWindow: 60000,
  rateLimitMax: 100,
  testModelId: 'claude-sonnet-4.5'
}

/**
 * 获取网关配置
 */
export async function getGatewayConfig(): Promise<GatewayConfig> {
  const redis = getRedisClient()

  try {
    const data = await redis.hgetall(CONFIG_KEY)

    if (!data || Object.keys(data).length === 0) {
      return { ...DEFAULT_CONFIG }
    }

    const disableTools = data.disableTools === 'true' || data.disableToolCalls === 'true'
    const autoContinueRoundsRaw = data.autoContinueRounds ?? data.toolCallAutoRounds
    const autoContinueRounds = autoContinueRoundsRaw !== undefined
      ? (parseInt(autoContinueRoundsRaw, 10) || 0)
      : (DEFAULT_CONFIG.autoContinueRounds || 0)
    const autoSwitchOnQuotaExhausted = data.autoSwitchOnQuotaExhausted !== undefined
      ? data.autoSwitchOnQuotaExhausted === 'true'
      : (DEFAULT_CONFIG.autoSwitchOnQuotaExhausted ?? true)

    // 字段别名处理：前端可能发送不同名的字段
    const enableMultiAccountRaw = data.enableMultiAccount ?? data.multiAccountEnabled
    const enableRequestLoggingRaw = data.enableRequestLogging ?? data.logRequests
    const tokenRefreshBeforeExpiryRaw = data.tokenRefreshBeforeExpiry ?? data.tokenRefreshAdvance

    return {
      port: parseInt(data.port, 10) || DEFAULT_CONFIG.port,
      host: data.host || DEFAULT_CONFIG.host,
      enableMultiAccount: enableMultiAccountRaw !== undefined ? enableMultiAccountRaw === 'true' : DEFAULT_CONFIG.enableMultiAccount,
      maxConcurrent: parseInt(data.maxConcurrent, 10) || DEFAULT_CONFIG.maxConcurrent,
      maxRetries: parseInt(data.maxRetries, 10) || DEFAULT_CONFIG.maxRetries,
      retryDelay: parseInt(data.retryDelay, 10) || DEFAULT_CONFIG.retryDelay,
      requestTimeout: parseInt(data.requestTimeout, 10) || DEFAULT_CONFIG.requestTimeout,
      preferredEndpoint: data.preferredEndpoint as GatewayConfig['preferredEndpoint'],
      defaultRegion: data.defaultRegion || DEFAULT_CONFIG.defaultRegion,
      disableTools,
      disableToolCalls: disableTools,
      autoContinueRounds,
      toolCallAutoRounds: autoContinueRounds,
      autoSwitchOnQuotaExhausted,
      enableRequestLogging: enableRequestLoggingRaw !== undefined ? enableRequestLoggingRaw === 'true' : true,
      tokenRefreshBeforeExpiry: tokenRefreshBeforeExpiryRaw !== undefined
        ? (parseInt(tokenRefreshBeforeExpiryRaw, 10) || 300)
        : 300,
      rateLimitEnabled: data.rateLimitEnabled === 'true',
      rateLimitWindow: parseInt(data.rateLimitWindow, 10) || DEFAULT_CONFIG.rateLimitWindow,
      rateLimitMax: parseInt(data.rateLimitMax, 10) || DEFAULT_CONFIG.rateLimitMax,
      // 账号池配置（透传保存的值，确保 GET 时不丢失）
      ...(data.errorCooldownTime && { errorCooldownTime: parseInt(data.errorCooldownTime, 10) }),
      ...(data.maxConsecutiveErrors && { maxConsecutiveErrors: parseInt(data.maxConsecutiveErrors, 10) }),
      ...(data.quotaResetTime && { quotaResetTime: parseInt(data.quotaResetTime, 10) }),
      // 账号自动停用规则
      ...(data.autoStopErrorCodes && { autoStopErrorCodes: data.autoStopErrorCodes }),
      ...(data.autoStopErrorPatterns && { autoStopErrorPatterns: data.autoStopErrorPatterns }),
      ...(data.quotaUsageThreshold && { quotaUsageThreshold: parseInt(data.quotaUsageThreshold, 10) }),
      // 并发排队配置
      queueEnabled: data.queueEnabled === 'true',
      ...(data.queueMaxSize && { queueMaxSize: parseInt(data.queueMaxSize, 10) }),
      ...(data.queueTimeoutMs && { queueTimeoutMs: parseInt(data.queueTimeoutMs, 10) }),
      // 动态并发配置
      ...(data.concurrencyMultiplier && { concurrencyMultiplier: parseFloat(data.concurrencyMultiplier) }),
      ...(data.queueSizeMultiplier && { queueSizeMultiplier: parseFloat(data.queueSizeMultiplier) }),
    }
  } catch (error) {
    logger.error('Failed to get gateway config', { error: (error as Error).message })
    return { ...DEFAULT_CONFIG }
  }
}

/**
 * 更新网关配置
 */
export async function updateGatewayConfig(updates: Partial<GatewayConfig>): Promise<GatewayConfig> {
  const redis = getRedisClient()

  try {
    // 字段归一化：将前端别名统一为标准字段名
    const normalized = { ...updates } as Record<string, unknown>
    if ('multiAccountEnabled' in normalized) {
      normalized.enableMultiAccount = normalized.multiAccountEnabled
      delete normalized.multiAccountEnabled
    }
    if ('logRequests' in normalized) {
      normalized.enableRequestLogging = normalized.logRequests
      delete normalized.logRequests
    }
    if ('tokenRefreshAdvance' in normalized) {
      normalized.tokenRefreshBeforeExpiry = normalized.tokenRefreshAdvance
      delete normalized.tokenRefreshAdvance
    }

    const current = await getGatewayConfig()
    const updated = { ...current, ...normalized }

    const data: Record<string, string> = {}
    for (const [key, value] of Object.entries(updated)) {
      if (value !== undefined && value !== null) {
        data[key] = String(value)
      }
    }

    // 清除已归一化的旧别名键，避免 Redis 中出现同义不同名的重复 key
    const aliasKeys = ['multiAccountEnabled', 'logRequests', 'tokenRefreshAdvance']
    for (const aliasKey of aliasKeys) {
      await redis.hdel(CONFIG_KEY, aliasKey)
    }

    await redis.hset(CONFIG_KEY, data)
    logger.info('Gateway config updated', { updates })

    return updated
  } catch (error) {
    logger.error('Failed to update gateway config', { error: (error as Error).message })
    throw error
  }
}

/**
 * 获取选中的账号 ID 列表
 */
export async function getSelectedAccounts(): Promise<string[]> {
  const redis = getRedisClient()

  try {
    return await redis.smembers(SELECTED_ACCOUNTS_KEY)
  } catch (error) {
    logger.error('Failed to get selected accounts', { error: (error as Error).message })
    return []
  }
}

/**
 * 设置选中的账号
 */
export async function setSelectedAccounts(accountIds: string[]): Promise<void> {
  const redis = getRedisClient()

  try {
    await redis.del(SELECTED_ACCOUNTS_KEY)
    if (accountIds.length > 0) {
      await redis.sadd(SELECTED_ACCOUNTS_KEY, ...accountIds)
    }
    logger.info('Selected accounts updated', { count: accountIds.length })
  } catch (error) {
    logger.error('Failed to set selected accounts', { error: (error as Error).message })
    throw error
  }
}

/**
 * 添加选中账号
 */
export async function addSelectedAccount(accountId: string): Promise<void> {
  const redis = getRedisClient()

  try {
    await redis.sadd(SELECTED_ACCOUNTS_KEY, accountId)
  } catch (error) {
    logger.error('Failed to add selected account', { error: (error as Error).message })
    throw error
  }
}

/**
 * 移除选中账号
 */
export async function removeSelectedAccount(accountId: string): Promise<void> {
  const redis = getRedisClient()

  try {
    await redis.srem(SELECTED_ACCOUNTS_KEY, accountId)
  } catch (error) {
    logger.error('Failed to remove selected account', { error: (error as Error).message })
    throw error
  }
}

// ============ API Key 管理 ============

export interface ApiKeyRecord {
  id: string
  key: string
  name: string
  boundAccountIds?: string[]  // 绑定的账号 ID 列表（空或不设 = 使用全局账号池）
  quotaLimit?: number  // 费用上限（美元），0 或 undefined 表示不限制
  createdAt: number
  lastUsed?: number
}

/**
 * 获取所有 API Key
 */
export async function getAllApiKeys(): Promise<ApiKeyRecord[]> {
  const redis = getRedisClient()

  try {
    const data = await redis.hgetall(API_KEYS_KEY)

    if (!data || Object.keys(data).length === 0) {
      return []
    }

    return Object.values(data).map(json => JSON.parse(json) as ApiKeyRecord)
  } catch (error) {
    logger.error('Failed to get API keys', { error: (error as Error).message })
    return []
  }
}

/**
 * 添加 API Key
 */
export async function addApiKey(record: ApiKeyRecord): Promise<void> {
  const redis = getRedisClient()

  try {
    const pipeline = redis.pipeline()
    pipeline.hset(API_KEYS_KEY, record.id, JSON.stringify(record))
    pipeline.hset(API_KEYS_INDEX_KEY, record.key, record.id)
    await pipeline.exec()
    logger.info('API key added', { id: record.id, name: record.name })
  } catch (error) {
    logger.error('Failed to add API key', { error: (error as Error).message })
    throw error
  }
}

/**
 * 删除 API Key
 */
export async function deleteApiKey(id: string): Promise<boolean> {
  const redis = getRedisClient()

  try {
    const raw = await redis.hget(API_KEYS_KEY, id)
    if (!raw) return false
    const record = JSON.parse(raw) as ApiKeyRecord

    const pipeline = redis.pipeline()
    pipeline.hdel(API_KEYS_KEY, id)
    pipeline.hdel(API_KEYS_INDEX_KEY, record.key)
    const result = await pipeline.exec()

    const deleted = result?.[0]?.[1] as number | undefined
    if ((deleted ?? 0) > 0) {
      logger.info('API key deleted', { id })
      return true
    }
    return false
  } catch (error) {
    logger.error('Failed to delete API key', { error: (error as Error).message })
    return false
  }
}

/**
 * 验证 API Key
 * 返回匹配的 ApiKeyRecord（含 boundAccountIds），无匹配返回 null
 */
export async function validateApiKey(key: string): Promise<ApiKeyRecord | null> {
  const redis = getRedisClient()

  try {
    const recordId = await redis.hget(API_KEYS_INDEX_KEY, key)
    if (recordId) {
      const raw = await redis.hget(API_KEYS_KEY, recordId)
      if (raw) {
        const record = JSON.parse(raw) as ApiKeyRecord
        if (record.key === key) {
          record.lastUsed = Date.now()
          redis.hset(API_KEYS_KEY, record.id, JSON.stringify(record)).catch((error) => {
            logger.warn('Failed to update API key lastUsed', { id: record.id, error: (error as Error).message })
          })
          return record
        }
      }
      // 索引脏数据，清理掉后走降级扫描
      await redis.hdel(API_KEYS_INDEX_KEY, key)
    }

    const data = await redis.hgetall(API_KEYS_KEY)

    if (!data || Object.keys(data).length === 0) {
      // 没有配置任何 API Key，拒绝访问（更安全的默认行为）
      logger.warn('No API keys configured, access denied')
      return null
    }

    // 兼容旧数据：当索引不存在时重建 key->id 索引
    const indexPipeline = redis.pipeline()
    for (const json of Object.values(data)) {
      const record = JSON.parse(json) as ApiKeyRecord
      indexPipeline.hset(API_KEYS_INDEX_KEY, record.key, record.id)
      if (record.key === key) {
        // 更新最后使用时间
        record.lastUsed = Date.now()
        redis.hset(API_KEYS_KEY, record.id, JSON.stringify(record)).catch((error) => {
          logger.warn('Failed to update API key lastUsed', { id: record.id, error: (error as Error).message })
        })
        await indexPipeline.exec()
        return record
      }
    }
    await indexPipeline.exec()

    return null
  } catch (error) {
    logger.error('Failed to validate API key', { error: (error as Error).message })
    return null
  }
}

/**
 * 更新 API Key（名称、绑定账号等）
 */
export async function updateApiKey(
  id: string,
  updates: Partial<Pick<ApiKeyRecord, 'name' | 'boundAccountIds' | 'quotaLimit'>>
): Promise<ApiKeyRecord | null> {
  const redis = getRedisClient()

  try {
    const raw = await redis.hget(API_KEYS_KEY, id)
    if (!raw) return null

    const record = JSON.parse(raw) as ApiKeyRecord
    // 合并更新字段
    if (updates.name !== undefined) record.name = updates.name
    if (updates.boundAccountIds !== undefined) record.boundAccountIds = updates.boundAccountIds
    if (updates.quotaLimit !== undefined) record.quotaLimit = updates.quotaLimit

    await redis.hset(API_KEYS_KEY, id, JSON.stringify(record))
    logger.info('API key updated', { id, updates })
    return record
  } catch (error) {
    logger.error('Failed to update API key', { error: (error as Error).message })
    return null
  }
}

/**
 * 从所有 API Key 的 boundAccountIds 中移除指定账号
 * 用于账号删除时的级联清理
 */
export async function removeAccountFromApiKeys(accountId: string): Promise<number> {
  const redis = getRedisClient()
  let updated = 0

  try {
    const data = await redis.hgetall(API_KEYS_KEY)
    if (!data || Object.keys(data).length === 0) return 0

    for (const [id, json] of Object.entries(data)) {
      const record = JSON.parse(json) as ApiKeyRecord
      if (record.boundAccountIds && record.boundAccountIds.includes(accountId)) {
        // 移除已删除的账号 ID
        record.boundAccountIds = record.boundAccountIds.filter(aid => aid !== accountId)
        await redis.hset(API_KEYS_KEY, id, JSON.stringify(record))
        updated++
      }
    }

    if (updated > 0) {
      logger.info('Removed account from API key bindings', { accountId, updatedKeys: updated })
    }
    return updated
  } catch (error) {
    logger.error('Failed to remove account from API keys', { error: (error as Error).message })
    return 0
  }
}

// ============ Webhook 配置 ============

const WEBHOOK_CONFIG_KEY = 'webhook_config'

const DEFAULT_WEBHOOK_CONFIG: WebhookConfig = {
  enabled: false,
  usageThreshold: 0,
  notifyOnAccountError: false,
  notifyOnTokenRefreshFail: false,
  notifyHeartbeat: false,
  platforms: [],
}

/**
 * 获取 Webhook 配置（首次访问时自动从旧字段迁移）
 */
export async function getWebhookConfig(): Promise<WebhookConfig> {
  const redis = getRedisClient()

  try {
    const raw = await redis.get(WEBHOOK_CONFIG_KEY)
    if (raw) return JSON.parse(raw) as WebhookConfig

    // 自动迁移旧配置
    const oldData = await redis.hgetall(CONFIG_KEY)
    const migrated: WebhookConfig = {
      enabled: !!oldData?.webhookUrl,
      usageThreshold: oldData?.webhookUsageThreshold ? parseInt(oldData.webhookUsageThreshold, 10) : 0,
      notifyOnAccountError: oldData?.webhookOnAccountError === 'true',
      notifyOnTokenRefreshFail: false,
      notifyHeartbeat: false,
      platforms: oldData?.webhookUrl
        ? [{ platform: 'feishu', enabled: true, url: oldData.webhookUrl, label: 'Default' }]
        : [],
    }

    await redis.set(WEBHOOK_CONFIG_KEY, JSON.stringify(migrated))
    if (oldData?.webhookUrl) {
      await redis.hdel(CONFIG_KEY, 'webhookUrl', 'webhookUsageThreshold', 'webhookOnAccountError')
    }

    return migrated
  } catch (error) {
    logger.error('Failed to get webhook config', { error: (error as Error).message })
    return { ...DEFAULT_WEBHOOK_CONFIG }
  }
}

/**
 * 更新 Webhook 配置
 */
export async function updateWebhookConfig(config: WebhookConfig): Promise<WebhookConfig> {
  const redis = getRedisClient()

  try {
    await redis.set(WEBHOOK_CONFIG_KEY, JSON.stringify(config))
    logger.info('Webhook config updated')
    return config
  } catch (error) {
    logger.error('Failed to update webhook config', { error: (error as Error).message })
    throw error
  }
}
