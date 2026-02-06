# Token 计算模块重构设计

## 背景

当前 TypeScript 版本使用字符单位估算算法，精度较低。需要参考 Python 版本，使用真实的 BPE tokenizer (tiktoken) 来提高精度，同时保留缓存逻辑。

## 算法对比

| 特性 | 当前 (TypeScript) | 目标 (参考 Python) |
|------|-------------------|-------------------|
| 计算方法 | 字符单位估算 | tiktoken (cl100k_base) |
| 修正系数 | 分段 1.0-1.5 | 固定 1.15 |
| 消息开销 | 不计算 | 每条消息 +4 token |
| 图片处理 | 不支持 | ~100 token/张（可配置） |
| 工具调用 | 简单计算 | 完整结构计算 |

### 修正系数说明

> **风险提示**: `cl100k_base` 是 GPT-4 的编码器，与 Claude 的实际 tokenizer 存在差异。
> 固定 1.15 修正系数是经验值，可能与真实计费/限额有偏差。
>
> **建议**:
> - 用于预估和展示，不作为精确计费依据
> - 可通过配置调整修正系数
> - 关键场景应以 API 返回的实际 token 数为准

## 请求体格式 (Schema)

### Claude 格式 (`/v1/messages/count_tokens`)

基于 `ClaudeRequest` 类型定义：

```typescript
// 请求体
interface CountTokensRequest {
  model: string
  messages: ClaudeMessage[]
  system?: string | ClaudeSystemBlock[]
  tools?: ClaudeTool[]
}

// 消息格式
interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string | ClaudeContentBlock[]
}

// 内容块（支持多模态和工具调用）
interface ClaudeContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'thinking'
  text?: string
  thinking?: string
  source?: { type: 'base64'; media_type: string; data: string }
  id?: string           // tool_use id
  name?: string         // tool name
  input?: unknown       // tool input (对象)
  tool_use_id?: string  // tool_result 引用
  content?: string | ClaudeContentBlock[]
}

// 工具定义
interface ClaudeTool {
  type?: string
  name: string
  description: string
  input_schema: unknown
}

// 系统消息块
interface ClaudeSystemBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}
```

### OpenAI 格式 (兼容)

基于 `OpenAIMessage` 和 `OpenAITool` 类型定义：

```typescript
// 消息格式
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OpenAIContentPart[]
  name?: string
  tool_calls?: OpenAIToolCall[]    // assistant 消息中的工具调用
  tool_call_id?: string            // tool 消息的引用 ID
}

// 工具调用
interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string  // JSON 字符串
  }
}

// 工具定义
interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: unknown
  }
}
```

## 设计方案

### 1. 依赖选择

使用 `js-tiktoken` 库（tiktoken 的 JavaScript 移植版）：
- 纯 JavaScript 实现，无需编译
- 支持 `cl100k_base` 编码（GPT-4/Claude 近似）
- npm 包：`js-tiktoken`

### 2. 核心常量

```typescript
/**
 * Claude 修正系数
 * 经验值：Claude 比 GPT-4 (cl100k_base) 多约 15% token
 * 可通过环境变量 TOKEN_CORRECTION_FACTOR 覆盖
 */
const CLAUDE_CORRECTION_FACTOR = 1.15

/**
 * 消息结构开销
 */
const MESSAGE_OVERHEAD_TOKENS = 4  // role + 分隔符
const FINAL_SERVICE_TOKENS = 3    // 最终服务 token
const TOOL_OVERHEAD_TOKENS = 4    // 每个工具/tool_call 开销

/**
 * 图片 token 估算
 * Claude 图片 token 取决于分辨率，范围约 85-1590 tokens
 * 这里使用保守的中等估算值
 */
const IMAGE_ESTIMATE_TOKENS = 200
```

### 3. 模块结构

```
src/core/tokenCounter.ts
├── 常量定义
├── 编码器缓存（懒加载）
├── countTokens(text)              - 单文本计数
├── countClaudeMessageTokens()     - Claude 消息计数
├── countOpenAIMessageTokens()     - OpenAI 消息计数
├── countClaudeToolsTokens()       - Claude 工具定义计数
├── countOpenAIToolsTokens()       - OpenAI 工具定义计数
└── countAllTokens(...)            - 完整请求计数（导出）
```

### 4. 缓存策略

编码器实例缓存（懒加载），避免函数名冲突：

```typescript
import { getEncoding as getTiktokenEncoding, type Tiktoken } from 'js-tiktoken'

// 编码器缓存
let _encoding: Tiktoken | false | null = null

/**
 * 获取 tiktoken 编码器（懒加载 + 缓存）
 */
function getTokenEncoder(): Tiktoken | null {
  if (_encoding === null) {
    try {
      _encoding = getTiktokenEncoding('cl100k_base')
    } catch (e) {
      console.warn('[TokenCounter] tiktoken not available, using fallback estimation')
      _encoding = false  // 标记初始化失败
    }
  }
  return _encoding || null
}
```

### 5. 核心函数实现

#### 5.1 countTokens - 单文本计数

```typescript
/**
 * 计算文本的 token 数量
 */
function countTokens(text: string, applyCorrection = true): number {
  if (!text) return 0

  const encoder = getTokenEncoder()
  let baseTokens: number

  if (encoder) {
    try {
      baseTokens = encoder.encode(text).length
    } catch {
      // 编码失败时使用 fallback
      baseTokens = Math.floor(text.length / 4) + 1
    }
  } else {
    // Fallback: ~4 字符/token
    baseTokens = Math.floor(text.length / 4) + 1
  }

  return applyCorrection
    ? Math.floor(baseTokens * CLAUDE_CORRECTION_FACTOR)
    : baseTokens
}
```

#### 5.2 countClaudeMessageTokens - Claude 消息计数

```typescript
import type { ClaudeMessage, ClaudeContentBlock } from './types.js'

/**
 * 计算 Claude 格式消息的 token 数量
 */
function countClaudeMessageTokens(
  messages: ClaudeMessage[],
  applyCorrection = true
): number {
  let total = 0

  for (const msg of messages) {
    // 消息结构开销
    total += MESSAGE_OVERHEAD_TOKENS

    // role
    total += countTokens(msg.role, false)

    // content
    const content = msg.content
    if (typeof content === 'string') {
      total += countTokens(content, false)
    } else if (Array.isArray(content)) {
      total += countClaudeContentBlocks(content)
    }
  }

  // 最终服务 token
  total += FINAL_SERVICE_TOKENS

  return applyCorrection
    ? Math.floor(total * CLAUDE_CORRECTION_FACTOR)
    : total
}

/**
 * 计算 Claude 内容块的 token 数量
 */
function countClaudeContentBlocks(blocks: ClaudeContentBlock[]): number {
  let total = 0

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        total += countTokens(block.text || '', false)
        break

      case 'thinking':
        total += countTokens(block.thinking || '', false)
        break

      case 'image':
        // 图片 token 估算
        total += IMAGE_ESTIMATE_TOKENS
        break

      case 'tool_use':
        // 工具调用
        total += TOOL_OVERHEAD_TOKENS
        total += countTokens(block.name || '', false)
        // input 是对象，需要序列化
        if (block.input !== undefined) {
          total += countTokens(
            typeof block.input === 'string'
              ? block.input
              : JSON.stringify(block.input),
            false
          )
        }
        break

      case 'tool_result':
        // 工具结果
        total += TOOL_OVERHEAD_TOKENS
        total += countTokens(block.tool_use_id || '', false)
        if (typeof block.content === 'string') {
          total += countTokens(block.content, false)
        } else if (Array.isArray(block.content)) {
          total += countClaudeContentBlocks(block.content)
        }
        break
    }
  }

  return total
}
```

#### 5.3 countOpenAIMessageTokens - OpenAI 消息计数

```typescript
import type { OpenAIMessage, OpenAIToolCall } from './types.js'

/**
 * 计算 OpenAI 格式消息的 token 数量
 */
function countOpenAIMessageTokens(
  messages: OpenAIMessage[],
  applyCorrection = true
): number {
  let total = 0

  for (const msg of messages) {
    // 消息结构开销
    total += MESSAGE_OVERHEAD_TOKENS

    // role
    total += countTokens(msg.role, false)

    // content
    const content = msg.content
    if (typeof content === 'string') {
      total += countTokens(content, false)
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'text') {
          total += countTokens(part.text || '', false)
        } else if (part.type === 'image_url') {
          total += IMAGE_ESTIMATE_TOKENS
        }
      }
    }

    // tool_calls (assistant 消息)
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += TOOL_OVERHEAD_TOKENS
        total += countTokens(tc.function?.name || '', false)
        // arguments 在 OpenAI 格式中是字符串
        const args = tc.function?.arguments
        if (args !== undefined) {
          total += countTokens(
            typeof args === 'string' ? args : JSON.stringify(args),
            false
          )
        }
      }
    }

    // tool_call_id (tool 消息)
    if (msg.tool_call_id) {
      total += countTokens(msg.tool_call_id, false)
    }
  }

  // 最终服务 token
  total += FINAL_SERVICE_TOKENS

  return applyCorrection
    ? Math.floor(total * CLAUDE_CORRECTION_FACTOR)
    : total
}
```

#### 5.4 countClaudeToolsTokens - Claude 工具定义计数

```typescript
import type { ClaudeTool } from './types.js'

/**
 * 计算 Claude 格式工具定义的 token 数量
 */
function countClaudeToolsTokens(
  tools: ClaudeTool[] | undefined,
  applyCorrection = true
): number {
  if (!tools?.length) return 0

  let total = 0

  for (const tool of tools) {
    total += TOOL_OVERHEAD_TOKENS
    total += countTokens(tool.name, false)
    if (tool.description) {
      total += countTokens(tool.description, false)
    }
    if (tool.input_schema) {
      total += countTokens(JSON.stringify(tool.input_schema), false)
    }
  }

  return applyCorrection
    ? Math.floor(total * CLAUDE_CORRECTION_FACTOR)
    : total
}
```

#### 5.5 countOpenAIToolsTokens - OpenAI 工具定义计数

```typescript
import type { OpenAITool } from './types.js'

/**
 * 计算 OpenAI 格式工具定义的 token 数量
 * OpenAI 格式: { type: 'function', function: { name, description, parameters } }
 */
function countOpenAIToolsTokens(
  tools: OpenAITool[] | undefined,
  applyCorrection = true
): number {
  if (!tools?.length) return 0

  let total = 0

  for (const tool of tools) {
    total += TOOL_OVERHEAD_TOKENS

    // OpenAI 格式的工具定义在 function 字段内
    const func = tool.function
    if (func) {
      total += countTokens(func.name || '', false)
      if (func.description) {
        total += countTokens(func.description, false)
      }
      if (func.parameters) {
        total += countTokens(JSON.stringify(func.parameters), false)
      }
    }
  }

  return applyCorrection
    ? Math.floor(total * CLAUDE_CORRECTION_FACTOR)
    : total
}
```

#### 5.6 countAllTokens - 完整请求计数（导出）

```typescript
import type { ClaudeMessage, ClaudeTool, ClaudeSystemBlock } from './types.js'

/**
 * 估算请求的输入 tokens（本地计算）
 * 支持 Claude API 的 count_tokens 请求格式
 *
 * @param _model - 模型名称（预留，当前未使用）
 * @param system - 系统消息（字符串或 ClaudeSystemBlock 数组）
 * @param messages - 消息列表
 * @param tools - 工具定义列表
 */
export function countAllTokens(
  _model: string,
  system: unknown,
  messages: ClaudeMessage[],
  tools?: ClaudeTool[]
): number {
  let total = 0

  // 系统消息
  if (system) {
    if (typeof system === 'string') {
      total += countTokens(system)
    } else if (Array.isArray(system)) {
      for (const item of system as ClaudeSystemBlock[]) {
        if (typeof item === 'string') {
          total += countTokens(item)
        } else if (item?.text) {
          total += countTokens(item.text)
        }
      }
    }
  }

  // 消息
  total += countClaudeMessageTokens(messages)

  // 工具
  total += countClaudeToolsTokens(tools)

  return Math.max(total, 1)
}
```

## 实现步骤

1. **安装依赖**
   ```bash
   cd packages/backend && pnpm add js-tiktoken
   ```

2. **重写 tokenCounter.ts**
   - 替换字符单位算法为 tiktoken
   - 添加消息结构开销计算
   - 添加图片/工具调用支持
   - 保留编码器缓存
   - 区分 Claude/OpenAI 格式处理

3. **类型检查**
   ```bash
   pnpm typecheck
   ```

4. **测试验证**
   - 对比新旧算法输出差异
   - 验证中英文混合文本计算

## 修改文件

| 文件 | 操作 |
|------|------|
| `packages/backend/package.json` | 添加 `js-tiktoken` 依赖 |
| `packages/backend/src/core/tokenCounter.ts` | 重写实现 |

## 调用点分析

`countAllTokens` 函数在以下位置被调用：
- `packages/backend/src/routes/proxy.ts:261` - `/v1/messages/count_tokens` 端点

函数签名保持不变，无需修改调用方：
```typescript
export function countAllTokens(
  _model: string,
  system: unknown,
  messages: ClaudeMessage[],
  tools?: ClaudeTool[]
): number
```

## 验证方法

```bash
# 启动后端服务
pnpm dev:backend

# 测试 count_tokens 端点
curl -X POST http://localhost:3000/v1/messages/count_tokens \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5",
    "messages": [
      {"role": "user", "content": "Hello World"},
      {"role": "user", "content": "你好世界"}
    ],
    "system": "You are a helpful assistant."
  }'
```

预期输出差异：

| 输入 | 旧算法 | 新算法 (预估) |
|------|--------|---------------|
| "Hello World" | ~4 tokens | ~3 tokens |
| "你好世界" | ~4 tokens | ~6 tokens |
| 混合文本 | 偏高 | 更接近实际 |

## 审查问题修复清单

- [x] **High**: `getEncoding()` 函数名冲突 → 重命名为 `getTokenEncoder()`
- [x] **High**: messages 类型缺少 tool_calls/tool_call_id → 使用正确的 `ClaudeMessage`/`OpenAIMessage` 类型
- [x] **High**: tool_calls.function.arguments 类型处理 → 添加类型判断和 JSON.stringify
- [x] **Medium**: tools 格式兼容性 → 区分 Claude/OpenAI 格式，分别处理
- [x] **Medium**: 修正系数风险说明 → 添加风险提示和建议
- [x] **Low**: 图片 token 估算 → 调整为 200 并添加说明
