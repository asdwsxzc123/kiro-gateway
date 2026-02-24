import { useState, useEffect } from "react"
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
import { useToast } from "@/hooks/use-toast"
import { getAccount, updateAccount } from "@/api/accounts"
import type { AddAccountRequest, Account, AccountStatus } from "@kiro-gateway/shared"
import { REGION_GROUPS, ALL_REGION_VALUES } from "./region-data"

// 编辑表单数据类型
interface EditFormData {
  alias: string
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
  status: AccountStatus
  maxConcurrency: number
  proxyUrl: string
}

// 初始编辑表单数据
const initialEditForm: EditFormData = {
  alias: "",
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
  status: "active",
  maxConcurrency: 0,
  proxyUrl: "",
}

interface EditAccountDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: Account | null
}

export function EditAccountDialog({ open, onOpenChange, account }: EditAccountDialogProps) {
  const [editForm, setEditForm] = useState<EditFormData>(initialEditForm)
  const [isLoading, setIsLoading] = useState(false)

  const { toast } = useToast()
  const queryClient = useQueryClient()

  // 对话框打开时，获取完整账号信息并填充表单
  useEffect(() => {
    if (!open || !account) return

    setIsLoading(true)
    getAccount(account.id)
      .then((fullAccount) => {
        setEditForm({
          alias: fullAccount.alias || "",
          email: fullAccount.email || "",
          userId: fullAccount.userId || "",
          accessToken: fullAccount.accessToken || "",
          refreshToken: fullAccount.refreshToken || "",
          clientId: fullAccount.clientId || "",
          clientSecret: fullAccount.clientSecret || "",
          region: fullAccount.region || "",
          authMethod: fullAccount.authMethod || "social",
          provider: fullAccount.provider || "",
          profileArn: fullAccount.profileArn || "",
          machineId: fullAccount.machineId || "",
          status: fullAccount.status ?? "active",
          maxConcurrency: fullAccount.maxConcurrency ?? 0,
          proxyUrl: fullAccount.proxyUrl || "",
        })
      })
      .catch((error) => {
        toast({
          title: "获取账号详情失败",
          description: (error as Error).message,
          variant: "destructive",
        })
        onOpenChange(false)
      })
      .finally(() => setIsLoading(false))
  }, [open, account?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AddAccountRequest> }) =>
      updateAccount(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] })
      onOpenChange(false)
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

  /** 提交更新 */
  const handleUpdateAccount = () => {
    if (!account) return

    const updateData: Partial<AddAccountRequest> = {
      alias: editForm.alias || undefined,
      email: editForm.email || undefined,
      region: editForm.region || undefined,
      authMethod: editForm.authMethod,
      provider: editForm.provider || undefined,
      profileArn: editForm.profileArn || undefined,
      machineId: editForm.machineId || undefined,
      accessToken: editForm.accessToken || undefined,
      refreshToken: editForm.refreshToken || undefined,
      clientId: editForm.clientId || undefined,
      clientSecret: editForm.clientSecret || undefined,
      maxConcurrency: editForm.maxConcurrency || undefined,
      proxyUrl: editForm.proxyUrl || undefined,
    }

    updateMutation.mutate({ id: account.id, data: updateData })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑账号</DialogTitle>
          <DialogDescription>
            修改账号信息。敏感字段（Token、Secret）留空表示不修改。
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">加载账号详情...</div>
        ) : (
          <div className="grid gap-4 py-4">
            {/* 别名 */}
            <div className="grid gap-2">
              <Label htmlFor="edit-alias">别名 (可选)</Label>
              <Input
                id="edit-alias"
                placeholder="输入账号别名"
                value={editForm.alias}
                onChange={(e) =>
                  setEditForm({ ...editForm, alias: e.target.value })
                }
              />
            </div>

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
                <div className="flex gap-2">
                  <Select
                    value={ALL_REGION_VALUES.includes(editForm.region as typeof ALL_REGION_VALUES[number]) ? editForm.region : ""}
                    onValueChange={(value) =>
                      setEditForm({ ...editForm, region: value })
                    }
                  >
                    <SelectTrigger className="w-[200px]">
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
                    id="edit-region"
                    placeholder="例如：us-east-1"
                    value={editForm.region}
                    onChange={(e) =>
                      setEditForm({ ...editForm, region: e.target.value })
                    }
                    className="flex-1"
                  />
                </div>
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

            {/* 代理 IP */}
            <div className="grid gap-2">
              <Label htmlFor="edit-proxyUrl">代理 IP</Label>
              <Input
                id="edit-proxyUrl"
                placeholder="http://user:pass@host:port"
                value={editForm.proxyUrl}
                onChange={(e) =>
                  setEditForm({ ...editForm, proxyUrl: e.target.value })
                }
              />
            </div>

            {/* 最大并发数 */}
            <div className="grid gap-2">
              <Label htmlFor="edit-maxConcurrency">最大并发数</Label>
              <Input
                id="edit-maxConcurrency"
                type="number"
                min={0}
                placeholder="0 表示不限制"
                value={editForm.maxConcurrency}
                onChange={(e) =>
                  setEditForm({ ...editForm, maxConcurrency: parseInt(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-muted-foreground">
                单账号最大并发请求数，0 表示不限制
              </p>
            </div>

            {/* 分隔线 */}
            <div className="border-t pt-4 mt-2">
              <p className="text-sm text-muted-foreground mb-4">
                以下为敏感字段（明文显示，可直接编辑）
              </p>
            </div>

            {/* Access Token */}
            <div className="grid gap-2">
              <Label htmlFor="edit-accessToken">Access Token</Label>
              <Input
                id="edit-accessToken"
                type="text"
                placeholder="Access Token"
                value={editForm.accessToken}
                onChange={(e) =>
                  setEditForm({ ...editForm, accessToken: e.target.value })
                }
                className="font-mono text-xs"
              />
            </div>

            {/* Refresh Token */}
            <div className="grid gap-2">
              <Label htmlFor="edit-refreshToken">Refresh Token</Label>
              <Input
                id="edit-refreshToken"
                type="text"
                placeholder="Refresh Token"
                value={editForm.refreshToken}
                onChange={(e) =>
                  setEditForm({ ...editForm, refreshToken: e.target.value })
                }
                className="font-mono text-xs"
              />
            </div>

            {/* Client ID 和 Client Secret */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-clientId">Client ID</Label>
                <Input
                  id="edit-clientId"
                  type="text"
                  placeholder="Client ID"
                  value={editForm.clientId}
                  onChange={(e) =>
                    setEditForm({ ...editForm, clientId: e.target.value })
                  }
                  className="font-mono text-xs"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-clientSecret">Client Secret</Label>
                <Input
                  id="edit-clientSecret"
                  type="text"
                  placeholder="Client Secret"
                  value={editForm.clientSecret}
                  onChange={(e) =>
                    setEditForm({ ...editForm, clientSecret: e.target.value })
                  }
                  className="font-mono text-xs"
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            onClick={handleUpdateAccount}
            disabled={updateMutation.isPending || isLoading}
          >
            {updateMutation.isPending ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
