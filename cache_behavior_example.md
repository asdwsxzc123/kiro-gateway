# 提示词缓存行为说明

## 自动缓存策略

网关现在**自动将系统提示词和 tools 定义放入缓存**，无需用户手动添加 `cache_control` 标记。

## Token 分类

### 第一次请求（缓存创建）

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 1024,
  "system": "You are a helpful AI assistant...",  // ~2000 tokens
  "tools": [...],  // 工具定义
  "messages": [
    {
      "role": "user",
      "content": "hi"  // ~10 tokens
    }
  ]
}
```

**Token 使用情况：**
```json
{
  "usage": {
    "input_tokens": 10,                      // 只有用户消息 "hi"
    "output_tokens": 50,
    "cache_creation_input_tokens": 2000,     // 系统提示词 + tools（自动）
    "cache_read_input_tokens": 0
  }
}
```

### 后续请求（缓存命中）

```json
{
  "model": "claude-opus-4-6",
  "max_tokens": 1024,
  "system": "You are a helpful AI assistant...",  // 相同内容
  "tools": [...],  // 相同工具定义
  "messages": [
    {
      "role": "user",
      "content": "What's the weather?"  // ~5 tokens
    }
  ]
}
```

**Token 使用情况：**
```json
{
  "usage": {
    "input_tokens": 5,                       // 只有新的用户消息
    "output_tokens": 20,
    "cache_creation_input_tokens": 0,        // 没有新缓存创建
    "cache_read_input_tokens": 2000          // 从缓存读取（10% 费用）
  }
}
```

## 实现原理

### 1. 自动缓存识别（cacheTracker.ts）

```typescript
extractCacheableBlocks(request) {
  // 自动缓存：
  // 1. system prompt（无论是否有 cache_control）
  // 2. tools 定义
  // 3. 带 cache_control 的 message blocks
}
```

### 2. Token 估算（proxyServer.ts）

```typescript
estimateKiroPayloadInputTokens(payload) {
  // 估算总输入 tokens（包含所有内容）
  // 不过滤系统提示词和 tools
}
```

### 3. 缓存拆分

```typescript
// 按比例拆分总 tokens
splitTokensByRatio(cacheRatio, totalInputTokens) {
  return {
    uncachedTokens: 10,           // 用户真实输入
    cacheCreationTokens: 2000,    // 第一次：系统提示词 + tools
    cacheReadTokens: 0,           // 后续：从缓存读取
    totalInputTokens: 2010
  }
}
```

## 成本优势

### 第一次请求
- 系统提示词 + tools: 2000 tokens × 1.25 = 2500 token 等价费用
- 用户输入: 10 tokens
- **总计**: 2510 token 等价费用

### 后续请求
- 系统提示词 + tools: 2000 tokens × 0.1 = 200 token 等价费用
- 用户输入: 5 tokens
- **总计**: 205 token 等价费用

### 节省
- **无缓存**: 每次请求 ~2005 tokens
- **有缓存**: 第二次起只需 ~205 tokens
- **节省**: ~90% 的输入 token 成本

## 缓存生命周期

- **默认 TTL**: 5 分钟（300 秒）
- **刷新机制**: 每次命中时自动刷新 TTL
- **存储**: Redis，按账号隔离（`gateway:cache:{accountId}:{contentHash}`）

## 注意事项

1. **内容必须完全相同**：系统提示词或 tools 的任何修改都会导致缓存失效
2. **按账号隔离**：不同账号的缓存独立计算
3. **只计算比例**：实际 tokens 由 Kiro API 返回，网关只负责按比例拆分
