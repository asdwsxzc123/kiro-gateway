# 配置模块文档

## 目录结构

```
src/config/
├── index.ts      # 配置加载器与类型定义
└── defaults.ts   # 默认配置值
```

---

## 一、文件说明

### 1. defaults.ts - 默认配置定义

定义所有配置模块的默认值，使用 `as const` 确保类型安全。

### 2. index.ts - 配置加载器

- 定义配置的 TypeScript 接口
- 实现配置加载逻辑
- 提供单例模式的配置管理
- 处理环境变量与默认值的合并

---

## 二、配置项详解

### 2.1 服务器配置 (ServerConfig)

```typescript
interface ServerConfig {
  port: number      // 监听端口，默认 3000
  host: string      // 监听地址，默认 '0.0.0.0'
  nodeEnv: string   // 运行环境，默认 'development'
}
```

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `PORT` | 3000 | HTTP 服务端口 |
| `HOST` | 0.0.0.0 | 监听地址 |
| `NODE_ENV` | development | 运行环境 |

---

### 2.2 Redis 配置 (RedisConfig)

```typescript
interface RedisConfig {
  url: string       // Redis 连接 URL
  password: string  // Redis 密码
  db: number        // 数据库编号 (0-15)
  keyPrefix: string // 键前缀
}
```

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `REDIS_URL` | redis://localhost:16999 | Redis 连接地址 |
| `REDIS_PASSWORD` | '' | Redis 密码 |
| `REDIS_DB` | 0 | 数据库编号 |
| `REDIS_KEY_PREFIX` | gateway: | 键前缀 |

---

### 2.3 安全配置 (SecurityConfig)

```typescript
interface SecurityConfig {
  apiKey: string         // API 密钥
  encryptionKey: string  // 加密密钥
  requireApiKey: boolean // 是否强制 API Key
}
```

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `API_KEY` | '' | API 访问密钥 |
| `ENCRYPTION_KEY` | '' | 数据加密密钥 |
| `REQUIRE_API_KEY` | false | 是否强制认证 |

---

### 2.4 代理配置 (ProxyConfig)

```typescript
interface ProxyConfig {
  enableMultiAccount: boolean        // 启用多账号
  maxConcurrent: number              // 最大并发数
  maxRetries: number                 // 最大重试次数
  retryDelayMs: number               // 重试延迟 (ms)
  tokenRefreshBeforeExpiry: number   // 提前刷新时间 (秒)
  preferredEndpoint: 'codewhisperer' | 'amazonq'  // 首选端点
  autoContinueRounds: number         // 自动继续轮数
  disableTools: boolean              // 禁用工具
  autoSwitchOnQuotaExhausted: boolean // 配额耗尽自动切换
}
```

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `ENABLE_MULTI_ACCOUNT` | true | 启用多账号支持 |
| `MAX_CONCURRENT` | 10 | 最大并发请求数 |
| `MAX_RETRIES` | 3 | 最大重试次数 |
| `RETRY_DELAY_MS` | 1000 | 重试延迟 |
| `TOKEN_REFRESH_BEFORE_EXPIRY` | 300 | 提前刷新 Token (秒) |
| `PREFERRED_ENDPOINT` | codewhisperer | 首选 API 端点 |
| `AUTO_CONTINUE_ROUNDS` | 0 | 自动继续轮数 |
| `DISABLE_TOOLS` | false | 禁用工具调用 |
| `AUTO_SWITCH_ON_QUOTA_EXHAUSTED` | true | 配额耗尽自动切换 |

---

### 2.5 限流配置 (RateLimitConfig)

```typescript
interface RateLimitConfig {
  enabled: boolean    // 是否启用
  windowMs: number    // 时间窗口 (ms)
  maxRequests: number // 最大请求数
}
```

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `RATE_LIMIT_ENABLED` | false | 启用限流 |
| `RATE_LIMIT_WINDOW_MS` | 60000 | 时间窗口 (1分钟) |
| `RATE_LIMIT_MAX_REQUESTS` | 100 | 窗口内最大请求数 |

---

### 2.6 日志配置 (LogConfig)

```typescript
interface LogConfig {
  level: string      // 日志级别
  maxEntries: number // 最大日志条目
}
```

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `LOG_LEVEL` | info | 日志级别 (debug/info/warn/error) |
| `LOG_MAX_ENTRIES` | 100000 | 最大日志条目数 |

---

### 2.7 账号池配置 (AccountPoolConfig)

```typescript
interface AccountPoolConfig {
  cooldownMs: number    // 冷却时间 (ms)
  maxErrorCount: number // 最大错误次数
  quotaResetMs: number  // 配额重置周期 (ms)
}
```

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| cooldownMs | 60000 | 账号冷却时间 (1分钟) |
| maxErrorCount | 3 | 错误次数阈值 |
| quotaResetMs | 3600000 | 配额重置周期 (1小时) |

> 注意：账号池配置不支持环境变量覆盖

---

## 三、配置加载机制

### 3.1 加载流程

```
应用启动
    ↓
dotenv.config() - 加载 .env 文件
    ↓
loadConfig() - 读取环境变量
    ↓
合并默认值 - 环境变量 > 默认值
    ↓
返回 Config 对象 (单例缓存)
```

### 3.2 单例模式

```typescript
let configInstance: Config | null = null

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig()
  }
  return configInstance
}
```

### 3.3 配置重载

```typescript
export function reloadConfig(): Config {
  configInstance = loadConfig()
  return configInstance
}
```

---

## 四、使用示例

### 基础使用

```typescript
import { getConfig } from './config/index'

const config = getConfig()
console.log(config.server.port)      // 3000
console.log(config.redis.url)        // redis://localhost:16999
```

### 环境变量配置

```bash
# .env 文件
PORT=8080
REDIS_URL=redis://redis-server:16999
MAX_CONCURRENT=20
RATE_LIMIT_ENABLED=true
```

---

## 五、类型安全

使用 `as const` 确保默认值的类型安全：

```typescript
export const DEFAULT_SERVER_CONFIG = {
  port: 3000,
  host: '0.0.0.0',
  nodeEnv: 'development'
} as const
```

---

## 六、配置优先级

```
环境变量 (最高优先级)
    ↓
默认值 (最低优先级)
```
