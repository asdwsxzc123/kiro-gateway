/**
 * 模型费用计算模块
 * Claude 模型价格表（内置）
 */

import { createLogger } from '../utils/logger.js'

const logger = createLogger('Pricing')

// 模型价格信息接口
export interface ModelPriceInfo {
  input_cost_per_token: number
  output_cost_per_token: number
  cache_creation_input_token_cost?: number
  cache_read_input_token_cost?: number
  max_input_tokens?: number
  max_output_tokens?: number
  supports_prompt_caching?: boolean
}

// 费用计算结果
export interface CostCalculation {
  inputCost: number
  outputCost: number
  cacheCreationCost: number
  cacheReadCost: number
  totalCost: number
}

/**
 * 内置 Claude 模型价格表
 * 价格单位: USD per token
 * 数据来源: https://www.anthropic.com/pricing
 */
const CLAUDE_PRICES: Record<string, ModelPriceInfo> = {
  // Claude 4 Opus
  'claude-4-opus-20250514': {
    input_cost_per_token: 0.000015,
    output_cost_per_token: 0.000075,
    cache_creation_input_token_cost: 0.00001875,
    cache_read_input_token_cost: 0.0000015,
    max_input_tokens: 200000,
    max_output_tokens: 32000,
    supports_prompt_caching: true
  },
  'claude-opus-4': {
    input_cost_per_token: 0.000015,
    output_cost_per_token: 0.000075,
    cache_creation_input_token_cost: 0.00001875,
    cache_read_input_token_cost: 0.0000015,
    max_input_tokens: 200000,
    max_output_tokens: 32000,
    supports_prompt_caching: true
  },

  // Claude Opus 4.5
  'claude-opus-4-5-20250929': {
    input_cost_per_token: 0.000015,
    output_cost_per_token: 0.000075,
    cache_creation_input_token_cost: 0.00001875,
    cache_read_input_token_cost: 0.0000015,
    max_input_tokens: 200000,
    max_output_tokens: 32000,
    supports_prompt_caching: true
  },
  'claude-opus-4-5': {
    input_cost_per_token: 0.000015,
    output_cost_per_token: 0.000075,
    cache_creation_input_token_cost: 0.00001875,
    cache_read_input_token_cost: 0.0000015,
    max_input_tokens: 200000,
    max_output_tokens: 32000,
    supports_prompt_caching: true
  },
  'claude-opus-4.5': {
    input_cost_per_token: 0.000015,
    output_cost_per_token: 0.000075,
    cache_creation_input_token_cost: 0.00001875,
    cache_read_input_token_cost: 0.0000015,
    max_input_tokens: 200000,
    max_output_tokens: 32000,
    supports_prompt_caching: true
  },

  // Claude 4 Sonnet
  'claude-4-sonnet-20250514': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_creation_input_token_cost: 0.00000375,
    cache_read_input_token_cost: 0.0000003,
    max_input_tokens: 200000,
    max_output_tokens: 64000,
    supports_prompt_caching: true
  },
  'claude-sonnet-4': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_creation_input_token_cost: 0.00000375,
    cache_read_input_token_cost: 0.0000003,
    max_input_tokens: 200000,
    max_output_tokens: 64000,
    supports_prompt_caching: true
  },

  // Claude Sonnet 4.5
  'claude-sonnet-4-5-20250929': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_creation_input_token_cost: 0.00000375,
    cache_read_input_token_cost: 0.0000003,
    max_input_tokens: 200000,
    max_output_tokens: 64000,
    supports_prompt_caching: true
  },
  'claude-sonnet-4-5': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_creation_input_token_cost: 0.00000375,
    cache_read_input_token_cost: 0.0000003,
    max_input_tokens: 200000,
    max_output_tokens: 64000,
    supports_prompt_caching: true
  },
  'claude-sonnet-4.5': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_creation_input_token_cost: 0.00000375,
    cache_read_input_token_cost: 0.0000003,
    max_input_tokens: 200000,
    max_output_tokens: 64000,
    supports_prompt_caching: true
  },

  // Claude Haiku 4.5
  'claude-haiku-4-5-20250929': {
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.000004,
    cache_creation_input_token_cost: 0.000001,
    cache_read_input_token_cost: 0.00000008,
    max_input_tokens: 200000,
    max_output_tokens: 8192,
    supports_prompt_caching: true
  },
  'claude-haiku-4-5': {
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.000004,
    cache_creation_input_token_cost: 0.000001,
    cache_read_input_token_cost: 0.00000008,
    max_input_tokens: 200000,
    max_output_tokens: 8192,
    supports_prompt_caching: true
  },
  'claude-haiku-4.5': {
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.000004,
    cache_creation_input_token_cost: 0.000001,
    cache_read_input_token_cost: 0.00000008,
    max_input_tokens: 200000,
    max_output_tokens: 8192,
    supports_prompt_caching: true
  },

  // Claude 3.5 Sonnet (legacy)
  'claude-3-5-sonnet-20241022': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_creation_input_token_cost: 0.00000375,
    cache_read_input_token_cost: 0.0000003,
    max_input_tokens: 200000,
    max_output_tokens: 8192,
    supports_prompt_caching: true
  },
  'claude-3.5-sonnet': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_creation_input_token_cost: 0.00000375,
    cache_read_input_token_cost: 0.0000003,
    max_input_tokens: 200000,
    max_output_tokens: 8192,
    supports_prompt_caching: true
  },

  // Claude 3.5 Haiku (legacy)
  'claude-3-5-haiku-20241022': {
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.000004,
    cache_creation_input_token_cost: 0.000001,
    cache_read_input_token_cost: 0.00000008,
    max_input_tokens: 200000,
    max_output_tokens: 8192,
    supports_prompt_caching: true
  },
  'claude-3.5-haiku': {
    input_cost_per_token: 0.0000008,
    output_cost_per_token: 0.000004,
    cache_creation_input_token_cost: 0.000001,
    cache_read_input_token_cost: 0.00000008,
    max_input_tokens: 200000,
    max_output_tokens: 8192,
    supports_prompt_caching: true
  },

  // Claude 3 Opus (legacy)
  'claude-3-opus-20240229': {
    input_cost_per_token: 0.000015,
    output_cost_per_token: 0.000075,
    cache_creation_input_token_cost: 0.00001875,
    cache_read_input_token_cost: 0.0000015,
    max_input_tokens: 200000,
    max_output_tokens: 4096,
    supports_prompt_caching: true
  },
  'claude-3-opus': {
    input_cost_per_token: 0.000015,
    output_cost_per_token: 0.000075,
    cache_creation_input_token_cost: 0.00001875,
    cache_read_input_token_cost: 0.0000015,
    max_input_tokens: 200000,
    max_output_tokens: 4096,
    supports_prompt_caching: true
  }
}

/**
 * 加载价格表
 */
export function loadPriceConfig(): Record<string, ModelPriceInfo> {
  return CLAUDE_PRICES
}

/**
 * 重新加载价格表（兼容旧接口，实际返回内置价格表）
 */
export function reloadPriceConfig(): Record<string, ModelPriceInfo> {
  return CLAUDE_PRICES
}

/**
 * 查找模型的价格信息
 * 支持精确匹配和模糊匹配
 */
export function findModelPrice(model: string): ModelPriceInfo | null {
  // 1. 精确匹配
  if (CLAUDE_PRICES[model]) return CLAUDE_PRICES[model]

  // 2. 标准化名称匹配: claude-sonnet-4.5 -> claude-sonnet-4-5
  const normalized = model.replace(/\./g, '-')
  if (CLAUDE_PRICES[normalized]) return CLAUDE_PRICES[normalized]

  // 3. 模糊匹配
  const lowerModel = model.toLowerCase()
  for (const [key, value] of Object.entries(CLAUDE_PRICES)) {
    if (key.toLowerCase() === lowerModel) return value
    // 匹配包含模型名的 key
    if (key.toLowerCase().includes(lowerModel.replace('claude-', ''))) {
      return value
    }
  }

  // 4. 前缀匹配
  for (const [key, value] of Object.entries(CLAUDE_PRICES)) {
    if (key.startsWith(normalized)) {
      return value
    }
  }

  logger.debug('No price info found for model', { model })
  return null
}

/**
 * 计算请求费用
 * @param model - 模型名称
 * @param inputTokens - 输入 token 数（不含缓存 token）
 * @param outputTokens - 输出 token 数
 * @param cacheCreationTokens - 缓存创建 token 数
 * @param cacheReadTokens - 缓存读取 token 数
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number = 0,
  cacheReadTokens: number = 0
): CostCalculation {
  const priceInfo = findModelPrice(model)

  if (!priceInfo) {
    return {
      inputCost: 0,
      outputCost: 0,
      cacheCreationCost: 0,
      cacheReadCost: 0,
      totalCost: 0
    }
  }

  // Compute actual non-cached input tokens
  // The inputTokens from Kiro includes uncached + cacheRead + cacheWrite
  // We need to subtract cache tokens to get uncached input cost
  const uncachedInputTokens = Math.max(0, inputTokens - cacheCreationTokens - cacheReadTokens)

  const inputCost = uncachedInputTokens * (priceInfo.input_cost_per_token || 0)
  const outputCost = outputTokens * (priceInfo.output_cost_per_token || 0)
  const cacheCreationCost = cacheCreationTokens * (priceInfo.cache_creation_input_token_cost || priceInfo.input_cost_per_token || 0)
  const cacheReadCost = cacheReadTokens * (priceInfo.cache_read_input_token_cost || 0)

  const totalCost = inputCost + outputCost + cacheCreationCost + cacheReadCost

  return {
    inputCost,
    outputCost,
    cacheCreationCost,
    cacheReadCost,
    totalCost
  }
}

/**
 * 获取当前价格表（只返回 Claude 模型）
 */
export function getClaudePrices(): Record<string, ModelPriceInfo> {
  return CLAUDE_PRICES
}

/**
 * 从远程 URL 更新价格表（已废弃，保留接口兼容）
 * @deprecated 价格表已内置，此方法不再执行实际更新
 */
export async function updatePriceFromRemote(_url?: string): Promise<{ success: boolean; modelCount: number; error?: string }> {
  logger.info('Price config is now built-in, remote update is disabled')
  return {
    success: true,
    modelCount: Object.keys(CLAUDE_PRICES).length,
    error: 'Price config is built-in, no update needed'
  }
}
