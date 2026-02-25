import { apiClient } from "./client"
import type { GatewayConfig, UpdateConfigRequest, ApiKeyRecord, CreateApiKeyRequest, ApiResponse, WebhookConfig, WebhookDeliveryResult } from "@kiro-gateway/shared"

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
 * @param data { name: string, boundAccountIds?: string[] }
 */
export async function createApiKey(data: CreateApiKeyRequest & { boundAccountIds?: string[] }): Promise<ApiKeyRecord> {
  const response = await apiClient.post<ApiResponse<ApiKeyRecord>>("/admin/apikeys", data)
  return response.data.data!
}

/**
 * 更新 API Key（名称、绑定账号）
 */
export async function updateApiKey(id: string, data: { name?: string; boundAccountIds?: string[]; quotaLimit?: number }): Promise<ApiKeyRecord> {
  const response = await apiClient.put<ApiResponse<ApiKeyRecord>>(`/admin/apikeys/${id}`, data)
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

/**
 * 测试 Webhook
 */
export async function testWebhook(): Promise<WebhookDeliveryResult[]> {
  const response = await apiClient.post<ApiResponse<WebhookDeliveryResult[]>>("/admin/webhook/test")
  return response.data.data!
}

/**
 * 获取 Webhook 配置
 */
export async function getWebhookConfig(): Promise<WebhookConfig> {
  const response = await apiClient.get<ApiResponse<WebhookConfig>>("/admin/webhook/config")
  return response.data.data!
}

/**
 * 更新 Webhook 配置
 */
export async function updateWebhookConfig(data: WebhookConfig): Promise<WebhookConfig> {
  const response = await apiClient.put<ApiResponse<WebhookConfig>>("/admin/webhook/config", data)
  return response.data.data!
}
