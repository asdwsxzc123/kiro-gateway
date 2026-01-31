# Kiro Gateway 后端架构文档

## 一、项目概述

Kiro Gateway 是一个 AI API 网关服务，提供 OpenAI/Claude 兼容的 API 接口，将请求代理到 AWS Kiro API（CodeWhisperer/AmazonQ）。

### 核心功能

- **多协议支持**：兼容 OpenAI 和 Claude API 格式
- **多账号管理**：支持账号池、轮询负载均衡、自动 Token 刷新
- **流式响应**：支持 Server-Sent Events (SSE) 流式输出
- **安全防护**：API Key 认证、限流、敏感数据加密
- **可观测性**：请求日志、统计数据、健康检查

### 技术栈

| 技术 | 用途 |
|------|------|
| Node.js + TypeScript | 运行时和开发语言 |
| Express.js | Web 框架 |
| Redis (ioredis) | 数据存储、缓存、限流 |
| Winston | 日志系统 |
| AES-256-GCM | 敏感数据加密 |

---

## 二、目录结构

```
packages/backend/src/
├── index.ts              # 应用入口，启动服务器
├── app.ts                # Express 应用配置
├── config/               # 配置管理
│   ├── index.ts          # 配置加载器
│   └── defaults.ts       # 默认配置
├── core/                 # 核心业务逻辑
│   ├── types.ts          # 类型定义
│   ├── kiroApi.ts        # Kiro API 调用
│   ├── translator.ts     # 格式转换器
│   ├── tokenRefresh.ts   # Token 刷新
│   └── machineId.ts      # 机器码管理
├── middleware/           # Express 中间件
│   ├── auth.ts           # API Key 认证
│   ├── rateLimit.ts      # 限流
│   ├── requestLogger.ts  # 请求日志
│   └── errorHandler.ts   # 错误处理
├── routes/               # API 路由
│   ├── index.ts          # 路由聚合
│   ├── proxy.ts          # AI 代理路由
│   ├── accounts.ts       # 账号管理路由
│   ├── admin.ts          # 管理配置路由
│   ├── stats.ts          # 统计路由
│   └── logs.ts           # 日志路由
├── services/             # 业务服务层
│   ├── accountService.ts # 账号服务
│   ├── proxyService.ts   # 代理服务
│   ├── statsService.ts   # 统计服务
│   └── logService.ts     # 日志服务
├── storage/              # 数据存储层
│   ├── redis.ts          # Redis 客户端
│   ├── accountStore.ts   # 账号存储
│   ├── configStore.ts    # 配置存储
│   ├── statsStore.ts     # 统计存储
│   └── logStore.ts       # 日志存储
└── utils/                # 工具函数
    ├── logger.ts         # 日志工具
    └── crypto.ts         # 加密工具
```

---

## 三、分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                      客户端请求                              │
│              (OpenAI / Claude API 格式)                      │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    中间件层 (Middleware)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │   CORS   │→│ 请求日志 │→│   限流   │→│  API Key认证 │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      路由层 (Routes)                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │  /v1/*   │ │/api/acct │ │/api/stats│ │/api/admin│       │
│  │ (代理)   │ │ (账号)   │ │ (统计)   │ │ (管理)   │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     服务层 (Services)                        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ proxyService │ │accountService│ │ statsService │        │
│  │  (代理服务)  │ │  (账号服务)  │ │  (统计服务)  │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      核心层 (Core)                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ kiroApi  │ │translator│ │tokenRefr │ │machineId │       │
│  │(API调用) │ │(格式转换)│ │(Token刷新)│ │(机器码)  │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     存储层 (Storage)                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ accountStore │ │ configStore  │ │  statsStore  │        │
│  │  (账号存储)  │ │  (配置存储)  │ │  (统计存储)  │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│                          │                                  │
│                          ▼                                  │
│                   ┌──────────────┐                          │
│                   │    Redis     │                          │
│                   └──────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 四、请求处理流程

### 4.1 完整请求链路

```
客户端请求 (POST /v1/chat/completions)
    │
    ├─ 1. CORS 中间件
    ├─ 2. JSON 解析
    ├─ 3. 请求日志记录
    ├─ 4. 限流检查 (Redis 滑动窗口)
    ├─ 5. API Key 认证
    │
    ▼
路由层 (proxy.ts)
    │
    ▼
服务层 (proxyService)
    ├─ 6. 选择可用账号 (轮询策略)
    ├─ 7. 检查 Token 过期 → 自动刷新
    │
    ▼
核心层 (translator + kiroApi)
    ├─ 8. 格式转换 (OpenAI → Kiro)
    ├─ 9. 调用 Kiro API (流式)
    ├─ 10. 解析 AWS Event Stream
    ├─ 11. 格式转换 (Kiro → OpenAI)
    │
    ▼
存储层 (statsStore + logStore)
    ├─ 12. 更新统计数据
    ├─ 13. 记录请求日志
    │
    ▼
返回响应给客户端
```

### 4.2 流式响应处理

```
proxyService.handleOpenAIStreamRequest()
    │
    ├─ 设置 SSE 响应头
    │   Content-Type: text/event-stream
    │   Cache-Control: no-cache
    │   Connection: keep-alive
    │
    ├─ 调用 kiroApi.callKiroApiStream()
    │   │
    │   ├─ onChunk(text, toolUse)
    │   │   └─ res.write(`data: ${chunk}\n\n`)
    │   │
    │   ├─ onComplete(usage)
    │   │   └─ res.write(`data: [DONE]\n\n`)
    │   │
    │   └─ onError(error)
    │       └─ 错误处理
    │
    └─ res.end()
```

---

## 五、核心模块依赖关系

```
                    ┌─────────────┐
                    │  types.ts   │ ◄── 基础类型定义
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  kiroApi.ts   │  │ translator.ts │  │tokenRefresh.ts│
│  (API 调用)   │  │  (格式转换)   │  │ (Token 刷新)  │
└───────┬───────┘  └───────┬───────┘  └───────┬───────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │ proxyService.ts │ ◄── 核心代理服务
                  └────────┬────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ accountStore  │  │  statsStore   │  │   logStore    │
│  (账号存储)   │  │  (统计存储)   │  │  (日志存储)   │
└───────────────┘  └───────────────┘  └───────────────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │    Redis    │
                    └─────────────┘
```

---

## 六、数据存储设计

### Redis 数据结构

| Key 模式 | 类型 | 用途 |
|---------|------|------|
| `account:{id}` | Hash | 账号信息 |
| `accounts:index` | Sorted Set | 账号索引（按创建时间） |
| `accounts:available` | Set | 可用账号集合 |
| `config` | Hash | 网关配置 |
| `config:apiKeys` | Hash | API Key 记录 |
| `stats:global` | Hash | 全局统计 |
| `stats:account:{id}` | Hash | 账号统计 |
| `stats:model:{id}` | Hash | 模型统计 |
| `logs:requests` | Stream | 请求日志 |
| `logs:system` | Stream | 系统日志 |
| `ratelimit:{ip}` | Sorted Set | 限流计数 |

---

## 七、安全设计

### 7.1 认证机制

- **API Key 认证**：支持 Bearer Token、x-api-key 头、查询参数
- **可选认证**：健康检查端点不需要认证

### 7.2 限流机制

- **算法**：Redis 滑动窗口
- **粒度**：基于客户端 IP
- **配置**：可配置时间窗口和最大请求数

### 7.3 数据加密

- **算法**：AES-256-GCM
- **加密字段**：accessToken、refreshToken、clientSecret
- **密钥管理**：通过环境变量配置

---

## 八、配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3000 | 服务端口 |
| `HOST` | 0.0.0.0 | 监听地址 |
| `REDIS_URL` | redis://localhost:6379 | Redis 连接 |
| `API_KEY` | - | API 密钥 |
| `ENCRYPTION_KEY` | - | 加密密钥 |
| `RATE_LIMIT_ENABLED` | false | 启用限流 |
| `MAX_CONCURRENT` | 10 | 最大并发 |

---

## 九、API 端点概览

| 方法 | 端点 | 功能 |
|------|------|------|
| POST | `/v1/chat/completions` | OpenAI Chat API |
| POST | `/v1/messages` | Claude Messages API |
| GET | `/v1/models` | 模型列表 |
| GET | `/api/accounts` | 获取账号列表 |
| POST | `/api/accounts` | 添加账号 |
| GET | `/api/stats` | 统计概览 |
| GET | `/api/logs/requests` | 请求日志 |
| GET | `/api/admin/config` | 获取配置 |
| GET | `/health` | 健康检查 |

详细 API 文档请参考 [API.md](./API.md)

---

## 十、启动流程

```
index.ts: start()
    │
    ├─ 1. loadConfig() - 加载配置
    ├─ 2. getRedisClient().ping() - 测试 Redis 连接
    ├─ 3. createApp() - 创建 Express 应用
    │   ├─ 注册中间件
    │   └─ 注册路由
    ├─ 4. app.listen() - 启动 HTTP 服务器
    ├─ 5. startTokenRefreshTask() - 启动 Token 刷新定时任务
    └─ 6. 注册优雅关闭处理
```

---

## 十一、文档索引

| 文档 | 说明 |
|------|------|
| [config.md](./config.md) | 配置模块详解 |
| [core.md](./core.md) | 核心模块详解 |
| [middleware.md](./middleware.md) | 中间件详解 |
| [routes.md](./routes.md) | 路由详解 |
| [services.md](./services.md) | 服务层详解 |
| [storage.md](./storage.md) | 存储层详解 |
| [utils.md](./utils.md) | 工具模块详解 |
| [API.md](./API.md) | API 接口文档 |
