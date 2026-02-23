import { apiClient } from "./client"
import type { RequestLog, SystemLog, LogsQuery, LogsSummary, ApiResponse, PaginatedLogsResponse, LogFile } from "@kiro-gateway/shared"

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

/**
 * 获取日志文件列表
 */
export async function getLogFiles(): Promise<LogFile[]> {
  const response = await apiClient.get<ApiResponse<LogFile[]>>("/logs/files")
  return response.data.data!
}

/**
 * 下载日志文件
 */
export function downloadLogFile(type: string, filename: string): void {
  const baseUrl = apiClient.defaults.baseURL || ''
  const token = localStorage.getItem('jwt_token')
  const url = `${baseUrl}/logs/files/download?type=${encodeURIComponent(type)}&filename=${encodeURIComponent(filename)}`

  fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
    .then(res => {
      if (!res.ok) {
        throw new Error(`下载失败: ${res.status} ${res.statusText}`)
      }
      return res.blob()
    })
    .then(blob => {
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(blobUrl)
    })
    .catch(err => {
      console.error('Download failed:', err)
      alert(err instanceof Error ? err.message : '下载失败')
    })
}
