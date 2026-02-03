/**
 * 统计服务
 * 提供统计数据的查询和管理
 */

import * as statsStore from '../storage/statsStore.js'
import type { GlobalStats } from '../storage/statsStore.js'
import * as accountStore from '../storage/accountStore.js'
import { createLogger } from '../utils/logger.js'
import type { AccountStats, ModelStats } from '../core/types.js'

const logger = createLogger('StatsService')

export interface StatsOverview {
  global: GlobalStats
  accounts: {
    total: number
    available: number
  }
  cache: {
    cacheCreationTokens: number
    cacheReadTokens: number
    cacheHitRate: number
  }
  uptime: number
}

/**
 * 获取统计概览
 */
export async function getStatsOverview(): Promise<StatsOverview> {
  const global = await statsStore.getGlobalStats()
  const totalAccounts = await accountStore.getAccountCount()
  const availableAccounts = (await accountStore.getAvailableAccounts()).length

  return {
    global,
    accounts: {
      total: totalAccounts,
      available: availableAccounts
    },
    cache: {
      cacheCreationTokens: global.cacheCreationTokens,
      cacheReadTokens: global.cacheReadTokens,
      cacheHitRate: global.inputTokens > 0 ? global.cacheReadTokens / global.inputTokens : 0
    },
    uptime: Date.now() - global.startTime
  }
}

/**
 * 获取全局统计
 */
export async function getGlobalStats(): Promise<GlobalStats> {
  return statsStore.getGlobalStats()
}

/**
 * 获取账号统计
 */
export async function getAccountStats(accountId: string): Promise<AccountStats> {
  return statsStore.getAccountStats(accountId)
}

/**
 * 获取所有账号统计
 */
export async function getAllAccountStats(): Promise<Record<string, AccountStats>> {
  return statsStore.getAllAccountStats()
}

/**
 * 获取模型统计
 */
export async function getModelStats(modelId: string): Promise<ModelStats> {
  return statsStore.getModelStats(modelId)
}

/**
 * 获取所有模型统计
 */
export async function getAllModelStats(): Promise<ModelStats[]> {
  return statsStore.getAllModelStats()
}

/**
 * 重置所有统计
 */
export async function resetAllStats(): Promise<void> {
  await statsStore.resetAllStats()
  logger.info('All stats reset')
}

/**
 * 获取详细统计报告
 */
export async function getDetailedReport(): Promise<{
  overview: StatsOverview
  accountStats: Record<string, AccountStats>
  modelStats: ModelStats[]
}> {
  const [overview, accountStats, modelStats] = await Promise.all([
    getStatsOverview(),
    getAllAccountStats(),
    getAllModelStats()
  ])

  return { overview, accountStats, modelStats }
}

/**
 * 获取缓存统计
 */
export async function getCacheStats(): Promise<{
  cacheCreationTokens: number
  cacheReadTokens: number
  cacheHitRate: number
}> {
  const global = await statsStore.getGlobalStats()
  return {
    cacheCreationTokens: global.cacheCreationTokens,
    cacheReadTokens: global.cacheReadTokens,
    cacheHitRate: global.inputTokens > 0 ? global.cacheReadTokens / global.inputTokens : 0
  }
}
