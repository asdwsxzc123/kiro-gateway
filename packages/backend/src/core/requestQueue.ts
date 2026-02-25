/**
 * 请求排队系统
 * 当并发请求数超过 maxConcurrent 时，排队等待而非立即拒绝
 * 内存级实现（单实例无需 Redis）
 */

import { createLogger } from '../utils/logger.js'

const logger = createLogger('RequestQueue')

export interface RequestQueueConfig {
  /** 是否启用排队 */
  enabled: boolean
  /** 最大队列长度（超过后拒绝），默认为 2x maxConcurrent */
  maxSize: number
  /** 排队超时时间（毫秒），默认 30s */
  timeoutMs: number
}

interface QueueEntry {
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  signal?: AbortSignal
  abortHandler?: () => void
  enqueuedAt: number
}

export class RequestQueue {
  private config: RequestQueueConfig
  private queue: QueueEntry[] = []
  private activeCount: number = 0
  private maxConcurrent: number

  constructor(maxConcurrent: number, config?: Partial<RequestQueueConfig>) {
    this.maxConcurrent = maxConcurrent
    this.config = {
      enabled: config?.enabled ?? false,
      maxSize: config?.maxSize ?? maxConcurrent * 2,
      timeoutMs: config?.timeoutMs ?? 30000
    }
  }

  /**
   * 更新配置
   */
  updateConfig(maxConcurrent: number, config?: Partial<RequestQueueConfig>): void {
    this.maxConcurrent = maxConcurrent
    if (config?.enabled !== undefined) this.config.enabled = config.enabled
    if (config?.maxSize !== undefined) this.config.maxSize = config.maxSize
    if (config?.timeoutMs !== undefined) this.config.timeoutMs = config.timeoutMs
  }

  /**
   * 获取队列状态
   */
  getStatus(): { active: number; queued: number; maxConcurrent: number; enabled: boolean } {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      enabled: this.config.enabled
    }
  }

  /**
   * 请求进入：如果有空位直接执行，否则排队等待
   * 返回一个 release 函数，请求完成后必须调用
   * @param signal 可选的 AbortSignal，客户端断开时取消排队
   */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    // 有空位，直接获取（无论是否启用排队）
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++
      return () => this.release()
    }

    // 并发已满，未启用排队时直接拒绝（502）
    if (!this.config.enabled) {
      logger.warn('Concurrency limit reached, rejecting (queue disabled)', {
        active: this.activeCount,
        maxConcurrent: this.maxConcurrent
      })
      throw new Error('Too many concurrent requests (502 overloaded)')
    }

    // 队列已满，拒绝
    if (this.queue.length >= this.config.maxSize) {
      logger.warn('Request queue full, rejecting', {
        queueSize: this.queue.length,
        maxSize: this.config.maxSize,
        active: this.activeCount
      })
      throw new Error('Too many concurrent requests, queue full (502 overloaded)')
    }

    // 客户端已断开，不排队
    if (signal?.aborted) {
      throw new Error('Request aborted by client')
    }

    // 排队等待
    logger.info('Request queued', {
      queuePosition: this.queue.length + 1,
      active: this.activeCount,
      maxConcurrent: this.maxConcurrent
    })

    return new Promise<() => void>((resolve, reject) => {
      const entry: QueueEntry = {
        resolve: () => {
          this.activeCount++
          resolve(() => this.release())
        },
        reject,
        timer: setTimeout(() => {
          this.removeFromQueue(entry)
          reject(new Error(`Request queued timeout after ${this.config.timeoutMs}ms`))
        }, this.config.timeoutMs),
        signal,
        enqueuedAt: Date.now()
      }

      // 监听客户端断开
      if (signal) {
        entry.abortHandler = () => {
          this.removeFromQueue(entry)
          reject(new Error('Request aborted by client while queued'))
        }
        signal.addEventListener('abort', entry.abortHandler, { once: true })
      }

      this.queue.push(entry)
    })
  }

  /**
   * 释放一个并发位
   */
  private release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1)
    this.processQueue()
  }

  /**
   * 处理队列：取出下一个等待的请求
   */
  private processQueue(): void {
    while (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const entry = this.queue.shift()
      if (!entry) break

      // 清理定时器和事件监听
      clearTimeout(entry.timer)
      if (entry.signal && entry.abortHandler) {
        entry.signal.removeEventListener('abort', entry.abortHandler)
      }

      // 如果客户端已断开，跳过
      if (entry.signal?.aborted) {
        logger.debug('Skipping aborted queued request')
        continue
      }

      const waitTime = Date.now() - entry.enqueuedAt
      logger.info('Request dequeued', {
        waitTime,
        remaining: this.queue.length,
        active: this.activeCount + 1
      })

      entry.resolve()
    }
  }

  /**
   * 从队列中移除指定条目
   */
  private removeFromQueue(entry: QueueEntry): void {
    const index = this.queue.indexOf(entry)
    if (index !== -1) {
      this.queue.splice(index, 1)
    }
    clearTimeout(entry.timer)
    if (entry.signal && entry.abortHandler) {
      entry.signal.removeEventListener('abort', entry.abortHandler)
    }
  }

  /**
   * 清空队列（拒绝所有等待的请求）
   */
  clear(): void {
    for (const entry of this.queue) {
      clearTimeout(entry.timer)
      if (entry.signal && entry.abortHandler) {
        entry.signal.removeEventListener('abort', entry.abortHandler)
      }
      entry.reject(new Error('Queue cleared'))
    }
    this.queue = []
  }
}
