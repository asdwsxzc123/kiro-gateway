/**
 * 账号等待队列
 * 当所有账号并发满时，请求进入 FIFO 等待队列而非立即 503
 * 设计对齐 RequestQueue 的安全保障模式：AbortSignal + timeout + maxSize
 */

import { createLogger } from '../utils/logger.js'

const logger = createLogger('AccountWaitQueue')

export interface AccountWaitQueueConfig {
  /** 是否启用账号等待队列，默认 true */
  enabled: boolean
  /** 最大等待队列长度，默认 50 */
  maxSize: number
  /** 等待超时（毫秒），默认 5000，必须远小于客户端超时 */
  timeoutMs: number
}

export interface AccountWaitStats {
  totalWaited: number
  totalTimedOut: number
  totalAborted: number
  totalQueueFull: number
  totalWokenSuccess: number
  totalWokenRaceLost: number
  waitTimeSamples: number[]
}

interface WaitEntry {
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  signal?: AbortSignal
  abortHandler?: () => void
  enqueuedAt: number
  /** 绑定账号 ID 列表（API Key 场景），空数组 = 全局池 */
  boundAccountIds: string[]
}

export class AccountWaitQueue {
  private queue: WaitEntry[] = []
  private config: AccountWaitQueueConfig
  private stats: AccountWaitStats = {
    totalWaited: 0, totalTimedOut: 0, totalAborted: 0,
    totalQueueFull: 0, totalWokenSuccess: 0, totalWokenRaceLost: 0,
    waitTimeSamples: []
  }

  constructor(config?: Partial<AccountWaitQueueConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      maxSize: config?.maxSize ?? 50,
      timeoutMs: config?.timeoutMs ?? 5000
    }
  }

  updateConfig(config: Partial<AccountWaitQueueConfig>): void {
    if (config.enabled !== undefined) this.config.enabled = config.enabled
    if (config.maxSize !== undefined) this.config.maxSize = config.maxSize
    if (config.timeoutMs !== undefined) this.config.timeoutMs = config.timeoutMs
  }

  get enabled(): boolean { return this.config.enabled }
  get length(): number { return this.queue.length }

  getStatus(): { queued: number; enabled: boolean; maxSize: number; timeoutMs: number } {
    return {
      queued: this.queue.length,
      enabled: this.config.enabled,
      maxSize: this.config.maxSize,
      timeoutMs: this.config.timeoutMs
    }
  }

  getStats(): AccountWaitStats {
    return { ...this.stats, waitTimeSamples: [...this.stats.waitTimeSamples] }
  }

  /**
   * 进入等待队列，返回 Promise，在被唤醒时 resolve
   * 调用方拿到 resolve 后需自行重试 getNextAccount
   */
  async wait(signal?: AbortSignal, boundAccountIds?: string[]): Promise<void> {
    if (!this.config.enabled) {
      throw new Error('Account wait queue disabled')
    }
    if (this.queue.length >= this.config.maxSize) {
      this.stats.totalQueueFull++
      logger.warn('Account wait queue full', { size: this.queue.length, max: this.config.maxSize })
      throw new Error('Account wait queue full')
    }
    if (signal?.aborted) {
      this.stats.totalAborted++
      throw new Error('Request already aborted')
    }

    this.stats.totalWaited++
    logger.debug('Request entering account wait queue', {
      position: this.queue.length + 1,
      boundAccounts: boundAccountIds?.length ?? 0
    })

    return new Promise<void>((resolve, reject) => {
      const entry: WaitEntry = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removeEntry(entry)
          this.stats.totalTimedOut++
          reject(new Error(`Account wait timeout after ${this.config.timeoutMs}ms`))
        }, this.config.timeoutMs),
        signal,
        enqueuedAt: Date.now(),
        boundAccountIds: boundAccountIds ?? []
      }

      if (signal) {
        entry.abortHandler = () => {
          this.removeEntry(entry)
          this.stats.totalAborted++
          reject(new Error('Request aborted while waiting for account'))
        }
        signal.addEventListener('abort', entry.abortHandler, { once: true })
      }

      this.queue.push(entry)
    })
  }

  /**
   * 唤醒队列中的下一个等待者（由 decrementConcurrency 调用）
   * @param freedAccountId 释放槽位的账号 ID，用于优先唤醒匹配的等待者
   */
  notifySlotFreed(freedAccountId?: string): void {
    if (this.queue.length === 0) return

    // 优先唤醒：绑定了该账号的等待者，或无绑定限制的等待者
    let targetIndex = -1
    for (let i = 0; i < this.queue.length; i++) {
      const entry = this.queue[i]
      if (entry.signal?.aborted) continue
      const bound = entry.boundAccountIds
      if (bound.length === 0 || (freedAccountId && bound.includes(freedAccountId))) {
        targetIndex = i
        break
      }
    }

    // 没有精确匹配，唤醒第一个未取消的（FIFO 兜底）
    if (targetIndex === -1) {
      for (let i = 0; i < this.queue.length; i++) {
        if (!this.queue[i].signal?.aborted) {
          targetIndex = i
          break
        }
      }
    }

    if (targetIndex === -1) return

    const entry = this.queue.splice(targetIndex, 1)[0]
    clearTimeout(entry.timer)
    if (entry.signal && entry.abortHandler) {
      entry.signal.removeEventListener('abort', entry.abortHandler)
    }

    const waitTime = Date.now() - entry.enqueuedAt
    this.recordWaitTime(waitTime)
    logger.debug('Waking account waiter', { waitTime, remaining: this.queue.length })
    entry.resolve()
  }

  /** 记录唤醒后拿到账号（供调用方回调） */
  recordWokenSuccess(): void { this.stats.totalWokenSuccess++ }
  /** 记录唤醒后竞争失败（供调用方回调） */
  recordWokenRaceLost(): void { this.stats.totalWokenRaceLost++ }

  private removeEntry(entry: WaitEntry): void {
    const idx = this.queue.indexOf(entry)
    if (idx !== -1) this.queue.splice(idx, 1)
    clearTimeout(entry.timer)
    if (entry.signal && entry.abortHandler) {
      entry.signal.removeEventListener('abort', entry.abortHandler)
    }
  }

  private recordWaitTime(ms: number): void {
    this.stats.waitTimeSamples.push(ms)
    if (this.stats.waitTimeSamples.length > 100) this.stats.waitTimeSamples.shift()
  }

  clear(): void {
    for (const entry of this.queue) {
      clearTimeout(entry.timer)
      if (entry.signal && entry.abortHandler) {
        entry.signal.removeEventListener('abort', entry.abortHandler)
      }
      entry.reject(new Error('Account wait queue cleared'))
    }
    this.queue = []
  }
}
