import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react"
import { authApi } from "@/api/auth"

interface User {
  username: string
}

interface AuthContextType {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const TOKEN_KEY = "jwt_token"

interface AuthProviderProps {
  children: ReactNode
}

/**
 * AuthProvider 组件 - 认证状态管理
 * 管理用户登录状态、token 存储和验证
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY)
  )
  const [isLoading, setIsLoading] = useState(true)

  const isAuthenticated = !!user && !!token

  // 登出
  const logout = useCallback(async () => {
    try {
      // 调用后端 API 删除 Redis 中的 token
      await authApi.logout()
    } catch (error) {
      // 即使后端调用失败，也要清除前端状态
      console.error('Logout API failed:', error)
    } finally {
      localStorage.removeItem(TOKEN_KEY)
      setToken(null)
      setUser(null)
    }
  }, [])

  // 验证 token 有效性
  const validateToken = useCallback(async () => {
    const storedToken = localStorage.getItem(TOKEN_KEY)
    if (!storedToken) {
      setIsLoading(false)
      return
    }

    try {
      const response = await authApi.me()
      setUser(response.data.data.user)
      setToken(storedToken)
    } catch {
      // Token 无效，清除存储
      logout()
    } finally {
      setIsLoading(false)
    }
  }, [logout])

  // 初始化时验证 token
  useEffect(() => {
    validateToken()
  }, [validateToken])

  // 登录
  const login = useCallback(async (username: string, password: string) => {
    const response = await authApi.login(username, password)
    const { token: newToken, user: newUser } = response.data.data

    localStorage.setItem(TOKEN_KEY, newToken)
    setToken(newToken)
    setUser(newUser)
  }, [])

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated,
    isLoading,
    login,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * useAuth hook - 获取认证上下文
 */
export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
