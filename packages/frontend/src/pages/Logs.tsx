import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, Filter, Loader2 } from "lucide-react"
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

/**
 * Logs 页面 - 请求日志与 Token 使用明细
 */
export function Logs() {
  const [query, setQuery] = useState<LogsQuery>({
    limit: 50,
  })
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const { data: logs, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["logs", query],
    queryFn: () => getRequestLogs(query),
  })

  const filteredLogs = logs?.filter((log) => {
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
          <div className="flex flex-wrap gap-4">
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
        </CardContent>
      </Card>
    </div>
  )
}
