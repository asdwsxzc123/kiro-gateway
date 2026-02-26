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
import { useToast } from "@/hooks/use-toast"
import { batchUpdateConcurrency } from "@/api/accounts"

interface BatchConcurrencyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountCount: number
}

export function BatchConcurrencyDialog({
  open,
  onOpenChange,
  accountCount,
}: BatchConcurrencyDialogProps) {
  const [maxConcurrency, setMaxConcurrency] = useState(0)

  const { toast } = useToast()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (value: number) => batchUpdateConcurrency(value),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] })
      onOpenChange(false)
      toast({
        title: "批量修改成功",
        description: `已将 ${data.updated} 个账号的最大并发数设为 ${data.maxConcurrency === 0 ? "不限制" : data.maxConcurrency}`,
      })
    },
    onError: (error: Error) => {
      toast({
        title: "批量修改失败",
        description: error.message,
        variant: "destructive",
      })
    },
  })

  const handleSubmit = () => {
    mutation.mutate(maxConcurrency)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>批量修改并发数</DialogTitle>
          <DialogDescription>
            将所有 {accountCount} 个账号的最大并发数统一修改为指定值。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="batch-maxConcurrency">最大并发数</Label>
            <Input
              id="batch-maxConcurrency"
              type="number"
              min={0}
              placeholder="0 表示不限制"
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(parseInt(e.target.value) || 0)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              单账号最大并发请求数，设为 0 表示不限制
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "修改中..." : "确认修改"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
