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
  // Claude Opus 4.6 — $5/$25 per Mtok
  'claude-opus-4-6': {
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000025,
    cache_creation_input_token_cost: 0.00000625,
    cache_read_input_token_cost: 0.0000005,
    max_input_tokens: 200000,
    max_output_tokens: 32000,
    supports_prompt_caching: true
  },
  'claude-opus-4.6': {
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000025,
    cache_creation_input_token_cost: 0.00000625,
    cache_read_input_token_cost: 0.0000005,
    max_input_tokens: 200000,
    max_output_tokens: 32000,
    supports_prompt_caching: true
  },

  // Claude Opus 4.6 (1M context) — $10/$37.50 per Mtok
  'claude-opus-4-6-1m': {
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.0000375,
    cache_creation_input_token_cost: 0.0000125,
    cache_read_input_token_cost: 0.000001,
    max_input_tokens: 1000000,
    max_output_tokens: 32000,
    supports_prompt_caching: true
  },
  'claude-opus-4.6-1m': {
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.0000375,
    cache_creation_input_token_cost: 0.0000125,
    cache_read_input_token_cost: 0.000001,
    max_input_tokens: 1000000,
    max_output_tokens: 32000,
    supports_prompt_caching: true
  },

  // Claude 4 Opus — $15/$75 per Mtok
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

  // Claude Opus 4.6 (date-specific)
  'claude-opus-4-6-20260207': {
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000025,
    cache_creation_input_token_cost: 0.00000625,
    cache_read_input_token_cost: 0.0000005,
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
  'claude-opus-4-5-20251101': {
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

  // Claude Sonnet 4.6 — $3/$15 per Mtok (same as Sonnet 4.5)
  'claude-sonnet-4-6': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_creation_input_token_cost: 0.00000375,
    cache_read_input_token_cost: 0.0000003,
    max_input_tokens: 200000,
    max_output_tokens: 64000,
    supports_prompt_caching: true
  },
  'claude-sonnet-4.6': {
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
  'claude-haiku-4-5-20251001': {
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

// 默认兜底模型（sonnet 4.5）
const DEFAULT_FALLBACK_MODEL = 'claude-sonnet-4-5'

/**
 * 从模型名称中提取系列和版本信息
 * 例如: claude-opus-4-5-20251101 -> { series: 'opus', version: '4.5' }
 */
function extractModelInfo(model: string): { series: string | null; version: string | null } {
  const lowerModel = model.toLowerCase()

  // 提取系列: opus, sonnet, haiku
  let series: string | null = null
  if (lowerModel.includes('opus')) series = 'opus'
  else if (lowerModel.includes('sonnet')) series = 'sonnet'
  else if (lowerModel.includes('haiku')) series = 'haiku'

  // 提取版本: 4.6, 4.5, 4, 3.5, 3（从高到低匹配，避免误匹配）
  let version: string | null = null
  if (lowerModel.includes('4.6') || lowerModel.includes('4-6')) {
    version = '4.6'
  } else if (lowerModel.includes('4.5') || lowerModel.includes('4-5') || lowerModel.includes('45')) {
    version = '4.5'
  } else if (lowerModel.includes('3.5') || lowerModel.includes('3-5') || lowerModel.includes('35')) {
    version = '3.5'
  } else if (lowerModel.includes('-4-') || lowerModel.includes('-4') || lowerModel.match(/claude-\w+-4$/)) {
    version = '4'
  } else if (lowerModel.includes('-3-') || lowerModel.includes('-3') || lowerModel.match(/claude-\w+-3$/)) {
    version = '3'
  }

  return { series, version }
}

/**
 * 根据系列和版本获取对应的基准模型名
 */
function getBaseModelName(series: string, version: string): string {
  // 映射到价格表中存在的基准模型名
  const modelMap: Record<string, Record<string, string>> = {
    'opus': {
      '4.6': 'claude-opus-4-6',
      '4.5': 'claude-opus-4-5',
      '4': 'claude-opus-4',
      '3': 'claude-3-opus'
    },
    'sonnet': {
      '4.6': 'claude-sonnet-4-6',
      '4.5': 'claude-sonnet-4-5',
      '4': 'claude-sonnet-4',
      '3.5': 'claude-3.5-sonnet'
    },
    'haiku': {
      '4.5': 'claude-haiku-4-5',
      '3.5': 'claude-3.5-haiku'
    }
  }

  return modelMap[series]?.[version] || DEFAULT_FALLBACK_MODEL
}

/**
 * 查找模型的价格信息
 * 支持精确匹配、模糊匹配和兜底
 */
export function findModelPrice(model: string): ModelPriceInfo {
  // 1. 精确匹配
  if (CLAUDE_PRICES[model]) return CLAUDE_PRICES[model]

  // 2. 标准化名称匹配: claude-sonnet-4.5 -> claude-sonnet-4-5
  const normalized = model.replace(/\./g, '-')
  if (CLAUDE_PRICES[normalized]) return CLAUDE_PRICES[normalized]

  // 3. 大小写不敏感的精确匹配
  const lowerModel = model.toLowerCase()
  for (const [key, value] of Object.entries(CLAUDE_PRICES)) {
    if (key.toLowerCase() === lowerModel) return value
  }

  // 4. 基于系列和版本的智能匹配
  const { series, version } = extractModelInfo(model)
  if (series && version) {
    const baseModel = getBaseModelName(series, version)
    if (CLAUDE_PRICES[baseModel]) {
      logger.debug('Model matched by series/version', { model, matchedTo: baseModel })
      return CLAUDE_PRICES[baseModel]
    }
  }

  // 5. 仅基于系列的匹配（使用该系列最新版本）
  if (series) {
    const seriesDefaults: Record<string, string> = {
      'opus': 'claude-opus-4-6',
      'sonnet': 'claude-sonnet-4-6',
      'haiku': 'claude-haiku-4-5'
    }
    const defaultModel = seriesDefaults[series]
    if (defaultModel && CLAUDE_PRICES[defaultModel]) {
      logger.debug('Model matched by series only', { model, matchedTo: defaultModel })
      return CLAUDE_PRICES[defaultModel]
    }
  }

  // 6. 兜底：未知模型按 sonnet 4.5 计费
  logger.warn('Unknown model, using fallback pricing (sonnet 4.5)', { model })
  return CLAUDE_PRICES[DEFAULT_FALLBACK_MODEL]
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
  // findModelPrice 现在总是返回价格信息（有兜底）
  const priceInfo = findModelPrice(model)

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
