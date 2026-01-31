import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2, RefreshCw, TestTube, Pencil, BarChart3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import {
  getAccounts,
  addAccount,
  updateAccount,
  deleteAccount,
  refreshAccountToken,
  testAccount,
  getAllAccountsUsage,
} from "@/api/accounts"
import type { AddAccountRequest, Account, AccountUsage } from "@kiro-gateway/shared"

// 导入模式类型
type ImportMode = "oidc" | "sso" | "manual"

// Provider 类型
type ProviderType = "BuilderId" | "Enterprise" | "Github" | "Google" | "IAM_SSO"

// OIDC 表单数据类型
interface OidcFormData {
  authMethod: "social" | "idc"
  provider: ProviderType
  refreshToken: string
  clientId: string
  clientSecret: string
  region: string
  email: string
}

// SSO 表单数据类型
interface SsoFormData {
  ssoTokens: string // 批量 token，每行一个
  region: string
}

// 初始 OIDC 表单数据
const initialOidcForm: OidcFormData = {
  authMethod: "idc",
  provider: "Enterprise",
  refreshToken: "",
  clientId: "",
  clientSecret: "",
  region: "us-east-1",
  email: "",
}

// 初始 SSO 表单数据
const initialSsoForm: SsoFormData = {
  ssoTokens: "",
  region: "us-east-1",
}

// 初始手动输入表单数据
const initialManualForm: AddAccountRequest = {
  accessToken: "",
  email: "",
  authMethod: "social",
  clientId: "",
  clientSecret: "",
  region: "",
  provider: "",
  profileArn: "",
  refreshToken: "",
}

// 编辑表单数据类型（所有字段可选，只提交修改的字段）
interface EditFormData {
  email: string
  userId: string
  accessToken: string
  refreshToken: string
  clientId: string
  clientSecret: string
  region: string
  authMethod: "social" | "idc"
  provider: string
  profileArn: string
  machineId: string
  isAvailable: boolean
}

// 初始编辑表单数据
const initialEditForm: EditFormData = {
  email: "",
  userId: "",
  accessToken: "",
  refreshToken: "",
  clientId: "",
  clientSecret: "",
  region: "",
  authMethod: "social",
  provider: "",
  profileArn: "",
  machineId: "",
  isAvailable: true,
}

/**
 * Accounts 页面 - 账号管理
 * 支持添加、删除、刷新 Token 等操作
 */
export function Accounts() {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  // 编辑对话框状态
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  // 当前编辑的账号
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  // 编辑表单数据
  const [editForm, setEditForm] = useState<EditFormData>(initialEditForm)
  // 导入模式状态
  const [importMode, setImportMode] = useState<ImportMode>("oidc")
  // OIDC 表单数据
  const [oidcForm, setOidcForm] = useState<OidcFormData>(initialOidcForm)
  // SSO 表单数据
  const [ssoForm, setSsoForm] = useState<SsoFormData>(initialSsoForm)
  // 手动输入表单数据
  const [manualForm, setManualForm] = useState<AddAccountRequest>(initialManualForm)

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

  // 根据账号 ID 获取使用量数据
  const getUsageForAccount = (accountId: string): AccountUsage | undefined => {
    return usageData?.find(u => u.accountId === accountId)
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

  // 添加账号
  const addMutation = useMutation({
    mutationFn: addAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] })
      setIsAddDialogOpen(false)
      // 重置所有表单
      setOidcForm(initialOidcForm)
      setSsoForm(initialSsoForm)
      setManualForm(initialManualForm)
      toast({ title: "添加成功", description: "账号已成功添加" })
    },
    onError: (error: Error) => {
      toast({
        title: "添加失败",
        description: error.message,
        variant: "destructive",
      })
    },
  })

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
      // 显示测试结果：模型和响应内容
      toast({
        title: "测试成功",
        description: `模型: ${data.model}\n响应: ${data.response.slice(0, 100)}${data.response.length > 100 ? '...' : ''}`,
      })
    },
    onError: (error: Error) => {
      toast({
        title: "测试失败",
        description: error.message,
        variant: "destructive",
      })
    },
  })

  // 更新账号
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AddAccountRequest> }) =>
      updateAccount(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] })
      setIsEditDialogOpen(false)
      setEditingAccount(null)
      setEditForm(initialEditForm)
      toast({ title: "更新成功", description: "账号信息已更新" })
    },
    onError: (error: Error) => {
      toast({
        title: "更新失败",
        description: error.message,
        variant: "destructive",
      })
    },
  })

  /**
   * 验证 OIDC 表单
   * @returns 错误信息，如果验证通过返回 null
   */
  const validateOidcForm = (): string | null => {
    if (!oidcForm.refreshToken) {
      return "Refresh Token 不能为空"
    }
    // IdC 模式需要 clientId 和 clientSecret
    if (oidcForm.authMethod === "idc") {
      if (!oidcForm.clientId) {
        return "IdC 模式需要填写 Client ID"
      }
      if (!oidcForm.clientSecret) {
        return "IdC 模式需要填写 Client Secret"
      }
    }
    return null
  }

  /**
   * 验证 SSO 表单
   * @returns 错误信息，如果验证通过返回 null
   */
  const validateSsoForm = (): string | null => {
    if (!ssoForm.ssoTokens.trim()) {
      return "SSO Token 不能为空"
    }
    if (!ssoForm.region) {
      return "Region 不能为空"
    }
    return null
  }

  /**
   * 验证手动输入表单
   * @returns 错误信息，如果验证通过返回 null
   */
  const validateManualForm = (): string | null => {
    if (!manualForm.accessToken) {
      return "Access Token 不能为空"
    }
    return null
  }

  /**
   * 处理添加账号
   * 根据不同的导入模式执行不同的验证和提交逻辑
   */
  const handleAddAccount = async () => {
    if (importMode === "oidc") {
      // OIDC 凭证模式
      const error = validateOidcForm()
      if (error) {
        toast({ title: "请填写完整信息", description: error, variant: "destructive" })
        return
      }
      // 构建请求数据
      const request: AddAccountRequest = {
        accessToken: "", // OIDC 模式不需要 accessToken，后端会通过 refreshToken 获取
        refreshToken: oidcForm.refreshToken,
        authMethod: oidcForm.authMethod,
        provider: oidcForm.provider,
        clientId: oidcForm.clientId || undefined,
        clientSecret: oidcForm.clientSecret || undefined,
        region: oidcForm.region || "us-east-1",
        email: oidcForm.email || undefined,
      }
      addMutation.mutate(request)
    } else if (importMode === "sso") {
      // SSO Token 模式 - 支持批量导入
      const error = validateSsoForm()
      if (error) {
        toast({ title: "请填写完整信息", description: error, variant: "destructive" })
        return
      }
      // 解析批量 token（每行一个）
      const tokens = ssoForm.ssoTokens
        .split("\n")
        .map(t => t.trim())
        .filter(t => t.length > 0)

      if (tokens.length === 0) {
        toast({ title: "请填写完整信息", description: "SSO Token 不能为空", variant: "destructive" })
        return
      }

      // 批量添加账号
      for (const token of tokens) {
        const request: AddAccountRequest = {
          accessToken: token,
          authMethod: "social",
          region: ssoForm.region,
        }
        addMutation.mutate(request)
      }
    } else {
      // 手动输入模式
      const error = validateManualForm()
      if (error) {
        toast({ title: "请填写完整信息", description: error, variant: "destructive" })
        return
      }
      addMutation.mutate(manualForm)
    }
  }

  /**
   * 打开编辑对话框
   * 预填充非敏感字段，敏感字段（token、secret）留空
   */
  const handleOpenEditDialog = (account: Account) => {
    setEditingAccount(account)
    // 只预填充非敏感字段
    setEditForm({
      email: account.email || "",
      userId: account.userId || "",
      accessToken: "", // 敏感信息不显示
      refreshToken: "", // 敏感信息不显示
      clientId: "", // 敏感信息不显示
      clientSecret: "", // 敏感信息不显示
      region: account.region || "",
      authMethod: account.authMethod || "social",
      provider: account.provider || "",
      profileArn: account.profileArn || "",
      machineId: account.machineId || "",
      isAvailable: account.isAvailable ?? true,
    })
    setIsEditDialogOpen(true)
  }

  /**
   * 处理更新账号
   * 只提交有值的字段
   */
  const handleUpdateAccount = () => {
    if (!editingAccount) return

    // 构建更新数据，只包含有值的字段
    const updateData: Partial<AddAccountRequest> = {}

    // 非敏感字段：始终更新
    if (editForm.email !== (editingAccount.email || "")) {
      updateData.email = editForm.email || undefined
    }
    if (editForm.region !== (editingAccount.region || "")) {
      updateData.region = editForm.region || undefined
    }
    if (editForm.authMethod !== (editingAccount.authMethod || "social")) {
      updateData.authMethod = editForm.authMethod
    }
    if (editForm.provider !== (editingAccount.provider || "")) {
      updateData.provider = editForm.provider || undefined
    }
    if (editForm.profileArn !== (editingAccount.profileArn || "")) {
      updateData.profileArn = editForm.profileArn || undefined
    }
    if (editForm.machineId !== (editingAccount.machineId || "")) {
      updateData.machineId = editForm.machineId || undefined
    }

    // 敏感字段：只有用户输入了新值才更新
    if (editForm.accessToken) {
      updateData.accessToken = editForm.accessToken
    }
    if (editForm.refreshToken) {
      updateData.refreshToken = editForm.refreshToken
    }
    if (editForm.clientId) {
      updateData.clientId = editForm.clientId
    }
    if (editForm.clientSecret) {
      updateData.clientSecret = editForm.clientSecret
    }

    // 如果没有任何更新，直接关闭对话框
    if (Object.keys(updateData).length === 0) {
      setIsEditDialogOpen(false)
      setEditingAccount(null)
      toast({ title: "提示", description: "没有修改任何内容" })
      return
    }

    updateMutation.mutate({ id: editingAccount.id, data: updateData })
  }

  /**
   * 渲染 OIDC 凭证模式表单
   */
  const renderOidcForm = () => (
    <div className="grid gap-4">
      {/* 认证方式选择 */}
      <div className="grid gap-2">
        <Label htmlFor="oidc-authMethod">认证方式 *</Label>
        <Select
          value={oidcForm.authMethod}
          onValueChange={(value: "social" | "idc") =>
            setOidcForm({ ...oidcForm, authMethod: value })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="选择认证方式" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="social">Social (第三方登录)</SelectItem>
            <SelectItem value="idc">IdC (Identity Center)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Social: 使用 Google/Github 等第三方登录；IdC: 使用 AWS Identity Center
        </p>
      </div>

      {/* Provider 选择 */}
      <div className="grid gap-2">
        <Label htmlFor="oidc-provider">Provider *</Label>
        <Select
          value={oidcForm.provider}
          onValueChange={(value: ProviderType) =>
            setOidcForm({ ...oidcForm, provider: value })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="选择 Provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BuilderId">BuilderId</SelectItem>
            <SelectItem value="Enterprise">Enterprise</SelectItem>
            <SelectItem value="Github">Github</SelectItem>
            <SelectItem value="Google">Google</SelectItem>
            <SelectItem value="IAM_SSO">IAM_SSO</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Refresh Token */}
      <div className="grid gap-2">
        <Label htmlFor="oidc-refreshToken">Refresh Token *</Label>
        <Input
          id="oidc-refreshToken"
          type="password"
          placeholder="请输入 Refresh Token"
          value={oidcForm.refreshToken}
          onChange={(e) =>
            setOidcForm({ ...oidcForm, refreshToken: e.target.value })
          }
        />
        <p className="text-xs text-muted-foreground">
          从 Kiro 客户端获取的 Refresh Token
        </p>
      </div>

      {/* IdC 模式特有字段 */}
      {oidcForm.authMethod === "idc" && (
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="oidc-clientId">Client ID *</Label>
            <Input
              id="oidc-clientId"
              placeholder="请输入 Client ID"
              value={oidcForm.clientId}
              onChange={(e) =>
                setOidcForm({ ...oidcForm, clientId: e.target.value })
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="oidc-clientSecret">Client Secret *</Label>
            <Input
              id="oidc-clientSecret"
              type="password"
              placeholder="请输入 Client Secret"
              value={oidcForm.clientSecret}
              onChange={(e) =>
                setOidcForm({ ...oidcForm, clientSecret: e.target.value })
              }
            />
          </div>
        </div>
      )}

      {/* Region */}
      <div className="grid gap-2">
        <Label htmlFor="oidc-region">Region</Label>
        <Input
          id="oidc-region"
          placeholder="默认: us-east-1"
          value={oidcForm.region}
          onChange={(e) =>
            setOidcForm({ ...oidcForm, region: e.target.value })
          }
        />
      </div>

      {/* Email */}
      <div className="grid gap-2">
        <Label htmlFor="oidc-email">邮箱 (可选)</Label>
        <Input
          id="oidc-email"
          type="email"
          placeholder="用于标识账号"
          value={oidcForm.email}
          onChange={(e) =>
            setOidcForm({ ...oidcForm, email: e.target.value })
          }
        />
      </div>
    </div>
  )

  /**
   * 渲染 SSO Token 模式表单
   */
  const renderSsoForm = () => (
    <div className="grid gap-4">
      {/* SSO Token 批量输入 */}
      <div className="grid gap-2">
        <Label htmlFor="sso-tokens">SSO Token *</Label>
        <textarea
          id="sso-tokens"
          className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="请输入 SSO Token，支持批量导入（每行一个）"
          value={ssoForm.ssoTokens}
          onChange={(e) =>
            setSsoForm({ ...ssoForm, ssoTokens: e.target.value })
          }
        />
        <p className="text-xs text-muted-foreground">
          支持批量导入，每行一个 Token。Token 将作为 Access Token 直接使用。
        </p>
      </div>

      {/* Region */}
      <div className="grid gap-2">
        <Label htmlFor="sso-region">Region *</Label>
        <Input
          id="sso-region"
          placeholder="例如：us-east-1"
          value={ssoForm.region}
          onChange={(e) =>
            setSsoForm({ ...ssoForm, region: e.target.value })
          }
        />
      </div>
    </div>
  )

  /**
   * 渲染手动输入模式表单
   */
  const renderManualForm = () => (
    <div className="grid gap-4">
      {/* Access Token */}
      <div className="grid gap-2">
        <Label htmlFor="manual-accessToken">Access Token *</Label>
        <Input
          id="manual-accessToken"
          type="password"
          placeholder="请输入 Access Token"
          value={manualForm.accessToken}
          onChange={(e) =>
            setManualForm({ ...manualForm, accessToken: e.target.value })
          }
        />
      </div>

      {/* Email */}
      <div className="grid gap-2">
        <Label htmlFor="manual-email">邮箱 (可选)</Label>
        <Input
          id="manual-email"
          type="email"
          placeholder="请输入邮箱"
          value={manualForm.email || ""}
          onChange={(e) =>
            setManualForm({ ...manualForm, email: e.target.value })
          }
        />
      </div>

      {/* Refresh Token */}
      <div className="grid gap-2">
        <Label htmlFor="manual-refreshToken">Refresh Token (可选)</Label>
        <Input
          id="manual-refreshToken"
          type="password"
          placeholder="请输入 Refresh Token"
          value={manualForm.refreshToken || ""}
          onChange={(e) =>
            setManualForm({ ...manualForm, refreshToken: e.target.value })
          }
        />
      </div>

      {/* 认证方式 */}
      <div className="grid gap-2">
        <Label htmlFor="manual-authMethod">认证方式</Label>
        <Select
          value={manualForm.authMethod || "social"}
          onValueChange={(value: "social" | "idc") =>
            setManualForm({ ...manualForm, authMethod: value })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="选择认证方式" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="social">Social</SelectItem>
            <SelectItem value="idc">IDC</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Client ID 和 Client Secret */}
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="manual-clientId">Client ID (可选)</Label>
          <Input
            id="manual-clientId"
            placeholder="请输入 Client ID"
            value={manualForm.clientId || ""}
            onChange={(e) =>
              setManualForm({ ...manualForm, clientId: e.target.value })
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="manual-clientSecret">Client Secret (可选)</Label>
          <Input
            id="manual-clientSecret"
            type="password"
            placeholder="请输入 Client Secret"
            value={manualForm.clientSecret || ""}
            onChange={(e) =>
              setManualForm({ ...manualForm, clientSecret: e.target.value })
            }
          />
        </div>
      </div>

      {/* Region 和 Provider */}
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="manual-region">Region (可选)</Label>
          <Input
            id="manual-region"
            placeholder="例如：us-east-1"
            value={manualForm.region || ""}
            onChange={(e) =>
              setManualForm({ ...manualForm, region: e.target.value })
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="manual-provider">Provider (可选)</Label>
          <Input
            id="manual-provider"
            placeholder="例如：Google"
            value={manualForm.provider || ""}
            onChange={(e) =>
              setManualForm({ ...manualForm, provider: e.target.value })
            }
          />
        </div>
      </div>

      {/* Profile ARN */}
      <div className="grid gap-2">
        <Label htmlFor="manual-profileArn">Profile ARN (可选)</Label>
        <Input
          id="manual-profileArn"
          placeholder="请输入 Profile ARN"
          value={manualForm.profileArn || ""}
          onChange={(e) =>
            setManualForm({ ...manualForm, profileArn: e.target.value })
          }
        />
      </div>
    </div>
  )

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

        {/* 添加账号按钮 */}
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              添加账号
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>添加新账号</DialogTitle>
              <DialogDescription>
                选择导入模式并填写相应信息以添加 Kiro 账号
              </DialogDescription>
            </DialogHeader>

            {/* 导入模式选择 Tabs */}
            <Tabs
              value={importMode}
              onValueChange={(value) => setImportMode(value as ImportMode)}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="oidc">OIDC 凭证</TabsTrigger>
                <TabsTrigger value="sso">SSO Token</TabsTrigger>
                <TabsTrigger value="manual">手动输入</TabsTrigger>
              </TabsList>

              {/* OIDC 凭证模式 */}
              <TabsContent value="oidc" className="mt-4">
                <div className="rounded-lg border p-4 bg-muted/30">
                  <p className="text-sm text-muted-foreground mb-4">
                    使用 OIDC Refresh Token 导入账号，支持 Social 和 IdC 两种认证方式。
                    系统会自动使用 Refresh Token 获取 Access Token。
                  </p>
                  {renderOidcForm()}
                </div>
              </TabsContent>

              {/* SSO Token 模式 */}
              <TabsContent value="sso" className="mt-4">
                <div className="rounded-lg border p-4 bg-muted/30">
                  <p className="text-sm text-muted-foreground mb-4">
                    直接使用 SSO Token 导入账号，支持批量导入（每行一个 Token）。
                    Token 将作为 Access Token 直接使用。
                  </p>
                  {renderSsoForm()}
                </div>
              </TabsContent>

              {/* 手动输入模式 */}
              <TabsContent value="manual" className="mt-4">
                <div className="rounded-lg border p-4 bg-muted/30">
                  <p className="text-sm text-muted-foreground mb-4">
                    手动输入所有账号信息，适用于需要完全控制账号配置的场景。
                  </p>
                  {renderManualForm()}
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter className="mt-4">
              <Button
                variant="outline"
                onClick={() => setIsAddDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                onClick={handleAddAccount}
                disabled={addMutation.isPending}
              >
                {addMutation.isPending ? "添加中..." : "添加"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* 编辑账号对话框 */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑账号</DialogTitle>
            <DialogDescription>
              修改账号信息。敏感字段（Token、Secret）留空表示不修改。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* 邮箱 */}
            <div className="grid gap-2">
              <Label htmlFor="edit-email">邮箱</Label>
              <Input
                id="edit-email"
                type="email"
                placeholder="用于标识账号"
                value={editForm.email}
                onChange={(e) =>
                  setEditForm({ ...editForm, email: e.target.value })
                }
              />
            </div>

            {/* 用户 ID（只读） */}
            <div className="grid gap-2">
              <Label htmlFor="edit-userId">用户 ID</Label>
              <Input
                id="edit-userId"
                placeholder="从 API 自动获取"
                value={editForm.userId}
                disabled
                className="bg-muted"
              />
            </div>

            {/* 认证方式 */}
            <div className="grid gap-2">
              <Label htmlFor="edit-authMethod">认证方式</Label>
              <Select
                value={editForm.authMethod}
                onValueChange={(value: "social" | "idc") =>
                  setEditForm({ ...editForm, authMethod: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择认证方式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="social">Social</SelectItem>
                  <SelectItem value="idc">IDC</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Provider 和 Region */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-provider">Provider</Label>
                <Input
                  id="edit-provider"
                  placeholder="例如：Google"
                  value={editForm.provider}
                  onChange={(e) =>
                    setEditForm({ ...editForm, provider: e.target.value })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-region">Region</Label>
                <Input
                  id="edit-region"
                  placeholder="例如：us-east-1"
                  value={editForm.region}
                  onChange={(e) =>
                    setEditForm({ ...editForm, region: e.target.value })
                  }
                />
              </div>
            </div>

            {/* Profile ARN */}
            <div className="grid gap-2">
              <Label htmlFor="edit-profileArn">Profile ARN</Label>
              <Input
                id="edit-profileArn"
                placeholder="请输入 Profile ARN"
                value={editForm.profileArn}
                onChange={(e) =>
                  setEditForm({ ...editForm, profileArn: e.target.value })
                }
              />
            </div>

            {/* 机器码 */}
            <div className="grid gap-2">
              <Label htmlFor="edit-machineId">机器码</Label>
              <Input
                id="edit-machineId"
                placeholder="账号绑定的机器码"
                value={editForm.machineId}
                onChange={(e) =>
                  setEditForm({ ...editForm, machineId: e.target.value })
                }
              />
            </div>

            {/* 分隔线 */}
            <div className="border-t pt-4 mt-2">
              <p className="text-sm text-muted-foreground mb-4">
                以下为敏感字段，留空表示不修改
              </p>
            </div>

            {/* Access Token */}
            <div className="grid gap-2">
              <Label htmlFor="edit-accessToken">Access Token</Label>
              <Input
                id="edit-accessToken"
                type="password"
                placeholder="留空表示不修改"
                value={editForm.accessToken}
                onChange={(e) =>
                  setEditForm({ ...editForm, accessToken: e.target.value })
                }
              />
            </div>

            {/* Refresh Token */}
            <div className="grid gap-2">
              <Label htmlFor="edit-refreshToken">Refresh Token</Label>
              <Input
                id="edit-refreshToken"
                type="password"
                placeholder="留空表示不修改"
                value={editForm.refreshToken}
                onChange={(e) =>
                  setEditForm({ ...editForm, refreshToken: e.target.value })
                }
              />
            </div>

            {/* Client ID 和 Client Secret */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-clientId">Client ID</Label>
                <Input
                  id="edit-clientId"
                  type="password"
                  placeholder="留空表示不修改"
                  value={editForm.clientId}
                  onChange={(e) =>
                    setEditForm({ ...editForm, clientId: e.target.value })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-clientSecret">Client Secret</Label>
                <Input
                  id="edit-clientSecret"
                  type="password"
                  placeholder="留空表示不修改"
                  value={editForm.clientSecret}
                  onChange={(e) =>
                    setEditForm({ ...editForm, clientSecret: e.target.value })
                  }
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsEditDialogOpen(false)
                setEditingAccount(null)
              }}
            >
              取消
            </Button>
            <Button
              onClick={handleUpdateAccount}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  <TableHead>邮箱/ID</TableHead>
                  <TableHead>订阅类型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>使用量</TableHead>
                  <TableHead>重置时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts?.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">
                      {account.email || account.id.slice(0, 12) + "..."}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{getSubscriptionType(account.id)}</span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                          account.isAvailable
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {account.isAvailable ? "正常" : "不可用"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{formatUsage(account.id)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{getNextResetDate(account.id)}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
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
