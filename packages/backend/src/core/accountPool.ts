/**
 * 账号池管理
 * 提供账号轮询、冷却、状态管理等功能
 * 参考 kiro-m 项目实现
 */

import type { ProxyAccount } from './types.js'
import type { AccountStatus } from '@kiro-gateway/shared'
import { notify } from './webhook.js'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('AccountPool')

export type { AccountStatus }

export interface AccountPoolStats {
  id: string
  requests: number
  tokens: number
  errors: number
  quotaErrors: number
  lastUsed: number
  needsRefresh: boolean
}

export interface PoolConfig {
  errorCooldownMs: number
  maxConsecutiveErrors: number
}

export class AccountPool {
  private accounts: Map<string, ProxyAccount> = new Map()
  private accountStats: Map<string, AccountPoolStats> = new Map()
  private accountOrder: string[] = []
  // 每账号活跃请求数追踪（内存级，单实例无需 Redis）
  private activeConcurrency: Map<string, number> = new Map()
  private poolConfig: PoolConfig = { errorCooldownMs: 60000, maxConsecutiveErrors: 3 }

  /**
   * 更新账号池配置（可热更新）
   */
  updatePoolConfig(config: Partial<PoolConfig>): void {
    if (config.errorCooldownMs !== undefined) this.poolConfig.errorCooldownMs = config.errorCooldownMs
    if (config.maxConsecutiveErrors !== undefined) this.poolConfig.maxConsecutiveErrors = config.maxConsecutiveErrors
  }

  /**
   * 检查账号是否处于 active 状态（可参与调度）
   */
  private isActive(account: ProxyAccount): boolean {
    return !account.status || account.status === 'active'
  }

  /**
   * 添加账号到池中
   */
  addAccount(account: ProxyAccount): void {
    // 确保新加入的账号有默认 status
    if (!account.status) {
      account.status = 'active'
    }
    this.accounts.set(account.id, account)
    this.accountStats.set(account.id, {
      id: account.id,
      requests: 0,
      tokens: 0,
      errors: 0,
      quotaErrors: 0,
      lastUsed: 0,
      needsRefresh: false
    })
    this.accountOrder.push(account.id)
  }

  /**
   * 批量添加账号
   */
  addAccounts(accounts: ProxyAccount[]): void {
    for (const account of accounts) {
      this.addAccount(account)
    }
  }

  /**
   * 移除账号
   */
  removeAccount(id: string): boolean {
    const removed = this.accounts.delete(id)
    if (removed) {
      this.accountStats.delete(id)
      this.accountOrder = this.accountOrder.filter(aid => aid !== id)
    }
    return removed
  }

  /**
   * 更新账号信息
   */
  updateAccount(id: string, updates: Partial<ProxyAccount>): void {
    const account = this.accounts.get(id)
    if (account) {
      this.accounts.set(id, { ...account, ...updates })
    }
  }

  /**
   * 获取账号
   */
  getAccount(id: string): ProxyAccount | null {
    return this.accounts.get(id) || null
  }

  /**
   * 获取所有账号
   */
  getAllAccounts(): ProxyAccount[] {
    return Array.from(this.accounts.values())
  }

  /**
   * 获取内存池中的账号总数
   */
  getPoolSize(): number {
    return this.accountOrder.length
  }

  /**
   * 获取下一个可用账号（LRU + 并发感知策略）
   * 优先选择并发数最低的账号，并发数相同时选择 lastUsed 最早的
   */
  getNextAccount(): ProxyAccount | null {
    if (this.accountOrder.length === 0) {
      logger.warn('Account pool is empty, no accounts loaded')
      return null
    }

    const now = Date.now()
    let bestAccount: ProxyAccount | null = null
    let bestConcurrency = Infinity
    let bestLastUsed = Infinity
    const skipReasons: { id: string; alias?: string; reason: string }[] = []

    for (const id of this.accountOrder) {
      const account = this.accounts.get(id)
      const stats = this.accountStats.get(id)
      const label = account?.alias || account?.email || id.slice(0, 8)

      if (!account || !stats) { skipReasons.push({ id, reason: 'not_in_pool' }); continue }
      if (!this.isActive(account)) { skipReasons.push({ id, alias: label, reason: `status=${account.status}` }); continue }
      if (account.cooldownUntil && account.cooldownUntil > now) { skipReasons.push({ id, alias: label, reason: `cooldown ${Math.ceil((account.cooldownUntil - now) / 1000)}s` }); continue }
      if (stats.needsRefresh) { skipReasons.push({ id, alias: label, reason: 'needsRefresh' }); continue }

      const concurrency = this.activeConcurrency.get(id) || 0

      // 检查单账号并发上限
      if (account.maxConcurrency && account.maxConcurrency > 0 && concurrency >= account.maxConcurrency) {
        skipReasons.push({ id, alias: label, reason: `concurrency ${concurrency}/${account.maxConcurrency}` })
        continue
      }

      const lastUsed = stats.lastUsed || 0

      // 优先选并发数低的，并发相同则选 LRU
      if (concurrency < bestConcurrency || (concurrency === bestConcurrency && lastUsed < bestLastUsed)) {
        bestConcurrency = concurrency
        bestLastUsed = lastUsed
        bestAccount = account
      }
    }

    if (!bestAccount && skipReasons.length > 0) {
      logger.warn('All accounts skipped', { total: this.accountOrder.length, reasons: skipReasons })
    }

    return bestAccount
  }

  /**
   * 获取下一个可用账号（排除指定账号，LRU + 并发感知策略）
   */
  getNextAvailableAccount(excludeId?: string): ProxyAccount | null {
    if (this.accountOrder.length === 0) return null

    const now = Date.now()
    let bestAccount: ProxyAccount | null = null
    let bestConcurrency = Infinity
    let bestLastUsed = Infinity

    for (const id of this.accountOrder) {
      if (id === excludeId) continue

      const account = this.accounts.get(id)
      const stats = this.accountStats.get(id)

      if (!account || !stats) continue
      if (!this.isActive(account)) continue
      if (account.cooldownUntil && account.cooldownUntil > now) continue
      if (stats.needsRefresh) continue

      const concurrency = this.activeConcurrency.get(id) || 0

      // 检查单账号并发上限
      if (account.maxConcurrency && account.maxConcurrency > 0 && concurrency >= account.maxConcurrency) continue

      const lastUsed = stats.lastUsed || 0

      if (concurrency < bestConcurrency || (concurrency === bestConcurrency && lastUsed < bestLastUsed)) {
        bestConcurrency = concurrency
        bestLastUsed = lastUsed
        bestAccount = account
      }
    }

    return bestAccount
  }

  /**
   * 记录请求成功
   */
  recordSuccess(id: string, tokens: number = 0): void {
    const stats = this.accountStats.get(id)
    if (stats) {
      stats.requests++
      stats.tokens += tokens
      stats.lastUsed = Date.now()
      // 成功后重置错误计数
      stats.errors = 0
      stats.quotaErrors = 0
    }

    const account = this.accounts.get(id)
    if (account) {
      account.lastUsed = Date.now()
      account.requestCount = (account.requestCount || 0) + 1
      // 仅从 error_suspended 自动恢复，手动 paused 和封号 suspended 不自动恢复
      if (account.status === 'error_suspended') {
        this.setStatus(id, 'active', '请求成功自动恢复')
      }
    }
  }

  /**
   * 记录请求错误
   */
  recordError(id: string, isQuotaError: boolean = false): void {
    const stats = this.accountStats.get(id)
    if (stats) {
      stats.errors++
      if (isQuotaError) {
        stats.quotaErrors++
        // 配额错误，设置冷却时间
        const account = this.accounts.get(id)
        if (account) {
          account.cooldownUntil = Date.now() + this.poolConfig.errorCooldownMs
        }
      }

      // 连续错误过多，自动挂起
      if (stats.errors >= this.poolConfig.maxConsecutiveErrors) {
        const account = this.accounts.get(id)
        if (account && account.status !== 'paused' && account.status !== 'suspended') {
          // 仅非手动暂停和非封号的账号才自动挂起
          this.setStatus(id, 'error_suspended', `连续错误 ${stats.errors} 次`)
        }
      }
    }

    const account = this.accounts.get(id)
    if (account) {
      account.errorCount = (account.errorCount || 0) + 1
    }
  }

  /**
   * 记录请求错误（按错误类型差异化冷却）
   */
  recordErrorWithType(id: string, errorCode: string, cooldownMs: number): void {
    const stats = this.accountStats.get(id)
    const account = this.accounts.get(id)

    if (stats) {
      stats.errors++
      if (errorCode === 'QUOTA_EXHAUSTED') {
        stats.quotaErrors++
      }

      // 设置差异化冷却时间
      if (account && cooldownMs > 0) {
        account.cooldownUntil = Date.now() + cooldownMs
      }

      // 连续错误过多，自动挂起
      if (stats.errors >= this.poolConfig.maxConsecutiveErrors) {
        if (account && account.status !== 'paused' && account.status !== 'suspended') {
          this.setStatus(id, 'error_suspended', `连续错误 ${stats.errors} 次`)
        }
      }
    }

    if (account) {
      account.errorCount = (account.errorCount || 0) + 1
    }
  }

  /**
   * 标记账号需要刷新 Token
   */
  markNeedsRefresh(id: string): void {
    const stats = this.accountStats.get(id)
    if (stats) {
      stats.needsRefresh = true
    }
  }

  /**
   * 清除需要刷新标记
   */
  clearNeedsRefresh(id: string): void {
    const stats = this.accountStats.get(id)
    if (stats) {
      stats.needsRefresh = false
    }
  }

  /**
   * 设置账号调度状态
   */
  setStatus(id: string, status: AccountStatus, reason?: string): void {
    const account = this.accounts.get(id)
    if (account) {
      account.status = status
      account.statusChangedAt = Date.now()
      account.statusReason = reason || ''
    }

    // 恢复到 active 时重置错误计数
    if (status === 'active') {
      const stats = this.accountStats.get(id)
      if (stats) {
        stats.errors = 0
      }
    }

    // 状态变更时触发 webhook 告警（active 是正常状态，不推送）
    if (account && status !== 'active') {
      notify({
        type: 'account_error',
        timestamp: new Date().toISOString(),
        account: { id, alias: account.alias, email: account.email },
        detail: { status, errorCount: account.errorCount }
      }).catch(() => {})
    }
  }

  /**
   * 设置账号冷却时间
   */
  setCooldown(id: string, durationMs: number): void {
    const account = this.accounts.get(id)
    if (account) {
      account.cooldownUntil = Date.now() + durationMs
    }
  }

  /**
   * 获取账号统计
   */
  getAccountStats(id: string): AccountPoolStats | null {
    return this.accountStats.get(id) || null
  }

  /**
   * 获取所有账号统计
   */
  getAllStats(): AccountPoolStats[] {
    return Array.from(this.accountStats.values())
  }

  /**
   * 账号池大小
   */
  get size(): number {
    return this.accounts.size
  }

  /**
   * 可用账号数量（status=active 且不在 cooldown/refresh 中）
   */
  get availableCount(): number {
    const now = Date.now()
    let count = 0

    for (const [id, stats] of this.accountStats) {
      if (stats.needsRefresh) continue

      const account = this.accounts.get(id)
      if (!account || !this.isActive(account)) continue
      if (account.cooldownUntil && account.cooldownUntil > now) continue

      count++
    }

    return count
  }

  /**
   * 从指定的账号子集中选择下一个可用账号（LRU + 并发感知策略）
   * 用于 API Key 绑定账号场景：只从绑定的账号中选择
   */
  getNextAccountFromSubset(accountIds: string[]): ProxyAccount | null {
    if (accountIds.length === 0) return null

    const now = Date.now()
    let bestAccount: ProxyAccount | null = null
    let bestConcurrency = Infinity
    let bestLastUsed = Infinity
    const skipReasons: { id: string; alias?: string; reason: string }[] = []

    for (const id of accountIds) {
      const account = this.accounts.get(id)
      const stats = this.accountStats.get(id)
      const label = account?.alias || account?.email || id.slice(0, 8)

      if (!account || !stats) { skipReasons.push({ id, reason: 'not_in_pool' }); continue }
      if (!this.isActive(account)) { skipReasons.push({ id, alias: label, reason: `status=${account.status}` }); continue }
      if (stats.needsRefresh) { skipReasons.push({ id, alias: label, reason: 'needsRefresh' }); continue }
      if (account.cooldownUntil && account.cooldownUntil > now) { skipReasons.push({ id, alias: label, reason: `cooldown ${Math.ceil((account.cooldownUntil - now) / 1000)}s` }); continue }

      const concurrency = this.activeConcurrency.get(id) || 0

      // 检查单账号并发上限
      if (account.maxConcurrency && account.maxConcurrency > 0 && concurrency >= account.maxConcurrency) {
        skipReasons.push({ id, alias: label, reason: `concurrency ${concurrency}/${account.maxConcurrency}` })
        continue
      }

      const lastUsed = stats.lastUsed || 0

      if (concurrency < bestConcurrency || (concurrency === bestConcurrency && lastUsed < bestLastUsed)) {
        bestConcurrency = concurrency
        bestLastUsed = lastUsed
        bestAccount = account
      }
    }

    if (!bestAccount && skipReasons.length > 0) {
      logger.warn('All bound accounts skipped', { subset: accountIds.length, reasons: skipReasons })
    }

    return bestAccount
  }

  /**
   * 如果指定账号可用则返回，否则返回 null（由调用方 fallback 到轮询）
   * 检查条件：账号存在 + status=active + 不在 cooldown 期 + 不需要 refresh
   */
  getAccountIfAvailable(id: string): ProxyAccount | null {
    const account = this.accounts.get(id)
    if (!account) return null

    const stats = this.accountStats.get(id)
    if (!stats) return null

    if (!this.isActive(account)) return null
    if (stats.needsRefresh) return null

    const now = Date.now()
    if (account.cooldownUntil && account.cooldownUntil > now) return null

    return account
  }

  // ============ 并发追踪 ============

  /**
   * 增加账号活跃并发数
   */
  incrementConcurrency(id: string): void {
    const current = this.activeConcurrency.get(id) || 0
    this.activeConcurrency.set(id, current + 1)
  }

  /**
   * 减少账号活跃并发数
   */
  decrementConcurrency(id: string): void {
    const current = this.activeConcurrency.get(id) || 0
    this.activeConcurrency.set(id, Math.max(0, current - 1))
  }

  /**
   * 获取账号当前活跃并发数
   */
  getConcurrency(id: string): number {
    return this.activeConcurrency.get(id) || 0
  }

  /**
   * 获取所有账号的并发数映射
   */
  getAllConcurrency(): Map<string, number> {
    return new Map(this.activeConcurrency)
  }

  /**
   * 清空账号池
   */
  clear(): void {
    this.accounts.clear()
    this.accountStats.clear()
    this.accountOrder = []
    this.activeConcurrency.clear()
  }

  /**
   * 重置所有账号状态
   */
  resetAllStats(): void {
    for (const [id] of this.accountStats) {
      this.accountStats.set(id, {
        id,
        requests: 0,
        tokens: 0,
        errors: 0,
        quotaErrors: 0,
        lastUsed: 0,
        needsRefresh: false
      })
      // 重置统计时恢复所有非手动暂停的账号
      const account = this.accounts.get(id)
      if (account && account.status === 'error_suspended') {
        this.setStatus(id, 'active', '统计重置自动恢复')
      }
    }
  }
}
