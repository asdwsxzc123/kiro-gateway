import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Copy, Plus, Trash2, Save, Lock, ArrowUpDown, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { getConfig, updateConfig, getApiKeys, createApiKey, updateApiKey, deleteApiKey, testWebhook, getWebhookConfig, updateWebhookConfig } from "@/api/config"
import { getAccounts } from "@/api/accounts"
import { authApi } from "@/api/auth"
import { getAllApiKeysTodayCost } from "@/api/stats"
import type { ApiKeyCostData } from "@/api/stats"

/**
 * Settings 页面 - 系统配置
 * 管理 API Key、限流和其他设置
 */
export function Settings() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [isAddKeyDialogOpen, setIsAddKeyDialogOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [newKeyBoundAccountIds, setNewKeyBoundAccountIds] = useState<string[]>([])
  // 编辑绑定账号的对话框状态
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null)
  const [editBoundAccountIds, setEditBoundAccountIds] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<"name" | "todayCost" | "totalCost">("name")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc")

  // Webhook 测试状态
  const [testingWebhook, setTestingWebhook] = useState(false)
  const [webhookConfig, setWebhookConfig] = useState<import("@kiro-gateway/shared").WebhookConfig | null>(null)

  // 修改密码状态
  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  // 本地配置状态
  const [localConfig, setLocalConfig] = useState<Record<string, any>>({})

  // 获取配置
  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
  })

  // 获取 API Keys
  const { data: apiKeys, isLoading: keysLoading } = useQuery({
    queryKey: ["apiKeys"],
    queryFn: getApiKeys,
  })

  // 获取 API Keys 费用数据
  const { data: apiKeysCostData = [] } = useQuery({
    queryKey: ["apiKeysCostData"],
    queryFn: getAllApiKeysTodayCost,
    refetchInterval: 30 * 1000, // 30秒自动刷新
  })

  // 获取所有账号列表（用于 API Key 绑定账号选择）
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
  })

  // 获取 Webhook 配置
  const { data: webhookData } = useQuery({
    queryKey: ["webhookConfig"],
    queryFn: getWebhookConfig,
  })

  // 格式化费用显示
  const formatCost = (cost: number): string => {
    return `$${cost.toFixed(4)}`
  }

  // 获取 API Key 的费用数据
  const getApiKeyCostData = (apiKeyId: string): ApiKeyCostData | undefined => {
    return apiKeysCostData.find(item => item.apiKeyId === apiKeyId)
  }

  // 合并 API Keys 和费用数据，并排序
  const mergedApiKeys = (apiKeys || []).map(key => ({
    ...key,
    costData: getApiKeyCostData(key.id),
  })).sort((a, b) => {
    let compareValue = 0

    if (sortBy === "name") {
      compareValue = (a.name || "").localeCompare(b.name || "")
    } else if (sortBy === "todayCost") {
      compareValue = (a.costData?.todayCost || 0) - (b.costData?.todayCost || 0)
    } else if (sortBy === "totalCost") {
      compareValue = (a.costData?.totalCost || 0) - (b.costData?.totalCost || 0)
    }

    return sortOrder === "asc" ? compareValue : -compareValue
  })

  // 切换排序
  const toggleSort = (field: "name" | "todayCost" | "totalCost") => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc")
    } else {
      setSortBy(field)
      setSortOrder("asc")
    }
  }

  // 排序指示器
  const SortIndicator = ({ field }: { field: "name" | "todayCost" | "totalCost" }) => {
    if (sortBy !== field) return null
    return (
      <ArrowUpDown className={`h-4 w-4 inline ml-1 ${sortOrder === "desc" ? "rotate-180" : ""}`} />
    )
  }
  const updateMutation = useMutation({
    mutationFn: updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] })
      toast({ title: "保存成功", description: "配置已更新" })
    },
    onError: (error: Error) => {
      toast({
        title: "保存失败",
        description: error.message,
        variant: "destructive",
      })
    },
  })

  // 创建 API Key
  const createKeyMutation = useMutation({
    mutationFn: createApiKey,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] })
      setIsAddKeyDialogOpen(false)
      setNewKeyName("")
      setNewKeyBoundAccountIds([])
      // 显示新创建的 key
      toast({
        title: "创建成功",
        description: `新 API Key: ${data.key}（请妥善保存，仅显示一次）`,
      })
    },
    onError: (error: Error) => {
      toast({
        title: "创建失败",
        description: error.message,
        variant: "destructive",
      })
    },
  })

  // 更新 API Key 绑定账号
  const updateKeyMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { boundAccountIds: string[] } }) =>
      updateApiKey(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] })
      setEditingKeyId(null)
      toast({ title: "更新成功", description: "API Key 绑定账号已更新" })
    },
    onError: (error: Error) => {
      toast({
        title: "更新失败",
        description: error.message,
        variant: "destructive",
      })
    },
  })

  // 删除 API Key
  const deleteKeyMutation = useMutation({
    mutationFn: deleteApiKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["apiKeys"] })
      toast({ title: "删除成功", description: "API Key 已删除" })
    },
    onError: (error: Error) => {
      toast({
        title: "删除失败",
        description: error.message,
        variant: "destructive",
      })
    },
  })

  // 修改密码
  const updatePasswordMutation = useMutation({
    mutationFn: () => authApi.updatePassword(oldPassword, newPassword),
    onSuccess: () => {
      toast({ title: "修改成功", description: "密码已更新" })
      setOldPassword("")
      setNewPassword("")
      setConfirmPassword("")
    },
    onError: (error: Error) => {
      toast({
        title: "修改失败",
        description: error.message,
        variant: "destructive",
      })
    },
  })

  // 处理修改密码
  const handleUpdatePassword = () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      toast({
        title: "错误",
        description: "请填写所有密码字段",
        variant: "destructive",
      })
      return
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: "错误",
        description: "新密码与确认密码不一致",
        variant: "destructive",
      })
      return
    }
    if (newPassword.length < 6) {
      toast({
        title: "错误",
        description: "新密码长度至少为 6 位",
        variant: "destructive",
      })
      return
    }
    updatePasswordMutation.mutate()
  }

  // 复制 API Key
  const copyApiKey = async (key: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(key)
      } else {
        // Fallback for non-HTTPS or unsupported browsers
        const textArea = document.createElement('textarea')
        textArea.value = key
        textArea.style.position = 'fixed'
        textArea.style.left = '-9999px'
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      toast({ title: "已复制", description: "API Key 已复制到剪贴板" })
    } catch {
      toast({ title: "复制失败", description: "请手动复制", variant: "destructive" })
    }
  }

  // 保存代理服务配置
  const saveProxyConfig = () => {
    updateMutation.mutate({
      multiAccountEnabled: localConfig.multiAccountEnabled ?? config?.multiAccountEnabled,
      maxConcurrent: localConfig.maxConcurrent ?? config?.maxConcurrent,
      autoSwitchOnQuotaExhausted: localConfig.autoSwitchOnQuotaExhausted ?? config?.autoSwitchOnQuotaExhausted,
      queueEnabled: localConfig.queueEnabled ?? config?.queueEnabled,
      queueMaxSize: localConfig.queueMaxSize ?? config?.queueMaxSize,
      queueTimeoutMs: localConfig.queueTimeoutMs ?? config?.queueTimeoutMs,
      concurrencyMultiplier: localConfig.concurrencyMultiplier ?? config?.concurrencyMultiplier,
      queueSizeMultiplier: localConfig.queueSizeMultiplier ?? config?.queueSizeMultiplier,
    })
  }

  // 保存限流配置
  const saveRateLimitConfig = () => {
    updateMutation.mutate({
      rateLimitEnabled: localConfig.rateLimitEnabled ?? config?.rateLimitEnabled,
      rateLimitMax: localConfig.rateLimitMax ?? config?.rateLimitMax,
      rateLimitWindow: localConfig.rateLimitWindow ?? config?.rateLimitWindow,
    })
  }

  // 保存 Token 刷新配置
  const saveTokenConfig = () => {
    updateMutation.mutate({
      tokenRefreshAdvance: localConfig.tokenRefreshAdvance ?? config?.tokenRefreshAdvance,
      maxRetries: localConfig.maxRetries ?? config?.maxRetries,
      retryDelay: localConfig.retryDelay ?? config?.retryDelay,
    })
  }

  // 保存账号池配置
  const savePoolConfig = () => {
    updateMutation.mutate({
      errorCooldownTime: localConfig.errorCooldownTime ?? config?.errorCooldownTime,
      maxConsecutiveErrors: localConfig.maxConsecutiveErrors ?? config?.maxConsecutiveErrors,
      quotaResetTime: localConfig.quotaResetTime ?? config?.quotaResetTime,
      autoStopErrorCodes: localConfig.autoStopErrorCodes ?? config?.autoStopErrorCodes,
      autoStopErrorPatterns: localConfig.autoStopErrorPatterns ?? config?.autoStopErrorPatterns,
      quotaUsageThreshold: localConfig.quotaUsageThreshold ?? config?.quotaUsageThreshold,
    })
  }

  // 测试 Webhook
  const handleTestWebhook = async () => {
    setTestingWebhook(true)
    try {
      const results = await testWebhook()
      const succeeded = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success).length
      if (results.length === 0) {
        toast({ title: "无可用平台", description: "请先添加并启用至少一个推送平台", variant: "destructive" })
      } else if (failed === 0) {
        toast({ title: "发送成功", description: `${succeeded} 个平台全部推送成功` })
      } else {
        const failedNames = results.filter(r => !r.success).map(r => r.label || r.platform).join(", ")
        toast({ title: "部分失败", description: `成功 ${succeeded}，失败 ${failed}（${failedNames}）`, variant: "destructive" })
      }
    } catch (error: any) {
      toast({ title: "发送失败", description: error.message || "Webhook 测试失败", variant: "destructive" })
    } finally {
      setTestingWebhook(false)
    }
  }

  // 保存 Webhook 配置
  const saveWebhookConfig = async () => {
    if (!webhookConfig) return
    try {
      await updateWebhookConfig(webhookConfig)
      queryClient.invalidateQueries({ queryKey: ["webhookConfig"] })
      toast({ title: "保存成功", description: "Webhook 配置已更新" })
    } catch (error: any) {
      toast({ title: "保存失败", description: error.message || "保存 Webhook 配置失败", variant: "destructive" })
    }
  }

  // 初始化 webhookConfig
  if (webhookData && !webhookConfig) {
    setWebhookConfig(webhookData)
  }

  // 保存高级配置
  const saveAdvancedConfig = () => {
    updateMutation.mutate({
      disableToolCalls: localConfig.disableToolCalls ?? config?.disableToolCalls,
      toolCallAutoRounds: localConfig.toolCallAutoRounds ?? config?.toolCallAutoRounds,
      preferredEndpoint: localConfig.preferredEndpoint ?? config?.preferredEndpoint,
      defaultRegion: localConfig.defaultRegion ?? config?.defaultRegion,
      enableRequestLogging: localConfig.enableRequestLogging ?? config?.enableRequestLogging,
      testModelId: localConfig.testModelId ?? config?.testModelId,
    })
  }

  // 格式化日期
  const formatDate = (timestamp?: number) => {
    if (!timestamp) return "-"
    return new Date(timestamp).toLocaleString("zh-CN")
  }

  if (configLoading) {
    return <div className="py-8 text-center">加载中...</div>
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">系统配置</h2>
        <p className="text-muted-foreground">
          管理 API Key、限流和其他系统设置
        </p>
      </div>

      <Tabs defaultValue="apikeys" className="space-y-4">
        <TabsList>
          <TabsTrigger value="apikeys">API Keys</TabsTrigger>
          <TabsTrigger value="proxy">代理服务</TabsTrigger>
          <TabsTrigger value="ratelimit">限流配置</TabsTrigger>
          <TabsTrigger value="token">Token刷新</TabsTrigger>
          <TabsTrigger value="pool">账号池</TabsTrigger>
          <TabsTrigger value="advanced">高级配置</TabsTrigger>
          <TabsTrigger value="password">修改密码</TabsTrigger>
        </TabsList>

        {/* API Keys 管理 */}
        <TabsContent value="apikeys">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>API Key 管理</CardTitle>
                <CardDescription>
                  用于访问网关 API 的认证密钥
                </CardDescription>
              </div>
              <Dialog open={isAddKeyDialogOpen} onOpenChange={setIsAddKeyDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    创建 API Key
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>创建新 API Key</DialogTitle>
                    <DialogDescription>
                      为 API Key 设置一个名称以便识别
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="keyName">名称</Label>
                      <Input
                        id="keyName"
                        placeholder="例如：生产环境"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>绑定账号（可选）</Label>
                      <p className="text-xs text-muted-foreground">
                        不选择则使用全局账号池轮询
                      </p>
                      <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
                        {accounts.length === 0 ? (
                          <p className="text-sm text-muted-foreground">暂无账号</p>
                        ) : (
                          accounts.map((acc) => (
                            <label key={acc.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted rounded px-1 py-0.5">
                              <input
                                type="checkbox"
                                checked={newKeyBoundAccountIds.includes(acc.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setNewKeyBoundAccountIds([...newKeyBoundAccountIds, acc.id])
                                  } else {
                                    setNewKeyBoundAccountIds(newKeyBoundAccountIds.filter(id => id !== acc.id))
                                  }
                                }}
                                className="rounded"
                              />
                              <span className="truncate">{acc.email || acc.id}</span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => { setIsAddKeyDialogOpen(false); setNewKeyBoundAccountIds([]) }}
                    >
                      取消
                    </Button>
                    <Button
                      onClick={() => createKeyMutation.mutate({
                        name: newKeyName,
                        boundAccountIds: newKeyBoundAccountIds.length > 0 ? newKeyBoundAccountIds : undefined,
                      })}
                      disabled={!newKeyName || createKeyMutation.isPending}
                    >
                      {createKeyMutation.isPending ? "创建中..." : "创建"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {keysLoading ? (
                <div className="py-4 text-center">加载中...</div>
              ) : apiKeys?.length === 0 ? (
                <div className="py-4 text-center text-muted-foreground">
                  暂无 API Key，点击上方按钮创建
                </div>
              ) : (
                <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        className="cursor-pointer hover:bg-muted"
                        onClick={() => toggleSort("name")}
                      >
                        名称 <SortIndicator field="name" />
                      </TableHead>
                      <TableHead>Key 预览</TableHead>
                      <TableHead>绑定账号</TableHead>
                      <TableHead>创建时间</TableHead>
                      <TableHead>最后使用</TableHead>
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
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mergedApiKeys?.map((apiKey) => {
                      // 获取绑定账号的邮箱用于展示
                      const boundIds = apiKey.boundAccountIds || []
                      const boundEmails = boundIds
                        .map(id => accounts.find(a => a.id === id)?.email || id.slice(0, 8))
                        .join(', ')

                      return (
                        <TableRow key={apiKey.id}>
                          <TableCell className="font-medium">{apiKey.name}</TableCell>
                          <TableCell className="font-mono">
                            {apiKey.keyPreview || apiKey.key?.slice(0, 8) + "..."}
                          </TableCell>
                          <TableCell className="max-w-[200px]">
                            {boundIds.length > 0 ? (
                              <span className="text-xs text-blue-600 truncate block" title={boundEmails}>
                                {boundIds.length} 个账号
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">全局</span>
                            )}
                          </TableCell>
                          <TableCell>{formatDate(apiKey.createdAt)}</TableCell>
                          <TableCell>{formatDate(apiKey.lastUsed)}</TableCell>
                          <TableCell className="font-semibold text-red-600">
                            {apiKey.costData ? formatCost(apiKey.costData.todayCost) : "-"}
                          </TableCell>
                          <TableCell className="font-semibold text-orange-600">
                            {apiKey.costData ? formatCost(apiKey.costData.totalCost) : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {/* 编辑绑定账号 */}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setEditingKeyId(apiKey.id)
                                  setEditBoundAccountIds(boundIds)
                                }}
                                title="编辑绑定账号"
                              >
                                <Save className="h-4 w-4" />
                              </Button>
                              {/* 复制完整 API Key */}
                              {apiKey.key && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => copyApiKey(apiKey.key!)}
                                  title="复制完整 Key"
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  if (confirm("确定要删除此 API Key 吗？")) {
                                    deleteKeyMutation.mutate(apiKey.id)
                                  }
                                }}
                                disabled={deleteKeyMutation.isPending}
                                title="删除"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>

                {/* 编辑绑定账号对话框 */}
                <Dialog open={!!editingKeyId} onOpenChange={(open) => !open && setEditingKeyId(null)}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>编辑绑定账号</DialogTitle>
                      <DialogDescription>
                        选择此 API Key 可使用的账号，不选择则使用全局账号池
                      </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-60 overflow-y-auto border rounded-md p-2 space-y-1">
                      {accounts.length === 0 ? (
                        <p className="text-sm text-muted-foreground">暂无账号</p>
                      ) : (
                        accounts.map((acc) => (
                          <label key={acc.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted rounded px-1 py-0.5">
                            <input
                              type="checkbox"
                              checked={editBoundAccountIds.includes(acc.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setEditBoundAccountIds([...editBoundAccountIds, acc.id])
                                } else {
                                  setEditBoundAccountIds(editBoundAccountIds.filter(id => id !== acc.id))
                                }
                              }}
                              className="rounded"
                            />
                            <span className="truncate">{acc.email || acc.id}</span>
                          </label>
                        ))
                      )}
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setEditingKeyId(null)}>
                        取消
                      </Button>
                      <Button
                        onClick={() => {
                          if (editingKeyId) {
                            updateKeyMutation.mutate({
                              id: editingKeyId,
                              data: { boundAccountIds: editBoundAccountIds },
                            })
                          }
                        }}
                        disabled={updateKeyMutation.isPending}
                      >
                        {updateKeyMutation.isPending ? "保存中..." : "保存"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 代理服务配置 */}
        <TabsContent value="proxy">
          <Card>
            <CardHeader>
              <CardTitle>代理服务配置</CardTitle>
              <CardDescription>
                代理服务已集成在主服务中，访问地址为 http://localhost:3000/v1/*
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 并发控制 */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>启用并发限制</Label>
                    <p className="text-sm text-muted-foreground">
                      关闭时不限制并发数，所有请求直接放行；开启后超过最大并发数的请求将排队等待
                    </p>
                  </div>
                  <Switch
                    checked={localConfig.queueEnabled ?? config?.queueEnabled ?? false}
                    onCheckedChange={(checked) =>
                      setLocalConfig({ ...localConfig, queueEnabled: checked })
                    }
                  />
                </div>
              </div>

              {(localConfig.queueEnabled ?? config?.queueEnabled) && (
                <>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="maxConcurrent">最大并发数</Label>
                    <Input
                      id="maxConcurrent"
                      type="number"
                      value={localConfig.maxConcurrent ?? config?.maxConcurrent ?? 10}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          maxConcurrent: parseInt(e.target.value),
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      同时处理的最大请求数
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="queueMaxSize">最大队列长度</Label>
                    <Input
                      id="queueMaxSize"
                      type="number"
                      value={localConfig.queueMaxSize ?? config?.queueMaxSize ?? (localConfig.maxConcurrent ?? config?.maxConcurrent ?? 10) * 2}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          queueMaxSize: parseInt(e.target.value),
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      超过队列长度的请求将直接拒绝
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="queueTimeoutMs">排队超时 (ms)</Label>
                    <Input
                      id="queueTimeoutMs"
                      type="number"
                      value={localConfig.queueTimeoutMs ?? config?.queueTimeoutMs ?? 30000}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          queueTimeoutMs: parseInt(e.target.value),
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      排队等待超过此时间将被拒绝
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="concurrencyMultiplier">并发乘数</Label>
                    <Input
                      id="concurrencyMultiplier"
                      type="number"
                      step="0.5"
                      min="0"
                      value={localConfig.concurrencyMultiplier ?? config?.concurrencyMultiplier ?? 0}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          concurrencyMultiplier: parseFloat(e.target.value) || 0,
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      动态模式: 有效并发 = max(最大并发, 乘数 x 可用账号数)，0 = 固定模式
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="queueSizeMultiplier">队列乘数</Label>
                    <Input
                      id="queueSizeMultiplier"
                      type="number"
                      step="0.5"
                      min="0"
                      value={localConfig.queueSizeMultiplier ?? config?.queueSizeMultiplier ?? 0}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          queueSizeMultiplier: parseFloat(e.target.value) || 0,
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      动态模式: 有效队列 = max(最大队列, 乘数 x 可用账号数)，0 = 固定模式
                    </p>
                  </div>
                </div>
                </>
              )}

              {/* 开关配置 */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>启用多账号轮询</Label>
                    <p className="text-sm text-muted-foreground">
                      开启后将在多个账号之间轮询分配请求
                    </p>
                  </div>
                  <Switch
                    checked={localConfig.multiAccountEnabled ?? config?.multiAccountEnabled ?? false}
                    onCheckedChange={(checked) =>
                      setLocalConfig({ ...localConfig, multiAccountEnabled: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>额度耗尽自动切换</Label>
                    <p className="text-sm text-muted-foreground">
                      当前账号额度耗尽时自动切换到下一个账号
                    </p>
                  </div>
                  <Switch
                    checked={localConfig.autoSwitchOnQuotaExhausted ?? config?.autoSwitchOnQuotaExhausted ?? false}
                    onCheckedChange={(checked) =>
                      setLocalConfig({ ...localConfig, autoSwitchOnQuotaExhausted: checked })
                    }
                  />
                </div>
              </div>

              <Button
                onClick={saveProxyConfig}
                disabled={updateMutation.isPending}
              >
                <Save className="mr-2 h-4 w-4" />
                {updateMutation.isPending ? "保存中..." : "保存配置"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 限流配置 */}
        <TabsContent value="ratelimit">
          <Card>
            <CardHeader>
              <CardTitle>限流配置</CardTitle>
              <CardDescription>
                配置 API 请求频率限制
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>启用限流</Label>
                  <p className="text-sm text-muted-foreground">
                    开启后将限制 API 请求频率
                  </p>
                </div>
                <Switch
                  checked={localConfig.rateLimitEnabled ?? config?.rateLimitEnabled}
                  onCheckedChange={(checked) =>
                    setLocalConfig({ ...localConfig, rateLimitEnabled: checked })
                  }
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="rateLimitMax">最大请求数</Label>
                  <Input
                    id="rateLimitMax"
                    type="number"
                    value={localConfig.rateLimitMax ?? config?.rateLimitMax ?? 100}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        rateLimitMax: parseInt(e.target.value),
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    时间窗口内允许的最大请求数
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rateLimitWindow">时间窗口 (毫秒)</Label>
                  <Input
                    id="rateLimitWindow"
                    type="number"
                    value={localConfig.rateLimitWindow ?? config?.rateLimitWindow ?? 60000}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        rateLimitWindow: parseInt(e.target.value),
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    限流时间窗口，默认 60000ms (1分钟)
                  </p>
                </div>
              </div>

              <Button
                onClick={saveRateLimitConfig}
                disabled={updateMutation.isPending}
              >
                <Save className="mr-2 h-4 w-4" />
                {updateMutation.isPending ? "保存中..." : "保存配置"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Token刷新配置 */}
        <TabsContent value="token">
          <Card>
            <CardHeader>
              <CardTitle>Token刷新配置</CardTitle>
              <CardDescription>
                配置 Token 自动刷新的相关参数
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tokenRefreshAdvance">Token刷新提前量 (秒)</Label>
                  <Input
                    id="tokenRefreshAdvance"
                    type="number"
                    value={localConfig.tokenRefreshAdvance ?? config?.tokenRefreshAdvance ?? 300}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        tokenRefreshAdvance: parseInt(e.target.value),
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Token 过期前多少秒开始刷新，默认 300 秒
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="maxRetries">最大重试次数</Label>
                  <Input
                    id="maxRetries"
                    type="number"
                    value={localConfig.maxRetries ?? config?.maxRetries ?? 3}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        maxRetries: parseInt(e.target.value),
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Token 刷新失败时的最大重试次数，默认 3 次
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="retryDelay">重试延迟 (毫秒)</Label>
                  <Input
                    id="retryDelay"
                    type="number"
                    value={localConfig.retryDelay ?? config?.retryDelay ?? 1000}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        retryDelay: parseInt(e.target.value),
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    重试之间的等待时间，默认 1000 毫秒
                  </p>
                </div>
              </div>

              <Button
                onClick={saveTokenConfig}
                disabled={updateMutation.isPending}
              >
                <Save className="mr-2 h-4 w-4" />
                {updateMutation.isPending ? "保存中..." : "保存配置"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 账号池配置 */}
        <TabsContent value="pool">
          <Card>
            <CardHeader>
              <CardTitle>账号池配置</CardTitle>
              <CardDescription>
                配置账号池的错误处理和配额管理
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="errorCooldownTime">错误冷却时间 (毫秒)</Label>
                  <Input
                    id="errorCooldownTime"
                    type="number"
                    value={localConfig.errorCooldownTime ?? config?.errorCooldownTime ?? 60000}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        errorCooldownTime: parseInt(e.target.value),
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    账号出错后的冷却时间，默认 60000 毫秒 (1分钟)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="maxConsecutiveErrors">最大连续错误次数</Label>
                  <Input
                    id="maxConsecutiveErrors"
                    type="number"
                    value={localConfig.maxConsecutiveErrors ?? config?.maxConsecutiveErrors ?? 3}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        maxConsecutiveErrors: parseInt(e.target.value),
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    账号连续出错多少次后暂停使用，默认 3 次
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="quotaResetTime">配额重置时间 (毫秒)</Label>
                  <Input
                    id="quotaResetTime"
                    type="number"
                    value={localConfig.quotaResetTime ?? config?.quotaResetTime ?? 3600000}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        quotaResetTime: parseInt(e.target.value),
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    配额重置的时间间隔，默认 3600000 毫秒 (1小时)
                  </p>
                </div>
              </div>

              {/* 自动停用规则 */}
              <div className="border-t pt-6">
                <h4 className="text-sm font-semibold mb-4">自动停用规则</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  配置触发账号自动暂停的规则，匹配时账号将被自动暂停使用
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="autoStopErrorCodes">触发停用的错误码</Label>
                    <Input
                      id="autoStopErrorCodes"
                      type="text"
                      placeholder="例如：429,403"
                      value={localConfig.autoStopErrorCodes ?? config?.autoStopErrorCodes ?? ""}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          autoStopErrorCodes: e.target.value,
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      逗号分隔的 HTTP 状态码，匹配时自动暂停账号
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="quotaUsageThreshold">配额使用阈值 (%)</Label>
                    <Input
                      id="quotaUsageThreshold"
                      type="number"
                      min={0}
                      max={100}
                      placeholder="0"
                      value={localConfig.quotaUsageThreshold ?? config?.quotaUsageThreshold ?? 0}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          quotaUsageThreshold: parseInt(e.target.value) || 0,
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      配额使用达到此百分比时自动暂停，0 表示不限制
                    </p>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="autoStopErrorPatterns">触发停用的错误消息</Label>
                    <Input
                      id="autoStopErrorPatterns"
                      type="text"
                      placeholder="例如：quota exceeded,rate limit"
                      value={localConfig.autoStopErrorPatterns ?? config?.autoStopErrorPatterns ?? ""}
                      onChange={(e) =>
                        setLocalConfig({
                          ...localConfig,
                          autoStopErrorPatterns: e.target.value,
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      逗号分隔的错误消息匹配模式，包含任一模式时自动暂停账号（不区分大小写）
                    </p>
                  </div>
                </div>
              </div>

              {/* Webhook 告警 */}
              <div className="border-t pt-6">
                <h4 className="text-sm font-semibold mb-4">Webhook 告警</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  事件驱动的多平台推送通知，支持飞书、钉钉、企微、Slack、Discord 等
                </p>

                {webhookConfig && (
                  <div className="space-y-4">
                    {/* 全局开关 */}
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>启用 Webhook 通知</Label>
                        <p className="text-sm text-muted-foreground">开启后将根据配置推送告警</p>
                      </div>
                      <Switch
                        checked={webhookConfig.enabled}
                        onCheckedChange={(checked) => setWebhookConfig({ ...webhookConfig, enabled: checked })}
                      />
                    </div>

                    {/* 通知类型 */}
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <Label className="text-xs">账号异常</Label>
                        </div>
                        <Switch
                          checked={webhookConfig.notifyOnAccountError}
                          onCheckedChange={(checked) => setWebhookConfig({ ...webhookConfig, notifyOnAccountError: checked })}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <Label className="text-xs">Token 刷新失败</Label>
                        </div>
                        <Switch
                          checked={webhookConfig.notifyOnTokenRefreshFail}
                          onCheckedChange={(checked) => setWebhookConfig({ ...webhookConfig, notifyOnTokenRefreshFail: checked })}
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-3">
                        <div className="space-y-0.5">
                          <Label className="text-xs">心跳 & 卡死检测</Label>
                        </div>
                        <Switch
                          checked={webhookConfig.notifyHeartbeat}
                          onCheckedChange={(checked) => setWebhookConfig({ ...webhookConfig, notifyHeartbeat: checked })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">用量阈值 (%)</Label>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          placeholder="0 = 不启用"
                          value={webhookConfig.usageThreshold}
                          onChange={(e) => setWebhookConfig({ ...webhookConfig, usageThreshold: parseInt(e.target.value) || 0 })}
                        />
                      </div>
                    </div>

                    {/* 平台列表 */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>推送平台</Label>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setWebhookConfig({
                            ...webhookConfig,
                            platforms: [...webhookConfig.platforms, { platform: "feishu", enabled: true, url: "", label: "" }],
                          })}
                        >
                          <Plus className="mr-1 h-3 w-3" /> 添加平台
                        </Button>
                      </div>

                      {webhookConfig.platforms.map((p, idx) => (
                        <div key={idx} className="rounded-lg border p-3 space-y-3">
                          <div className="flex items-center gap-2">
                            <Select
                              value={p.platform}
                              onValueChange={(val) => {
                                const platforms = [...webhookConfig.platforms]
                                platforms[idx] = { ...p, platform: val as any }
                                setWebhookConfig({ ...webhookConfig, platforms })
                              }}
                            >
                              <SelectTrigger className="w-[130px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="feishu">飞书</SelectItem>
                                <SelectItem value="dingtalk">钉钉</SelectItem>
                                <SelectItem value="wechat_work">企业微信</SelectItem>
                                <SelectItem value="slack">Slack</SelectItem>
                                <SelectItem value="discord">Discord</SelectItem>
                                <SelectItem value="custom">自定义</SelectItem>
                              </SelectContent>
                            </Select>
                            <Input
                              placeholder="标签（可选）"
                              className="w-[120px]"
                              value={p.label ?? ""}
                              onChange={(e) => {
                                const platforms = [...webhookConfig.platforms]
                                platforms[idx] = { ...p, label: e.target.value }
                                setWebhookConfig({ ...webhookConfig, platforms })
                              }}
                            />
                            <Switch
                              checked={p.enabled}
                              onCheckedChange={(checked) => {
                                const platforms = [...webhookConfig.platforms]
                                platforms[idx] = { ...p, enabled: checked }
                                setWebhookConfig({ ...webhookConfig, platforms })
                              }}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => {
                                const platforms = webhookConfig.platforms.filter((_, i) => i !== idx)
                                setWebhookConfig({ ...webhookConfig, platforms })
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <Input
                            placeholder="Webhook URL"
                            value={p.url}
                            onChange={(e) => {
                              const platforms = [...webhookConfig.platforms]
                              platforms[idx] = { ...p, url: e.target.value }
                              setWebhookConfig({ ...webhookConfig, platforms })
                            }}
                          />
                          {(p.platform === "feishu" || p.platform === "dingtalk") && (
                            <Input
                              placeholder="签名密钥（可选）"
                              value={p.secret ?? ""}
                              onChange={(e) => {
                                const platforms = [...webhookConfig.platforms]
                                platforms[idx] = { ...p, secret: e.target.value }
                                setWebhookConfig({ ...webhookConfig, platforms })
                              }}
                            />
                          )}
                        </div>
                      ))}

                      {webhookConfig.platforms.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          暂无推送平台，点击上方按钮添加
                        </p>
                      )}
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex gap-2">
                      <Button onClick={saveWebhookConfig}>
                        <Save className="mr-2 h-4 w-4" />
                        保存 Webhook 配置
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleTestWebhook}
                        disabled={testingWebhook}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        {testingWebhook ? "发送中..." : "测试 Webhook"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <Button
                onClick={savePoolConfig}
                disabled={updateMutation.isPending}
              >
                <Save className="mr-2 h-4 w-4" />
                {updateMutation.isPending ? "保存中..." : "保存配置"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 高级配置 */}
        <TabsContent value="advanced">
          <Card>
            <CardHeader>
              <CardTitle>高级配置</CardTitle>
              <CardDescription>
                配置工具调用、端点选择和日志记录
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 开关配置 */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>禁用工具调用</Label>
                    <p className="text-sm text-muted-foreground">
                      禁用 AI 模型的工具调用功能
                    </p>
                  </div>
                  <Switch
                    checked={localConfig.disableToolCalls ?? config?.disableToolCalls ?? false}
                    onCheckedChange={(checked) =>
                      setLocalConfig({ ...localConfig, disableToolCalls: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>记录请求日志</Label>
                    <p className="text-sm text-muted-foreground">
                      记录所有 API 请求的详细日志
                    </p>
                  </div>
                  <Switch
                    checked={localConfig.enableRequestLogging ?? config?.enableRequestLogging ?? false}
                    onCheckedChange={(checked) =>
                      setLocalConfig({ ...localConfig, enableRequestLogging: checked })
                    }
                  />
                </div>
              </div>

              {/* 数值和选择配置 */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="defaultRegion">默认 Region</Label>
                  <Input
                    id="defaultRegion"
                    type="text"
                    placeholder="us-east-1"
                    value={localConfig.defaultRegion ?? config?.defaultRegion ?? "us-east-1"}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        defaultRegion: e.target.value,
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    API 端点的默认 AWS Region，账号自身 region 优先
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="toolCallAutoRounds">工具调用自动继续轮数</Label>
                  <Input
                    id="toolCallAutoRounds"
                    type="number"
                    value={localConfig.toolCallAutoRounds ?? config?.toolCallAutoRounds ?? 0}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        toolCallAutoRounds: parseInt(e.target.value),
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    工具调用后自动继续的轮数，0 表示不自动继续
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="preferredEndpoint">首选端点</Label>
                  <Select
                    value={localConfig.preferredEndpoint ?? config?.preferredEndpoint ?? "codewhisperer"}
                    onValueChange={(value: 'codewhisperer' | 'amazonq') =>
                      setLocalConfig({
                        ...localConfig,
                        preferredEndpoint: value,
                      })
                    }
                  >
                    <SelectTrigger id="preferredEndpoint">
                      <SelectValue placeholder="选择首选端点" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="codewhisperer">CodeWhisperer</SelectItem>
                      <SelectItem value="amazonq">Amazon Q</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    优先使用的 API 端点
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="testModelId">测试/验证模型 ID</Label>
                  <Input
                    id="testModelId"
                    type="text"
                    placeholder="claude-sonnet-4.5"
                    value={localConfig.testModelId ?? config?.testModelId ?? "claude-sonnet-4.5"}
                    onChange={(e) =>
                      setLocalConfig({
                        ...localConfig,
                        testModelId: e.target.value,
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    账号连通性测试和 Token 刷新后验证使用的模型 ID
                  </p>
                </div>
              </div>

              <Button
                onClick={saveAdvancedConfig}
                disabled={updateMutation.isPending}
              >
                <Save className="mr-2 h-4 w-4" />
                {updateMutation.isPending ? "保存中..." : "保存配置"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 修改密码 */}
        <TabsContent value="password">
          <Card>
            <CardHeader>
              <CardTitle>修改密码</CardTitle>
              <CardDescription>
                更新您的登录密码
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 max-w-md">
                <div className="space-y-2">
                  <Label htmlFor="oldPassword">旧密码</Label>
                  <Input
                    id="oldPassword"
                    type="password"
                    placeholder="请输入旧密码"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="newPassword">新密码</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    placeholder="请输入新密码（至少 6 位）"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">确认新密码</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="请再次输入新密码"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <Button
                onClick={handleUpdatePassword}
                disabled={updatePasswordMutation.isPending}
              >
                <Lock className="mr-2 h-4 w-4" />
                {updatePasswordMutation.isPending ? "修改中..." : "修改密码"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
