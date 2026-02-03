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
  7. 按权重拆分（最大余数法）:
     - 三个分量各自 floor(inputTokens × 权重/总权重)
     - 余数按小数部分降序逐个 +1，保证三项之和 === inputTokens
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

### Step 1b: 同步 shared 包类型定义

**文件**: `packages/shared/src/types/index.ts`

当前 shared 包的 `ProxyStats` 缺少 `cacheCreationTokens` 和 `cacheReadTokens` 字段，导致前端无法显示缓存统计。需同步添加：

```typescript
// packages/shared/src/types/index.ts — ProxyStats
export interface ProxyStats {
  // ... 现有字段
  cacheCreationTokens: number   // 新增
  cacheReadTokens: number       // 新增
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
  uncachedTokens: number        // 未标记 cache_control 的 token
  cacheCreationTokens: number   // 首次出现的 cache_control token
  cacheReadTokens: number       // 重复出现的 cache_control token
  totalInputTokens: number      // 等于 API 返回的 inputTokens
}
```

#### 稳定序列化规范

哈希计算的前置条件：所有内容必须经过 **稳定序列化**，确保相同内容始终产生相同哈希。

##### `stableStringify(value: unknown): string`

递归 JSON 序列化函数，保证 object key 在所有嵌套层级按字典序排列：

```typescript
function stableStringify(value: unknown): string {
  // null
  if (value === null) return 'null'
  // undefined → 顶层返回 undefined（与 JSON.stringify 一致），
  // 但此函数不应被顶层传入 undefined，undefined 仅在对象值中出现时被跳过（见下方 object 分支）
  if (value === undefined) return undefined as unknown as string
  // 基本类型
  if (typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`stableStringify: unsupported number ${value}`)
    return Object.is(value, -0) ? '"0"' : JSON.stringify(value)  // -0 → "0"（与 JSON.stringify 一致，但显式处理）
  }
  if (typeof value === 'string') return JSON.stringify(value)
  // 数组
  if (Array.isArray(value)) {
    const items = value.map(item => {
      const s = stableStringify(item)
      return s === undefined ? 'null' : s   // undefined 在数组中序列化为 null（JSON 标准）
    })
    return '[' + items.join(',') + ']'
  }
  // 普通对象：key 按字典序排列
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    const pairs: string[] = []
    for (const key of keys) {
      const v = stableStringify((value as Record<string, unknown>)[key])
      if (v !== undefined) {   // undefined 值的 key 被跳过（JSON 标准）
        pairs.push(JSON.stringify(key) + ':' + v)
      }
    }
    return '{' + pairs.join(',') + '}'
  }
  // 不支持的类型（Date、Map、Set、BigInt、function、symbol 等）
  // NaN、Infinity、-0 已在 number 分支拦截
  throw new TypeError(`stableStringify: unsupported type ${typeof value}`)
}
```

**JSON 安全限制**：此函数仅处理 JSON 安全类型（string、number、boolean、null、Array、plain Object）。Date、Map、Set、BigInt、NaN、Infinity、-0 等类型不会出现在 Claude API 的 content block 中，如果出现则视为编程错误，抛出 TypeError。

##### `stableHashInput(block: ClaudeContentBlock | ClaudeSystemBlock): string`

针对不同 block 类型，提取关键内容字段（**不包含** `cache_control` 本身），返回用于 SHA-256 的稳定字符串：

```typescript
function stableHashInput(block: ClaudeContentBlock | ClaudeSystemBlock): string {
  switch (block.type) {
    case 'text':
      return stableStringify({ type: block.type, text: block.text })
    case 'image':
      return stableStringify({ type: block.type, source: block.source })
    case 'tool_use':
      return stableStringify({ type: block.type, id: block.id, name: block.name, input: block.input })
    case 'tool_result':
      return stableStringify({ type: block.type, tool_use_id: block.tool_use_id, content: block.content })
    case 'thinking':
      return stableStringify({ type: block.type, thinking: block.thinking })
    default:
      // 未知类型：提取除 cache_control 外的所有字段
      const { cache_control, ...rest } = block as Record<string, unknown>
      return stableStringify(rest)
  }
}
```

**注意**：`stableStringify` 确保所有嵌套层级（如 `tool_use.input` 内部的对象）都按字典序序列化，消除 JSON.stringify 的 key 顺序不确定性问题。

#### 哈希计算

```typescript
// hash = SHA-256(stableHashInput(block))
// 权重 = stableHashInput(block).length
```

支持所有带 `cache_control` 的 block 类型（text、image、tool_use、tool_result、thinking）。

#### 核心函数

```typescript
// 从 Claude 请求中提取所有带 cache_control: { type: 'ephemeral' } 的内容块，计算哈希
// 提取范围：request.system（ClaudeSystemBlock[]）+ request.messages[*].content（ClaudeContentBlock[]）
// string 类型的 system 和 content 不可能带 cache_control，直接跳过
// 注意：只读取内容用于计算哈希，不存储内容本身
export function extractCacheableBlocks(request: ClaudeRequest): CacheableBlock[]

// 估算整个请求的总权重（包含标记和未标记的内容）
// 必须使用 stableHashInput() 计算每个块的权重，确保与哈希权重口径一致
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

#### `estimateRequestWeight` 权重规范

```typescript
function estimateRequestWeight(request: ClaudeRequest): number {
  let totalWeight = 0

  // system prompt
  if (typeof request.system === 'string') {
    // 包装为 text block 再用 stableHashInput，确保口径一致
    totalWeight += stableHashInput({ type: 'text', text: request.system }).length
  } else if (Array.isArray(request.system)) {
    for (const block of request.system) {
      totalWeight += stableHashInput(block).length
    }
  }

  // messages
  for (const msg of request.messages) {
    if (typeof msg.content === 'string') {
      totalWeight += stableHashInput({ type: 'text', text: msg.content }).length
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        totalWeight += stableHashInput(block).length
      }
    }
  }

  return totalWeight
}
```

#### 原子判定逻辑（解决并发问题）

```typescript
async function calculateCacheRatio(accountId: string, request: ClaudeRequest) {
  const blocks = extractCacheableBlocks(request)
  const totalWeight = estimateRequestWeight(request)

  // blocks 为空时：所有内容都是 uncached
  if (blocks.length === 0) {
    return {
      cacheCreationWeight: 0,
      cacheReadWeight: 0,
      uncachedWeight: totalWeight,
      totalWeight
    }
  }

  let cacheReadWeight = 0
  let cacheCreationWeight = 0

  try {
    // 使用 pipeline 批量执行原子操作
    const pipeline = redis.pipeline()
    for (const block of blocks) {
      const key = `gateway:cache:${accountId}:${block.hash}`
      // SET NX EX 300: 仅当 key 不存在时写入，原子操作
      pipeline.set(key, '1', 'EX', 300, 'NX')
    }
    const results = await pipeline.exec()

    // 收集需要刷新 TTL 的 cache_read keys
    const expireKeys: string[] = []

    for (let i = 0; i < blocks.length; i++) {
      const [err, result] = results[i]
      if (result === 'OK') {
        // NX 写入成功 → 首次出现 → cache_creation
        cacheCreationWeight += blocks[i].weight
      } else {
        // NX 写入失败 → 已存在 → cache_read
        cacheReadWeight += blocks[i].weight
        expireKeys.push(`cache:${accountId}:${blocks[i].hash}`)
      }
    }

    // 批量刷新 TTL（使用 pipeline，避免逐个 await 的 RTT 开销）
    if (expireKeys.length > 0) {
      const expirePipeline = redis.pipeline()
      for (const key of expireKeys) {
        expirePipeline.expire(key, 300)
      }
      await expirePipeline.exec()
    }
  } catch (error) {
    // Redis 故障时降级：所有标记块视为 uncached，不影响请求正常转发
    logger.warn('calculateCacheRatio Redis error, degrading to all-uncached', { error })
    return {
      cacheCreationWeight: 0,
      cacheReadWeight: 0,
      uncachedWeight: totalWeight,
      totalWeight
    }
  }

  // 未标记 cache_control 的内容权重
  const markedWeight = cacheReadWeight + cacheCreationWeight
  const uncachedWeight = Math.max(0, totalWeight - markedWeight)

  return { cacheCreationWeight, cacheReadWeight, uncachedWeight, totalWeight }
}
```

#### `splitTokensByRatio` — 最大余数法

```typescript
function splitTokensByRatio(ratio: CacheRatio, actualInputTokens: number): CacheCalculation {
  if (ratio.totalWeight === 0) {
    return {
      uncachedTokens: actualInputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalInputTokens: actualInputTokens
    }
  }

  const total = actualInputTokens

  // 1. 计算精确浮点值
  const exactCreation = total * (ratio.cacheCreationWeight / ratio.totalWeight)
  const exactRead = total * (ratio.cacheReadWeight / ratio.totalWeight)
  const exactUncached = total * (ratio.uncachedWeight / ratio.totalWeight)

  // 2. 全部 floor
  let creation = Math.floor(exactCreation)
  let read = Math.floor(exactRead)
  let uncached = Math.floor(exactUncached)

  // 3. 计算余数（需要分配的剩余 token 数）
  let remainder = total - creation - read - uncached

  // 4. 按小数部分降序分配余数（最大余数法）
  const fractions = [
    { key: 'creation', frac: exactCreation - creation },
    { key: 'read', frac: exactRead - read },
    { key: 'uncached', frac: exactUncached - uncached }
  ]
  // 降序排列；小数部分相同时，按固定顺序 tie-break（creation > read > uncached）
  fractions.sort((a, b) => b.frac - a.frac)

  for (const item of fractions) {
    if (remainder <= 0) break
    if (item.key === 'creation') creation++
    else if (item.key === 'read') read++
    else uncached++
    remainder--
  }

  return {
    cacheCreationTokens: creation,
    cacheReadTokens: read,
    uncachedTokens: uncached,
    totalInputTokens: total
  }
}
```

**保证**：`cacheCreationTokens + cacheReadTokens + uncachedTokens === totalInputTokens`（严格等式，由最大余数法保证）。

#### Redis Key 设计

| Key 模式 | 类型 | TTL | 值 | 说明 |
|----------|------|-----|-----|------|
| `gateway:cache:{accountId}:{hash}` | STRING | 300s | `"1"` | 哈希存在标记 |

**为什么只用单层 key？**
- 每个 key 自带 TTL，过期自动清理，无需维护集合
- 写入用 `SET NX EX 300`（原子操作，解决并发问题）
- 比 SET + STRING 双重结构更简单、更可靠

**为什么没有 `clearAccountCacheRecord`？**
- 哈希标记 5 分钟自动过期，无需主动清理
- 如果要按账号清除，需要 `SCAN gateway:cache:{accountId}:*`，在生产环境不可接受
- 没有业务场景需要"立即清除某账号的缓存标记"

---

### Step 3: 新建 `packages/backend/src/core/sessionCache.ts`（~120 行）

Sticky Session 路由模块，确保同一会话路由到同一账号。

#### Session Hash 计算优先级

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | `x-session-id` header | 客户端显式指定，取 SHA-256 前 16 字符（限长，防止恶意超长 header） |
| 2 | system prompt 哈希 | 同一 system prompt 的对话 |
| 3 | 第一条 user message 哈希 | 兜底策略 |

**注意**：之前方案的"优先级 2：cache_control 标记内容的哈希拼接"已移除 — 不同请求的 cache_control 标记会变化（如新增工具定义），导致 session hash 不稳定，造成路由抖动。

#### System Prompt Hash 计算

```typescript
function hashSystemPrompt(system: string | ClaudeSystemBlock[] | undefined): string | null {
  if (!system) return null
  if (typeof system === 'string') {
    return sha256(system).substring(0, 16)
  }
  // ClaudeSystemBlock[]：对每个 block 用 stableHashInput 序列化后拼接
  // 假设客户端保持 block 数组顺序稳定（Claude Code 始终按固定顺序发送 system blocks）
  const parts = system.map(block => stableHashInput(block))
  return sha256(parts.join('|')).substring(0, 16)
}
```

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
| `gateway:session:{hash}` | STRING | 300s | accountId | 会话→账号绑定 |

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

在 `handleClaudeRequest`（非流式）和 `handleClaudeStreamRequest`（流式）中集成缓存追踪。

**注意**：OpenAI 路径（`handleOpenAIRequest` / `handleOpenAIStreamRequest`）不需要缓存追踪 — OpenAI 格式请求不包含 `cache_control` 标记，且经过 translator 转换后 cache 语义丢失。

**非流式 vs 流式差异**：两个 handler 的集成逻辑相同，但流式路径有 `auto-continue` 递归调用（tool_use → tool_result → 递归），需要特殊处理 `currentRound` 参数。

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
// 仅在 currentRound === 0 时计算（auto-continue 递归轮次不重新计算）
// 原因：auto-continue 的后续轮次会改变请求内容（添加 tool_result），
// 重新计算会导致之前的 cache_creation 变成 cache_read，比例偏差。
// 且 auto-continue 的 token 消耗通常在同一次用户请求的计费周期内，
// 只需要首轮的缓存比例即可。
let cacheRatio: CacheRatio | null = null
if (currentRound === 0) {
  cacheRatio = await calculateCacheRatio(account.id, request)
}

// === 正常调用 Kiro API（不拦截、不跳过）===
// ... callKiroApiStream / callKiroApi ...

// === API 返回后 ===

// 3. 用真实 inputTokens 拆分（仅首轮有 cacheRatio 时执行）
let cacheCalc: CacheCalculation | null = null
if (cacheRatio) {
  cacheCalc = splitTokensByRatio(cacheRatio, usage.inputTokens)
}

// 4. 绑定 Sticky Session
if (sessionHash) {
  await setSessionAccount(sessionHash, account.id)
}

// 5. 用拆分后的 token 数进行计费
// 注意：calculateCost 的第一个参数是 TOTAL inputTokens，函数内部会减去缓存 token
// 因此必须传 cacheCalc.totalInputTokens（即 usage.inputTokens），而非 cacheCalc.uncachedTokens
const costResult = calculateCost(
  model,
  cacheCalc ? cacheCalc.totalInputTokens : usage.inputTokens,
  usage.outputTokens,
  cacheCalc?.cacheCreationTokens ?? 0,
  cacheCalc?.cacheReadTokens ?? 0
)

// 6. 更新内存统计
this.stats.cacheCreationTokens += cacheCalc?.cacheCreationTokens ?? 0
this.stats.cacheReadTokens += cacheCalc?.cacheReadTokens ?? 0

// 7. 持久化到 Redis（现有 proxyServer 未调用此方法，需要补充）
await updateGlobalStats({
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheCreationTokens: cacheCalc?.cacheCreationTokens ?? 0,
  cacheReadTokens: cacheCalc?.cacheReadTokens ?? 0,
  totalCost: costResult.totalCost
})

// 8. 记录请求日志（确保缓存字段写入 RequestLog）
await this.recordRequest({
  // ... 现有字段
  cacheCreationTokens: cacheCalc?.cacheCreationTokens ?? 0,
  cacheReadTokens: cacheCalc?.cacheReadTokens ?? 0,
  cost: costResult.totalCost
})
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
  cacheHitRate: number   // cacheReadTokens / GlobalStats.inputTokens（inputTokens=0 时返回 0）
}
```

**公式说明**：`cacheHitRate = inputTokens > 0 ? cacheReadTokens / GlobalStats.inputTokens : 0`。分母使用全局 `inputTokens` 总量（而非 `cacheRead + cacheCreation + uncached`），表示"缓存命中在总输入中的占比"，更直观反映缓存收益。系统刚启动无请求时 `inputTokens === 0`，返回 0 避免除零。

> **依赖**：`cacheHitRate` 的分母 `GlobalStats.inputTokens` 由 Step 5 中新增的 `updateGlobalStats()` 调用写入。如果 Step 5 未正确集成，此端点的 `cacheHitRate` 将不准确。

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
Step 1  (types.ts)          ─┐
Step 1b (shared/types)      ─┤
Step 2  (cacheTracker.ts)   ─┤─→ Step 5 (proxyServer.ts) → Step 6 (proxy.ts)
Step 3  (sessionCache.ts)   ─┤
Step 4  (accountPool.ts)    ─┘

Step 7 (stats 端点)  — 可独立实现
```

总新增代码量：~400 行（2 个新文件 + 5 个修改文件）

---

## 设计决策 FAQ

### Q: 为什么不缓存内容？
**A**: Gateway 的目的不是"拦截请求返回缓存"，而是"标记哪些 token 属于 cache_read"。判断"见过没有"只需要哈希比对，不需要原始内容。

### Q: 为什么用 SET NX 而不是先 EXISTS 再 SET？
**A**: 解决并发问题。两个请求同时 EXISTS 都为 false，会重复计为 cache_creation。`SET NX EX 300` 是原子操作，只有一个请求能写入成功，另一个会正确识别为 cache_read。

### Q: 为什么没有 clearAccountCacheRecord？
**A**: 哈希标记 5 分钟自动过期，无需主动清理。要按账号清除需要 `SCAN`，在生产环境不可接受。没有业务场景需要"立即清除缓存标记"。

### Q: 哈希包含哪些字段？
**A**: 包含 block 的内容字段（type、text、source、id、name、input 等），**不包含** `cache_control` 本身。不同类型的 block 通过 `stableHashInput()` 提取各自的关键字段，再经 `stableStringify()` 递归序列化（保证嵌套对象 key 排序稳定）。不包含 model 或工具配置，因为缓存标记只关心"内容是否相同"。

### Q: 非文本 block 怎么处理？
**A**: 支持所有带 `cache_control` 的 block 类型。哈希和权重计算统一使用 `stableHashInput()` —— 对每种 block type 提取关键字段，通过 `stableStringify()` 确保嵌套对象在所有层级按 key 排序，再计算 SHA-256。

### Q: Sticky Session TTL 为什么是 300s 而不是 3600s？
**A**: 与缓存哈希 TTL 对齐。如果 session 绑定（3600s）远长于缓存哈希（300s），会导致路由到"缓存已冷"的账号——session 绑定还在，但哈希标记已过期，cache_read 率为 0。对齐 TTL 后，每次请求刷新两者，活跃会话不断开；不活跃会话同步过期。

### Q: SHA-256 哈希碰撞风险？
**A**: 碰撞概率约 2^(-128)，可忽略。即使碰撞，后果仅是某个请求的 token 被错误分类为 cache_read（少计费），不影响功能。

### Q: token 估算精度够吗？
**A**: 估算只用于确定**比例**，不用于最终计费。最终 token 数来自 API 返回的真实总量。`estimateRequestWeight` 和 `extractCacheableBlocks` 统一使用 `stableHashInput().length` 作为权重，确保口径一致，比例准确。

### Q: stableStringify 为什么不支持 Date/Map/Set？
**A**: Claude API 的 content block 只包含 JSON 安全类型。非 JSON 类型不应出现在请求中，如果出现则是编程错误（抛出 TypeError 便于发现），而非静默降级。

---

## 验证方案

1. **构建**：`pnpm build && pnpm typecheck`
2. **缓存计算**：
   - 发送带 `cache_control` 标记的 Claude 请求
   - 第一次：日志显示 `cacheCreationTokens > 0`
   - 第二次（相同内容）：日志显示 `cacheReadTokens > 0`
   - 验证 `cacheCreation + cacheRead + uncached = inputTokens`（严格等式，由最大余数法保证）
   - 边界用例：发送总 token 为质数的请求（如 997），验证三项之和仍等于总量
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
