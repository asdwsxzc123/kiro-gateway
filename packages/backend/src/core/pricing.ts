/**
 * 模型费用计算模块
 * 基于 LiteLLM 价格表计算请求费用
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('Pricing')

// 价格表路径 - 优先使用 data 目录（Docker 挂载），回退到项目根目录
function getPriceJsonPath(): string {
  // Docker 环境: /app/data/price.json
  const dockerPath = '/app/data/price.json'
  if (existsSync(dockerPath)) {
    return dockerPath
  }

  // 本地开发环境: 项目根目录/data/price.json
  const localPath = join(process.cwd(), 'data/price.json')
  if (existsSync(localPath)) {
    return localPath
  }

  // 回退到相对于 __dirname 的路径
  return join(__dirname, '../../data/price.json')
}

const PRICE_JSON_PATH = getPriceJsonPath()

// LiteLLM 远程价格表 URL
const LITELLM_PRICE_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

// 模型价格信息接口
export interface ModelPriceInfo {
  input_cost_per_token: number
  output_cost_per_token: number
  cache_creation_input_token_cost?: number
  cache_read_input_token_cost?: number
  max_input_tokens?: number
  max_output_tokens?: number
  supports_prompt_caching?: boolean
  [key: string]: unknown
}

// 费用计算结果
export interface CostCalculation {
  inputCost: number
  outputCost: number
  cacheCreationCost: number
  cacheReadCost: number
  totalCost: number
}

// 价格表缓存
let priceData: Record<string, ModelPriceInfo> | null = null

/**
 * 加载价格表
 */
export function loadPriceConfig(): Record<string, ModelPriceInfo> {
  if (priceData) return priceData

  try {
    const raw = readFileSync(PRICE_JSON_PATH, 'utf-8')
    priceData = JSON.parse(raw)
    logger.info('Price config loaded', { modelCount: Object.keys(priceData!).length })
    return priceData!
  } catch (error) {
    logger.error('Failed to load price config', { error: (error as Error).message })
    priceData = {}
    return priceData
  }
}

/**
 * 重新加载价格表（清除缓存）
 */
export function reloadPriceConfig(): Record<string, ModelPriceInfo> {
  priceData = null
  return loadPriceConfig()
}

/**
 * Gateway 内部模型名到 price.json key 的映射
 * Gateway uses names like "claude-sonnet-4.5", price.json uses "claude-sonnet-4-5-20250929" etc.
 */
const MODEL_PRICE_MAP: Record<string, string> = {
  // Gateway internal model names -> price.json keys
  'claude-sonnet-4.5': 'claude-sonnet-4-5',
  'claude-sonnet-4': 'claude-4-sonnet-20250514',
  'claude-haiku-4.5': 'claude-haiku-4-5',
  'claude-opus-4.5': 'claude-opus-4-5',
  'claude-opus-4': 'claude-4-opus-20250514',
  'claude-opus-4-1': 'claude-opus-4-1',
}

/**
 * 查找模型的价格信息
 * 支持精确匹配和模糊匹配
 */
export function findModelPrice(model: string): ModelPriceInfo | null {
  const prices = loadPriceConfig()

  // 1. 精确匹配
  if (prices[model]) return prices[model]

  // 2. 通过映射表匹配
  const mapped = MODEL_PRICE_MAP[model]
  if (mapped && prices[mapped]) return prices[mapped]

  // 3. 模糊匹配：尝试在 price.json 中查找包含模型名的 key
  const lowerModel = model.toLowerCase()
  for (const [key, value] of Object.entries(prices)) {
    // Only match direct anthropic provider entries (not bedrock/openrouter etc.)
    if (key.toLowerCase() === lowerModel) return value
    if (key.startsWith('claude-') && key.toLowerCase().includes(lowerModel.replace('claude-', ''))) {
      return value
    }
  }

  // 4. 尝试标准化名称匹配: claude-sonnet-4.5 -> claude-sonnet-4-5
  const normalized = model.replace(/\./g, '-')
  if (prices[normalized]) return prices[normalized]

  for (const [key, value] of Object.entries(prices)) {
    if (key.startsWith('claude-') && key.startsWith(normalized)) {
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
  const prices = loadPriceConfig()
  const claudePrices: Record<string, ModelPriceInfo> = {}

  for (const [key, value] of Object.entries(prices)) {
    // Only include direct Claude model entries (not bedrock/openrouter/azure prefixed)
    if (key.startsWith('claude-') && !key.includes('/')) {
      claudePrices[key] = value
    }
  }

  return claudePrices
}

/**
 * 从远程 URL 更新价格表到本地
 */
export async function updatePriceFromRemote(url?: string): Promise<{ success: boolean; modelCount: number; error?: string }> {
  const fetchUrl = url || LITELLM_PRICE_URL

  try {
    logger.info('Fetching price config from remote', { url: fetchUrl })

    const response = await fetch(fetchUrl)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json() as Record<string, unknown>
    const modelCount = Object.keys(data).length

    // Validate the data looks like a price config
    if (modelCount < 10) {
      throw new Error('Invalid price data: too few models')
    }

    // Write to local file
    writeFileSync(PRICE_JSON_PATH, JSON.stringify(data, null, 4), 'utf-8')

    // Reload cache
    reloadPriceConfig()

    logger.info('Price config updated from remote', { modelCount })
    return { success: true, modelCount }
  } catch (error) {
    const errorMsg = (error as Error).message
    logger.error('Failed to update price config from remote', { error: errorMsg })
    return { success: false, modelCount: 0, error: errorMsg }
  }
}
