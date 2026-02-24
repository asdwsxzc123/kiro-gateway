/**
 * 代理感知的 fetch 工具
 * 当账号绑定了 HTTP 代理 IP 时，通过代理发送请求
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici'

const agentCache = new Map<string, ProxyAgent>()

/**
 * 获取或创建 ProxyAgent（缓存复用）
 */
export function getProxyDispatcher(proxyUrl: string): ProxyAgent {
  let agent = agentCache.get(proxyUrl)
  if (!agent) {
    agent = new ProxyAgent(proxyUrl)
    agentCache.set(proxyUrl, agent)
  }
  return agent
}

/**
 * 代理感知的 fetch
 * 当 proxyUrl 存在时通过代理转发，否则使用原生 fetch
 */
export async function proxyFetch(
  url: string | URL,
  options: RequestInit = {},
  proxyUrl?: string
): Promise<Response> {
  if (!proxyUrl) return fetch(url, options)
  const dispatcher = getProxyDispatcher(proxyUrl)
  return undiciFetch(url as string, {
    ...options as Record<string, unknown>,
    dispatcher
  }) as unknown as Response
}
