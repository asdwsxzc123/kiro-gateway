import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, Filter, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Calendar, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getRequestLogs } from "@/api/logs"
import type { LogsQuery } from "@kiro-gateway/shared"

// 每页显示数量选项
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

// 常用模型列表
const MODEL_OPTIONS = [
  { value: "all", label: "全部模型" },
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { value: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
  { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
  { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
]

// 日期快捷选项
const DATE_PRESETS = [
  { value: "today", label: "今天" },
  { value: "yesterday", label: "昨天" },
  { value: "7days", label: "近7天" },
  { value: "30days", label: "近30天" },
  { value: "custom", label: "自定义" },
]

/**
 * 根据日期预设计算时间范围
 */
function getDateRange(preset: string): { startTime?: number; endTime?: number } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (preset) {
    case "today":
      return { startTime: today.getTime(), endTime: now.getTime() }
    case "yesterday": {
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      return { startTime: yesterday.getTime(), endTime: today.getTime() }
    }
    case "7days": {
      const sevenDaysAgo = new Date(today)
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
      return { startTime: sevenDaysAgo.getTime(), endTime: now.getTime() }
    }
    case "30days": {
      const thirtyDaysAgo = new Date(today)
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      return { startTime: thirtyDaysAgo.getTime(), endTime: now.getTime() }
    }
    default:
      return {}
  }
}

/**
 * Logs 页面 - 请求日志与 Token 使用明细
 */
export function Logs() {
  // 分页状态
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [statusFilter, setStatusFilter] = useState<string>("all")

  // 模型筛选
  const [modelFilter, setModelFilter] = useState<string>("all")

  // 日期筛选
  const [datePreset, setDatePreset] = useState<string>("all")
  const [customStartDate, setCustomStartDate] = useState<string>("")
  const [customEndDate, setCustomEndDate] = useState<string>("")

  // 计算时间范围
  const dateRange = useMemo(() => {
    if (datePreset === "all") {
      return {}
    }
    if (datePreset === "custom") {
      return {
        startTime: customStartDate ? new Date(customStartDate).getTime() : undefined,
        endTime: customEndDate ? new Date(customEndDate + "T23:59:59").getTime() : undefined,
      }
    }
    return getDateRange(datePreset)
  }, [datePreset, customStartDate, customEndDate])

  // 构建查询参数
  const query: LogsQuery = useMemo(() => ({
    limit: pageSize,
    offset: (currentPage - 1) * pageSize,
    model: modelFilter !== "all" ? modelFilter : undefined,
    ...dateRange,
  }), [pageSize, currentPage, modelFilter, dateRange])

  const { data: logsResponse, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["logs", query],
    queryFn: () => getRequestLogs(query),
  })

  // 从响应中获取数据
  const logs = logsResponse?.data ?? []
  const total = logsResponse?.total ?? 0
  const totalPages = Math.ceil(total / pageSize) || 1

  // 前端过滤（状态筛选）
  const filteredLogs = logs.filter((log) => {
    if (statusFilter === "all") return true
    if (statusFilter === "success") return log.success
    if (statusFilter === "error") return !log.success
    return true
  })

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("zh-CN")
  }

  const getProvider = (model: string) => {
    if (model.startsWith("claude")) return "claude"
    if (model.startsWith("gpt")) return "openai"
    return "unknown"
  }

  const formatCost = (cost?: number) => {
    if (cost === undefined || cost === null) return "$0"
    if (cost === 0) return "$0"
    return `$${cost.toFixed(6)}`
  }

  // 分页处理函数
  const goToPage = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    }
  }

  const handlePageSizeChange = (value: string) => {
    const newSize = parseInt(value, 10)
    setPageSize(newSize)
    setCurrentPage(1)
  }

  // 筛选变更时重置页码
  const handleModelChange = (value: string) => {
    setModelFilter(value)
    setCurrentPage(1)
  }

  const handleDatePresetChange = (value: string) => {
    setDatePreset(value)
    setCurrentPage(1)
    if (value !== "custom") {
      setCustomStartDate("")
      setCustomEndDate("")
    }
  }

  // 清除所有筛选
  const clearFilters = () => {
    setStatusFilter("all")
    setModelFilter("all")
    setDatePreset("all")
    setCustomStartDate("")
    setCustomEndDate("")
    setCurrentPage(1)
  }

  // 是否有活跃的筛选条件
  const hasActiveFilters = statusFilter !== "all" || modelFilter !== "all" || datePreset !== "all"

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">请求日志</h2>
        <p className="text-muted-foreground">
          查看 API 请求日志与 Token 使用明细
        </p>
      </div>

      {/* 筛选区域 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            筛选条件
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            {/* 状态筛选 */}
            <div className="w-32">
              <label className="text-sm text-muted-foreground mb-1 block">状态</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="success">成功</SelectItem>
                  <SelectItem value="error">失败</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 模型筛选 */}
            <div className="w-48">
              <label className="text-sm text-muted-foreground mb-1 block">模型</label>
              <Select value={modelFilter} onValueChange={handleModelChange}>
                <SelectTrigger>
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 日期筛选 */}
            <div className="w-32">
              <label className="text-sm text-muted-foreground mb-1 block">日期</label>
              <Select value={datePreset} onValueChange={handleDatePresetChange}>
                <SelectTrigger>
                  <Calendar className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="选择日期" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部时间</SelectItem>
                  {DATE_PRESETS.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 自定义日期范围 */}
            {datePreset === "custom" && (
              <>
                <div className="w-40">
                  <label className="text-sm text-muted-foreground mb-1 block">开始日期</label>
                  <Input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => {
                      setCustomStartDate(e.target.value)
                      setCurrentPage(1)
                    }}
                  />
                </div>
                <div className="w-40">
                  <label className="text-sm text-muted-foreground mb-1 block">结束日期</label>
                  <Input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => {
                      setCustomEndDate(e.target.value)
                      setCurrentPage(1)
                    }}
                  />
                </div>
              </>
            )}

            {/* 每页数量 */}
            <div className="w-28">
              <label className="text-sm text-muted-foreground mb-1 block">每页</label>
              <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="每页数量" />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size} 条
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                {isFetching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                {isFetching ? "刷新中..." : "刷新"}
              </Button>

              {hasActiveFilters && (
                <Button variant="ghost" onClick={clearFilters}>
                  <X className="mr-2 h-4 w-4" />
                  清除筛选
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 日志列表 */}
      <Card>
        <CardHeader>
          <CardTitle>日志列表</CardTitle>
          <CardDescription>
            共 {total} 条记录，当前显示第 {total > 0 ? (currentPage - 1) * pageSize + 1 : 0}-{Math.min(currentPage * pageSize, total)} 条
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center">加载中...</div>
          ) : filteredLogs?.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              暂无日志记录
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>服务商</TableHead>
                    <TableHead>模型</TableHead>
                    <TableHead>接口</TableHead>
                    <TableHead className="text-right">输入Tokens</TableHead>
                    <TableHead className="text-right">输出Tokens</TableHead>
                    <TableHead className="text-right">缓存读</TableHead>
                    <TableHead className="text-right">缓存建</TableHead>
                    <TableHead className="text-right">费用($)</TableHead>
                    <TableHead>消费类型</TableHead>
                    <TableHead className="text-right">耗时</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs?.map((log) => (
                    <TableRow key={log.id || log.timestamp}>
                      <TableCell className="whitespace-nowrap">{formatDate(log.timestamp)}</TableCell>
                      <TableCell>{getProvider(log.model)}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={log.model}>{log.model}</TableCell>
                      <TableCell className="font-mono text-xs">{log.path}</TableCell>
                      <TableCell className="text-right">{log.inputTokens.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{log.outputTokens.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{(log.cacheReadTokens ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{(log.cacheCreationTokens ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatCost(log.cost)}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            log.success
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {log.success ? "正常" : "失败"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{log.responseTime}ms</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* 分页控件 */}
          {total > 0 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                第 {currentPage} 页，共 {totalPages} 页
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => goToPage(1)}
                  disabled={currentPage === 1 || isFetching}
                  title="首页"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1 || isFetching}
                  title="上一页"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={1}
                    max={totalPages}
                    value={currentPage}
                    onChange={(e) => {
                      const page = parseInt(e.target.value, 10)
                      if (!isNaN(page)) {
                        goToPage(page)
                      }
                    }}
                    className="w-16 text-center"
                  />
                  <span className="text-sm text-muted-foreground">/ {totalPages}</span>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages || isFetching}
                  title="下一页"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => goToPage(totalPages)}
                  disabled={currentPage === totalPages || isFetching}
                  title="末页"
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
