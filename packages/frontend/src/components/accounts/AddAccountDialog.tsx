import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { addAccount } from "@/api/accounts"
import type { AddAccountRequest } from "@kiro-gateway/shared"
import { REGION_GROUPS, ALL_REGION_VALUES } from "./region-data"

// 导入模式类型
type ImportMode = "oidc" | "sso" | "manual"

// Provider 类型
type ProviderType = "BuilderId" | "Enterprise" | "Github" | "Google" | "IAM_SSO"

// OIDC 表单数据类型
interface OidcFormData {
  alias: string
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
  alias: string
  ssoTokens: string
  region: string
}

// 初始 OIDC 表单数据
const initialOidcForm: OidcFormData = {
  alias: "",
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
  alias: "",
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
  proxyUrl: "",
}

interface AddAccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultBatchImportConcurrency?: number
}

export function AddAccountDialog({
  open,
  onOpenChange,
  defaultBatchImportConcurrency = 0,
}: AddAccountDialogProps) {
  const [importMode, setImportMode] = useState<ImportMode>("oidc")
  const [oidcForm, setOidcForm] = useState<OidcFormData>(initialOidcForm)
  const [ssoForm, setSsoForm] = useState<SsoFormData>(initialSsoForm)
  const [oidcBatchInput, setOidcBatchInput] = useState("")
  const [manualForm, setManualForm] = useState<AddAccountRequest>(initialManualForm)
  const [isBatchImporting, setIsBatchImporting] = useState(false)

  const { toast } = useToast()
  const queryClient = useQueryClient()
  const resetForms = () => {
    setOidcForm(initialOidcForm)
    setOidcBatchInput("")
    setSsoForm(initialSsoForm)
    setManualForm(initialManualForm)
  }

  const addMutation = useMutation({
    mutationFn: addAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] })
      onOpenChange(false)
      resetForms()
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

  const runBatchImport = async (requests: AddAccountRequest[]) => {
    if (requests.length === 0) return

    setIsBatchImporting(true)
    const concurrency = Math.max(1, defaultBatchImportConcurrency || 8)
    const workerCount = Math.min(concurrency, requests.length)
    let nextIndex = 0
    let success = 0
    const errors: string[] = []

    const worker = async () => {
      while (true) {
        const currentIndex = nextIndex++
        if (currentIndex >= requests.length) return
        try {
          await addAccount(requests[currentIndex])
          success += 1
        } catch (error) {
          const message = error instanceof Error ? error.message : "未知错误"
          errors.push(`第 ${currentIndex + 1} 条失败: ${message}`)
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    queryClient.invalidateQueries({ queryKey: ["accounts"] })

    setIsBatchImporting(false)

    if (errors.length === 0) {
      onOpenChange(false)
      resetForms()
      toast({
        title: "批量导入完成",
        description: `成功导入 ${success} 个账号（并发 ${workerCount}）`,
      })
      return
    }

    toast({
      title: success > 0 ? "批量导入部分完成" : "批量导入失败",
      description: `成功 ${success}，失败 ${errors.length}`,
      variant: "destructive",
    })
  }

  /**
   * 解析 OIDC 批量粘贴的单行数据
   * 格式: accessToken----refreshToken----clientId----clientSecret----region
   */
  const parseOidcBatchLine = (line: string): AddAccountRequest | null => {
    const parts = line.split("----").map((p) => p.trim())
    if (parts.length < 2) return null
    return {
      accessToken: parts[0] || "",
      refreshToken: parts[1] || undefined,
      clientId: parts[2] || undefined,
      clientSecret: parts[3] || undefined,
      region: parts[4] || "us-east-1",
      authMethod: "idc",
      provider: "Enterprise",
      maxConcurrency: defaultBatchImportConcurrency,
    }
  }

  /**
   * 尝试解析 JSON 格式的账号数据
   * 支持 JSON 数组 [{refreshToken, clientId, clientSecret, region, provider, machineId, ...}]
   * 兼容 .account.txt 导出格式
   * @returns 解析成功返回 AddAccountRequest[]，失败返回 null
   */
  const parseJsonAccounts = (text: string): AddAccountRequest[] | null => {
    try {
      const trimmed = text.trim()
      if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return null

      const parsed = JSON.parse(trimmed)
      const items = Array.isArray(parsed) ? parsed : [parsed]

      if (items.length === 0) return null

      // 验证至少有 refreshToken 或 accessToken
      const valid = items.every(
        (item: Record<string, unknown>) => item.refreshToken || item.accessToken
      )
      if (!valid) return null

      return items.map((item: Record<string, unknown>) => ({
        accessToken: (item.accessToken as string) || "",
        refreshToken: (item.refreshToken as string) || undefined,
        clientId: (item.clientId as string) || undefined,
        clientSecret: (item.clientSecret as string) || undefined,
        region: (item.region as string) || "us-east-1",
        authMethod: (item.startUrl ? "idc" : (item.authMethod as "social" | "idc")) || "idc",
        provider: (item.provider as string) || "Enterprise",
        machineId: (item.machineId as string) || undefined,
        email: (item.email as string) || undefined,
        proxyUrl: (item.proxyUrl as string) || undefined,
        maxConcurrency: item.maxConcurrency != null ? Number(item.maxConcurrency) : defaultBatchImportConcurrency,
      }))
    } catch {
      return null
    }
  }

  /**
   * 处理 OIDC 批量粘贴输入变化
   * 自动检测 JSON 格式或 ---- 分隔格式
   * 单条记录时自动填充表单字段
   */
  const handleOidcBatchChange = (text: string) => {
    setOidcBatchInput(text)

    // 优先尝试 JSON 格式解析
    const jsonAccounts = parseJsonAccounts(text)
    if (jsonAccounts) {
      if (jsonAccounts.length === 1) {
        // JSON 单条记录时自动填充表单
        const item = jsonAccounts[0]
        setOidcForm({
          ...oidcForm,
          authMethod: (item.authMethod as "social" | "idc") || "idc",
          provider: (item.provider as ProviderType) || "Enterprise",
          refreshToken: item.refreshToken || "",
          clientId: item.clientId || "",
          clientSecret: item.clientSecret || "",
          region: item.region || "us-east-1",
        })
      } else {
        // 多条记录时取第一条的 region 填充到表单
        const firstRegion = jsonAccounts[0]?.region
        if (firstRegion) {
          setOidcForm((prev) => ({ ...prev, region: firstRegion }))
        }
      }
      return
    }

    // 回退到 ---- 分隔格式
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    // 单行时自动填充到表单
    if (lines.length === 1) {
      const parsed = parseOidcBatchLine(lines[0])
      if (parsed) {
        setOidcForm({
          ...oidcForm,
          authMethod: "idc",
          provider: "Enterprise",
          refreshToken: parsed.refreshToken || "",
          clientId: parsed.clientId || "",
          clientSecret: parsed.clientSecret || "",
          region: parsed.region || "us-east-1",
        })
      }
    }
  }

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
   *
   * BUG FIX: 单条 JSON 粘贴时走表单提交路径，确保用户修改的 region 等字段生效。
   * 只有多条 JSON (length > 1) 才走批量路径直接使用解析数据。
   */
  const handleAddAccount = async () => {
    if (importMode === "oidc") {
      // 优先尝试 JSON 格式批量导入（仅多条时走批量路径）
      const jsonAccounts = parseJsonAccounts(oidcBatchInput)
      if (jsonAccounts && jsonAccounts.length > 1) {
        await runBatchImport(jsonAccounts)
        return
      }

      // 回退到 ---- 分隔格式的批量导入
      const batchLines = oidcBatchInput
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && l.includes("----"))

      if (batchLines.length > 1) {
        // 多行批量导入
        const batchRequests: AddAccountRequest[] = []
        let hasParseError = false
        for (const line of batchLines) {
          const parsed = parseOidcBatchLine(line)
          if (parsed) {
            batchRequests.push(parsed)
          } else {
            hasParseError = true
          }
        }
        if (hasParseError) {
          toast({
            title: "部分解析失败",
            description: "存在格式不正确的行，已跳过",
            variant: "destructive",
          })
        }
        await runBatchImport(batchRequests)
        return
      }

      // 单账号 OIDC 凭证模式（包括单条 JSON 粘贴后用户可能修改的表单数据）
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
        alias: oidcForm.alias || undefined,
        maxConcurrency: defaultBatchImportConcurrency,
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
      const requests: AddAccountRequest[] = tokens.map((token) => ({
          accessToken: token,
          authMethod: "social",
          region: ssoForm.region,
          alias: ssoForm.alias || undefined,
          maxConcurrency: defaultBatchImportConcurrency,
        }))
      await runBatchImport(requests)
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

  /** 渲染 OIDC 凭证模式表单 */
  const renderOidcForm = () => (
    <div className="grid gap-4">
      {/* 批量粘贴区域 */}
      <div className="grid gap-2">
        <Label htmlFor="oidc-batch">批量粘贴 (OIDC)</Label>
        <textarea
          id="oidc-batch"
          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder={"支持两种格式:\n1. JSON: [{\"refreshToken\":\"...\",\"clientId\":\"...\",\"clientSecret\":\"...\",\"region\":\"...\"}]\n2. 分隔符: accessToken----refreshToken----clientId----clientSecret----region"}
          value={oidcBatchInput}
          onChange={(e) => handleOidcBatchChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          支持 JSON 数组格式（如 .account.txt）或 ---- 分隔格式。单条记录自动填充下方表单，多条直接批量导入。
        </p>
      </div>

      {/* 分隔线 */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">或手动填写</span>
        </div>
      </div>

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
        <div className="flex gap-2">
          <Select
            value={ALL_REGION_VALUES.includes(oidcForm.region as typeof ALL_REGION_VALUES[number]) ? oidcForm.region : ""}
            onValueChange={(value) =>
              setOidcForm({ ...oidcForm, region: value })
            }
          >
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="快捷选择 Region" />
            </SelectTrigger>
            <SelectContent>
              {REGION_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.regions.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <Input
            id="oidc-region"
            placeholder="默认: us-east-1"
            value={oidcForm.region}
            onChange={(e) =>
              setOidcForm({ ...oidcForm, region: e.target.value })
            }
            className="flex-1"
          />
        </div>
      </div>

      {/* 别名 */}
      <div className="grid gap-2">
        <Label htmlFor="oidc-alias">别名 (可选)</Label>
        <Input
          id="oidc-alias"
          placeholder="输入账号别名"
          value={oidcForm.alias}
          onChange={(e) =>
            setOidcForm({ ...oidcForm, alias: e.target.value })
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

  /** 渲染 SSO Token 模式表单 */
  const renderSsoForm = () => (
    <div className="grid gap-4">
      {/* 别名 */}
      <div className="grid gap-2">
        <Label htmlFor="sso-alias">别名 (可选)</Label>
        <Input
          id="sso-alias"
          placeholder="输入账号别名"
          value={ssoForm.alias}
          onChange={(e) =>
            setSsoForm({ ...ssoForm, alias: e.target.value })
          }
        />
      </div>

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
        <div className="flex gap-2">
          <Select
            value={ALL_REGION_VALUES.includes(ssoForm.region as typeof ALL_REGION_VALUES[number]) ? ssoForm.region : ""}
            onValueChange={(value) =>
              setSsoForm({ ...ssoForm, region: value })
            }
          >
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="快捷选择 Region" />
            </SelectTrigger>
            <SelectContent>
              {REGION_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.regions.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <Input
            id="sso-region"
            placeholder="例如：us-east-1"
            value={ssoForm.region}
            onChange={(e) =>
              setSsoForm({ ...ssoForm, region: e.target.value })
            }
            className="flex-1"
          />
        </div>
      </div>
    </div>
  )

  /** 渲染手动输入模式表单 */
  const renderManualForm = () => (
    <div className="grid gap-4">
      {/* 别名 */}
      <div className="grid gap-2">
        <Label htmlFor="manual-alias">别名 (可选)</Label>
        <Input
          id="manual-alias"
          placeholder="输入账号别名"
          value={manualForm.alias || ""}
          onChange={(e) =>
            setManualForm({ ...manualForm, alias: e.target.value })
          }
        />
      </div>

      {/* Access Token */}
      <div className="grid gap-2">
        <Label htmlFor="manual-accessToken">Access Token *</Label>
        <Input
          id="manual-accessToken"
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
          <Select
            value={ALL_REGION_VALUES.includes(manualForm.region as typeof ALL_REGION_VALUES[number]) ? manualForm.region || "" : ""}
            onValueChange={(value) =>
              setManualForm({ ...manualForm, region: value })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="快捷选择 Region" />
            </SelectTrigger>
            <SelectContent>
              {REGION_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.regions.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <Input
            id="manual-region"
            placeholder="或手动输入 Region"
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

      {/* 代理 IP */}
      <div className="grid gap-2">
        <Label htmlFor="manual-proxyUrl">代理 IP (可选)</Label>
        <Input
          id="manual-proxyUrl"
          placeholder="http://user:pass@host:port"
          value={manualForm.proxyUrl || ""}
          onChange={(e) =>
            setManualForm({ ...manualForm, proxyUrl: e.target.value })
          }
        />
      </div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            onClick={handleAddAccount}
            disabled={addMutation.isPending || isBatchImporting}
          >
            {isBatchImporting ? "导入中..." : addMutation.isPending ? "添加中..." : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
