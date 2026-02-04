# 修复：kiro-gateway 流式响应缓存数据传递给 CRS

## 问题描述

从 claude-relay-service (CRS) 通过 kiro-gateway 调用时，CRS 无法获取到缓存数据：
- `cache_creation_input_tokens` 始终为 0
- `cache_read_input_tokens` 始终为 0

## 问题分析

### 数据流向
```
CRS 发送请求
  → kiro-gateway 接收 Claude 格式请求
  → translator.ts: claudeToKiro() 转换为 Kiro 格式
  → Kiro API (AWS) 返回响应（包含缓存数据）
  → kiroApi.ts: parseEventStream() 解析缓存数据 ✓
  → proxyServer.ts: 构建 message_delta 事件 ✗ (缓存数据丢失)
  → CRS 收到响应（无缓存数据）
```

### 根本原因

**问题1：kiro-gateway 的 `message_delta` 事件中没有传递缓存数据**

位置：`packages/backend/src/core/proxyServer.ts` 中 `handleClaudeStream` 方法的 `onComplete` 回调，搜索 `createClaudeStreamEvent('message_delta'`

```typescript
// 当前代码（缺少缓存字段）
const messageDelta = createClaudeStreamEvent('message_delta', {
  delta: { type: 'message_delta', stop_reason: stopReason, stop_sequence: undefined },
  usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens }  // ← 问题在这里
})
```

**问题2：CRS 只从 `message_start` 读取缓存数据，不从 `message_delta` 读取**

CRS 的 `claudeRelayService.js` 中：
- `message_start` 事件：读取 `input_tokens` 和缓存字段
- `message_delta` 事件：只读取 `output_tokens`，不读取缓存字段

但 kiro-gateway 的 `message_start` 是在请求开始时发送的，此时还没有真实的缓存数据。

### Kiro API 返回的 token 结构

```typescript
// kiroApi.ts 中的处理逻辑
const uncached = tokenUsage.uncachedInputTokens || 0
const cacheRead = tokenUsage.cacheReadInputTokens || 0
const cacheWrite = tokenUsage.cacheWriteInputTokens || 0
const calculatedInput = uncached + cacheRead + cacheWrite  // inputTokens = 总和

usage.inputTokens = calculatedInput  // 已经是总和，不需要再减
usage.cacheReadTokens = cacheRead
usage.cacheWriteTokens = cacheWrite
```

**重要**：`inputTokens` 已经是 `uncached + cacheRead + cacheWrite` 的总和，符合 Claude API 标准。

## 修改方案

### 方案 A：只修改 kiro-gateway（推荐）

在 `message_delta` 中添加缓存字段，CRS 需要同步修改以从 `message_delta` 读取缓存数据。

#### 修改文件 1：kiro-gateway
`packages/backend/src/core/proxyServer.ts`

#### 修改位置
`handleClaudeStream` 方法中，搜索 `createClaudeStreamEvent('message_delta'` 找到 `message_delta` 事件的构建位置

#### 修改内容

```typescript
// 修改前
const messageDelta = createClaudeStreamEvent('message_delta', {
  delta: { type: 'message_delta', stop_reason: stopReason, stop_sequence: undefined },
  usage: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens }
})

// 修改后（与非流式响应保持一致，仅在有值时添加字段）
const messageDelta = createClaudeStreamEvent('message_delta', {
  delta: { type: 'message_delta', stop_reason: stopReason, stop_sequence: undefined },
  usage: {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    ...(usage.cacheWriteTokens ? { cache_creation_input_tokens: usage.cacheWriteTokens } : {}),
    ...(usage.cacheReadTokens ? { cache_read_input_tokens: usage.cacheReadTokens } : {})
  }
})
```

#### 修改文件 2：CRS（需要同步修改）
`/root/git/person/claude-relay-service/src/services/claudeRelayService.js`

在 `message_delta` 事件处理中，添加缓存字段的读取：

```javascript
// 修改前（约第997行）
if (data.type === 'message_delta' && data.usage && data.usage.output_tokens !== undefined) {
  currentUsageData.output_tokens = data.usage.output_tokens || 0
  // ...
}

// 修改后
if (data.type === 'message_delta' && data.usage && data.usage.output_tokens !== undefined) {
  currentUsageData.output_tokens = data.usage.output_tokens || 0

  // 从 message_delta 读取缓存数据（kiro-gateway 在此事件中返回真实缓存数据）
  if (data.usage.cache_creation_input_tokens !== undefined) {
    currentUsageData.cache_creation_input_tokens = data.usage.cache_creation_input_tokens
  }
  if (data.usage.cache_read_input_tokens !== undefined) {
    currentUsageData.cache_read_input_tokens = data.usage.cache_read_input_tokens
  }
  // ...
}
```

### 字段映射说明
| Kiro API 返回字段 | Claude API 标准字段 |
|------------------|-------------------|
| `cacheWriteTokens` | `cache_creation_input_tokens` |
| `cacheReadTokens` | `cache_read_input_tokens` |
| `inputTokens` | `input_tokens`（已经是总和，不需要减去缓存） |

## 验证方法

1. 重启 kiro-gateway 和 CRS 服务
2. 从 CRS 发送请求（**注意：AWS 缓存由服务端自动管理，需要短时间内发送相同或相似的输入内容来触发缓存命中**）
3. 检查 CRS 日志中收到的响应：
   - 第一次请求：可能有 `cache_creation_input_tokens` > 0（AWS 创建缓存）
   - 短时间内第二次相同/相似请求：`cache_read_input_tokens` > 0（AWS 缓存命中）
4. 确认 CRS 的 usage 统计正确记录了缓存数据

## 注意事项

- **AWS 缓存机制**：Kiro API 的缓存是 AWS 服务端自动管理的，与 Claude API 的 `cache_control` 参数无关
- **cache_control 字段**：客户端发送的 `cache_control` 字段在 `claudeToKiro()` 转换时会被丢弃（这是预期行为，因为 Kiro API 不支持此参数）
- **本修改目的**：确保 Kiro API 返回的缓存统计数据能正确传递给 CRS，用于统计和计费
- **字段一致性**：修改后的代码与非流式响应（`kiroToClaudeResponse` 函数）保持一致，仅在有值时添加缓存字段
- **input_tokens 不需要调整**：Kiro API 返回的 `inputTokens` 已经是 `uncached + cacheRead + cacheWrite` 的总和，符合 Claude API 标准
