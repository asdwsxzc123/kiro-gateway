import { apiClient } from "./client"
import type { GatewayConfig, UpdateConfigRequest, ApiKeyRecord, CreateApiKeyRequest, ApiResponse } from "@kiro-gateway/shared"

/**
 * 获取系统配置
 */
export async function getConfig(): Promise<GatewayConfig> {
  const response = await apiClient.get<ApiResponse<GatewayConfig>>("/admin/config")
  return response.data.data!
}

/**
 * 更新系统配置
 */
export async function updateConfig(data: UpdateConfigRequest): Promise<GatewayConfig> {
  const response = await apiClient.put<ApiResponse<GatewayConfig>>("/admin/config", data)
  return response.data.data!
}

/**
 * 获取所有 API Key
 */
export async function getApiKeys(): Promise<ApiKeyRecord[]> {
  const response = await apiClient.get<ApiResponse<ApiKeyRecord[]>>("/admin/apikeys")
  return response.data.data!
}

/**
 * 创建 API Key
 */
export async function createApiKey(data: CreateApiKeyRequest): Promise<ApiKeyRecord> {
  const response = await apiClient.post<ApiResponse<ApiKeyRecord>>("/admin/apikeys", data)
  return response.data.data!
}

/**
 * 删除 API Key
 */
export async function deleteApiKey(id: string): Promise<void> {
  await apiClient.delete(`/admin/apikeys/${id}`)
}

/**
 * 获取选中的账号
 */
export async function getSelectedAccounts(): Promise<string[]> {
  const response = await apiClient.get<ApiResponse<string[]>>("/admin/selected-accounts")
  return response.data.data!
}

/**
 * 设置选中的账号
 */
export async function setSelectedAccounts(accountIds: string[]): Promise<void> {
  await apiClient.put("/admin/selected-accounts", { accountIds })
}

/**
 * 健康检查
 */
export async function healthCheck(): Promise<{ status: string; redis: string; timestamp: number }> {
  const response = await apiClient.get<ApiResponse<{ status: string; redis: string; timestamp: number }>>("/admin/health")
  return response.data.data!
}
