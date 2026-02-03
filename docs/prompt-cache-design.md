# Prompt Cache 实现方案（基于 CC 的 cache_control 标记）

## 设计原则

**只存哈希、不存内容。**

- Gateway **不拦截请求** — 每次请求都完整转发到 Kiro API
- Gateway **不缓存响应** — 不做响应级别的缓存
- Gateway **不存储内容** — 只存哈希字符串（几十字节/key）
- 哈希的唯一用途：**判断"这个内容块是否之前发送过"**，用于计费分类

> 哈希是指纹，不是照片。识别身份只需要指纹，不需要把人存下来。

### 背景

Kiro API（AWS 端）**不返回缓存 token 分类信息**，只返回 `inputTokens` 总量。
代码中 `cacheWriteTokens`/`cacheReadTokens` 字段是预留的，值始终为 0/undefined。

因此需要 Gateway **自行计算**缓存 token 分类，用于差异化计费。

---

## 核心思路

Claude Code 在请求中已经带了 `cache_control: { type: "ephemeral" }` 标记。网关需要：

1. **解析 cache_control 标记** — 识别请求中哪些内容块被标记为可缓存
2. **计算内容哈希** — 对标记块计算 SHA-256，作为"见过没有"的指纹
3. **原子查询+写入** — 用 `SET NX EX 300` 判定：写入成功 = cache_creation，写入失败 = cache_read
4. **比例拆分** — API 调用前算比例，API 返回后用真实 `inputTokens` 总量拆分
5. **Sticky Session** — 同一会话路由到同一账号，确保哈希跟踪有效
6. **缓存感知计费** — 按 Anthropic 官方价格计算四维度费用

---

## 已实现模块（feat/cache 分支）

以下模块已在当前分支实现，**不需要改动**：

| 模块 | 状态 | 说明 |
|------|------|------|
| `core/pricing.ts` | ✅ 已完成 | 四维度计费（input / output / cacheCreation / cacheRead），含价格回退逻辑 |
| `core/types.ts` | ✅ 已完成 | `ProxyStats`、`RequestLog` 已包含 `cacheCreationTokens`、`cacheReadTokens` |
| `storage/statsStore.ts` | ✅ 已完成 | `GlobalStats` 已支持缓存 token 持久化 |
| `core/proxyServer.ts` | ⚠️ 骨架就绪 | `calculateCost()` 调用已预留缓存参数，当前传 0 |

**注意**：`services/proxyService.ts` 未被任何路由引用（`routes/proxy.ts` 直接调用 `ProxyServer`），本方案不修改该文件。

---

## 数据流概览

```
请求进来 (API 调用前):
  1. 提取 x-session-id header
  2. 计算 session hash → 查 Redis → Sticky 路由到绑定账号
  3. 提取所有 cache_control 标记块 → 计算 SHA-256 哈希
  4. 对每个哈希: SET NX EX 300 (原子判定+写入)
     - 写入成功 → cache_creation
     - 写入失败(已存在) → cache_read，刷新 TTL
  5. 用字符数估算每个块的"权重"（占总输入的比例）

正常调用 Kiro API (不拦截、不跳过)

API 返回后:
  6. 拿到真实 inputTokens 总量
  7. 按权重拆分:
     - cacheReadTokens = inputTokens × (cache_read权重 / 总权重)
     - cacheCreationTokens = inputTokens × (cache_creation权重 / 总权重)
     - uncachedTokens = inputTokens - cacheReadTokens - cacheCreationTokens
  8. 绑定 Sticky Session
  9. 用拆分后的 token 数进行四维度计费
```

**关键**：比例计算在 API 调用前完成，token 拆分在 API 返回后完成，确保使用真实总量。

---

## 待实现步骤

### Step 1: 修改类型定义（~10 行）

**文件**: `packages/backend/src/core/types.ts`

为 Claude 消息类型添加 `cache_control` 字段：

```typescript
// ClaudeRequest.system 中的 block
export interface ClaudeSystemBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }  // 新增
}

// ClaudeMessage.content 中的 block
export interface ClaudeContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'thinking'
  text?: string
  // ... 其他已有字段
  cache_control?: { type: 'ephemeral' }  // 新增
}
```

---

### Step 2: 新建 `packages/backend/src/core/cacheTracker.ts`（~150 行）

纯哈希标记模块，**不存储任何内容**。

#### 数据结构

```typescript
// 哈希标记（不包含原始内容）
interface CacheableBlock {
  hash: string      // SHA-256 哈希（内容指纹）
  weight: number    // 估算字符数（用于确定比例）
}

// 缓存比例计算结果（API 调用前）
interface CacheRatio {
  cacheCreationWeight: number   // cache_creation 块的总权重
  cacheReadWeight: number       // cache_read 块的总权重
  uncachedWeight: number        // 未标记 cache_control 的内容权重
  totalWeight: number           // 总权重
}

// 缓存 token 拆分结果（API 返回后）
interface CacheCalculation {
  inputTokens: number           // 未标记 cache_control 的 token
  cacheCreationTokens: number   // 首次出现的 cache_control token
  cacheReadTokens: number       // 重复出现的 cache_control token
  totalInputTokens: number      // 等于 API 返回的 inputTokens
}
```

#### 哈希规范

哈希计算包含以下字段，**不包含** `cache_control` 本身（它是标记，不是内容）：

```typescript
// 文本块: hash = SHA-256(JSON.stringify({ type, text }))
// 工具块: hash = SHA-256(JSON.stringify({ type, id, name, input }))
// 图片块: hash = SHA-256(JSON.stringify({ type, source }))
// 其他块: hash = SHA-256(JSON.stringify(block内容，排除cache_control))
```

支持所有带 `cache_control` 的 block 类型（text、image、tool_use、tool_result、thinking）。
对非文本 block 的权重估算使用 `JSON.stringify(block).length` 作为字符数。

#### 核心函数

```typescript
// 从 Claude 请求中提取 cache_control 标记的内容块，计算哈希
// 注意：只读取内容用于计算哈希，不存储内容本身
export function extractCacheableBlocks(request: ClaudeRequest): CacheableBlock[]

// 估算整个请求的总权重（包含标记和未标记的内容）
// 使用同一个估算逻辑，确保口径一致
export function estimateRequestWeight(request: ClaudeRequest): number

// 原子判定+写入，返回缓存比例（API 调用前调用）
export async function calculateCacheRatio(
  accountId: string,
  request: ClaudeRequest
): Promise<CacheRatio>

// 根据比例和 API 返回的真实 token 总量，拆分为三类（API 返回后调用）
export function splitTokensByRatio(
  ratio: CacheRatio,
  actualInputTokens: number
): CacheCalculation
```

#### 原子判定逻辑（解决并发问题）

```typescript
async function calculateCacheRatio(accountId: string, request: ClaudeRequest) {
  const blocks = extractCacheableBlocks(request)
  let cacheReadWeight = 0
  let cacheCreationWeight = 0

  // 使用 pipeline 批量执行原子操作
  const pipeline = redis.pipeline()
  for (const block of blocks) {
    const key = `cache:${accountId}:${block.hash}`
    // SET NX EX 300: 仅当 key 不存在时写入，原子操作
    pipeline.set(key, '1', 'EX', 300, 'NX')
  }
  const results = await pipeline.exec()

  for (let i = 0; i < blocks.length; i++) {
    const [err, result] = results[i]
    if (result === 'OK') {
      // NX 写入成功 → 首次出现 → cache_creation
      cacheCreationWeight += blocks[i].weight
    } else {
      // NX 写入失败 → 已存在 → cache_read
      cacheReadWeight += blocks[i].weight
      // 刷新 TTL（保持活跃的缓存不过期）
      await redis.expire(`cache:${accountId}:${blocks[i].hash}`, 300)
    }
  }

  // 未标记 cache_control 的内容权重
  const totalWeight = estimateRequestWeight(request)
  const markedWeight = cacheReadWeight + cacheCreationWeight
  const uncachedWeight = Math.max(0, totalWeight - markedWeight)

  return { cacheCreationWeight, cacheReadWeight, uncachedWeight, totalWeight }
}

function splitTokensByRatio(ratio: CacheRatio, actualInputTokens: number): CacheCalculation {
  if (ratio.totalWeight === 0) {
    return { inputTokens: actualInputTokens, cacheCreationTokens: 0, cacheReadTokens: 0, totalInputTokens: actualInputTokens }
  }

  // 按比例拆分真实 token 总量
  const cacheCreationTokens = Math.round(actualInputTokens * (ratio.cacheCreationWeight / ratio.totalWeight))
  const cacheReadTokens = Math.round(actualInputTokens * (ratio.cacheReadWeight / ratio.totalWeight))
  // 保底：确保三部分之和等于总量，防止四舍五入误差
  const inputTokens = Math.max(0, actualInputTokens - cacheCreationTokens - cacheReadTokens)

  return { inputTokens, cacheCreationTokens, cacheReadTokens, totalInputTokens: actualInputTokens }
}
```

#### Redis Key 设计

| Key 模式 | 类型 | TTL | 值 | 说明 |
|----------|------|-----|-----|------|
| `cache:{accountId}:{hash}` | STRING | 300s | `"1"` | 哈希存在标记 |

**为什么只用单层 key？**
- 每个 key 自带 TTL，过期自动清理，无需维护集合
- 写入用 `SET NX EX 300`（原子操作，解决并发问题）
- 比 SET + STRING 双重结构更简单、更可靠

**为什么没有 `clearAccountCacheRecord`？**
- 哈希标记 5 分钟自动过期，无需主动清理
- 如果要按账号清除，需要 `SCAN cache:{accountId}:*`，在生产环境不可接受
- 没有业务场景需要"立即清除某账号的缓存标记"

---

### Step 3: 新建 `packages/backend/src/core/sessionCache.ts`（~120 行）

Sticky Session 路由模块，确保同一会话路由到同一账号。

#### Session Hash 计算优先级

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | `x-session-id` header | 客户端显式指定 |
| 2 | cache_control 标记内容的哈希拼接 | 同样的缓存内容路由到同一账号 |
| 3 | system prompt 哈希 | 同一 system prompt 的对话 |
| 4 | 第一条 user message 哈希 | 兜底策略 |

#### 核心函数

```typescript
// 计算会话哈希
export function computeSessionHash(request: ClaudeRequest, sessionHeader?: string): string | null

// 查询会话绑定的账号
export async function getSessionAccount(hash: string): Promise<string | null>

// 绑定会话到账号
export async function setSessionAccount(hash: string, accountId: string): Promise<void>
```

#### Redis Key

| Key 模式 | 类型 | TTL | 值 | 说明 |
|----------|------|-----|-----|------|
| `session:{hash}` | STRING | 300s | accountId | 会话→账号绑定 |

**TTL 设为 300s（与缓存哈希对齐）**：
- 之前设计是 3600s，但缓存哈希 300s 就过期了
- 如果 session 绑定还在但缓存哈希已过期，会导致路由到"缓存已冷"的账号
- 对齐 TTL 确保 session 绑定和缓存标记同步过期
- 每次请求成功后刷新 TTL，活跃会话不会断开

#### 失效处理

- session 绑定的账号不可用（cooldown/disabled）→ fallback 到轮询
- session key 过期 → 下次请求重新分配账号
- 账号被删除 → 查到的 accountId 无效，fallback 到轮询

---

### Step 4: 修改 `packages/backend/src/core/accountPool.ts`（+15 行）

新增按 ID 获取可用账号的方法：

```typescript
// 如果指定账号可用则返回，否则返回 null（由调用方 fallback 到轮询）
getAccountIfAvailable(id: string): ProxyAccount | null
```

检查条件：账号存在 + isAvailable + 不在 cooldown 期 + 不需要 refresh。

---

### Step 5: 修改 `packages/backend/src/core/proxyServer.ts`（~60 行）

在 `handleClaudeStreamRequest` 和 `handleClaudeRequest` 中集成：

```typescript
// === API 调用前 ===

// 1. Sticky Session：尝试路由到绑定账号
const sessionHash = computeSessionHash(request, headers?.['x-session-id'])
let account: ProxyAccount | null = null

if (sessionHash) {
  const stickyAccountId = await getSessionAccount(sessionHash)
  if (stickyAccountId) {
    account = this.accountPool.getAccountIfAvailable(stickyAccountId)
  }
}
if (!account) {
  account = await this.getAvailableAccount()
}

// 2. 计算缓存比例（原子判定+写入）
const cacheRatio = await calculateCacheRatio(account.id, request)

// === 正常调用 Kiro API（不拦截、不跳过）===
// ... callKiroApiStream ...

// === API 返回后 ===

// 3. 用真实 inputTokens 拆分
const cacheCalc = splitTokensByRatio(cacheRatio, usage.inputTokens)

// 4. 绑定 Sticky Session
if (sessionHash) {
  await setSessionAccount(sessionHash, account.id)
}

// 5. 用拆分后的 token 数进行计费
const costResult = calculateCost(
  model,
  cacheCalc.inputTokens,
  usage.outputTokens,
  cacheCalc.cacheCreationTokens,
  cacheCalc.cacheReadTokens
)

// 6. 更新统计和日志
// ... recordRequest / updateStats ...
```

---

### Step 6: 修改 `packages/backend/src/routes/proxy.ts`（+6 行）

提取 `x-session-id` header 并传入 handler：

```typescript
const sessionId = req.headers['x-session-id'] as string | undefined
// 传入 headers 对象中，或作为独立参数
```

---

### Step 7: 缓存统计端点（+40 行，可独立实现）

#### 修改 `packages/backend/src/services/statsService.ts`

StatsOverview 新增 cache 字段：

```typescript
cache: {
  cacheCreationTokens: number
  cacheReadTokens: number
  cacheHitRate: number   // cacheRead / (cacheRead + cacheCreation + uncached)
}
```

#### 修改 `packages/backend/src/routes/stats.ts`

新增端点：`GET /api/stats/cache`

**认证**：JWT

**响应**：
```json
{
  "success": true,
  "data": {
    "cacheCreationTokens": 45678,
    "cacheReadTokens": 23456,
    "cacheHitRate": 0.339
  }
}
```

---

## 实现顺序与依赖

```
Step 1 (types.ts)          ─┐
Step 2 (cacheTracker.ts)   ─┤─→ Step 5 (proxyServer.ts) → Step 6 (proxy.ts)
Step 3 (sessionCache.ts)   ─┤
Step 4 (accountPool.ts)    ─┘

Step 7 (stats 端点)  — 可独立实现
```

总新增代码量：~400 行（2 个新文件 + 4 个修改文件）

---

## 设计决策 FAQ

### Q: 为什么不缓存内容？
**A**: Gateway 的目的不是"拦截请求返回缓存"，而是"标记哪些 token 属于 cache_read"。判断"见过没有"只需要哈希比对，不需要原始内容。

### Q: 为什么用 SET NX 而不是先 EXISTS 再 SET？
**A**: 解决并发问题。两个请求同时 EXISTS 都为 false，会重复计为 cache_creation。`SET NX EX 300` 是原子操作，只有一个请求能写入成功，另一个会正确识别为 cache_read。

### Q: 为什么没有 clearAccountCacheRecord？
**A**: 哈希标记 5 分钟自动过期，无需主动清理。要按账号清除需要 `SCAN`，在生产环境不可接受。没有业务场景需要"立即清除缓存标记"。

### Q: 哈希包含哪些字段？
**A**: 包含 block 的内容字段（type、text、source、id、name、input 等），**不包含** `cache_control` 本身。不同类型的 block 使用各自的关键字段。不包含 model 或工具配置，因为缓存标记只关心"内容是否相同"。

### Q: 非文本 block 怎么处理？
**A**: 支持所有带 `cache_control` 的 block 类型。哈希计算使用 JSON 序列化后的内容，权重估算使用序列化后的字符数。

### Q: Sticky Session TTL 为什么是 300s 而不是 3600s？
**A**: 与缓存哈希 TTL 对齐。如果 session 绑定（3600s）远长于缓存哈希（300s），会导致路由到"缓存已冷"的账号——session 绑定还在，但哈希标记已过期，cache_read 率为 0。对齐 TTL 后，每次请求刷新两者，活跃会话不断开；不活跃会话同步过期。

### Q: SHA-256 哈希碰撞风险？
**A**: 碰撞概率约 2^(-128)，可忽略。即使碰撞，后果仅是某个请求的 token 被错误分类为 cache_read（少计费），不影响功能。

### Q: token 估算精度够吗？
**A**: 估算只用于确定**比例**，不用于最终计费。最终 token 数来自 API 返回的真实总量。估算函数对所有块使用同一逻辑（字符数），确保口径一致，比例准确。

---

## 验证方案

1. **构建**：`pnpm build && pnpm typecheck`
2. **缓存计算**：
   - 发送带 `cache_control` 标记的 Claude 请求
   - 第一次：日志显示 `cacheCreationTokens > 0`
   - 第二次（相同内容）：日志显示 `cacheReadTokens > 0`
   - 验证 `cacheCreation + cacheRead + uncached = inputTokens`
3. **并发验证**：
   - 同时发送两个相同请求
   - 只有一个应计为 cache_creation，另一个为 cache_read
4. **Sticky Session**：
   - 发送多轮请求，确认路由到同一账号
   - 日志中确认 session hash 和账号绑定
5. **TTL 验证**：
   - 等待 5 分钟后发送相同请求
   - 应该重新计为 `cacheCreationTokens`（哈希标记已过期）
6. **Fallback 验证**：
   - 禁用 sticky 绑定的账号
   - 确认请求 fallback 到其他可用账号

---

## 参考：Anthropic Prompt Caching 定价

以 claude-opus-4-5 为例：

| 类型 | 价格 ($/MTok) | 相对输入价 |
|------|-------------|-----------|
| 标准输入 | $5.00 | 100% |
| 缓存创建（≤5min） | $6.25 | 125% |
| **缓存读取** | **$0.50** | **10%** |
| 标准输出 | $25.00 | — |

**核心收益**：缓存读取价格仅为标准输入的 **1/10**，多轮对话中 system prompt 和历史消息的重复传输可获得显著节省。
