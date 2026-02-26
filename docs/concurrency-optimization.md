# 并发处理优化方案

## 根因：全局队列 + 账号级限制 = 队头阻塞（Head-of-Line Blocking）

### 问题模型

两套并发控制互不协调：

```
请求流转顺序（proxyServer.ts）：
Line 839:  selectAccount()                    ← ① 先选账号
Line 848:  requestQueue.acquire(signal)       ← ② 再抢全局队列槽位
Line 864:  accountPool.incrementConcurrency() ← ③ 最后才计账号并发
```

全局 `RequestQueue` 是「账号无感知」的——它只知道总共有多少请求在执行，不关心分布在哪些账号上（`requestQueue.ts:71-76`）。

### 复现场景

假设：2 个账号，全局 maxConcurrent = 8

| 账号 | maxConcurrency | 当前并发 |
|------|----------------|----------|
| A    | 1              | 1/1 (满) |
| B    | 无限制         | 7        |

全局队列：activeCount = 8/8 (满)

Request #9 到达：
1. `selectAccount()` → 跳过 A（满），选中 B（空闲）
2. `requestQueue.acquire()` → `activeCount(8) >= maxConcurrent(8)` → **被拒绝或排队**

**账号 B 明明还有容量，但全局队列说"满了"**。

### 恶化因素

1. **慢请求放大**：账号 A 的长流式请求（30s+）占住全局槽位不释放，压缩其他账号可用槽位
2. **动态并发无法补救**：`effectiveMax = max(baseMax, multiplier * availableCount)` 算出的上限仍会被吃满
3. **队列超时是最后防线**：用户看到 502 时体验已经崩了

### 决策：采用方案 A —— 去掉全局队列，仅用账号级限制

| 方案 | 思路 | 复杂度 | 采用 |
|------|------|--------|------|
| **A. 去掉全局队列** | 每个账号自己管并发，互不干扰 | 低 | **✅ 采用** |
| B. 全局队列改为账号感知 | acquire 时传入 accountId，按账号分桶计数 | 中 | 备选 |
| C. 调换顺序 | 先抢槽位再选账号 | 中 | 不采用（加剧首 token 延迟） |
| D. Per-account 队列 | 每个账号独立队列，彻底隔离 | 高 | 过度设计 |

**实现方式**：`maxConcurrent` 默认改为 0 → `RequestQueue.acquire()` 直接旁路 → 全局队列不再限制。用户仍可通过 Settings 页面显式启用全局队列（设 `queueEnabled=true` + `maxConcurrent>0`）。

修改后的流量模型：

```
修改前：Request → [全局队列 8/8] → Account A (1/1 满) / Account B (7/∞ 空闲) → 第9个请求被拒
修改后：Request → [无全局瓶颈] → Account A (1/1 满→跳过) → Account B (7/∞→处理) ✅
```

---

## 审计发现

### 🔴 高风险

#### H1: `maxConcurrent=0` 与动态并发计算冲突
- `recalculateDynamicConcurrency()` 中：`effectiveMax = Math.max(baseMax, floor(multiplier * availableCount))`
- 当 `maxConcurrent=0`（无限制）时，`Math.max(0, 10 * 5) = 50`，反而被强制设上限
- **需要在 `maxConcurrent=0` 时跳过动态计算，保持无限制语义**

#### H2: `parseInt || DEFAULT` 的 0 值回退 bug + NaN 兜底缺失
- `configStore.ts:114`：`parseInt(data.maxConcurrent, 10) || DEFAULT_CONFIG.maxConcurrent`
- `parseInt("0")` = 0（falsy），`||` 回退到默认值 → 用户无法显式设置 0
- 空串/脏值时 `parseInt("")` = NaN，也是 falsy → 静默回退，但若修复 `||` 为 `!== undefined`，NaN 会透传到 `requestQueue.ts:73` 的 `activeCount < maxConcurrent` 判断，永远为 false → 所有请求被拒绝
- **必须同时加 `Number.isFinite()` 兜底**

#### H3: 无 Retry-After 响应头
- 所有 429/502/503 错误响应均未设置 `Retry-After` 头
- 429 有两种来源：**本地并发超限**（`Too many concurrent`）和**上游配额耗尽**（`KiroApiError.QUOTA_EXHAUSTED`），需区分处理
  - 本地 429/502：基于队列状态动态计算
  - 上游 429：用较长等待（配额冷却，默认 60s）
- **影响**：客户端无法判断重试间隔 → 重试风暴 → 加剧堵塞

### 🟡 中风险

#### M1: 资源释放路径结构不防御未来变更
- `_handleClaudeStreamRequest` 中，`incrementConcurrency`（line 1112）和主 `try-finally`（line 1142）之间有约 30 行代码（WebSearch 判断、thinking 模式检查等）未被统一 try-finally 包裹
- 当前路径安全，但结构上不防御未来新增分支

#### M2: 无过载前置拒绝
- 请求进入主处理流程后才检查并发限制，已消耗 JSON 解析、鉴权等计算资源

#### M3: 账号选择在队列获取之前
- 排队等待期间预选的账号可能变为不可用

#### M4: `updateConfig` 切到无限制模式时遗留队列无法消费
- `processQueue()` 依赖 `this.activeCount < this.maxConcurrent`（`requestQueue.ts:149`）
- 当 `maxConcurrent` 从正数切为 0 时，`0 < 0 = false` → 队列中的旧请求永远无法被放行
- **需要在 `updateConfig` 检测到切换为无限制时，调用 `drainQueue()` 一次性放行所有排队请求**

### 🔴 并发安全（TOCTOU 竞态）

#### C1: 账号选择与并发计数不是原子操作
- `getNextAccount()` 读取 `activeConcurrency` Map 选账号（`accountPool.ts:153`）
- `incrementConcurrency()` 在 `proxyServer.ts:864` 才执行，中间隔着 `await requestQueue.acquire()`
- **竞态窗口**：5 个并发请求同时读到 `concurrency=9/10`，全选中同一账号，实际并发 14/10

```
A: getNextAccount() → X (9/10)
A: await acquire()    ← 让出执行权
B: getNextAccount() → X (仍读到 9/10，未被 A increment)
B: await acquire()
A: incrementConcurrency(X) → 10/10
B: incrementConcurrency(X) → 11/10 ❌ 超限
```

#### C2: Token 刷新无等待机制（Promise 缓存缺失）
- `refreshToken()` 检测到 `refreshingTokens.has(id)` 直接 `return false`（`proxyServer.ts:349-351`）
- 请求 A 刷新中，请求 B 选中同一账号 → 发现需要刷新 → `return false` → 回退到备选账号或用旧 token
- 高并发下：多个请求都拿到旧 token → 上游 401 → 触发错误计数 → 账号被错误禁用

#### C3: RequestQueue `activeCount` 检查与递增
- `acquire()` 中 `this.activeCount < this.maxConcurrent` 和 `this.activeCount++` 是**同步连续操作**
- Node.js 单线程下，这两行之间**无 yield point**，实际上是原子的
- **严格来说这不是竞态**，但设计上依赖隐式保证，未来若在两行之间插入 await 会引入 bug

### 🟢 可观测性缺失

| 指标 | 当前状态 | 需要 |
|------|----------|------|
| `queue_wait_ms` | 仅日志 logger.info，无聚合 | P50/P90/P99 统计 |
| `acquire_fail_reason` | 无 | 区分 queue_full / timeout / aborted / overloaded |
| `inflight_age` | 有 Map 存 startTime，无暴露 | 检测长尾/假死请求 |
| `account_selection_fail` | 仅 logger.warn | 计数 + 拒绝原因分类 |

---

## 实施计划（按优先级排序）

### 阶段一：修复高风险问题

#### Step 1: RequestQueue 支持无限制模式 + 队列迁移

**文件**: `packages/backend/src/core/requestQueue.ts`

1) `acquire()` 方法开头增加旁路：

```typescript
async acquire(signal?: AbortSignal): Promise<() => void> {
  // 无限制模式：maxConcurrent <= 0 时直接放行，仅追踪活跃计数
  if (this.maxConcurrent <= 0) {
    this.activeCount++
    return () => this.release()
  }
  // ... 现有逻辑不变 ...
}
```

2) `processQueue()` 增加无限制模式处理：

```typescript
private processQueue(): void {
  // 无限制模式：放行所有排队请求
  if (this.maxConcurrent <= 0) {
    this.drainQueue()
    return
  }
  // ... 现有 while 循环不变 ...
}
```

3) 新增 `drainQueue()` 方法——放行所有排队请求：

```typescript
/**
 * 放行队列中所有等待的请求（切换到无限制模式时调用）
 */
private drainQueue(): void {
  while (this.queue.length > 0) {
    const entry = this.queue.shift()
    if (!entry) break
    clearTimeout(entry.timer)
    if (entry.signal && entry.abortHandler) {
      entry.signal.removeEventListener('abort', entry.abortHandler)
    }
    if (entry.signal?.aborted) {
      continue
    }
    const waitTime = Date.now() - entry.enqueuedAt
    logger.info('Request drained (unlimited mode)', { waitTime, remaining: this.queue.length })
    entry.resolve()
  }
}
```

4) `updateConfig()` 中检测切换到无限制模式：

```typescript
updateConfig(maxConcurrent: number, config?: Partial<RequestQueueConfig>): void {
  const wasLimited = this.maxConcurrent > 0
  this.maxConcurrent = maxConcurrent
  if (config?.enabled !== undefined) this.config.enabled = config.enabled
  if (config?.maxSize !== undefined) this.config.maxSize = config.maxSize
  if (config?.timeoutMs !== undefined) this.config.timeoutMs = config.timeoutMs

  // 从有限切到无限制：放行所有排队请求
  if (wasLimited && this.maxConcurrent <= 0 && this.queue.length > 0) {
    logger.info('Switching to unlimited mode, draining queue', { queued: this.queue.length })
    this.drainQueue()
  }
}
```

#### Step 2: 修复动态并发计算中的无限制模式冲突

**文件**: `packages/backend/src/core/proxyServer.ts`

`recalculateDynamicConcurrency()` 增加 `maxConcurrent=0` 早返回：

```typescript
recalculateDynamicConcurrency(): void {
  const baseMax = this.config.maxConcurrent

  // maxConcurrent<=0 表示不限制，跳过动态计算，保持无限制语义
  if (baseMax <= 0) {
    this.requestQueue.updateConfig(0, {
      enabled: this.config.queueEnabled,
      maxSize: this.config.queueMaxSize ?? 0,
      timeoutMs: this.config.queueTimeoutMs
    })
    logger.info('Concurrency unlimited mode (maxConcurrent=0)')
    return
  }

  // ... 原有动态计算逻辑不变 ...
}
```

#### Step 3: 修改默认值 + 修复 parseInt 解析（含 NaN 兜底）

**三处默认值**：

| 文件 | 行号 | 修改 |
|------|------|------|
| `packages/backend/src/config/defaults.ts` | 24 | `maxConcurrent: 8` → `maxConcurrent: 0` |
| `packages/backend/src/storage/configStore.ts` | 69 | `maxConcurrent: 8` → `maxConcurrent: 0` |
| `packages/backend/src/core/proxyServer.ts` | 89 | `maxConcurrent: 8` → `maxConcurrent: 0` |

**修复 parseInt**：`packages/backend/src/storage/configStore.ts:114`

```typescript
// 修复前
maxConcurrent: parseInt(data.maxConcurrent, 10) || DEFAULT_CONFIG.maxConcurrent,

// 修复后：抽取工具函数，避免重复 parseInt + 统一处理 NaN
function safeParseInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

// 使用
maxConcurrent: safeParseInt(data.maxConcurrent, DEFAULT_CONFIG.maxConcurrent),
```

> 同文件内 `maxRetries`、`retryDelay`、`requestTimeout` 等 parseInt 调用也有相同 NaN 风险，建议统一替换为 `safeParseInt`。

#### Step 4: 移除冗余条件守卫

**文件**: `packages/backend/src/routes/proxy.ts:104-107`

```diff
- // 初始化后立即计算动态并发
- if (config.concurrencyMultiplier && config.concurrencyMultiplier > 0) {
-   proxyServer.recalculateDynamicConcurrency()
- }
+ // addAccounts 内部已无条件调用 recalculateDynamicConcurrency
```

---

### 阶段二：动态 Retry-After + 过载前置拒绝

#### Step 5a: 扩展 `_handleClaudeRequest` 返回类型（Step 5b 前置依赖）

**文件**: `packages/backend/src/core/proxyServer.ts`

当前非流式返回结构为 `{ success, error: string, statusCode }`（`proxy.ts:301-312`），无法区分 429 来源。需先扩展返回类型：

```typescript
// proxyServer.ts — handleClaudeRequest 返回类型扩展
type RequestResult = {
  success: boolean
  response?: unknown
  error?: string
  statusCode?: number
  errorKind?: 'local_overload' | 'upstream_quota' | 'upstream_overloaded' | 'no_accounts' | 'unknown'
}
```

在 `_handleClaudeRequest` 的 catch 块（line 1029-1041）中，利用已有的 `classifyRetryError()` 填充 `errorKind`：

```typescript
} catch (error) {
  const classified = this.classifyRetryError(error as Error)
  return {
    success: false,
    error: (error as Error).message,
    statusCode: error instanceof KiroApiError ? error.statusCode : 500,
    errorKind: classified.kind === 'quota_exhausted' ? 'upstream_quota'
             : classified.kind === 'overloaded' ? 'upstream_overloaded'
             : 'unknown'
  }
}
```

队列拒绝路径（line 855-860）中：

```typescript
return { success: false, error: msg, statusCode, errorKind: 'local_overload' }
```

无可用账号路径（line 840-843）中：

```typescript
return { success: false, error: 'No available accounts', statusCode: 503, errorKind: 'no_accounts' }
```

#### Step 5b: 动态 Retry-After 响应头（区分 429 来源）

**文件**: `packages/backend/src/routes/proxy.ts`

`proxy.ts` 中通过 `result.errorKind`（来自 Step 5a）精确区分 429 来源：

```typescript
/**
 * 计算动态 Retry-After 值（秒）
 * 区分本地并发超限 vs 上游配额耗尽
 */
function computeRetryAfter(statusCode: number, error?: Error): number {
  const status = getConcurrencyStatus()
  const { active, queued, maxConcurrent } = status.queue

  // 区分 429 来源
  if (statusCode === 429) {
    const isUpstream = error instanceof KiroApiError
      || (error?.message?.includes('quota'))
      || (error?.message?.includes('Quota'))
    if (isUpstream) {
      // 上游配额耗尽：用较长冷却（匹配 errorCooldown429 语义）
      return 30
    }
    // 本地限流：基于队列压力，1~15s
    if (maxConcurrent <= 0) return 1
    const pressure = queued / Math.max(1, maxConcurrent)
    return Math.max(1, Math.min(15, Math.ceil(pressure * 3)))
  }

  if (statusCode === 502 || statusCode === 529) {
    // 过载：基于活跃请求比例，2~30s
    if (maxConcurrent <= 0) return 5
    const utilization = active / Math.max(1, maxConcurrent)
    return Math.max(2, Math.min(30, Math.ceil(utilization * 10)))
  }

  if (statusCode === 503) {
    // 无可用账号：固定 30s
    return 30
  }

  return 5
}
```

在非流式和流式错误响应路径中注入：

```typescript
// 非流式（proxy.ts ~line 307-312）
const retryAfter = computeRetryAfter(statusCode, originalError)
res.setHeader('Retry-After', String(retryAfter))
res.status(statusCode).json({ type: 'error', error: { ... } })

// 流式、headers 未发送时（proxy.ts ~line 278）
res.setHeader('Retry-After', String(computeRetryAfter(statusCode, originalError)))
res.status(statusCode).json({ ... })
```

#### Step 6: 过载前置拒绝（修正可用账号判断）

**文件**: `packages/backend/src/routes/proxy.ts`

```typescript
/**
 * 过载前置检查：在消耗 CPU 处理请求前快速拒绝
 * 注意：使用 accountPool.availableCount 而非 concurrency map 的 accounts.length
 *       后者仅包含"出现过并发计数的账号"，启动时通常为 0
 */
function checkOverload(): { reject: boolean; reason?: string; statusCode?: number } {
  if (!proxyServer) return { reject: false }

  const status = proxyServer.getConcurrencyStatus()
  const { queued, maxConcurrent } = status.queue

  // 使用 accountPool.availableCount（正确的可用账号数）
  const availableCount = proxyServer.getAvailableAccountCount()  // 已存在（proxyServer.ts:237）
  if (availableCount === 0) {
    return { reject: true, reason: 'No available accounts', statusCode: 503 }
  }

  // 队列深度超过上限的 2 倍：过载拒绝
  if (maxConcurrent > 0 && queued > maxConcurrent * 2) {
    return { reject: true, reason: 'Queue overloaded', statusCode: 502 }
  }

  return { reject: false }
}
```

`proxyServer.getAvailableAccountCount()` 已存在于 `proxyServer.ts:237`，无需新增。

---

### 阶段三：资源释放强化 + 可观测性

#### Step 7: 统一 try-finally 包裹范围

**文件**: `packages/backend/src/core/proxyServer.ts`

将 `_handleClaudeStreamRequest` 中 `incrementConcurrency` 之后的全部代码纳入同一个 try-finally：

```typescript
// 修改后的结构
this.accountPool.incrementConcurrency(account.id)
let accountConcurrencyTracked = true

try {
  if (hasWebSearchTool(effectiveRequest)) {
    // 注意：handleWebSearchStream 内部已调用 callbacks.onComplete()（websearch.ts:420）
    // 此处不可重复调用 onComplete，否则 res.end 会二次触发
    await handleWebSearchStream(effectiveRequest, account, callbacks, matchedApiKeyId)
    return
  }

  // thinking 模式检查 + 主流程 ...
  await this.handleClaudeStream(...)
  callbacks.onComplete()
} catch (error) {
  const statusCode = error instanceof KiroApiError ? error.statusCode : 500
  this.events.onResponse?.({ ... })
  callbacks.onError(error as Error)
} finally {
  if (accountConcurrencyTracked) {
    this.accountPool.decrementConcurrency(account.id)
  }
  if (reqId) this.inflightRequests.delete(reqId)
  release?.()
}
```

#### Step 8: ~~账号选择后置~~ → **降级为"不实施"**

> **原因**：`selectAccount()` 内部可能触发 `await refreshToken()`（10s 网络 I/O，`proxyServer.ts:472`）。
> 若将其放到 `acquire()` 之后，全局并发槽位会在"选账号 + 刷新 token"期间被白白占住，
> 反而加剧队列等待、恶化首 token 延迟。
>
> 在方案 A（`maxConcurrent=0`）下，`acquire()` 是同步旁路，账号选择后置无意义。
> 当前维持原有顺序：`selectAccount() → acquire() → incrementConcurrency()`

#### Step 9: 补充可观测性指标

**文件**: `packages/backend/src/core/requestQueue.ts`

在 RequestQueue 中增加统计：

```typescript
interface QueueStats {
  totalAcquired: number
  totalRejected: number
  rejectReasons: Record<string, number>  // queue_full | timeout | aborted | overloaded
  waitTimeSamples: number[]              // 最近 100 个等待时间（ms）
}
```

**文件**: `packages/backend/src/core/proxyServer.ts`

`getConcurrencyStatus()` 新增字段（向后兼容，仅追加）：

```typescript
getConcurrencyStatus() {
  return {
    queue: this.requestQueue.getStatus(),
    accounts: [...],
    // 新增（可选字段，前端不依赖则无需同步类型）
    queueStats: this.requestQueue.getStats(),
    inflight: this.getInflightRequests().map(r => ({
      ...r,
      age: Date.now() - r.startTime
    }))
  }
}
```

**前端类型处理**：`packages/frontend/src/api/stats.ts:41`

由于 `queueStats` 和 `inflight` 是**新增可选字段**，TypeScript 接口不强制要求前端消费它们。两种策略：
- **最小改动**：前端 `ConcurrencyStatus` 接口不改，新字段被 TypeScript 忽略，运行时 JSON 正常兼容
- **完整同步**：在 `ConcurrencyStatus` 中加 `queueStats?: QueueStats; inflight?: InflightInfo[]`

建议阶段三**先不改前端 `ConcurrencyStatus` 类型定义**（`queueStats`、`inflight` 作为后端新增可选字段，前端不消费即可）。阶段五 Step 13 会改 `Accounts.tsx` 展示逻辑，使用已有的 `queue` 字段。

---

## 涉及文件清单

| 文件 | 阶段 | 变更类型 |
|------|------|----------|
| `packages/backend/src/core/requestQueue.ts` | 一+三 | 无限制旁路 + drainQueue + 统计指标 |
| `packages/backend/src/config/defaults.ts` | 一 | 改默认值 |
| `packages/backend/src/storage/configStore.ts` | 一 | 改默认值 + 修复解析（含 NaN 兜底） |
| `packages/backend/src/core/proxyServer.ts` | 一+二+三+3.5 | 动态并发修复 + errorKind 返回类型 + 流程重构 + 可观测性 + Promise 缓存刷新 |
| `packages/backend/src/routes/proxy.ts` | 一+二 | 删冗余 + Retry-After + 过载拒绝 |
| `packages/frontend/src/pages/Accounts.tsx` | 五 | 展示全局队列状态 |

---

## 向后兼容性

| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| 全新部署，无 Redis 配置 | maxConcurrent=8，超 8 即 502 | maxConcurrent=0，不限制 |
| 已有部署，Redis 存 maxConcurrent=8 | 使用 8 | 使用 8（**不变**） |
| 已有部署，queueEnabled=true | 按配置排队 | **不变** |
| 用户设 maxConcurrent=0 | 被 parseInt `\|\|` 回退到 8 | 正确识别为 0 |
| 动态并发 + maxConcurrent=0 | `max(0, 10*N)=10N` 强制上限 | 保持无限制 |
| Redis 脏值（空串/非数字） | 静默回退到 8 | `Number.isFinite` 兜底回退到 0 |
| 热更新切到无限制模式（8→0） | 队列中请求永远无法放行 | `drainQueue()` 一次性放行 |
| 热更新切到限制模式（0→8） | N/A（原来就是 8） | activeCount 可能 >8（已有请求自然排空，新请求排队/拒绝） |
| 上游 429 配额耗尽 | 无 Retry-After | Retry-After: 30（区分上游源） |
| 本地并发 502 | 无 Retry-After | Retry-After: 2~30（基于利用率） |

---

### 阶段 3.5：并发安全修复

#### Step 8a: 账号选择 + 并发计数原子化

> **⚠️ 前置依赖**：Step 7（统一 try-finally）必须先完成。否则回退逻辑需要在 WebSearch 和主路径各写一份。

**问题**：`getNextAccount()` 选中账号后，直到 `incrementConcurrency()` 中间有 `await` yield point，其他请求可能重复选中同一账号。

**方案**：不新增 `acquireAccount()` 方法（避免与现有入口 `incrementConcurrency` / `swapConcurrencyTracking` 冲突导致双计数），而是**消除竞态窗口**——去掉中间的 `await`。

在方案 A（去掉全局队列，`maxConcurrent=0`）下，`requestQueue.acquire()` 是同步旁路（直接 return），`selectAccount()` 和 `incrementConcurrency()` 之间不再有 yield point。竞态窗口自然消失。

**仅当用户显式启用全局队列（`maxConcurrent > 0`）时**，竞态窗口才重新打开。此时的降级处理：

```typescript
// proxyServer.ts — _handleClaudeRequest / _handleClaudeStreamRequest
// 账号级并发超限检查：在 incrementConcurrency 后立即验证
this.accountPool.incrementConcurrency(concurrencyRef.accountId)

// 二次检查：如果选中的账号在排队期间被其他请求占满，回退重选
if (account.maxConcurrency && account.maxConcurrency > 0) {
  const actual = this.accountPool.getConcurrency(concurrencyRef.accountId)
  if (actual > account.maxConcurrency) {
    // 超限：释放并重选
    this.accountPool.decrementConcurrency(concurrencyRef.accountId)
    const fallback = this.accountPool.getNextAvailableAccount(account.id)
    if (fallback) {
      concurrencyRef.accountId = fallback.id
      account = fallback
      this.accountPool.incrementConcurrency(concurrencyRef.accountId)
    } else {
      // 无可用账号
      release?.()
      // 非流式返回错误对象，流式调用 callbacks.onError
      return { success: false, error: 'All accounts at concurrency limit', statusCode: 503 }
    }
  }
}
```

**前置变更（两个方法都需要）**：

1. `_handleClaudeRequest`（line 839）和 `_handleClaudeStreamRequest`（line 1089）中 `account` 从 `const` 改为 `let`：
   ```typescript
   // 修改前
   const { account, stickyFallback } = await this.selectAccount(...)
   // 修改后
   let { account, stickyFallback } = await this.selectAccount(...)
   ```

2. **`_handleClaudeStreamRequest` 必须引入 `concurrencyRef`**（当前不存在，只有 `_handleClaudeRequest` 有）：
   ```typescript
   // _handleClaudeStreamRequest — line 1112 附近
   // 修改前：直接用 account.id
   this.accountPool.incrementConcurrency(account.id)

   // 修改后：引入 concurrencyRef，与 _handleClaudeRequest 对齐
   const concurrencyRef = { accountId: account.id }
   this.accountPool.incrementConcurrency(concurrencyRef.accountId)
   ```

   同步更新所有引用 `account.id` 做并发追踪的位置：
   - finally 块中 `decrementConcurrency(account.id)` → `decrementConcurrency(concurrencyRef.accountId)`
   - `swapConcurrencyTracking` 调用传入 `concurrencyRef`（如果流式路径有重试）

   > **关键**：`_handleClaudeStreamRequest` 当前没有 `callWithRetry`（流式不走重试），
   > 所以没有 `swapConcurrencyTracking` 调用。`concurrencyRef` 仅用于 Step 8a 回退 + finally 清理。

**与 `swapConcurrencyTracking` 的交互**（仅影响 `_handleClaudeRequest`）：
- Step 8a 的回退操作修改了 `concurrencyRef.accountId` 和 `account`
- 后续 `callWithRetry` 中若触发重试切账号，`swapConcurrencyTracking(concurrencyRef, newAccount)` 会正确地 decrement 当前 `concurrencyRef.accountId`（即 Step 8a 选中的 fallback）并 increment 新账号
- 两者不冲突：Step 8a 在 `incrementConcurrency` 后立即做一次性回退，`swapConcurrencyTracking` 在重试循环中按需切换

**优势**：
- 不改变 `accountPool` 公共 API
- 默认无限制模式下无额外开销（竞态窗口不存在）
- 启用全局队列时，二次检查兜底（概率极低，仅在极端并发下触发）

#### Step 8b: Token 刷新改为 Promise 缓存模式（Step 8a 前置依赖）

> **⚠️ Step 8a 和 8b 必须同步实施**。
> Step 8a 的回退路径（`getNextAvailableAccount`）可能选中正在刷新 token 的账号。
> 若 `refreshToken()` 仍用 `Set`（检测到正在刷新直接 `return false`），
> 回退路径会误判"刷新失败" → 跳过可用账号 → 行为抖动。
> 只有 Step 8b 将 `Set` 改为 `Map<string, Promise<boolean>>` 后，
> 回退路径才能正确 await 同一个刷新 Promise，拿到真实结果。

**文件**: `packages/backend/src/core/proxyServer.ts`

当前 `refreshingTokens` 是 `Set<string>`，只存在/不存在两态。改为 `Map<string, Promise<boolean>>`：

```typescript
// 修改前
private refreshingTokens: Set<string> = new Set()

// 修改后
private refreshingTokens: Map<string, Promise<boolean>> = new Map()

private async refreshToken(account: ProxyAccount): Promise<boolean> {
  // 已有刷新进行中：等待同一个 Promise（不重复发起）
  const existing = this.refreshingTokens.get(account.id)
  if (existing) {
    logger.debug('Token refresh already in progress, awaiting', { accountId: account.id })
    return existing  // 等待而非 return false
  }

  this.accountPool.markNeedsRefresh(account.id)

  const refreshPromise = this._doRefreshToken(account)
  this.refreshingTokens.set(account.id, refreshPromise)

  try {
    return await refreshPromise
  } finally {
    this.refreshingTokens.delete(account.id)
  }
}

// 实际刷新逻辑抽取到私有方法
private async _doRefreshToken(account: ProxyAccount): Promise<boolean> {
  try {
    let result: { success: boolean; accessToken?: string; ... }
    if (this.events.onTokenRefresh) {
      result = await this.events.onTokenRefresh(account)
    } else {
      result = await refreshTokenByMethod(account)
    }
    if (result.success && result.accessToken) {
      this.accountPool.updateAccount(account.id, { ... })
      this.accountPool.clearNeedsRefresh(account.id)
      this.accountPool.setStatus(account.id, 'active', 'Token 刷新成功')
      return true
    }
    return false
  } catch (error) {
    logger.error('Token refresh error', { ... })
    return false
  }
}
```

**效果**：
- 请求 A 触发刷新 → 创建 Promise，存入 Map
- 请求 B 发现同一账号刷新中 → `return existing`（await 同一个 Promise）
- 刷新完成 → 所有等待者同时拿到结果
- 不再用旧 token 发请求，消除上游 401 导致的错误计数

---

### ~~阶段四：首 Token 延迟优化~~ — 已移除

> 原 Step 10（Token 后台异步刷新）存在中途过期风险，Step 11（cacheRatio 延迟 await）和 Step 12（Redis fire-and-forget）
> 的收益有限且增加复杂度。整体阶段四不实施。

---

### 阶段五：前端队列状态展示

#### Step 13: Accounts 页面展示全局队列状态

**文件**: `packages/frontend/src/pages/Accounts.tsx`

当前 `concurrencyData` 已包含 `queue: { active, queued, maxConcurrent }` 但未展示。

在 CardHeader（line 530-536）的 CardDescription 中追加队列指示器：

```tsx
<CardDescription>
  共 {accounts?.length ?? 0} 个账号
  {concurrencyData?.queue && (
    <span className="ml-3 inline-flex items-center gap-2">
      <span className="text-blue-600">
        活跃 {concurrencyData.queue.active}
      </span>
      {concurrencyData.queue.queued > 0 && (
        <span className="text-orange-600 font-semibold animate-pulse">
          排队 {concurrencyData.queue.queued}
        </span>
      )}
      {concurrencyData.queue.maxConcurrent > 0 && (
        <span className="text-muted-foreground">
          / 上限 {concurrencyData.queue.maxConcurrent}
        </span>
      )}
      {concurrencyData.queue.maxConcurrent <= 0 && (
        <span className="text-muted-foreground">
          (不限制)
        </span>
      )}
    </span>
  )}
</CardDescription>
```

**效果**：
- 正常：`共 10 个账号  活跃 3 (不限制)`
- 有排队：`共 10 个账号  活跃 8 排队 5 / 上限 8` （排队数橙色闪烁）
- 无限制模式：`共 10 个账号  活跃 15 (不限制)`

---

## 涉及文件清单（更新）

| 文件 | 阶段 | 变更类型 |
|------|------|----------|
| `packages/backend/src/core/requestQueue.ts` | 一+三 | 无限制旁路 + drainQueue + 统计指标 |
| `packages/backend/src/config/defaults.ts` | 一 | 改默认值 |
| `packages/backend/src/storage/configStore.ts` | 一 | 改默认值 + 修复解析（含 NaN 兜底） |
| `packages/backend/src/core/proxyServer.ts` | 一+二+三+3.5 | 动态并发修复 + 流程重构 + 可观测性 + Promise 缓存刷新 |
| `packages/backend/src/routes/proxy.ts` | 一+二 | 删冗余 + Retry-After + 过载拒绝 |
| `packages/frontend/src/pages/Accounts.tsx` | 五 | 展示全局队列状态（活跃/排队/上限） |

---

## 验证方式

1. `pnpm typecheck && pnpm build`
2. **阶段一验证**：
   - 启动后端，发送 >8 并发请求，验证不再 502
   - Redis 设 `maxConcurrent=0`，重启，确认无限制模式生效
   - Redis 设脏值 `maxConcurrent=abc`，重启，确认回退到默认值 0 而非 NaN
   - 热更新从 `maxConcurrent=5` 切到 `0`，验证排队中请求被立即放行
3. **阶段二验证**：
   - 触发 502 响应，检查 `Retry-After` 头包含合理值（2~30s）
   - 触发上游 429，检查 `Retry-After: 30`
   - 所有账号 cooldown 时，前置拒绝返回 503 + Retry-After
4. **阶段三验证**：
   - `GET /api/stats/concurrency` 返回 queueStats + inflight age 字段
   - 前端 Dashboard 不因新增字段报错
5. **阶段 3.5 验证**：
   - 100 并发压测，检查单账号实际并发是否严格 ≤ maxConcurrency
   - Token 即将过期时，多个并发请求日志显示 `awaiting` 而非各自触发独立刷新
   - 刷新期间无 401 错误（旧 token 不再被使用）
