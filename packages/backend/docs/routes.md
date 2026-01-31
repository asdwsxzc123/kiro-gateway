# 路由模块文档

## 目录结构

```
src/routes/
├── index.ts      # 路由聚合入口
├── proxy.ts      # AI API 代理路由
├── accounts.ts   # 账号管理路由
├── admin.ts      # 管理配置路由
├── stats.ts      # 统计数据路由
└── logs.ts       # 日志管理路由
```

---

## 一、路由注册机制

### index.ts - 路由聚合

```typescript
const router: IRouter = Router()

router.use('/v1', proxyRouter)              // 代理路由
router.use('/api/accounts', accountsRouter) // 账号管理
router.use('/api/stats', statsRouter)       // 统计数据
router.use('/api/logs', logsRouter)         // 日志管理
router.use('/api/admin', adminRouter)       // 管理配置
```

---

## 二、proxy.ts - AI API 代理路由

### 端点列表

| 方法 | 端点 | 功能 | 特性 |
|------|------|------|------|
| POST | `/v1/chat/completions` | OpenAI Chat API | 支持流式/非流式 |
| POST | `/v1/messages` | Claude Messages API | 支持流式/非流式 |
| GET | `/v1/models` | 获取模型列表 | - |

### 流式响应

```typescript
// 流式响应头
res.setHeader('Content-Type', 'text/event-stream')
res.setHeader('Cache-Control', 'no-cache')
res.setHeader('Connection', 'keep-alive')
res.setHeader('X-Accel-Buffering', 'no')
```

### 支持的模型

- claude-sonnet-4.5, claude-sonnet-4
- claude-haiku-4.5, claude-opus-4.5
- gpt-4, gpt-4o (映射到 Claude)

---

## 三、accounts.ts - 账号管理路由

### 端点列表

| 方法 | 端点 | 功能 |
|------|------|------|
| GET | `/api/accounts` | 获取所有账号（隐藏敏感信息） |
| GET | `/api/accounts/:id` | 获取账号详情 |
| POST | `/api/accounts` | 添加新账号 |
| PUT | `/api/accounts/:id` | 更新账号信息 |
| DELETE | `/api/accounts/:id` | 删除账号 |
| POST | `/api/accounts/:id/refresh` | 刷新账号 Token |
| POST | `/api/accounts/:id/test` | 测试账号连通性 |
| POST | `/api/accounts/:id/regenerate-machine-id` | 重新生成机器码 |
| POST | `/api/accounts/batch/import` | 批量导入账号 |

### 安全特性

返回账号列表时隐藏敏感信息：
- 只返回：id, email, authMethod, provider, region, machineId, isAvailable, errorCount, requestCount, lastUsed, expiresAt, createdAt

---

## 四、admin.ts - 管理配置路由

### 端点列表

| 方法 | 端点 | 功能 |
|------|------|------|
| GET | `/api/admin/config` | 获取网关配置 |
| PUT | `/api/admin/config` | 更新网关配置 |
| GET | `/api/admin/selected-accounts` | 获取选中账号列表 |
| PUT | `/api/admin/selected-accounts` | 设置选中账号 |
| GET | `/api/admin/apikeys` | 获取所有 API Key（隐藏完整 key） |
| POST | `/api/admin/apikeys` | 创建新 API Key |
| DELETE | `/api/admin/apikeys/:id` | 删除 API Key |
| GET | `/api/admin/health` | 健康检查 |

### API Key 管理

```typescript
// 创建时生成
const id = uuidv4()
const key = `sk-${uuidv4().replace(/-/g, '')}`

// 列表返回时隐藏
keyPreview: k.key.substring(0, 8) + '...'
```

### 健康检查响应

```json
{
  "status": "healthy",
  "redis": "connected",
  "timestamp": 1706688000000
}
```

---

## 五、stats.ts - 统计数据路由

### 端点列表

| 方法 | 端点 | 功能 |
|------|------|------|
| GET | `/api/stats` | 获取统计概览 |
| GET | `/api/stats/global` | 获取全局统计 |
| GET | `/api/stats/accounts` | 获取所有账号统计 |
| GET | `/api/stats/accounts/:id` | 获取指定账号统计 |
| GET | `/api/stats/models` | 获取所有模型统计 |
| GET | `/api/stats/report` | 获取详细统计报告 |
| POST | `/api/stats/reset` | 重置所有统计数据 |

---

## 六、logs.ts - 日志管理路由

### 端点列表

| 方法 | 端点 | 功能 | 查询参数 |
|------|------|------|---------|
| GET | `/api/logs/requests` | 获取请求日志 | limit, startTime, endTime |
| GET | `/api/logs/system` | 获取系统日志 | limit, level, category |
| GET | `/api/logs/stats` | 获取日志统计 | - |
| GET | `/api/logs/errors` | 获取最近错误 | limit |
| GET | `/api/logs/summary` | 获取请求摘要 | hours |
| DELETE | `/api/logs/requests` | 清空请求日志 | - |
| DELETE | `/api/logs/system` | 清空系统日志 | - |

### 查询示例

```bash
# 获取请求日志
GET /api/logs/requests?limit=100&startTime=1234567890

# 获取系统日志
GET /api/logs/system?limit=100&level=error&category=auth

# 获取最近24小时摘要
GET /api/logs/summary?hours=24
```

---

## 七、响应格式

### 成功响应

```json
{
  "success": true,
  "data": { /* 业务数据 */ }
}
```

### 错误响应

```json
{
  "success": false,
  "error": { "message": "错误信息" }
}
```

### Proxy 路由错误

```json
// OpenAI 格式
{ "error": { "message": "...", "type": "api_error" } }

// Claude 格式
{ "type": "error", "error": { "type": "invalid_request_error", "message": "..." } }
```

---

## 八、端点总览

共 **23 个 API 端点**：

| 模块 | 端点数 |
|------|--------|
| proxy | 3 |
| accounts | 9 |
| admin | 8 |
| stats | 7 |
| logs | 7 |
