import { NavLink } from "react-router-dom"
import {
  LayoutDashboard,
  Users,
  FileText,
  Settings,
  Zap
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * 侧边栏导航项配置
 */
const navItems = [
  {
    title: "仪表盘",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "账号管理",
    href: "/accounts",
    icon: Users,
  },
  {
    title: "日志查看",
    href: "/logs",
    icon: FileText,
  },
  {
    title: "系统配置",
    href: "/settings",
    icon: Settings,
  },
]

/**
 * Sidebar 组件 - 侧边栏导航
 */
export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r bg-background">
      {/* Logo 区域 */}
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <Zap className="h-6 w-6 text-primary" />
        <span className="text-lg font-semibold">Kiro Gateway</span>
      </div>

      {/* 导航菜单 */}
      <nav className="space-y-1 p-4">
        {navItems.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.title}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
