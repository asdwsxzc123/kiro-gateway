# 服务层模块文档

## 目录结构

```
src/services/
├── accountService.ts  # 账号管理服务
├── proxyService.ts    # 代理服务
├── statsService.ts    # 统计服务
└── logService.ts      # 日志服务
```

---

## 一、accountService.ts - 账号管理服务

### 1.1 核心职责

- 账号生命周期管理（增删改查）
- Token 生命周期管理（刷新、过期检查）
- 账号可用性管理（选择、冷却、连通性测试）
- 批量操作支持

### 1.2 核心函数

```typescript
// 账号 CRUD
getAllAccounts(): Promise<ProxyAccount[]>
getAccountById(id: string): Promise<ProxyAccount | null>
addAccount(request: AddAccountRequest): Promise<ProxyAccount>
updateAccount(id: string, updates: UpdateAccountRequest): Promise<ProxyAccount>
deleteAccount(id: string): Promise<boolean>

// 账号选择（轮询策略）
selectAvailableAccount(): Promise<ProxyAccount | null>
getAvailableAccounts(): Promise<ProxyAccount[]>

// Token 管理
refreshAccountToken(id: string): Promise<{ success, account?, error? }>
checkAndRefreshExpiredTokens(): Promise<{ checked, refreshed, failed }>

// 连通性测试
testAccountConnection(id: string): Promise<{ success, models?, error? }>

// 冷却管理
setAccountCooldown(id: string, durationMs: number): Promise<void>

// 批量导入
batchImportAccounts(accounts: AddAccountRequest[]): Promise<{ success, failed, errors }>
```

### 1.3 账号选择策略

```
selectAvailableAccount() 流程：
1. 获取所有可用账号
2. 按 lastUsed 排序（最久未使用优先）
3. 检查 Token 是否过期
   ├─ 过期 → 自动刷新
   │  ├─ 成功 → 返回账号
   │  └─ 失败 → 标记不可用，递归选择下一个
   └─ 未过期 → 直接返回
```

### 1.4 依赖关系

- `accountStore` - 数据持久化
- `tokenRefresh` - Token 刷新核心逻辑
- `kiroApi.fetchKiroModels()` - 模型获取

---

## 二、proxyService.ts - 代理服务

### 2.1 核心职责

- 多协议支持（OpenAI、Claude）
- 流式和非流式请求处理
- 请求/响应格式转换
- 统计数据和日志更新

### 2.2 核心函数

```typescript
// OpenAI 格式
handleOpenAIRequest(request: OpenAIChatRequest, account?: ProxyAccount): Promise<OpenAIChatResponse>
handleOpenAIStreamRequest(
  request: OpenAIChatRequest,
  callbacks: StreamCallbacks,
  account?: ProxyAccount,
  signal?: AbortSignal
): Promise<void>

// Claude 格式
handleClaudeRequest(request: ClaudeRequest, account?: ProxyAccount): Promise<ClaudeResponse>
handleClaudeStreamRequest(
  request: ClaudeRequest,
  callbacks: StreamCallbacks,
  account?: ProxyAccount,
  signal?: AbortSignal
): Promise<void>
```

### 2.3 请求处理流程

```
客户端请求
    ↓
1. 选择可用账号 (accountService.selectAvailableAccount)
    ↓
2. 格式转换 (translator.openaiToKiro / claudeToKiro)
    ↓
3. 调用 Kiro API (kiroApi.callKiroApiStream)
    ↓
4. 响应转换 (translator.kiroToOpenaiResponse / kiroToClaudeResponse)
    ↓
5. 更新统计 (updateStats)
    ↓
返回响应
```

### 2.4 统计更新

```typescript
updateStats() 调用链：
1. statsStore.updateGlobalStats()    // 全局统计
2. statsStore.updateAccountStats()   // 账号统计
3. statsStore.updateModelStats()     // 模型统计
4. accountService.updateAccountUsage() // 账号使用记录
5. logStore.addRequestLog()          // 请求日志
```

### 2.5 错误处理

```
错误检测 → 分类处理：
├─ 配额耗尽 (429/Quota exhausted)
│  └─ accountService.setAccountCooldown(id, 60000)
├─ 其他错误
│  └─ 记录日志，返回错误信息
└─ 统计更新（无论成功失败）
```

### 2.6 依赖关系

- `accountService` - 账号选择
- `translator` - 格式转换
- `kiroApi` - API 调用
- `statsStore` / `logStore` - 数据存储

---

## 三、statsService.ts - 统计服务

### 3.1 核心职责

- 统计数据聚合查询
- 多维度统计（全局、账号、模型）
- 综合报告生成

### 3.2 核心函数

```typescript
// 概览
getStatsOverview(): Promise<{ global, accounts, uptime }>

// 全局统计
getGlobalStats(): Promise<ProxyStats>

// 账号统计
getAccountStats(accountId: string): Promise<AccountStats>
getAllAccountStats(): Promise<Record<string, AccountStats>>

// 模型统计
getModelStats(modelId: string): Promise<ModelStats>
getAllModelStats(): Promise<ModelStats[]>

// 详细报告
getDetailedReport(): Promise<{ overview, accountStats, modelStats }>

// 重置
resetAllStats(): Promise<void>
```

### 3.3 依赖关系

- `statsStore` - 统计数据存储
- `accountStore` - 账号数据存储

---

## 四、logService.ts - 日志服务

### 4.1 核心职责

- 请求日志查询和管理
- 系统日志查询和管理
- 日志统计和摘要

### 4.2 核心函数

```typescript
// 请求日志
getRequestLogs(limit?: number, startTime?: number, endTime?: number): Promise<RequestLog[]>
clearRequestLogs(): Promise<void>

// 系统日志
getSystemLogs(limit?: number, level?: string, category?: string): Promise<SystemLog[]>
addSystemLog(level: string, category: string, message: string, data?: any): Promise<void>
clearSystemLogs(): Promise<void>

// 统计
getLogStats(): Promise<{ requestCount, systemCount }>
getRecentErrors(limit?: number): Promise<SystemLog[]>
getRequestLogSummary(hours?: number): Promise<{ total, success, failed, avgResponseTime }>
```

### 4.3 依赖关系

- `logStore` - 日志存储

---

## 五、服务间依赖关系

```
proxyService (核心)
├── accountService (账号选择)
├── statsStore (更新统计)
├── logStore (记录日志)
├── translator (格式转换)
└── kiroApi (API调用)

accountService
├── accountStore (存储)
├── tokenRefresh (Token刷新)
└── kiroApi (模型获取)

statsService
├── statsStore (存储)
└── accountStore (账号数据)

logService
└── logStore (存储)
```

---

## 六、设计模式

### 6.1 轮询策略 (Round-Robin)

```typescript
// 选择最久未使用的账号
accounts.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0))
const selected = accounts[0]
```

### 6.2 自动恢复机制

```typescript
// Token 过期自动刷新
if (isTokenExpired(selected)) {
  const result = await refreshTokenByMethod(selected)
  if (!result.success) {
    return selectAvailableAccount() // 递归选择下一个
  }
}
```

### 6.3 流式处理

```typescript
// 通过 callbacks 逐块返回数据
callKiroApiStream(account, payload,
  (text, toolUse) => callbacks.onChunk(...),
  (usage) => callbacks.onComplete(usage),
  (error) => callbacks.onError(error)
)
```
