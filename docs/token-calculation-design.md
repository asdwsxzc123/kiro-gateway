# Token 计算设计文档

## 1. 问题背景

Gateway 返回给 Claude Code 的 `input_tokens` 与 Claude Code 自身计算的 token 数存在差异。

### 1.1 差异来源

| 方面 | Gateway | Claude Code |
|------|---------|-------------|
| **统计口径** | `inputTokens = uncached + cacheRead + cacheWrite` | 只统计 `uncached` |
| **Tokenizer** | 简化估算算法 | 官方 tokenizer |
| **数据来源** | `message_start` 使用本地估算值 | 期望 API 返回的真实值 |

### 1.2 具体问题

1. **`message_start` 事件中的 `input_tokens` 使用粗糙估算**：
   ```typescript
   // proxyServer.ts:1122
   const estimatedInputTokens = Math.max(1, Math.round(JSON.stringify(kiroPayload).length / 3))
   ```

2. **模型映射缺失**：`claude-sonnet-4-20250529` 未在 `kiroApi.ts` 中映射

---

## 2. Token 计算架构

### 2.1 数据流

```
用户请求
    ↓
[Claude 请求] → calculateCacheRatio() → 提取可缓存块，Redis 原子判定
    ↓
claudeToKiro() → 格式转换
    ↓
callKiroApi() → 调用 Kiro API
    ↓
parseEventStream() → 提取 messageMetadataEvent
    ↓
获取 API 返回的 token：
  - uncachedInputTokens
  - cacheReadInputTokens
  - cacheWriteInputTokens
  - outputTokens
    ↓
splitTokensByRatio() → 根据缓存比例拆分 token
    ↓
calculateCost() → 计算费用
    ↓
返回给客户端（message_start / message_delta）
```

### 2.2 关键模块

| 模块 | 文件路径 | 职责 |
|------|---------|------|
| 本地 Token 估算 | `core/tokenCounter.ts` | 基于字符的 token 估算 |
| API 响应解析 | `core/kiroApi.ts` | 从 Kiro API 提取真实 token |
| 缓存追踪 | `core/cacheTracker.ts` | 计算缓存比例，拆分 token |
| 费用计算 | `core/pricing.ts` | 根据模型和 token 计算费用 |
| 代理处理 | `core/proxyServer.ts` | 组装响应，发送给客户端 |

---

## 3. 本地 Token 估算算法

### 3.1 当前算法 (`tokenCounter.ts`)

```typescript
function countTokens(text: string): number {
  let charUnits = 0
  for (const c of text) {
    // 非西文字符（中文、日文等）：每字符 = 4 字符单位
    // 西文字符：每字符 = 1 字符单位
    charUnits += isNonWesternChar(c) ? 4.0 : 1.0
  }
  const tokens = charUnits / 4.0

  // 应用加权系数
  // <100 tokens: 1.5x
  // <200 tokens: 1.3x
  // <300 tokens: 1.25x
  // <800 tokens: 1.2x
  // ≥800 tokens: 1.0x
  return Math.floor(accToken)
}
```

### 3.2 估算范围

- 系统消息（string 或 array 格式）
- 用户消息内容（text blocks）
- 工具定义（name + description + input_schema）

---

## 4. API 返回的 Token 类型

### 4.1 Kiro API `messageMetadataEvent`

```typescript
// kiroApi.ts:701-717
if (eventType === 'messageMetadataEvent') {
  const tokenUsage = metadata.tokenUsage
  usage.inputTokens = uncachedInputTokens + cacheReadInputTokens + cacheWriteInputTokens
  usage.outputTokens = tokenUsage.outputTokens
  usage.cacheReadTokens = cacheReadInputTokens
  usage.cacheWriteTokens = cacheWriteInputTokens
}
```

### 4.2 Token 字段说明

| 字段 | 说明 |
|------|------|
| `uncachedInputTokens` | 未缓存的输入 token（需要完整计算） |
| `cacheReadInputTokens` | 缓存读取 token（从缓存读取，费用较低） |
| `cacheWriteInputTokens` | 缓存写入 token（写入缓存，费用较高） |
| `outputTokens` | 输出 token |

---

## 5. 流式响应中的 Token 传递

### 5.1 `message_start` 事件

**当前实现**（使用估算值）：
```typescript
// proxyServer.ts:1259
usage: { input_tokens: estimatedInputTokens, output_tokens: 0 }
```

**问题**：Claude Code 可能从此事件读取 `input_tokens`，导致显示估算值。

### 5.2 `message_delta` 事件

**当前实现**（使用真实值）：
```typescript
// proxyServer.ts:1516-1523
usage: {
  input_tokens: usage.inputTokens,
  output_tokens: usage.outputTokens,
  ...(cacheWriteTokens ? { cache_creation_input_tokens: cacheWriteTokens } : {}),
  ...(cacheReadTokens ? { cache_read_input_tokens: cacheReadTokens } : {})
}
```

---

## 6. 修复方案

### 6.1 改进 `message_start` 中的 token 估算

**方案 A**：使用 `countAllTokens` 函数

```typescript
import { countAllTokens } from './tokenCounter.js'

// 替换 proxyServer.ts:1122
const estimatedInputTokens = countAllTokens(model, request.system, request.messages, request.tools)
```

**方案 B**：在 `message_start` 中发送 0，只在 `message_delta` 中发送真实值

```typescript
usage: { input_tokens: 0, output_tokens: 0 }
```

**推荐方案 A**，因为 Claude API 规范要求 `message_start` 中包含 `input_tokens`。

### 6.2 添加模型映射

```typescript
// kiroApi.ts MODEL_ID_MAP
'claude-sonnet-4-20250529': 'claude-sonnet-4',
```

---

## 7. 统计口径对齐（可选）

### 7.1 当前口径

Gateway 统计的 `inputTokens` 包含所有输入 token：
```
inputTokens = uncached + cacheRead + cacheWrite
```

### 7.2 Claude Code 期望口径

可能只统计未缓存的 token：
```
inputTokens = uncached
```

### 7.3 对齐方案

如需对齐，修改 `message_delta` 中的 `input_tokens`：

```typescript
// 只返回未缓存的 token
usage: {
  input_tokens: cacheCalc?.uncachedTokens ?? usage.inputTokens,
  output_tokens: usage.outputTokens,
  cache_creation_input_tokens: cacheWriteTokens,
  cache_read_input_tokens: cacheReadTokens
}
```

---

## 8. 关键文件清单

| 文件 | 行号 | 说明 |
|------|------|------|
| `core/proxyServer.ts` | 1122 | `estimatedInputTokens` 计算 |
| `core/proxyServer.ts` | 1259 | `message_start` 事件 |
| `core/proxyServer.ts` | 1516-1523 | `message_delta` 事件 |
| `core/kiroApi.ts` | 60-78 | `MODEL_ID_MAP` |
| `core/kiroApi.ts` | 701-717 | Token 提取逻辑 |
| `core/tokenCounter.ts` | 全文件 | 本地 token 估算 |
| `core/cacheTracker.ts` | 249-299 | `splitTokensByRatio` |
| `core/pricing.ts` | 368-397 | `calculateCost` |
