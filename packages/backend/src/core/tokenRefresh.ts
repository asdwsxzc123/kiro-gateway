/**
 * Token 刷新模块
 * 从 Electron 主进程提取的 Token 刷新逻辑
 */

import { createLogger } from '../utils/logger.js'
import type { ProxyAccount, TokenRefreshResult } from './types.js'
import { getKiroUserAgent } from './kiroApi.js'

const logger = createLogger('TokenRefresh')

// Kiro Auth 端点
const KIRO_AUTH_ENDPOINT = 'https://prod.us-east-1.auth.desktop.kiro.dev'

/**
 * OIDC Token 刷新 (BuilderId/IdC)
 * 用于 AWS SSO 认证方式
 */
export async function refreshOidcToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  region: string = 'us-east-1'
): Promise<TokenRefreshResult> {
  logger.info(`Refreshing OIDC token, region: ${region}`)

  const url = `https://oidc.${region}.amazonaws.com/token`

   const payload = {
    clientId,
    clientSecret,
    refreshToken,
    grantType: 'refresh_token'
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`OIDC refresh failed: ${response.status} - ${errorText}`)
      return { success: false, error: `HTTP ${response.status}: ${errorText}` }
    }

    const data = await response.json() as {
      accessToken: string
      refreshToken?: string
      expiresIn?: number
    }

    logger.info(`OIDC token refreshed successfully, expires in ${data.expiresIn}s`)

    return {
      success: true,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
      expiresAt: Date.now() + (data.expiresIn || 3600) * 1000
    }
  } catch (error) {
    logger.error(`OIDC refresh error: ${error}`)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * 社交登录 Token 刷新 (GitHub/Google)
 * 使用 Kiro Auth Service
 * @param refreshToken - 刷新令牌
 * @param machineId - 机器码（可选，用于生成 User-Agent）
 */
export async function refreshSocialToken(
  refreshToken: string,
  machineId?: string
): Promise<TokenRefreshResult> {
  logger.info('Refreshing social token')

  const url = `${KIRO_AUTH_ENDPOINT}/refreshToken`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 关键修复：使用包含 machineId 的 User-Agent（与 kiro-m 保持一致）
        'User-Agent': getKiroUserAgent(machineId)
      },
      body: JSON.stringify({ refreshToken })
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`Social refresh failed: ${response.status} - ${errorText}`)
      return { success: false, error: `HTTP ${response.status}: ${errorText}` }
    }

    const data = await response.json() as {
      accessToken: string
      refreshToken?: string
      expiresIn?: number
    }

    logger.info(`Social token refreshed successfully, expires in ${data.expiresIn}s`)

    return {
      success: true,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
      expiresAt: Date.now() + (data.expiresIn || 3600) * 1000
    }
  } catch (error) {
    logger.error(`Social refresh error: ${error}`)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * 根据认证方式刷新 Token
 */
export async function refreshTokenByMethod(
  account: ProxyAccount
): Promise<TokenRefreshResult> {
  if (!account.refreshToken) {
    return { success: false, error: 'No refresh token available' }
  }

  // 社交登录使用 Kiro Auth Service
  if (account.authMethod === 'social') {
    // 关键修复：传递 machineId 给 refreshSocialToken（与 kiro-m 保持一致）
    return refreshSocialToken(account.refreshToken, account.machineId)
  }

  // IdC/BuilderId 使用 OIDC
  if (!account.clientId || !account.clientSecret) {
    return { success: false, error: 'Missing clientId or clientSecret for OIDC refresh' }
  }

  return refreshOidcToken(
    account.refreshToken,
    account.clientId,
    account.clientSecret,
    account.region || 'us-east-1'
  )
}

/**
 * 检查 Token 是否需要刷新
 * @param account 账号
 * @param beforeExpirySec 提前刷新秒数（默认5分钟）
 */
export function needsTokenRefresh(
  account: ProxyAccount,
  beforeExpirySec: number = 300
): boolean {
  if (!account.expiresAt) {
    return false // 没有过期时间，不刷新
  }

  const now = Date.now()
  const refreshThreshold = account.expiresAt - beforeExpirySec * 1000

  return now >= refreshThreshold
}

/**
 * 检查 Token 是否已过期
 */
export function isTokenExpired(account: ProxyAccount): boolean {
  if (!account.expiresAt) {
    return false // 没有过期时间，假设未过期
  }

  return Date.now() >= account.expiresAt
}
