/**
 * Webhook 服务
 * 检查账号使用量并发送告警通知
 */

import * as accountStore from '../storage/accountStore.js'
import * as configStore from '../storage/configStore.js'
import { fetchUsageLimits } from '../core/kiroApi.js'
import { notify } from '../core/webhook.js'
import type { ProxyAccount } from '../core/types.js'
import { getRedisClient } from '../storage/redis.js'
import { createLogger } from '../utils/logger.js'
import { refreshProxyServerAccounts } from '../routes/proxy.js'

const logger = createLogger('WebhookService')

/**
 * 检查所有活跃账号的使用量：
 * 2. 超过 webhook 阈值时发送告警通知
 */
export async function checkUsageAndAlert(): Promise<void> {
  const accounts: ProxyAccount[] = await accountStore.getAllAccounts()
  const redis = getRedisClient()
  const webhookConfig = await configStore.getWebhookConfig()
  let needsRefresh = false

  const activeAccounts = accounts.filter(
    a => a.status === 'active' || a.status === undefined
  )

  // 并行检查，每批最多 5 个
  const BATCH_SIZE = 5
  for (let i = 0; i < activeAccounts.length; i += BATCH_SIZE) {
    const batch = activeAccounts.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(batch.map(async (account) => {
      const usageData = await fetchUsageLimits(account)

      if (!usageData.usageBreakdownList || usageData.usageBreakdownList.length === 0) {
        return
      }

      const usageEntry = usageData.usageBreakdownList.find(
        entry => entry.currentUsage != null && entry.usageLimit != null
      )

      if (!usageEntry || !usageEntry.usageLimit) {
        return
      }

      const currentUsage = usageEntry.currentUsage!
      const usageLimit = usageEntry.usageLimit


      // Webhook 告警逻辑
      if (!webhookConfig.usageThreshold) return

      const dedupKey = `webhook:usage_alerted:${account.id}`
      const alreadyAlerted = await redis.get(dedupKey)
      if (alreadyAlerted) return

      const usagePercent = (currentUsage / usageLimit) * 100

      if (usagePercent >= webhookConfig.usageThreshold) {
        await redis.set(dedupKey, '1', 'EX', 86400)

        notify({
          type: 'usage_alert',
          timestamp: new Date().toISOString(),
          account: { id: account.id, alias: account.alias, email: account.email },
          detail: {
            usagePercent: Math.round(usagePercent * 100) / 100,
            currentUsage, usageLimit,
          },
        }).catch(() => {})

        logger.info('Usage alert sent', {
          accountId: account.id, alias: account.alias,
          usagePercent: Math.round(usagePercent * 100) / 100,
          currentUsage, usageLimit,
        })
      }
    }))

    for (const r of results) {
      if (r.status === 'rejected') {
        logger.error('Failed to check usage for account', { error: r.reason?.message })
      }
    }
  }

  // 批量刷新一次内存账号池
  if (needsRefresh) {
    await refreshProxyServerAccounts()
  }
}
