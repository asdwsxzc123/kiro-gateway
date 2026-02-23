/**
 * Webhook 通知模块
 * 事件驱动的多平台推送，支持飞书、钉钉、企微、Slack、Discord、自定义
 */

import { createHmac } from 'crypto'
import { createLogger } from '../utils/logger.js'
import * as configStore from '../storage/configStore.js'
import type {
  WebhookPlatformConfig,
  WebhookNotification,
  WebhookDeliveryResult,
  WebhookConfig,
} from '@kiro-gateway/shared'

const logger = createLogger('Webhook')

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * 发送通知到所有已启用的平台（唯一公开入口）
 */
export async function notify(notification: WebhookNotification): Promise<void> {
  let config: WebhookConfig
  try {
    config = await configStore.getWebhookConfig()
  } catch {
    return
  }

  if (!config.enabled) return

  // 检查通知类型开关
  if (notification.type === 'account_error' && !config.notifyOnAccountError) return
  if (notification.type === 'usage_alert' && !config.usageThreshold) return
  if (notification.type === 'token_refresh_fail' && !config.notifyOnTokenRefreshFail) return

  const platforms = config.platforms.filter(p => p.enabled && p.url)
  if (platforms.length === 0) return

  const results = await Promise.allSettled(
    platforms.map(p => sendWithRetry(p, notification))
  )

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)) {
      logger.error('Webhook delivery failed', {
        platform: platforms[i].platform,
        label: platforms[i].label,
        error: r.status === 'rejected' ? String(r.reason) : r.value.error,
      })
    }
  }
}

/**
 * 测试推送到所有已启用的平台，返回每个平台的结果
 */
export async function sendTestNotification(): Promise<WebhookDeliveryResult[]> {
  const config = await configStore.getWebhookConfig()
  const notification: WebhookNotification = {
    type: 'test',
    timestamp: new Date().toISOString(),
    detail: { message: 'Test notification from Kiro Gateway' },
  }

  const platforms = config.platforms.filter(p => p.enabled && p.url)
  if (platforms.length === 0) return []

  const results = await Promise.allSettled(
    platforms.map(p => sendWithRetry(p, notification, 1))
  )

  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { platform: platforms[i].platform, label: platforms[i].label, success: false, error: String(r.reason) }
  )
}

// ─── Retry ───────────────────────────────────────────────────────────────────

async function sendWithRetry(
  platform: WebhookPlatformConfig,
  notification: WebhookNotification,
  maxAttempts = 4,
): Promise<WebhookDeliveryResult> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(1000 * Math.pow(2, attempt - 1))
    const result = await sendToPlatform(platform, notification)
    if (result.success) return result
    if (result.statusCode && result.statusCode >= 400 && result.statusCode < 500 && result.statusCode !== 429) {
      return result
    }
  }
  return { platform: platform.platform, label: platform.label, success: false, error: 'Max retries exceeded' }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Platform Dispatch ───────────────────────────────────────────────────────

async function sendToPlatform(
  platform: WebhookPlatformConfig,
  notification: WebhookNotification,
): Promise<WebhookDeliveryResult> {
  const base = { platform: platform.platform, label: platform.label } as const

  try {
    let url = platform.url
    let body: object

    switch (platform.platform) {
      case 'feishu':
        body = formatFeishu(notification, platform.secret, url)
        break
      case 'dingtalk':
        ({ body, url } = formatDingtalk(notification, platform.secret, url))
        break
      case 'wechat_work':
        body = formatWechatWork(notification)
        break
      case 'slack':
        body = formatSlack(notification)
        break
      case 'discord':
        body = formatDiscord(notification)
        break
      default:
        body = formatCustom(notification)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (response.ok) {
        return { ...base, success: true, statusCode: response.status }
      }
      return { ...base, success: false, statusCode: response.status, error: `HTTP ${response.status}` }
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    return { ...base, success: false, error: (error as Error).message }
  }
}

// ─── Message Builders ────────────────────────────────────────────────────────

function buildTitle(n: WebhookNotification): string {
  const map: Record<string, string> = {
    account_error: '账号异常',
    usage_alert: '用量告警',
    token_refresh_fail: 'Token 刷新失败',
    test: '测试通知',
  }
  return `Kiro Gateway · ${map[n.type] || n.type}`
}

function buildMarkdown(n: WebhookNotification): string {
  const name = n.account ? (n.account.alias || n.account.email || n.account.id) : '-'
  const d = n.detail as Record<string, unknown>

  if (n.type === 'test') return `${d.message}`

  const lines: string[] = [`**类型**: ${buildTitle(n)}`]
  if (n.account) lines.push(`**账号**: ${name}`)

  if (n.type === 'usage_alert') {
    lines.push(`**用量**: ${d.currentUsage}/${d.usageLimit} (${d.usagePercent}%)`)
  } else if (n.type === 'account_error') {
    lines.push(`**状态**: ${d.status}`)
    if (d.reason) lines.push(`**原因**: ${d.reason}`)
  } else if (n.type === 'token_refresh_fail') {
    if (d.error) lines.push(`**错误**: ${d.error}`)
  }

  lines.push(`**时间**: ${n.timestamp}`)
  return lines.join('\n')
}

// ─── Feishu ──────────────────────────────────────────────────────────────────

function formatFeishu(n: WebhookNotification, secret?: string, _url?: string): object {
  const card: Record<string, unknown> = {
    msg_type: 'interactive',
    card: {
      header: {
        title: { tag: 'plain_text', content: buildTitle(n) },
        template: n.type === 'test' ? 'blue' : 'orange',
      },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: buildMarkdown(n) } },
      ],
    },
  }

  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const sign = genFeishuSign(timestamp, secret)
    card.timestamp = timestamp
    card.sign = sign
  }

  return card
}

function genFeishuSign(timestamp: string, secret: string): string {
  const str = `${timestamp}\n${secret}`
  return createHmac('sha256', str).update('').digest('base64')
}

// ─── DingTalk ────────────────────────────────────────────────────────────────

function formatDingtalk(
  n: WebhookNotification,
  secret: string | undefined,
  url: string,
): { body: object; url: string } {
  const body = {
    msgtype: 'markdown',
    markdown: { title: buildTitle(n), text: buildMarkdown(n) },
  }

  if (secret) {
    const timestamp = Date.now().toString()
    const sign = genDingtalkSign(timestamp, secret)
    const sep = url.includes('?') ? '&' : '?'
    url = `${url}${sep}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`
  }

  return { body, url }
}

function genDingtalkSign(timestamp: string, secret: string): string {
  const str = `${timestamp}\n${secret}`
  return createHmac('sha256', secret).update(str).digest('base64')
}

// ─── WeChat Work ─────────────────────────────────────────────────────────────

function formatWechatWork(n: WebhookNotification): object {
  return {
    msgtype: 'markdown',
    markdown: { content: buildMarkdown(n) },
  }
}

// ─── Slack ───────────────────────────────────────────────────────────────────

function formatSlack(n: WebhookNotification): object {
  return {
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: buildTitle(n) } },
      { type: 'section', text: { type: 'mrkdwn', text: buildMarkdown(n) } },
    ],
  }
}

// ─── Discord ─────────────────────────────────────────────────────────────────

function formatDiscord(n: WebhookNotification): object {
  return {
    embeds: [{
      title: buildTitle(n),
      description: buildMarkdown(n),
      color: n.type === 'test' ? 0x3498db : 0xff6600,
      timestamp: n.timestamp,
    }],
  }
}

// ─── Custom ──────────────────────────────────────────────────────────────────

function formatCustom(n: WebhookNotification): object {
  return { type: n.type, timestamp: n.timestamp, account: n.account, detail: n.detail }
}
