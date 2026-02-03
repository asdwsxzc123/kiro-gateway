/**
 * Token 计算模块
 * 基于字符单位的 token 估算算法
 *
 * 计算规则：
 * - 非西文字符：每个计 4 个字符单位
 * - 西文字符：每个计 1 个字符单位
 * - 4 个字符单位 = 1 token
 */

/**
 * 判断字符是否为非西文字符
 * 西文字符包括 ASCII、拉丁字母扩展等
 */
function isNonWesternChar(c: string): boolean {
  const code = c.codePointAt(0)!
  // ASCII (U+0000..U+007F)
  if (code <= 0x007F) return false
  // Latin Extended-A/B (U+0080..U+024F)
  if (code >= 0x0080 && code <= 0x024F) return false
  // Latin Extended Additional (U+1E00..U+1EFF)
  if (code >= 0x1E00 && code <= 0x1EFF) return false
  // Latin Extended-C (U+2C60..U+2C7F)
  if (code >= 0x2C60 && code <= 0x2C7F) return false
  // Latin Extended-D (U+A720..U+A7FF)
  if (code >= 0xA720 && code <= 0xA7FF) return false
  // Latin Extended-E (U+AB30..U+AB6F)
  if (code >= 0xAB30 && code <= 0xAB6F) return false
  return true
}

/**
 * 计算文本的 token 数量
 */
function countTokens(text: string): number {
  let charUnits = 0
  for (const c of text) {
    charUnits += isNonWesternChar(c) ? 4.0 : 1.0
  }

  const tokens = charUnits / 4.0

  let accToken: number
  if (tokens < 100) {
    accToken = tokens * 1.5
  } else if (tokens < 200) {
    accToken = tokens * 1.3
  } else if (tokens < 300) {
    accToken = tokens * 1.25
  } else if (tokens < 800) {
    accToken = tokens * 1.2
  } else {
    accToken = tokens * 1.0
  }

  return Math.floor(accToken)
}

/**
 * 估算请求的输入 tokens（本地计算）
 * 支持 Claude API 的 count_tokens 请求格式
 */
export function countAllTokens(
  _model: string,
  system: unknown,
  messages: Array<{ role: string; content: unknown }>,
  tools?: Array<{ name: string; description?: string; input_schema?: unknown }>
): number {
  let total = 0

  // 系统消息
  if (system) {
    if (typeof system === 'string') {
      total += countTokens(system)
    } else if (Array.isArray(system)) {
      for (const item of system) {
        if (typeof item === 'string') {
          total += countTokens(item)
        } else if (item && typeof item === 'object' && 'text' in item) {
          total += countTokens(String((item as { text: string }).text))
        }
      }
    }
  }

  // 消息内容
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += countTokens(msg.content)
    } else if (Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (item && typeof item === 'object') {
          if ('text' in item && typeof (item as { text: string }).text === 'string') {
            total += countTokens((item as { text: string }).text)
          }
        }
      }
    }
  }

  // 工具定义
  if (tools) {
    for (const tool of tools) {
      total += countTokens(tool.name)
      if (tool.description) {
        total += countTokens(tool.description)
      }
      if (tool.input_schema) {
        total += countTokens(JSON.stringify(tool.input_schema))
      }
    }
  }

  return Math.max(total, 1)
}
