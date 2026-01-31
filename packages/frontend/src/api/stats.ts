import { apiClient } from "./client"
import type { StatsOverview, AccountStats, ModelStats, ApiResponse } from "@kiro-gateway/shared"

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
