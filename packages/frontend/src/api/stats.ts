import { apiClient } from "./client"
import type { StatsOverview, AccountStats, ModelStats, ApiResponse } from "@kiro-gateway/shared"

/**
 * 费用数据类型
 */
export interface CostData {
  date: string
  cost: number
}

export interface ApiKeyCostData {
  apiKeyId: string
  name: string
  todayCost: number
  totalCost: number
}

export interface AccountCostData {
  accountId: string
  email: string
  todayCost: number
  totalCost: number
}

export interface ModelCostData {
  model: string
  cost: number
  percentage: number
}

export interface TopCostItem {
  id: string
  name: string
  cost: number
}

/**
 * 并发状态类型
 */
export interface ConcurrencyStatus {
  queue: { active: number; queued: number; maxConcurrent: number }
  accounts: Array<{ accountId: string; concurrency: number }>
}

/**
 * 获取并发状态（每账号实时连接数 + 队列状态）
 */
export async function getConcurrencyStatus(): Promise<ConcurrencyStatus> {
  const response = await apiClient.get<ApiResponse<ConcurrencyStatus>>("/stats/concurrency")
  return response.data.data!
}

/**
 * 获取统计概览数据
 */
export async function getStats(): Promise<StatsOverview> {
  const response = await apiClient.get<ApiResponse<StatsOverview>>("/stats")
  return response.data.data!
}

/**
 * 获取全局统计数据
 */
export async function getGlobalStats() {
  const response = await apiClient.get<ApiResponse<StatsOverview["global"]>>("/stats/global")
  return response.data.data!
}

/**
 * 获取所有账号统计
 */
export async function getAccountsStats(): Promise<Record<string, AccountStats>> {
  const response = await apiClient.get<ApiResponse<Record<string, AccountStats>>>("/stats/accounts")
  return response.data.data!
}

/**
 * 获取指定账号统计
 */
export async function getAccountStats(id: string): Promise<AccountStats> {
  const response = await apiClient.get<ApiResponse<AccountStats>>(`/stats/accounts/${id}`)
  return response.data.data!
}

/**
 * 获取模型统计
 */
export async function getModelStats(): Promise<ModelStats[]> {
  const response = await apiClient.get<ApiResponse<ModelStats[]>>("/stats/models")
  return response.data.data!
}

/**
 * 重置统计
 */
export async function resetStats(): Promise<void> {
  await apiClient.post("/stats/reset")
}

/**
 * 获取今日全局费用
 */
export async function getTodayGlobalCost(): Promise<number> {
  const response = await apiClient.get<ApiResponse<{ cost: number }>>("/stats/today/cost")
  return response.data.data?.cost ?? 0
}

/**
 * 获取全局日费用范围
 */
export async function getGlobalDailyCosts(startDate: string, endDate: string): Promise<CostData[]> {
  const response = await apiClient.get<ApiResponse<CostData[]>>("/stats/daily/global", {
    params: { startDate, endDate }
  })
  return response.data.data ?? []
}

/**
 * 获取所有 API Key 的今日费用
 */
export async function getAllApiKeysTodayCost(): Promise<ApiKeyCostData[]> {
  const response = await apiClient.get<ApiResponse<Array<{ id: string; name: string; cost: number; totalCost: number }>>>("/stats/today/apikeys")
  return (response.data.data ?? []).map(item => ({
    apiKeyId: item.id,
    name: item.name,
    todayCost: item.cost,
    totalCost: item.totalCost,
  }))
}

/**
 * 获取所有账号的今日费用
 */
export async function getAllAccountsTodayCost(): Promise<AccountCostData[]> {
  const response = await apiClient.get<ApiResponse<Array<{ id: string; name: string; cost: number }>>>("/stats/today/accounts")
  return (response.data.data ?? []).map(item => ({
    accountId: item.id,
    email: item.name,
    todayCost: item.cost,
    totalCost: 0
  }))
}

/**
 * 获取 API Key 日费用范围
 */
export async function getApiKeyDailyCosts(apiKeyId: string, startDate: string, endDate: string): Promise<CostData[]> {
  const response = await apiClient.get<ApiResponse<CostData[]>>(`/stats/daily/apikeys/${apiKeyId}`, {
    params: { startDate, endDate }
  })
  return response.data.data ?? []
}

/**
 * 获取账号日费用范围
 */
export async function getAccountDailyCosts(accountId: string, startDate: string, endDate: string): Promise<CostData[]> {
  const response = await apiClient.get<ApiResponse<CostData[]>>(`/stats/daily/accounts/${accountId}`, {
    params: { startDate, endDate }
  })
  return response.data.data ?? []
}

/**
 * 获取模型日费用范围
 */
export async function getModelDailyCosts(startDate: string, endDate: string): Promise<CostData[]> {
  const response = await apiClient.get<ApiResponse<CostData[]>>("/stats/daily/models", {
    params: { startDate, endDate }
  })
  return response.data.data ?? []
}

/**
 * 获取账号费用排行榜
 */
export async function getTopAccountsByCost(limit: number = 5, days: number = 7): Promise<TopCostItem[]> {
  const response = await apiClient.get<ApiResponse<Array<{ id: string; name: string; totalCost: number; avgDailyCost: number }>>>("/stats/top/accounts", {
    params: { limit, days }
  })
  return (response.data.data ?? []).map(item => ({
    id: item.id,
    name: item.name,
    cost: item.totalCost
  }))
}

/**
 * 获取 API Key 费用排行榜
 */
export async function getTopApiKeysByCost(limit: number = 5, days: number = 7): Promise<TopCostItem[]> {
  const response = await apiClient.get<ApiResponse<Array<{ id: string; name: string; totalCost: number; avgDailyCost: number }>>>("/stats/top/apikeys", {
    params: { limit, days }
  })
  return (response.data.data ?? []).map(item => ({
    id: item.id,
    name: item.name,
    cost: item.totalCost
  }))
}

/**
 * Session 统计类型
 */
export interface SessionStats {
  totalSessions: number
  sessions: Array<{
    hash: string
    accountId: string
    ttl: number
  }>
}

/**
 * 获取 Session 粘性统计
 */
export async function getSessionStats(): Promise<SessionStats> {
  const response = await apiClient.get<ApiResponse<SessionStats>>("/stats/sessions")
  return response.data.data ?? { totalSessions: 0, sessions: [] }
}
