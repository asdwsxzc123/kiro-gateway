import { Outlet } from "react-router-dom"
import { Sidebar } from "./Sidebar"
import { Header } from "./Header"

/**
 * Layout 组件 - 主布局容器
 * 包含侧边栏、顶部导航和内容区域
 */
export function Layout() {
  return (
    <div className="min-h-screen bg-background">
      {/* 侧边栏 */}
      <Sidebar />

      {/* 主内容区域 */}
      <div className="ml-64">
        {/* 顶部导航 */}
        <Header />

        {/* 页面内容 */}
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
