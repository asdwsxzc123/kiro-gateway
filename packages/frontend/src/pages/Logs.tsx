import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, Filter, ChevronDown, ChevronUp } from "lucide-react"
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
import type { LogsQuery, RequestLog } from "@kiro-gateway/shared"

/**
 * Logs 页面 - 日志查看
 * 支持筛选和查看详情
 */
export function Logs() {
  // 筛选条件
  const [query, setQuery] = useState<LogsQuery>({
    limit: 50,
  })
  // 展开的日志 ID
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // 状态筛选
  const [statusFilter, setStatusFilter] = useState<string>("all")

  // 获取日志列表
  const { data: logs, isLoading } = useQuery({
    queryKey: ["logs", query],
    queryFn: () => getRequestLogs(query),
  })

  // 根据状态筛选日志
  const filteredLogs = logs?.filter(log => {
    if (statusFilter === "all") return true
    if (statusFilter === "success") return log.success
    if (statusFilter === "error") return !log.success
    return true
  })

  // 格式化日期
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("zh-CN")
  }

  // 切换展开状态
  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id)
  }

  // 渲染日志详情
  const renderLogDetail = (log: RequestLog) => {
    if (expandedId !== log.id) return null
    return (
      <TableRow key={`${log.id}-detail`}>
        <TableCell colSpan={7} className="bg-muted/50 p-4">
          <div className="grid gap-2 text-sm">
            <div>
              <span className="font-medium">请求路径：</span>
              {log.path}
            </div>
            <div>
              <span className="font-medium">输入 Token：</span>
              {log.inputTokens}
            </div>
            <div>
              <span className="font-medium">输出 Token：</span>
              {log.outputTokens}
            </div>
            {log.credits && (
              <div>
                <span className="font-medium">消耗额度：</span>
                {log.credits}
              </div>
            )}
            {log.error && (
              <div>
                <span className="font-medium text-destructive">错误信息：</span>
                {log.error}
              </div>
            )}
          </div>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">日志查看</h2>
        <p className="text-muted-foreground">
          查看 API 请求日志，支持筛选和搜索
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
          <div className="flex flex-wrap gap-4">
            {/* 状态筛选 */}
            <div className="w-40">
              <Select
                value={statusFilter}
                onValueChange={setStatusFilter}
              >
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

            {/* 数量限制 */}
            <div className="w-32">
              <Input
                type="number"
                placeholder="数量"
                value={query.limit || 50}
                onChange={(e) =>
                  setQuery({ ...query, limit: parseInt(e.target.value) || 50 })
                }
              />
            </div>

            {/* 搜索按钮 */}
            <Button
              variant="outline"
              onClick={() => setQuery({ ...query })}
            >
              <Search className="mr-2 h-4 w-4" />
              刷新
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 日志列表 */}
      <Card>
        <CardHeader>
          <CardTitle>日志列表</CardTitle>
          <CardDescription>
            共 {filteredLogs?.length ?? 0} 条记录
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>时间</TableHead>
                  <TableHead>账号ID</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>耗时</TableHead>
                  <TableHead>Token</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs?.map((log) => (
                  <>
                    <TableRow
                      key={log.id || log.timestamp}
                      className="cursor-pointer"
                      onClick={() => toggleExpand(log.id || String(log.timestamp))}
                    >
                      <TableCell>
                        {expandedId === (log.id || String(log.timestamp)) ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell>{formatDate(log.timestamp)}</TableCell>
                      <TableCell>{log.accountId.slice(0, 8)}...</TableCell>
                      <TableCell>{log.model}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                            log.success
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {log.success ? "成功" : "失败"}
                        </span>
                      </TableCell>
                      <TableCell>{log.responseTime}ms</TableCell>
                      <TableCell>{log.inputTokens + log.outputTokens}</TableCell>
                    </TableRow>
                    {renderLogDetail(log)}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
