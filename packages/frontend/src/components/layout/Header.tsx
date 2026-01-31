import { Bell, User } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Header 组件 - 顶部导航栏
 */
export function Header() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background px-6">
      {/* 左侧标题区域 */}
      <div>
        <h1 className="text-lg font-semibold">管理控制台</h1>
      </div>

      {/* 右侧操作区域 */}
      <div className="flex items-center gap-4">
        {/* 通知按钮 */}
        <Button variant="ghost" size="icon">
          <Bell className="h-5 w-5" />
        </Button>

        {/* 用户头像 */}
        <Button variant="ghost" size="icon">
          <User className="h-5 w-5" />
        </Button>
      </div>
    </header>
  )
}
