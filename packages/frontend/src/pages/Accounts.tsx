import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2, RefreshCw, TestTube, Pencil, BarChart3, Fingerprint, ArrowUpDown, Pause, Play, Download, Copy, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { useToast } from "@/hooks/use-toast"
import {
  getAccounts,
  getAccount,
  deleteAccount,
  refreshAccountToken,
  testAccount,
  getAllAccountsUsage,
  regenerateMachineId,
  pauseAccount,
  resumeAccount,
  batchDeleteAccounts,
} from "@/api/accounts"
import { getAllAccountsTodayCost, getConcurrencyStatus } from "@/api/stats"
import type { Account, AccountUsage } from "@kiro-gateway/shared"
import type { AccountCostData } from "@/api/stats"
import { AddAccountDialog } from "@/components/accounts/AddAccountDialog"
import { EditAccountDialog } from "@/components/accounts/EditAccountDialog"

/**
 * Accounts 页面 - 账号管理
 * 支持添加、删除、刷新 Token 等操作
 */
export function Accounts() {
  const defaultBatchImportConcurrency = 10
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [sortBy, setSortBy] = useState<"email" | "todayCost" | "totalCost">("email")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc")

  const { toast } = useToast()
  const queryClient = useQueryClient()

  // 获取账号列表
  const { data: accounts, isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
  })

  // 获取所有账号使用量
  const { data: usageData, isLoading: isUsageLoading, refetch: refetchUsage } = useQuery({
    queryKey: ["accounts-usage"],
    queryFn: getAllAccountsUsage,
    // 每 5 分钟自动刷新
    refetchInterval: 5 * 60 * 1000,
    // 账号列表加载完成后才获取使用量
    enabled: !!accounts && accounts.length > 0,
  })

  // 获取账号费用数据
  const { data: accountsCostData = [] } = useQuery({
    queryKey: ["accountsCostData"],
    queryFn: getAllAccountsTodayCost,
    refetchInterval: 30 * 1000, // 30秒自动刷新
  })

  // 获取并发状态（3秒轮询）
  const { data: concurrencyData } = useQuery({
    queryKey: ["concurrencyStatus"],
    queryFn: getConcurrencyStatus,
    refetchInterval: 3 * 1000,
  })

  // 根据账号 ID 获取使用量数据
  const getUsageForAccount = (accountId: string): AccountUsage | undefined => {
    return usageData?.find(u => u.accountId === accountId)
  }

  // 格式化费用显示
  const formatCost = (cost: number): string => {
    return `$${cost.toFixed(3)}`
  }

  // 获取账号的费用数据
  const getAccountCostData = (accountId: string): AccountCostData | undefined => {
    return accountsCostData.find(item => item.accountId === accountId)
  }

  // 获取账号的实时并发数
  const getAccountConcurrency = (accountId: string): number => {
    return concurrencyData?.accounts.find(a => a.accountId === accountId)?.concurrency ?? 0
  }

  // 合并账号和费用数据，并排序
  const mergedAccounts = (accounts || []).map(account => ({
    ...account,
    costData: getAccountCostData(account.id),
  })).sort((a, b) => {
    let compareValue = 0

    if (sortBy === "email") {
      compareValue = (a.email || "").localeCompare(b.email || "")
    } else if (sortBy === "todayCost") {
      compareValue = (a.costData?.todayCost || 0) - (b.costData?.todayCost || 0)
    } else if (sortBy === "totalCost") {
      compareValue = (a.costData?.totalCost || 0) - (b.costData?.totalCost || 0)
    }

    return sortOrder === "asc" ? compareValue : -compareValue
  })

  // 切换排序
  const toggleSort = (field: "email" | "todayCost" | "totalCost") => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc")
    } else {
      setSortBy(field)
      setSortOrder("asc")
    }
  }

  // 排序指示器
  const SortIndicator = ({ field }: { field: "email" | "todayCost" | "totalCost" }) => {
    if (sortBy !== field) return null
    return (
      <ArrowUpDown className={`h-4 w-4 inline ml-1 ${sortOrder === "desc" ? "rotate-180" : ""}`} />
    )
  }

  // 格式化使用量显示
  const formatUsage = (accountId: string): string => {
    const usage = getUsageForAccount(accountId)
    if (!usage) return isUsageLoading ? "加载中..." : "-"
    if (usage.error) return "获取失败"

    // 优先查找 CREDIT 类型，其次查找 AGENTIC_REQUEST 类型
    const usageItem = usage.usage?.usageBreakdownList?.find(
      b => b.resourceType === "CREDIT"
    ) || usage.usage?.usageBreakdownList?.find(
      b => b.resourceType === "AGENTIC_REQUEST"
    ) || usage.usage?.usageBreakdownList?.[0]

    if (!usageItem) return "-"

    const current = usageItem.currentUsage ?? 0
    const limit = usageItem.usageLimit ?? 0
    const remaining = Math.max(0, limit - current)
    // 计算已使用百分比
    const percentage = limit > 0 ? Math.round((current / limit) * 100) : 0

    return `${current}/${limit} (${percentage}%, 剩余 ${remaining})`
  }

  // 获取订阅类型显示
  const getSubscriptionType = (accountId: string): string => {
    const usage = getUsageForAccount(accountId)
    if (!usage?.usage?.subscriptionInfo) return "-"

    const subInfo = usage.usage.subscriptionInfo
    // 显示订阅标题，如 "KIRO POWER"
    return subInfo.subscriptionTitle || subInfo.type || "-"
  }

  // 获取下次重置时间
  const getNextResetDate = (accountId: string): string => {
    const usage = getUsageForAccount(accountId)
    if (!usage?.usage?.nextDateReset) return "-"

    const resetDate = new Date(usage.usage.nextDateReset)
    return resetDate.toLocaleDateString("zh-CN")
  }

  // 删除账号
  const deleteMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] })
      toast({ title: "删除成功", description: "账号已成功删除" })
    },
    onError: (error: Error) => {
      toast({
        title: "删除失败",
        description: error.message,
        variant: "destructive",
      })
    },
  })

  // 刷新 Token
  const refreshMutation = useMutation({
    mutationFn: refreshAccountToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] })
      toast({ title: "刷新成功", description: "Token 已成功刷新" })
    },
    onError: (error: Error) => {
      toast({
        title: "刷新失败",
        description: error.message,
        variant: "destructive",
      })
    },
  })

  // 测试账号
  const testMutation = useMutation({
    mutationFn: testAccount,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] })
      toast({
        title: "测试成功",
        description: `模型: ${data.model}\n响应: ${data.response.slice(0, 100)}${data.response.length > 100 ? '...' : ''}`,
      })
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] })
      toast({
        title: "测试失败",
        description: error.message,
        variant: "destructive",
      })
    },
  })

  // 重新生成机器码
  const regenerateMachineIdMutation = useMutation({
    mutationFn: regenerateMachineId,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] })
      toast({
        title: "生成成功",
        description: `新机器码: ${data.machineId?.slice(0, 18)}...`,
      })
    },
    onError: (error: Error) => {
      toast({
        title: "生成失败",
        description: error.message,
        variant: "destructive",
      })
    },
  })

  // 暂停/恢复账号
  const pauseMutation = useMutation({
    mutationFn: pauseAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] })
      toast({ title: "操作成功", description: "账号已暂停调度" })
    },
    onError: (error: Error) => {
      toast({
        title: "暂停失败",
        description: error.message,
        variant: "destructive",
      })
    },
  })

  const resumeMutation = useMutation({
    mutationFn: resumeAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] })
      toast({ title: "操作成功", description: "账号已恢复调度" })
    },
    onError: (error: Error) => {
      toast({
        title: "恢复失败",
        description: error.message,
        variant: "destructive",
      })
    },
  })

  // 批量删除账号
  const batchDeleteMutation = useMutation({
    mutationFn: batchDeleteAccounts,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] })
      toast({ title: "删除成功", description: `已删除 ${data.deleted} 个账号` })
    },
    onError: (error: Error) => {
      toast({ title: "删除失败", description: error.message, variant: "destructive" })
    },
  })

  /** 删除全部账号 */
  const handleDeleteAll = () => {
    if (!accounts?.length) return
    if (!confirm(`确定要删除全部 ${accounts.length} 个账号吗？此操作不可恢复！`)) return
    batchDeleteMutation.mutate(undefined)
  }

  /** 删除非激活账号 */
  const handleDeleteInactive = () => {
    const inactiveIds = accounts?.filter(a => a.status !== "active").map(a => a.id) || []
    if (inactiveIds.length === 0) {
      toast({ title: "无非激活账号", description: "所有账号均为激活状态" })
      return
    }
    if (!confirm(`确定要删除 ${inactiveIds.length} 个非激活账号吗？`)) return
    batchDeleteMutation.mutate(inactiveIds)
  }

  /** 将账号列表转换为导出 JSON 格式 */
  const toExportFormat = (fullAccounts: Account[]) =>
    fullAccounts.map(a => ({
      refreshToken: a.refreshToken || "",
      clientId: a.clientId || "",
      clientSecret: a.clientSecret || "",
      region: a.region || "us-east-1",
      startUrl: "",
      provider: a.provider || "",
      machineId: a.machineId || "",
    }))

  /** 导出所有账号为 JSON 文件 */
  const [isExporting, setIsExporting] = useState(false)
  const handleExportAccounts = async () => {
    if (!accounts || accounts.length === 0) {
      toast({ title: "无可导出账号", variant: "destructive" })
      return
    }
    setIsExporting(true)
    try {
      const fullAccounts = await Promise.all(accounts.map(a => getAccount(a.id)))
      const json = JSON.stringify(toExportFormat(fullAccounts), null, 2)
      const blob = new Blob([json], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `accounts_export_${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      toast({ title: "导出成功", description: `已导出 ${fullAccounts.length} 个账号` })
    } catch (error) {
      toast({ title: "导出失败", description: (error as Error).message, variant: "destructive" })
    } finally {
      setIsExporting(false)
    }
  }

  /** 复制所有账号信息到剪贴板 */
  const [isCopying, setIsCopying] = useState(false)
  const handleCopyAccounts = async () => {
    if (!accounts || accounts.length === 0) {
      toast({ title: "无可复制账号", variant: "destructive" })
      return
    }
    setIsCopying(true)
    try {
      const fullAccounts = await Promise.all(accounts.map(a => getAccount(a.id)))
      const json = JSON.stringify(toExportFormat(fullAccounts), null, 2)
      await navigator.clipboard.writeText(json)
      toast({ title: "复制成功", description: `已复制 ${fullAccounts.length} 个账号信息` })
    } catch (error) {
      toast({ title: "复制失败", description: (error as Error).message, variant: "destructive" })
    } finally {
      setIsCopying(false)
    }
  }

  /** 打开编辑对话框 */
  const handleOpenEditDialog = (account: Account) => {
    setEditingAccount(account)
    setIsEditDialogOpen(true)
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">账号管理</h2>
          <p className="text-muted-foreground">
            管理 Kiro 账号，支持添加、删除和刷新 Token
          </p>
        </div>

        <div className="flex gap-2">
          {/* 删除非激活账号 */}
          <Button variant="outline" onClick={handleDeleteInactive} disabled={batchDeleteMutation.isPending || !accounts?.length}>
            <XCircle className="mr-2 h-4 w-4 text-yellow-600" />
            删除非激活
          </Button>

          {/* 删除全部账号 */}
          <Button variant="destructive" onClick={handleDeleteAll} disabled={batchDeleteMutation.isPending || !accounts?.length}>
            <Trash2 className="mr-2 h-4 w-4" />
            删除全部
          </Button>

          {/* 复制账号按钮 */}
          <Button variant="outline" onClick={handleCopyAccounts} disabled={isCopying || !accounts?.length}>
            <Copy className="mr-2 h-4 w-4" />
            {isCopying ? "复制中..." : "复制账号"}
          </Button>

          {/* 导出账号按钮 */}
          <Button variant="outline" onClick={handleExportAccounts} disabled={isExporting || !accounts?.length}>
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "导出中..." : "导出账号"}
          </Button>

          {/* 添加账号按钮 */}
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            添加账号
          </Button>
        </div>
      </div>

      {/* 添加账号对话框 */}
      <AddAccountDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        defaultBatchImportConcurrency={defaultBatchImportConcurrency}
      />

      {/* 编辑账号对话框 */}
      <EditAccountDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        account={editingAccount}
      />

      {/* 账号列表 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>账号列表</CardTitle>
            <CardDescription>
              共 {accounts?.length ?? 0} 个账号
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchUsage()}
            disabled={isUsageLoading}
            title="刷新使用量"
          >
            <BarChart3 className="mr-2 h-4 w-4" />
            {isUsageLoading ? "刷新中..." : "刷新使用量"}
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center">加载中...</div>
          ) : accounts?.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              暂无账号，点击上方按钮添加
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>别名</TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted"
                    onClick={() => toggleSort("email")}
                  >
                    邮箱/ID <SortIndicator field="email" />
                  </TableHead>
                  <TableHead>机器码</TableHead>
                  <TableHead>代理</TableHead>
                  <TableHead>订阅类型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>连接数</TableHead>
                  <TableHead>使用量</TableHead>
                  <TableHead>重置时间</TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted"
                    onClick={() => toggleSort("todayCost")}
                  >
                    今日费用 <SortIndicator field="todayCost" />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted"
                    onClick={() => toggleSort("totalCost")}
                  >
                    累计费用 <SortIndicator field="totalCost" />
                  </TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mergedAccounts?.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell>
                      <span className="text-sm">{account.alias || "-"}</span>
                    </TableCell>
                    <TableCell className="font-medium">
                      {account.email || account.id.slice(0, 12) + "..."}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-mono text-muted-foreground" title={account.machineId || ""}>
                        {account.machineId ? account.machineId.slice(0, 8) + "..." : "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-mono text-muted-foreground" title={account.proxyUrl ? account.proxyUrl.replace(/\/\/[^@]*@/, "//") : ""}>
                        {account.proxyUrl ? account.proxyUrl.replace(/\/\/[^@]*@/, "//") : "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{getSubscriptionType(account.id)}</span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                          account.status === 'active'
                            ? "bg-green-100 text-green-700"
                            : account.status === 'paused'
                            ? "bg-yellow-100 text-yellow-700"
                            : account.status === 'suspended'
                            ? "bg-gray-100 text-gray-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {account.status === 'active' ? "正常" : account.status === 'paused' ? "已暂停" : account.status === 'suspended' ? "已封号" : "异常挂起"}
                      </span>
                      {account.status !== 'active' && (account.statusChangedAt || account.statusReason) && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {account.statusChangedAt && new Date(account.statusChangedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          {account.statusReason && <span className="ml-1">{account.statusReason}</span>}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const current = getAccountConcurrency(account.id)
                        const max = account.maxConcurrency
                        if (max && max > 0) {
                          const ratio = current / max
                          const colorClass = ratio >= 1 ? "text-red-600 font-semibold" : ratio >= 0.7 ? "text-yellow-600" : "text-green-600"
                          return <span className={`text-sm ${colorClass}`}>{current}/{max}</span>
                        }
                        return <span className={`text-sm ${current > 0 ? "text-blue-600" : "text-muted-foreground"}`}>{current}</span>
                      })()}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{formatUsage(account.id)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{getNextResetDate(account.id)}</span>
                    </TableCell>
                    <TableCell className="font-semibold text-red-600">
                      {account.costData ? formatCost(account.costData.todayCost) : "-"}
                    </TableCell>
                    <TableCell className="font-semibold text-orange-600">
                      {account.costData ? formatCost(account.costData.totalCost) : "-"}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {account.createdAt ? new Date(account.createdAt).toLocaleDateString("zh-CN") : "-"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {/* 暂停/恢复按钮 */}
                        {account.status === 'active' ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => pauseMutation.mutate(account.id)}
                            disabled={pauseMutation.isPending}
                            title="暂停账号"
                          >
                            <Pause className="h-4 w-4 text-yellow-600" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => resumeMutation.mutate(account.id)}
                            disabled={resumeMutation.isPending}
                            title="恢复账号"
                          >
                            <Play className="h-4 w-4 text-green-600" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={async () => {
                            try {
                              const full = await getAccount(account.id)
                              const json = JSON.stringify(toExportFormat([full]), null, 2)
                              await navigator.clipboard.writeText(json)
                              toast({ title: "复制成功", description: `已复制 ${account.email || account.id.slice(0, 12)} 的账号信息` })
                            } catch (error) {
                              toast({ title: "复制失败", description: (error as Error).message, variant: "destructive" })
                            }
                          }}
                          title="复制账号信息"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEditDialog(account)}
                          title="编辑账号"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm("确定要重新生成机器码吗？这会更改账号绑定。")) {
                              regenerateMachineIdMutation.mutate(account.id)
                            }
                          }}
                          disabled={regenerateMachineIdMutation.isPending}
                          title="生成/重置机器码"
                        >
                          <Fingerprint className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => testMutation.mutate(account.id)}
                          disabled={testMutation.isPending}
                          title="测试账号"
                        >
                          <TestTube className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => refreshMutation.mutate(account.id)}
                          disabled={refreshMutation.isPending}
                          title="刷新 Token"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm("确定要删除此账号吗？")) {
                              deleteMutation.mutate(account.id)
                            }
                          }}
                          disabled={deleteMutation.isPending}
                          title="删除账号"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
