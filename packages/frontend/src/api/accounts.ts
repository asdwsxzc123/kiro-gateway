import { apiClient } from "./client"
import type {
  Account,
  AddAccountRequest,
  ApiResponse,
  AccountUsage,
  UsageLimitsResponse,
} from "@kiro-gateway/shared"

/**
 * 获取所有账号列表
 */
export async function getAccounts(): Promise<Account[]> {
  const response = await apiClient.get<ApiResponse<Account[]>>("/accounts")
  return response.data.data!
}

/**
 * 获取账号详情
 */
export async function getAccount(id: string): Promise<Account> {
  const response = await apiClient.get<ApiResponse<Account>>(`/accounts/${id}`)
  return response.data.data!
}

/**
 * 添加新账号
 */
export async function addAccount(data: AddAccountRequest): Promise<Account> {
  const response = await apiClient.post<ApiResponse<Account>>("/accounts", data)
  return response.data.data!
}

/**
 * 更新账号
 */
export async function updateAccount(id: string, data: Partial<AddAccountRequest>): Promise<Account> {
  const response = await apiClient.put<ApiResponse<Account>>(`/accounts/${id}`, data)
  return response.data.data!
}

/**
 * 删除账号
 */
export async function deleteAccount(id: string): Promise<void> {
  await apiClient.delete(`/accounts/${id}`)
}

/**
 * 刷新账号 Token
 */
export async function refreshAccountToken(id: string): Promise<Account> {
  const response = await apiClient.post<ApiResponse<Account>>(`/accounts/${id}/refresh`)
  return response.data.data!
}

/**
 * 测试账号连通性
 * 通过实际发送消息来测试账号是否可用
 */
export async function testAccount(id: string): Promise<{ response: string; model: string }> {
  const response = await apiClient.post<ApiResponse<{ response: string; model: string }>>(`/accounts/${id}/test`)
  return response.data.data!
}

/**
 * 重新生成账号机器码
 */
export async function regenerateMachineId(id: string): Promise<Account> {
  const response = await apiClient.post<ApiResponse<Account>>(`/accounts/${id}/regenerate-machine-id`)
  return response.data.data!
}

/**
 * 获取单个账号使用量
 */
export async function getAccountUsage(id: string): Promise<UsageLimitsResponse> {
  const response = await apiClient.get<ApiResponse<UsageLimitsResponse>>(`/accounts/${id}/usage`)
  return response.data.data!
}

/**
 * 暂停账号调度
 */
export async function pauseAccount(id: string): Promise<{ id: string; status: string }> {
  const response = await apiClient.post<ApiResponse<{ id: string; status: string }>>(`/accounts/${id}/pause`)
  return response.data.data!
}

/**
 * 恢复账号调度
 */
export async function resumeAccount(id: string): Promise<{ id: string; status: string }> {
  const response = await apiClient.post<ApiResponse<{ id: string; status: string }>>(`/accounts/${id}/resume`)
  return response.data.data!
}

/**
 * 批量导入账号（支持直接传入导出格式的 JSON 数组）
 */
export async function batchImportAccounts(
  accounts: Record<string, unknown>[]
): Promise<{ success: number; failed: number; errors: string[] }> {
  const response = await apiClient.post<
    ApiResponse<{ success: number; failed: number; errors: string[] }>
  >("/accounts/batch/import", accounts)
  return response.data.data!
}

/**
 * 批量删除账号
 * accountIds 为空时删除全部
 */
export async function batchDeleteAccounts(
  accountIds?: string[]
): Promise<{ deleted: number; total: number }> {
  const response = await apiClient.post<
    ApiResponse<{ deleted: number; total: number }>
  >("/accounts/batch/delete", { accountIds })
  return response.data.data!
}

/**
 * 批量更新账号并发数
 * accountIds 为空时更新全部
 */
export async function batchUpdateConcurrency(
  maxConcurrency: number,
  accountIds?: string[]
): Promise<{ updated: number; maxConcurrency: number }> {
  const response = await apiClient.post<
    ApiResponse<{ updated: number; maxConcurrency: number }>
  >("/accounts/batch/update-concurrency", { maxConcurrency, accountIds })
  return response.data.data!
}

/**
 * 批量获取所有账号使用量
 */
export async function getAllAccountsUsage(): Promise<AccountUsage[]> {
  const response = await apiClient.get<ApiResponse<AccountUsage[]>>("/accounts/usage/all")
  return response.data.data!
}
