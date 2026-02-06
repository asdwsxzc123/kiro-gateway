/**
 * 账号池管理
 * 提供账号轮询、冷却、状态管理等功能
 * 参考 kiro-m 项目实现
 */

import type { ProxyAccount } from './types.js'

export interface AccountPoolStats {
  id: string
  requests: number
  tokens: number
  errors: number
  quotaErrors: number
  lastUsed: number
  isAvailable: boolean
  needsRefresh: boolean
}

export class AccountPool {
  private accounts: Map<string, ProxyAccount> = new Map()
  private accountStats: Map<string, AccountPoolStats> = new Map()
  private currentIndex: number = 0
  private accountOrder: string[] = []

  /**
   * 添加账号到池中
   */
  addAccount(account: ProxyAccount): void {
    this.accounts.set(account.id, account)
    this.accountStats.set(account.id, {
      id: account.id,
      requests: 0,
      tokens: 0,
      errors: 0,
      quotaErrors: 0,
      lastUsed: 0,
      isAvailable: true,
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
      if (this.currentIndex >= this.accountOrder.length) {
        this.currentIndex = 0
      }
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
   * 获取下一个可用账号（轮询策略）
   */
  getNextAccount(): ProxyAccount | null {
    if (this.accountOrder.length === 0) return null

    const now = Date.now()
    const startIndex = this.currentIndex
    let attempts = 0

    while (attempts < this.accountOrder.length) {
      const id = this.accountOrder[this.currentIndex]
      const account = this.accounts.get(id)
      const stats = this.accountStats.get(id)

      this.currentIndex = (this.currentIndex + 1) % this.accountOrder.length

      if (account && stats) {
        // 检查是否可用
        if (!stats.isAvailable) {
          attempts++
          continue
        }

        // 检查冷却时间
        if (account.cooldownUntil && account.cooldownUntil > now) {
          attempts++
          continue
        }

        // 检查是否需要刷新 Token
        if (stats.needsRefresh) {
          attempts++
          continue
        }

        return account
      }

      attempts++
    }

    // 没有可用账号，返回第一个（可能需要刷新）
    const firstId = this.accountOrder[startIndex]
    return this.accounts.get(firstId) || null
  }

  /**
   * 获取下一个可用账号（排除指定账号）
   */
  getNextAvailableAccount(excludeId?: string): ProxyAccount | null {
    if (this.accountOrder.length === 0) return null

    const now = Date.now()

    for (const id of this.accountOrder) {
      if (id === excludeId) continue

      const account = this.accounts.get(id)
      const stats = this.accountStats.get(id)

      if (account && stats) {
        if (!stats.isAvailable) continue
        if (account.cooldownUntil && account.cooldownUntil > now) continue
        if (stats.needsRefresh) continue

        return account
      }
    }

    return null
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
      stats.isAvailable = true
      // 成功后重置错误计数
      stats.errors = 0
      stats.quotaErrors = 0
    }

    const account = this.accounts.get(id)
    if (account) {
      account.lastUsed = Date.now()
      account.requestCount = (account.requestCount || 0) + 1
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
          account.cooldownUntil = Date.now() + 60000 // 1 分钟冷却
        }
      }

      // 连续错误过多，标记为不可用
      if (stats.errors >= 3) {
        stats.isAvailable = false
      }
    }

    const account = this.accounts.get(id)
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
   * 设置账号可用状态
   */
  setAvailable(id: string, available: boolean): void {
    const stats = this.accountStats.get(id)
    if (stats) {
      stats.isAvailable = available
      if (available) {
        stats.errors = 0
      }
    }

    const account = this.accounts.get(id)
    if (account) {
      account.isAvailable = available
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
   * 可用账号数量
   */
  get availableCount(): number {
    const now = Date.now()
    let count = 0

    for (const [id, stats] of this.accountStats) {
      if (!stats.isAvailable) continue
      if (stats.needsRefresh) continue

      const account = this.accounts.get(id)
      if (account?.cooldownUntil && account.cooldownUntil > now) continue

      count++
    }

    return count
  }

  /**
   * 从指定的账号子集中轮询选择下一个可用账号
   * 用于 API Key 绑定账号场景：只从绑定的账号中选择
   */
  getNextAccountFromSubset(accountIds: string[]): ProxyAccount | null {
    if (accountIds.length === 0) return null

    const now = Date.now()

    // 第一轮：找可用的账号
    for (const id of accountIds) {
      const account = this.accounts.get(id)
      const stats = this.accountStats.get(id)

      if (!account || !stats) continue
      if (!stats.isAvailable) continue
      if (stats.needsRefresh) continue
      if (account.cooldownUntil && account.cooldownUntil > now) continue

      return account
    }

    // 没有可用账号，返回 null（不像全局轮询那样 fallback）
    return null
  }

  /**
   * 如果指定账号可用则返回，否则返回 null（由调用方 fallback 到轮询）
   * 检查条件：账号存在 + isAvailable + 不在 cooldown 期 + 不需要 refresh
   */
  getAccountIfAvailable(id: string): ProxyAccount | null {
    const account = this.accounts.get(id)
    if (!account) return null

    const stats = this.accountStats.get(id)
    if (!stats) return null

    if (!stats.isAvailable) return null
    if (stats.needsRefresh) return null

    const now = Date.now()
    if (account.cooldownUntil && account.cooldownUntil > now) return null

    return account
  }

  /**
   * 清空账号池
   */
  clear(): void {
    this.accounts.clear()
    this.accountStats.clear()
    this.accountOrder = []
    this.currentIndex = 0
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
        isAvailable: true,
        needsRefresh: false
      })
    }
  }
}
