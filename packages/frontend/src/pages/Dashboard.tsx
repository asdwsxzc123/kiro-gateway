import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  CheckCircle,
  Users,
  Clock,
  DollarSign,
  TrendingUp,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { getStats, getTodayGlobalCost, getGlobalDailyCosts, getTopAccountsByCost, getTopApiKeysByCost } from "@/api/stats"
import { getAccounts } from "@/api/accounts"
import { getLogsSummary } from "@/api/logs"

/**
 * 格式化费用显示
 */
const formatCost = (cost: number): string => {
  return `$${cost.toFixed(4)}`
}

/**
 * 获取最近7天的日期范围
 */
const getLast7DaysDateRange = () => {
  const endDate = new Date()
  const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000)

  const formatDate = (date: Date) => date.toISOString().split('T')[0]

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  }
}

/**
 * Dashboard 页面 - 仪表盘
 * 显示统计概览、请求趋势图和账号状态
 */
export function Dashboard() {
  // 获取统计数据
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: getStats,
  })

  // 获取日志摘要（用于今日请求数和平均响应时间）
  const { data: logsSummary } = useQuery({
    queryKey: ["logsSummary"],
    queryFn: () => getLogsSummary(24),
  })

  // 获取账号列表
  const { data: accounts, isLoading: accountsLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
  })

  // 获取今日全局费用
  const { data: todayGlobalCost = 0 } = useQuery({
    queryKey: ["todayGlobalCost"],
    queryFn: getTodayGlobalCost,
    refetchInterval: 30 * 1000, // 30秒自动刷新
  })

  // 获取最近7天的费用趋势
  const dateRange = getLast7DaysDateRange()
  const { data: costTrendData = [] } = useQuery({
    queryKey: ["costTrend", dateRange.startDate, dateRange.endDate],
    queryFn: () => getGlobalDailyCosts(dateRange.startDate, dateRange.endDate),
    refetchInterval: 30 * 1000, // 30秒自动刷新
  })

  // 获取Top 5账号费用排行
  const { data: topAccounts = [] } = useQuery({
    queryKey: ["topAccountsByCost"],
    queryFn: () => getTopAccountsByCost(5, 7),
    refetchInterval: 30 * 1000, // 30秒自动刷新
  })

  // 获取Top 5 API Key费用排行
  const { data: topApiKeys = [] } = useQuery({
    queryKey: ["topApiKeysByCost"],
    queryFn: () => getTopApiKeysByCost(5, 7),
    refetchInterval: 30 * 1000, // 30秒自动刷新
  })

  // 计算成功率
  const successRate = stats?.global
    ? stats.global.totalRequests > 0
      ? ((stats.global.successRequests / stats.global.totalRequests) * 100).toFixed(1)
      : "0.0"
    : "0.0"

  // 统计卡片数据
  const statCards = [
    {
      title: "总请求数",
      value: stats?.global?.totalRequests ?? 0,
      icon: Activity,
      description: "累计 API 请求次数",
    },
    {
      title: "成功率",
      value: `${successRate}%`,
      icon: CheckCircle,
      description: "请求成功百分比",
    },
    {
      title: "活跃账号",
      value: `${stats?.accounts?.available ?? 0}/${stats?.accounts?.total ?? 0}`,
      icon: Users,
      description: "正常运行的账号数",
    },
    {
      title: "今日请求",
      value: logsSummary?.total ?? 0,
      icon: Clock,
      description: "最近 24 小时请求次数",
    },
    {
      title: "今日费用",
      value: formatCost(todayGlobalCost),
      icon: DollarSign,
      description: "今日全局费用总额",
    },
  ]

  // 模拟趋势数据（实际应从后端获取）
  const trendData = [
    { date: "周一", requests: stats?.global?.totalRequests ? Math.floor(stats.global.totalRequests * 0.1) : 0 },
    { date: "周二", requests: stats?.global?.totalRequests ? Math.floor(stats.global.totalRequests * 0.12) : 0 },
    { date: "周三", requests: stats?.global?.totalRequests ? Math.floor(stats.global.totalRequests * 0.15) : 0 },
    { date: "周四", requests: stats?.global?.totalRequests ? Math.floor(stats.global.totalRequests * 0.18) : 0 },
    { date: "周五", requests: stats?.global?.totalRequests ? Math.floor(stats.global.totalRequests * 0.2) : 0 },
    { date: "周六", requests: stats?.global?.totalRequests ? Math.floor(stats.global.totalRequests * 0.13) : 0 },
    { date: "周日", requests: stats?.global?.totalRequests ? Math.floor(stats.global.totalRequests * 0.12) : 0 },
  ]

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">仪表盘</h2>
        <p className="text-muted-foreground">
          查看 API 网关的运行状态和统计数据
        </p>
      </div>

      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {statCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {card.title}
              </CardTitle>
              <card.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {statsLoading ? "..." : card.value}
              </div>
              <p className="text-xs text-muted-foreground">
                {card.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 请求趋势图和费用趋势图 */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* 请求趋势图 */}
        <Card>
          <CardHeader>
            <CardTitle>请求趋势</CardTitle>
            <CardDescription>最近 7 天的请求统计</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {statsLoading ? (
                <div className="flex h-full items-center justify-center">
                  加载中...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="requests"
                      stroke="#8884d8"
                      name="请求数"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 费用趋势图 */}
        <Card>
          <CardHeader>
            <CardTitle>费用趋势</CardTitle>
            <CardDescription>最近 7 天的费用统计</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {costTrendData.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  加载中...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={costTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip formatter={(value) => formatCost(value as number)} />
                    <Line
                      type="monotone"
                      dataKey="cost"
                      stroke="#ef4444"
                      name="费用"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 费用排行榜 */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* 账号费用排行 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              账号费用排行 (7天)
            </CardTitle>
            <CardDescription>Top 5 账号费用排行榜</CardDescription>
          </CardHeader>
          <CardContent>
            {topAccounts.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                暂无数据
              </div>
            ) : (
              <div className="space-y-4">
                {topAccounts.map((item, index) => (
                  <div key={item.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.id.slice(0, 8)}...</p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-red-600">
                      {formatCost(item.cost)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* API Key 费用排行 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              API Key 费用排行 (7天)
            </CardTitle>
            <CardDescription>Top 5 API Key 费用排行榜</CardDescription>
          </CardHeader>
          <CardContent>
            {topApiKeys.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                暂无数据
              </div>
            ) : (
              <div className="space-y-4">
                {topApiKeys.map((item, index) => (
                  <div key={item.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.id.slice(0, 8)}...</p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-red-600">
                      {formatCost(item.cost)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 账号状态列表 */}
      <Card>
        <CardHeader>
          <CardTitle>账号状态</CardTitle>
          <CardDescription>所有账号的当前状态</CardDescription>
        </CardHeader>
        <CardContent>
          {accountsLoading ? (
            <div>加载中...</div>
          ) : accounts?.length === 0 ? (
            <div className="text-muted-foreground">暂无账号</div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {accounts?.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center gap-2 rounded-lg border p-3"
                >
                  <div
                    className={`h-2 w-2 rounded-full ${
                      account.isAvailable
                        ? "bg-green-500"
                        : "bg-red-500"
                    }`}
                  />
                  <span className="text-sm font-medium">
                    {account.email || account.id.slice(0, 8)}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {account.isAvailable ? "正常" : "不可用"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
