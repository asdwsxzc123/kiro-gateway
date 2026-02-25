import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, Filter, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Calendar, X, Download, FileText, Activity } from "lucide-react"
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
import { getRequestLogs, getSystemLogs, getLogFiles, downloadLogFile } from "@/api/logs"
import type { LogsQuery } from "@kiro-gateway/shared"

// 系统日志分类选项
const SYSTEM_LOG_CATEGORIES = [
  { value: "all", label: "全部分类" },
  { value: "account_status", label: "账号状态变更" },
]

// 系统日志级别选项
const SYSTEM_LOG_LEVELS = [
  { value: "all", label: "全部级别" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warn" },
  { value: "error", label: "Error" },
]

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

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
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

  // Tab 状态
  const [activeTab, setActiveTab] = useState<'requests' | 'system' | 'files'>('requests')
  const [fileTypeFilter, setFileTypeFilter] = useState<string>('all')

  // 系统日志筛选
  const [sysLogCategory, setSysLogCategory] = useState<string>("all")
  const [sysLogLevel, setSysLogLevel] = useState<string>("all")
  const [sysLogLimit, setSysLogLimit] = useState(100)

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

  // 系统日志查询
  const sysLogParams = useMemo(() => ({
    limit: sysLogLimit,
    level: sysLogLevel !== 'all' ? sysLogLevel as 'info' | 'warn' | 'error' : undefined,
    category: sysLogCategory !== 'all' ? sysLogCategory : undefined,
  }), [sysLogLimit, sysLogLevel, sysLogCategory])

  const { data: systemLogs = [], isLoading: isSysLoading, isFetching: isSysFetching, refetch: refetchSysLogs } = useQuery({
    queryKey: ['systemLogs', sysLogParams],
    queryFn: () => getSystemLogs(sysLogParams),
    enabled: activeTab === 'system'
  })

  // 日志文件查询
  const { data: logFiles = [], isLoading: isFilesLoading, refetch: refetchFiles } = useQuery({
    queryKey: ['logFiles'],
    queryFn: getLogFiles,
    enabled: activeTab === 'files'
  })

  const filteredFiles = fileTypeFilter === 'all'
    ? logFiles
    : logFiles.filter(f => f.type === fileTypeFilter)

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

  const formatTokens = (count: number): string => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`
    }
    return count.toLocaleString()
  }

  const formatCost = (cost?: number) => {
    if (cost === undefined || cost === null) return "$0"
    if (cost === 0) return "$0"
    return `$${cost.toFixed(3)}`
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

      {/* Tab 切换 */}
      <div className="flex gap-2">
        <Button
          variant={activeTab === 'requests' ? 'default' : 'outline'}
          onClick={() => setActiveTab('requests')}
        >
          <Search className="mr-2 h-4 w-4" />
          请求日志
        </Button>
        <Button
          variant={activeTab === 'system' ? 'default' : 'outline'}
          onClick={() => setActiveTab('system')}
        >
          <Activity className="mr-2 h-4 w-4" />
          系统日志
        </Button>
        <Button
          variant={activeTab === 'files' ? 'default' : 'outline'}
          onClick={() => setActiveTab('files')}
        >
          <FileText className="mr-2 h-4 w-4" />
          日志文件
        </Button>
      </div>

      {activeTab === 'requests' && (<>
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
                    <TableHead className="text-right">积分</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead className="text-right">耗时</TableHead>
                    <TableHead>用户输入</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs?.map((log) => (
                    <TableRow key={log.id || log.timestamp}>
                      <TableCell className="whitespace-nowrap">{formatDate(log.timestamp)}</TableCell>
                      <TableCell>{getProvider(log.model)}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={log.model}>{log.model}</TableCell>
                      <TableCell className="font-mono text-xs">{log.path}</TableCell>
                      <TableCell className="text-right">{formatTokens(log.inputTokens)}</TableCell>
                      <TableCell className="text-right">{formatTokens(log.outputTokens)}</TableCell>
                      <TableCell className="text-right">{formatTokens(log.cacheReadTokens ?? 0)}</TableCell>
                      <TableCell className="text-right">{formatTokens(log.cacheCreationTokens ?? 0)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{formatCost(log.cost)}</TableCell>
                      <TableCell className="text-right">{log.kiroCredits != null ? log.kiroCredits.toFixed(3) : "-"}</TableCell>
                      <TableCell>
                        {log.auxiliary ? (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">
                            辅助
                          </span>
                        ) : log.success ? (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">
                            正常
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">
                            失败
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{log.responseTime}ms</TableCell>
                      <TableCell className="max-w-[150px] truncate text-xs text-muted-foreground" title={log.userInput || ""}>
                        {log.userInput || "-"}
                      </TableCell>
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
      </>)}

      {activeTab === 'system' && (
        <>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              筛选条件
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="w-40">
                <label className="text-sm text-muted-foreground mb-1 block">分类</label>
                <Select value={sysLogCategory} onValueChange={setSysLogCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="分类" />
                  </SelectTrigger>
                  <SelectContent>
                    {SYSTEM_LOG_CATEGORIES.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-32">
                <label className="text-sm text-muted-foreground mb-1 block">级别</label>
                <Select value={sysLogLevel} onValueChange={setSysLogLevel}>
                  <SelectTrigger>
                    <SelectValue placeholder="级别" />
                  </SelectTrigger>
                  <SelectContent>
                    {SYSTEM_LOG_LEVELS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28">
                <label className="text-sm text-muted-foreground mb-1 block">条数</label>
                <Select value={String(sysLogLimit)} onValueChange={(v) => setSysLogLimit(parseInt(v, 10))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[50, 100, 200, 500].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} 条</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                onClick={() => refetchSysLogs()}
                disabled={isSysFetching}
              >
                {isSysFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                {isSysFetching ? "刷新中..." : "刷新"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>系统日志</CardTitle>
            <CardDescription>共 {systemLogs.length} 条记录</CardDescription>
          </CardHeader>
          <CardContent>
            {isSysLoading ? (
              <div className="py-8 text-center">加载中...</div>
            ) : systemLogs.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">暂无系统日志</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[170px]">时间</TableHead>
                      <TableHead className="w-[70px]">级别</TableHead>
                      <TableHead className="w-[130px]">分类</TableHead>
                      <TableHead>消息</TableHead>
                      <TableHead className="w-[300px]">详情</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {systemLogs.map((log) => (
                      <TableRow key={log.id || log.timestamp}>
                        <TableCell className="whitespace-nowrap text-sm">{new Date(log.timestamp).toLocaleString("zh-CN")}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            log.level === 'error' ? 'bg-red-100 text-red-700'
                              : log.level === 'warn' ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {log.level}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            log.category === 'account_status' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                            {log.category === 'account_status' ? '账号状态' : log.category}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{log.message}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate" title={log.data ? JSON.stringify(log.data) : ''}>
                          {log.data ? JSON.stringify(log.data) : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        </>
      )}

      {activeTab === 'files' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>日志文件</span>
              <div className="flex gap-2">
                <Select value={fileTypeFilter} onValueChange={setFileTypeFilter}>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="文件类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="requests">请求日志</SelectItem>
                    <SelectItem value="system">系统日志</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={() => refetchFiles()}>
                  <Search className="mr-2 h-4 w-4" />
                  刷新
                </Button>
              </div>
            </CardTitle>
            <CardDescription>
              下载历史日志文件
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isFilesLoading ? (
              <div className="py-8 text-center">加载中...</div>
            ) : filteredFiles.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                暂无日志文件
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>文件名</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>日期</TableHead>
                    <TableHead className="text-right">大小</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFiles.map((file) => (
                    <TableRow key={`${file.type}-${file.filename}`}>
                      <TableCell className="font-mono text-sm">{file.filename}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          file.type === 'requests' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                        }`}>
                          {file.type === 'requests' ? '请求日志' : '系统日志'}
                        </span>
                      </TableCell>
                      <TableCell>{file.date}</TableCell>
                      <TableCell className="text-right">{formatFileSize(file.size)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => downloadLogFile(file.type, file.filename)}
                        >
                          <Download className="mr-1 h-4 w-4" />
                          下载
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
