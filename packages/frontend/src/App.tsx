import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthProvider } from "@/contexts/AuthContext"
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { Layout } from "@/components/layout/Layout"
import { Toaster } from "@/components/ui/toaster"
import { Dashboard } from "@/pages/Dashboard"
import { Accounts } from "@/pages/Accounts"
import { Logs } from "@/pages/Logs"
import { Settings } from "@/pages/Settings"
import { Login } from "@/pages/Login"

// 创建 QueryClient 实例
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 分钟
      retry: 1,
    },
  },
})

/**
 * App 组件 - 应用入口
 */
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* 登录页面 - 不需要认证 */}
            <Route path="/login" element={<Login />} />

            {/* 受保护的主布局路由 */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              {/* 默认重定向到仪表盘 */}
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="accounts" element={<Accounts />} />
              <Route path="logs" element={<Logs />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  )
}

export default App
