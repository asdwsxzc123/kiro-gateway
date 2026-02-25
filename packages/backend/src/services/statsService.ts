/**
 * 统计服务
 * 提供统计数据的查询和管理
 */

import * as statsStore from '../storage/statsStore.js'
import type { GlobalStats } from '../storage/statsStore.js'
import * as accountStore from '../storage/accountStore.js'
import * as dailyStatsStore from '../storage/dailyStatsStore.js'
import type { DailyStats, DailyAccountStats, DailyModelStats } from '../storage/dailyStatsStore.js'
import * as apiKeyStore from '../storage/apiKeyStore.js'
import * as configStore from '../storage/configStore.js'
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

/**
 * 获取今日全局费用
 */
export async function getTodayGlobalCost(): Promise<number> {
  const today = new Date()
  const stats = await dailyStatsStore.getDailyGlobalStats(today)
  return stats.totalCost
}

/**
 * 获取全局日费用范围
 */
export async function getGlobalDailyCosts(
  startDate: string | Date | number,
  endDate: string | Date | number
): Promise<DailyStats[]> {
  return dailyStatsStore.getDailyGlobalStatsRange(startDate, endDate)
}

/**
 * 获取账号日费用范围
 */
export async function getAccountDailyCosts(
  accountId: string,
  startDate: string | Date | number,
  endDate: string | Date | number
): Promise<DailyAccountStats[]> {
  return dailyStatsStore.getDailyAccountStatsRange(accountId, startDate, endDate)
}

/**
 * 获取 API Key 日费用范围
 */
export async function getApiKeyDailyCosts(
  apiKeyId: string,
  startDate: string | Date | number,
  endDate: string | Date | number
): Promise<Array<{ date: string; cost: number }>> {
  const result: Array<{ date: string; cost: number }> = []

  // 生成日期范围内的所有日期
  const dates: string[] = []
  const current = new Date(typeof startDate === 'string' ? startDate : startDate)
  const end = new Date(typeof endDate === 'string' ? endDate : endDate)

  while (current <= end) {
    const year = current.getFullYear()
    const month = String(current.getMonth() + 1).padStart(2, '0')
    const day = String(current.getDate()).padStart(2, '0')
    dates.push(`${year}-${month}-${day}`)
    current.setDate(current.getDate() + 1)
  }

  // 批量获取统计数据
  for (const date of dates) {
    const stats = await apiKeyStore.getDailyApiKeyStats(apiKeyId, new Date(date))
    result.push({ date, cost: stats.cost })
  }

  return result
}

/**
 * 获取模型日费用范围
 */
export async function getModelDailyCosts(
  startDate: string | Date | number,
  endDate: string | Date | number
): Promise<DailyModelStats[]> {
  return dailyStatsStore.getAllDailyModelStatsRange(startDate, endDate)
}

/**
 * 获取所有 API Key 的今日费用
 */
export async function getAllApiKeysTodayCost(): Promise<
  Array<{
    id: string
    name: string
    cost: number
    totalCost: number
  }>
> {
  const apiKeys = await configStore.getAllApiKeys()
  const today = new Date()
  const result: Array<{ id: string; name: string; cost: number; totalCost: number }> = []

  for (const apiKey of apiKeys) {
    const [dailyStats, totalStats] = await Promise.all([
      apiKeyStore.getDailyApiKeyStats(apiKey.id, today),
      apiKeyStore.getApiKeyTotalStats(apiKey.id),
    ])
    result.push({
      id: apiKey.id,
      name: apiKey.name,
      cost: dailyStats.cost,
      totalCost: totalStats.cost,
    })
  }

  return result.filter((item) => item.cost > 0 || item.totalCost > 0)
}

/**
 * 获取所有账号的今日费用
 */
export async function getAllAccountsTodayCost(): Promise<
  Array<{
    id: string
    name: string
    cost: number
  }>
> {
  const accounts = await accountStore.getAllAccounts()
  const today = new Date()
  const result: Array<{ id: string; name: string; cost: number }> = []

  for (const account of accounts) {
    const stats = await dailyStatsStore.getDailyAccountStats(account.id, today)
    result.push({
      id: account.id,
      name: account.email || account.id,
      cost: stats.totalCost
    })
  }

  return result.filter((item) => item.cost > 0)
}

/**
 * 获取费用排行榜（账号）
 */
export async function getTopAccountsByCost(
  limit: number = 10,
  days: number = 7
): Promise<
  Array<{
    id: string
    name: string
    totalCost: number
    avgDailyCost: number
  }>
> {
  const accounts = await accountStore.getAllAccounts()
  const result: Array<{
    id: string
    name: string
    totalCost: number
    avgDailyCost: number
  }> = []

  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days + 1)

  for (const account of accounts) {
    const dailyStats = await dailyStatsStore.getDailyAccountStatsRange(
      account.id,
      startDate,
      endDate
    )
    const totalCost = dailyStats.reduce((sum, stat) => sum + stat.totalCost, 0)

    if (totalCost > 0) {
      result.push({
        id: account.id,
        name: account.email || account.id,
        totalCost,
        avgDailyCost: totalCost / days
      })
    }
  }

  // 按总费用降序排序
  result.sort((a, b) => b.totalCost - a.totalCost)

  return result.slice(0, limit)
}

/**
 * 获取费用排行榜（API Key）
 */
export async function getTopApiKeysByCost(
  limit: number = 10,
  days: number = 7
): Promise<
  Array<{
    id: string
    name: string
    totalCost: number
    avgDailyCost: number
  }>
> {
  const apiKeys = await apiKeyStore.getAllApiKeyMeta()
  const result: Array<{
    id: string
    name: string
    totalCost: number
    avgDailyCost: number
  }> = []

  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days + 1)

  for (const apiKey of apiKeys) {
    let totalCost = 0

    // 生成日期范围内的所有日期
    const dates: string[] = []
    const current = new Date(startDate)

    while (current <= endDate) {
      const year = current.getFullYear()
      const month = String(current.getMonth() + 1).padStart(2, '0')
      const day = String(current.getDate()).padStart(2, '0')
      dates.push(`${year}-${month}-${day}`)
      current.setDate(current.getDate() + 1)
    }

    // 累计费用
    for (const date of dates) {
      const stats = await apiKeyStore.getDailyApiKeyStats(apiKey.id, new Date(date))
      totalCost += stats.cost
    }

    if (totalCost > 0) {
      result.push({
        id: apiKey.id,
        name: apiKey.name,
        totalCost,
        avgDailyCost: totalCost / days
      })
    }
  }

  // 按总费用降序排序
  result.sort((a, b) => b.totalCost - a.totalCost)

  return result.slice(0, limit)
}
