# 缓存问题排查指南

## 已修复的问题

### 问题根源
1. **时间戳注入**（translator.ts:74-76）每次请求都变化，导致：
   - 缓存权重基于原始 `request.system`（稳定）
   - Token 估算基于注入后内容（含时间戳，不稳定）
   - **权重不匹配** → 比例计算错误 → `input_tokens` 显示错误

2. **解决方案**：
   - 缓存追踪：基于用户原始 `request.system` 和 `request.tools`
   - Token 估算：过滤注入内容（时间戳、执行指令），保持口径一致

## 测试步骤

### 1. 启动服务并查看日志

```bash
cd /Users/mac/git/person/gateway
npm run dev
```

### 2. 发送第一次请求

```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "claude-opus-4-6",
    "max_tokens": 1024,
    "system": "You are a helpful AI assistant with deep knowledge in programming.",
    "messages": [
      {
        "role": "user",
        "content": "hi"
      }
    ]
  }'
```

### 3. 查看日志输出

应该看到以下日志：

```
[ProxyServer] Incoming Claude request {
  model: 'claude-opus-4-6',
  hasSystem: true,
  systemType: 'string',
  systemLength: 68,
  hasTools: false,
  toolsCount: 0,
  messageCount: 1
}

[CacheTracker] Cache ratio calculation {
  model: 'claude-opus-4-6',
  blocksFound: 1,
  totalWeight: XXX,
  hasSystem: true,
  systemType: 'string',
  hasTools: false,
  toolsCount: 0,
  messageCount: 1,
  blockWeights: [{ hash: 'abcd1234', weight: XXX }]
}

[CacheTracker] Token split result {
  ratio: {
    cacheCreationWeight: XXX,
    cacheReadWeight: 0,
    uncachedWeight: YYY,
    totalWeight: ZZZ
  },
  actualInputTokens: 1500,
  result: {
    cacheCreationTokens: ~1400,
    cacheReadTokens: 0,
    uncachedTokens: ~100,  // 应该接近用户消息的 token 数
    totalInputTokens: 1500
  }
}

[ProxyServer] Final token allocation {
  uncachedInputTokens: ~100,  // 这个值应该接近用户消息 "hi" 的 tokens
  totalInputTokens: 1500,
  cacheCreationTokens: ~1400,
  cacheReadTokens: 0
}
```

### 4. 检查响应

第一次请求响应应该包含：

```json
{
  "usage": {
    "input_tokens": 100,  // 应该很小，接近 "hi" 的 tokens
    "output_tokens": 50,
    "cache_creation_input_tokens": 1400,  // 系统提示词
    "cache_read_input_tokens": 0
  }
}
```

### 5. 发送第二次请求（相同系统提示词）

```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "claude-opus-4-6",
    "max_tokens": 1024,
    "system": "You are a helpful AI assistant with deep knowledge in programming.",
    "messages": [
      {
        "role": "user",
        "content": "What is Python?"
      }
    ]
  }'
```

### 6. 查看第二次请求的日志

应该看到：

```
[CacheTracker] Token split result {
  ratio: {
    cacheCreationWeight: 0,
    cacheReadWeight: XXX,  // 命中缓存
    uncachedWeight: YYY,
    totalWeight: ZZZ
  },
  actualInputTokens: 1500,
  result: {
    cacheCreationTokens: 0,
    cacheReadTokens: ~1400,  // 从缓存读取
    uncachedTokens: ~100,
    totalInputTokens: 1500
  }
}
```

### 7. 检查第二次响应

```json
{
  "usage": {
    "input_tokens": 100,  // 仍然很小
    "output_tokens": 150,
    "cache_creation_input_tokens": 0,  // 没有新缓存创建
    "cache_read_input_tokens": 1400  // 从缓存读取（10% 费用）
  }
}
```

## 常见问题

### 问题 1: `input_tokens` 仍然是 2000

**可能原因**：
1. 请求中没有 `system` 字段
2. `system` 是空字符串
3. Redis 连接失败，fallback 到 all-uncached

**检查**：
- 查看日志中的 `hasSystem` 和 `systemLength`
- 查看 `blocksFound`（应该 > 0）
- 查看 `cacheCreationWeight`（应该 > 0）

### 问题 2: 第二次请求仍然显示 `cache_creation_input_tokens`

**可能原因**：
1. 系统提示词内容不完全相同
2. 缓存 TTL 过期（5 分钟）
3. Redis key 不一致

**检查**：
- 确保两次请求的 `system` 字段完全相同
- 5 分钟内发送第二次请求
- 查看日志中的 block hash 是否相同

### 问题 3: `blocksFound: 0`

**可能原因**：
请求格式不正确

**检查**：
```javascript
// 正确格式
{
  "system": "Your prompt here",  // 字符串
  "messages": [...]
}

// 或者数组格式
{
  "system": [
    { "type": "text", "text": "Your prompt here" }
  ],
  "messages": [...]
}
```

## 调试命令

### 查看 Redis 缓存

```bash
redis-cli
> KEYS gateway:cache:*
> TTL gateway:cache:{accountId}:{hash}
```

### 清除缓存（重新测试）

```bash
redis-cli
> FLUSHDB
```

## 预期成本节省

### 第一次请求
- 系统提示词: 1400 tokens × 1.25 = 1750 token 等价
- 用户输入: 100 tokens
- **总计**: 1850 token 等价

### 第二次请求
- 系统提示词: 1400 tokens × 0.1 = 140 token 等价
- 用户输入: 100 tokens
- **总计**: 240 token 等价

**节省**: ~87% 的输入 token 成本！
