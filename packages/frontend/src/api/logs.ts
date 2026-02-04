import { apiClient } from "./client"
import type { RequestLog, SystemLog, LogsQuery, LogsSummary, ApiResponse, PaginatedLogsResponse } from "@kiro-gateway/shared"

/**
 * 获取请求日志（支持分页）
 * @param query 查询参数
 * @returns 分页日志响应
 */
export async function getRequestLogs(query: LogsQuery = {}): Promise<PaginatedLogsResponse<RequestLog>> {
  const response = await apiClient.get<ApiResponse<PaginatedLogsResponse<RequestLog>>>("/logs/requests", {
    params: query,
  })
  return response.data.data!
}

/**
 * 获取系统日志
 */
export async function getSystemLogs(params: {
  limit?: number;
  level?: 'debug' | 'info' | 'warn' | 'error';
  category?: string;
} = {}): Promise<SystemLog[]> {
  const response = await apiClient.get<ApiResponse<SystemLog[]>>("/logs/system", {
    params,
  })
  return response.data.data!
}

/**
 * 获取日志统计
 */
export async function getLogsStats(): Promise<{ requestLogs: number; systemLogs: number }> {
  const response = await apiClient.get<ApiResponse<{ requestLogs: number; systemLogs: number }>>("/logs/stats")
  return response.data.data!
}

/**
 * 获取最近错误
 */
export async function getRecentErrors(limit: number = 50): Promise<SystemLog[]> {
  const response = await apiClient.get<ApiResponse<SystemLog[]>>("/logs/errors", {
    params: { limit },
  })
  return response.data.data!
}

/**
 * 获取请求日志摘要
 */
export async function getLogsSummary(hours: number = 24): Promise<LogsSummary> {
  const response = await apiClient.get<ApiResponse<LogsSummary>>("/logs/summary", {
    params: { hours },
  })
  return response.data.data!
}

/**
 * 清空请求日志
 */
export async function clearRequestLogs(): Promise<void> {
  await apiClient.delete("/logs/requests")
}

/**
 * 清空系统日志
 */
export async function clearSystemLogs(): Promise<void> {
  await apiClient.delete("/logs/system")
}
