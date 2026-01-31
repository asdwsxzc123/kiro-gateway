# 中间件模块文档

## 目录结构

```
src/middleware/
├── auth.ts           # API Key 认证
├── rateLimit.ts      # 限流控制
├── requestLogger.ts  # 请求日志
└── errorHandler.ts   # 错误处理
```

---

## 一、中间件执行顺序

```
请求进入
    ↓
1. CORS 中间件 (cors())
    ↓
2. JSON 解析 (express.json())
    ↓
3. URL 编码解析 (express.urlencoded())
    ↓
4. 请求日志 (requestLoggerMiddleware)
    ↓
5. 限流检查 (rateLimitMiddleware)
    ↓
6. 路由匹配
    ├─ /health → 直接响应（不需要认证）
    ├─ /v1/* → API Key 认证 (authMiddleware)
    └─ /api/* → API Key 认证 (authMiddleware)
    ↓
7. 业务路由处理
    ↓
8. 404 处理 (notFoundHandler)
    ↓
9. 错误处理 (errorHandler)
    ↓
响应返回
```

---

## 二、auth.ts - API Key 认证

### 2.1 功能说明

验证请求中的 API Key，保护 `/v1` 和 `/api` 路由。

### 2.2 API Key 提取顺序

1. `Authorization` header 中的 Bearer token
2. `x-api-key` header
3. 查询参数 `api_key`（不推荐）

### 2.3 导出函数

```typescript
// 强制认证中间件
authMiddleware(req, res, next)

// 可选认证中间件
optionalAuthMiddleware(req, res, next)
```

### 2.4 豁免规则

- `/health` 端点不需要认证
- `/api/admin/health` 端点不需要认证
- 可通过配置禁用认证 (`config.security.requireApiKey`)

### 2.5 错误响应

```json
// 401 Unauthorized
{
  "error": {
    "message": "API key is required",
    "type": "authentication_error"
  }
}

// 401 Invalid Key
{
  "error": {
    "message": "Invalid API key",
    "type": "authentication_error"
  }
}
```

---

## 三、rateLimit.ts - 限流控制

### 3.1 功能说明

基于 Redis 滑动窗口算法实现的限流中间件。

### 3.2 实现原理

```typescript
// 使用 Redis Sorted Set 实现滑动窗口
const key = `ratelimit:${clientIp}`

// 1. 移除窗口外的请求记录
pipeline.zremrangebyscore(key, 0, windowStart)

// 2. 获取当前窗口内的请求数
pipeline.zcard(key)

// 3. 添加当前请求
pipeline.zadd(key, now, `${now}-${Math.random()}`)

// 4. 设置过期时间
pipeline.expire(key, Math.ceil(windowMs / 1000))
```

### 3.3 导出函数

```typescript
// 全局限流中间件
rateLimitMiddleware(req, res, next)

// 自定义限流工厂
createRateLimiter(options: {
  windowMs: number
  maxRequests: number
  keyPrefix?: string
})
```

### 3.4 响应头

```
X-RateLimit-Limit: 100        # 限流上限
X-RateLimit-Remaining: 95     # 剩余请求数
X-RateLimit-Reset: 1706688000 # 重置时间戳
```

### 3.5 超限响应

```json
// 429 Too Many Requests
{
  "error": {
    "message": "Too many requests, please try again later",
    "type": "rate_limit_error"
  }
}
```

### 3.6 容错处理

Redis 连接失败时放行请求，避免级联故障。

---

## 四、requestLogger.ts - 请求日志

### 4.1 功能说明

记录所有 HTTP 请求的基本信息和响应时间。

### 4.2 导出函数

```typescript
// 基础请求日志
requestLoggerMiddleware(req, res, next)

// 详细请求日志（调试用）
verboseRequestLoggerMiddleware(req, res, next)
```

### 4.3 日志内容

**基础日志：**
- 请求方法、路径
- 客户端 IP、User-Agent
- 响应状态码、耗时

**详细日志（额外）：**
- 查询参数
- 请求头（隐藏 Authorization）
- 请求体大小
- 响应体大小

### 4.4 日志级别

- 状态码 >= 400：`warn`
- 其他：`info`

---

## 五、errorHandler.ts - 错误处理

### 5.1 功能说明

统一处理所有未捕获的异常和 404 错误。

### 5.2 导出函数

```typescript
// 404 处理
notFoundHandler(req, res, next)

// 全局错误处理
errorHandler(err, req, res, next)

// 异步错误包装器
asyncHandler(fn: AsyncRequestHandler)
```

### 5.3 错误分类

| 错误类型 | 状态码 | 处理方式 |
|---------|--------|---------|
| SyntaxError (JSON) | 400 | 返回 "Invalid JSON in request body" |
| ValidationError | 400 | 返回验证错误信息 |
| 其他错误 | 500 | 生产环境隐藏详情 |

### 5.4 404 响应

```json
{
  "error": {
    "message": "Route GET /unknown/path not found",
    "type": "not_found_error"
  }
}
```

### 5.5 500 响应

```json
// 生产环境
{
  "error": {
    "message": "Internal server error",
    "type": "internal_error"
  }
}

// 开发环境
{
  "error": {
    "message": "具体错误信息",
    "type": "internal_error"
  }
}
```

### 5.6 asyncHandler 使用

```typescript
// 包装异步路由处理函数
app.get('/api/data', asyncHandler(async (req, res) => {
  const data = await fetchData()  // 错误自动被捕获
  res.json(data)
}))
```

---

## 六、安全设计

### 6.1 认证隔离

- 仅对 `/v1` 和 `/api` 路由强制认证
- 健康检查端点公开访问

### 6.2 敏感信息保护

- 日志中隐藏 Authorization 头
- 生产环境不暴露内部错误详情

### 6.3 限流防护

- 基于 IP 的滑动窗口限流
- Redis 失败时放行（容错）

---

## 七、配置依赖

```typescript
// 限流配置
config.rateLimit.enabled        // 是否启用
config.rateLimit.windowMs       // 时间窗口
config.rateLimit.maxRequests    // 最大请求数

// 认证配置
config.security.requireApiKey   // 是否强制认证

// 环境配置
process.env.NODE_ENV            // 环境
```
