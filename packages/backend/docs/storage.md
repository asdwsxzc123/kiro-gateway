# 存储层模块文档

## 目录结构

```
src/storage/
├── redis.ts          # Redis 客户端
├── accountStore.ts   # 账号存储
├── configStore.ts    # 配置存储
├── statsStore.ts     # 统计存储
└── logStore.ts       # 日志存储
```

---

## 一、redis.ts - Redis 客户端

### 1.1 核心职责

- 提供全局 Redis 连接单例
- 管理连接生命周期
- 实现自动重试和健康检查

### 1.2 连接配置

```typescript
// 单例模式
let redisClient: Redis | null = null

// 重试策略
retryStrategy: (times) => {
  if (times > 10) return null
  return Math.min(times * 100, 3000)
}

// 每个请求最多重试 3 次
maxRetriesPerRequest: 3
```

### 1.3 导出函数

```typescript
getRedisClient(): Redis      // 获取或创建连接
closeRedis(): Promise<void>  // 优雅关闭
checkRedisHealth(): Promise<boolean>  // 健康检查
```

---

## 二、accountStore.ts - 账号存储

### 2.1 Redis 数据结构

| Key 模式 | 类型 | 用途 |
|---------|------|------|
| `account:{id}` | Hash | 账号完整信息 |
| `accounts:index` | Sorted Set | 按创建时间排序的索引 |
| `accounts:available` | Set | 可用账号 ID 集合 |
| `machineIds` | Set | 已使用的机器码集合 |

### 2.2 敏感字段加密

```typescript
const SENSITIVE_FIELDS = ['accessToken', 'refreshToken', 'clientSecret']

// 序列化时加密
function serializeAccount(account) {
  if (SENSITIVE_FIELDS.includes(key)) {
    data[key] = encrypt(value)
  }
}

// 反序列化时解密
function deserializeAccount(data) {
  if (SENSITIVE_FIELDS.includes(key)) {
    account[key] = decrypt(value)
  }
}
```

### 2.3 核心函数

```typescript
// CRUD
addAccount(account: ProxyAccount): Promise<void>
getAccountById(id: string): Promise<ProxyAccount | null>
getAllAccounts(): Promise<ProxyAccount[]>
updateAccount(id: string, updates: Partial<ProxyAccount>): Promise<void>
deleteAccount(id: string): Promise<boolean>

// 可用性
getAvailableAccounts(): Promise<ProxyAccount[]>
setAccountAvailable(id: string, available: boolean): Promise<void>

// 机器码
regenerateMachineId(id: string): Promise<string>
setAccountCooldown(id: string, cooldownUntil: number): Promise<void>

// 使用统计
updateAccountUsage(id: string, success: boolean, responseTime: number): Promise<void>
```

---

## 三、configStore.ts - 配置存储

### 3.1 Redis 数据结构

| Key | 类型 | 用途 |
|-----|------|------|
| `config` | Hash | 网关配置参数 |
| `config:selectedAccounts` | Set | 选中的账号 ID |
| `config:apiKeys` | Hash | API Key 记录 |

### 3.2 网关配置项

```typescript
interface GatewayConfig {
  port: number
  host: string
  enableMultiAccount: boolean
  maxConcurrent: number
  maxRetries: number
  retryDelay: number
  requestTimeout: number
  preferredEndpoint?: 'codewhisperer' | 'amazonq'
  rateLimitEnabled: boolean
  rateLimitWindow: number
  rateLimitMax: number
}
```

### 3.3 核心函数

```typescript
// 配置管理
getGatewayConfig(): Promise<GatewayConfig>
updateGatewayConfig(config: Partial<GatewayConfig>): Promise<void>

// 账号选择
getSelectedAccounts(): Promise<string[]>
setSelectedAccounts(ids: string[]): Promise<void>
addSelectedAccount(id: string): Promise<void>
removeSelectedAccount(id: string): Promise<void>

// API Key 管理
getAllApiKeys(): Promise<ApiKeyRecord[]>
addApiKey(record: ApiKeyRecord): Promise<void>
deleteApiKey(id: string): Promise<boolean>
validateApiKey(key: string): Promise<boolean>
```

---

## 四、statsStore.ts - 统计存储

### 4.1 Redis 数据结构

| Key 模式 | 类型 | 用途 |
|---------|------|------|
| `stats:global` | Hash | 全局统计 |
| `stats:account:{id}` | Hash | 账号统计 |
| `stats:model:{id}` | Hash | 模型统计 |

### 4.2 统计字段

```typescript
// 全局统计
interface ProxyStats {
  totalRequests: number
  successRequests: number
  failedRequests: number
  totalTokens: number
  totalCredits: number
  inputTokens: number
  outputTokens: number
  startTime: number
}

// 账号统计
interface AccountStats {
  requests: number
  tokens: number
  inputTokens: number
  outputTokens: number
  errors: number
  lastUsed: number
  avgResponseTime: number
  totalResponseTime: number
}

// 模型统计
interface ModelStats {
  model: string
  requests: number
  tokens: number
}
```

### 4.3 核心函数

```typescript
// 全局统计
getGlobalStats(): Promise<ProxyStats>
updateGlobalStats(success: boolean, inputTokens: number, outputTokens: number, credits?: number): Promise<void>

// 账号统计
getAccountStats(accountId: string): Promise<AccountStats>
updateAccountStats(accountId: string, success: boolean, inputTokens: number, outputTokens: number, responseTime: number): Promise<void>
getAllAccountStats(): Promise<Record<string, AccountStats>>

// 模型统计
getModelStats(modelId: string): Promise<ModelStats>
updateModelStats(modelId: string, tokens: number): Promise<void>
getAllModelStats(): Promise<ModelStats[]>

// 重置
resetAllStats(): Promise<void>
```

### 4.4 Pipeline 优化

```typescript
// 批量操作
const pipeline = redis.pipeline()
pipeline.hincrby(GLOBAL_STATS_KEY, 'totalRequests', 1)
pipeline.hincrby(GLOBAL_STATS_KEY, 'successRequests', 1)
pipeline.hincrby(GLOBAL_STATS_KEY, 'inputTokens', inputTokens)
await pipeline.exec()
```

---

## 五、logStore.ts - 日志存储

### 5.1 Redis 数据结构

| Key | 类型 | 容量限制 |
|-----|------|---------|
| `logs:requests` | Stream | 100,000 条 |
| `logs:system` | Stream | 50,000 条 |

### 5.2 日志结构

```typescript
// 请求日志
interface RequestLog {
  id: string
  timestamp: number
  path: string
  model: string
  accountId: string
  machineId?: string
  inputTokens: number
  outputTokens: number
  credits?: number
  responseTime: number
  success: boolean
  error?: string
}

// 系统日志
interface SystemLog {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  category: string
  message: string
  data?: Record<string, any>
}
```

### 5.3 核心函数

```typescript
// 请求日志
addRequestLog(log: RequestLog): Promise<void>
getRequestLogs(limit?: number, startTime?: number, endTime?: number): Promise<RequestLog[]>
getRequestLogCount(): Promise<number>
clearRequestLogs(): Promise<void>

// 系统日志
addSystemLog(log: SystemLog): Promise<void>
getSystemLogs(limit?: number, level?: string, category?: string): Promise<SystemLog[]>
getSystemLogCount(): Promise<number>
clearSystemLogs(): Promise<void>
```

### 5.4 Stream 操作

```typescript
// 添加日志（自动修剪）
await redis.xadd(REQUEST_LOGS_STREAM, '*', ...fields)
await redis.xtrim(REQUEST_LOGS_STREAM, 'MAXLEN', '~', MAX_REQUEST_LOGS)

// 查询日志（反向范围）
await redis.xrevrange(REQUEST_LOGS_STREAM, '+', '-', 'COUNT', limit)
```

---

## 六、Redis 命令总结

| 数据结构 | 常用命令 | 使用场景 |
|---------|---------|---------|
| **Hash** | HSET, HGET, HGETALL, HINCRBY | 对象存储、统计 |
| **Set** | SADD, SMEMBERS, SREM | 集合、索引 |
| **Sorted Set** | ZADD, ZRANGE, ZREM | 有序索引 |
| **Stream** | XADD, XREVRANGE, XTRIM | 日志存储 |
| **Pipeline** | pipeline().exec() | 批量操作 |

---

## 七、错误处理

所有存储模块遵循统一的错误处理模式：

```typescript
try {
  const result = await redis.operation()
  return result
} catch (error) {
  logger.error('Operation failed', { error: error.message })
  return defaultValue  // 返回默认值，不中断流程
}
```

---

## 八、性能优化

| 优化点 | 实现方式 |
|--------|---------|
| 批量操作 | Pipeline 减少网络往返 |
| 日志修剪 | 近似修剪 (`~`) 提高性能 |
| 索引优化 | Sorted Set 维护时间索引 |
| 加密存储 | 应用层加密，防止数据泄露 |
