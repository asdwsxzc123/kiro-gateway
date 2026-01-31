import axios from "axios"
import { toast } from "@/hooks/use-toast"

/**
 * API 客户端实例
 * 配置基础 URL 和默认请求头
 */
export const apiClient = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30000,
})

// 请求拦截器 - 添加认证 token
apiClient.interceptors.request.use(
  (config) => {
    const apiKey = localStorage.getItem("apiKey")
    if (apiKey) {
      config.headers.Authorization = `Bearer ${apiKey}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器 - 统一错误处理
apiClient.interceptors.response.use(
  (response) => {
    // 检查业务逻辑错误 (HTTP 200 但 success: false)
    if (response.data && response.data.success === false) {
      const errorMessage = response.data.error?.message || response.data.message || "请求失败"
      toast({
        variant: "destructive",
        title: "错误",
        description: errorMessage,
      })
      return Promise.reject(new Error(errorMessage))
    }
    return response
  },
  (error) => {
    // HTTP 错误处理
    const message = error.response?.data?.error?.message || error.response?.data?.message || error.message || "请求失败"
    toast({
      variant: "destructive",
      title: "请求错误",
      description: message,
    })
    console.error("API Error:", message)
    return Promise.reject(error)
  }
)
