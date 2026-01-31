# API 接口文档

## 基础信息

- **Base URL**: `http://localhost:3000`
- **认证方式**: API Key (Bearer Token / x-api-key header)
- **响应格式**: JSON

---

## 一、AI 代理接口 (/v1)

### 1.1 OpenAI Chat Completions

**POST** `/v1/chat/completions`

OpenAI 兼容的 Chat API，支持流式和非流式响应。

**请求头**
```
Authorization: Bearer <api-key>
Content-Type: application/json
```

**请求体**
```json
{
  "model": "claude-sonnet-4.5",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 1000,
  "tools": []
}
```

**响应 (非流式)**
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1706688000,
  "model": "claude-sonnet-4.5",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you today?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 10,
    "total_tokens": 30
  }
}
```

**响应 (流式)**
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"}}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":"!"}}]}

data: [DONE]
```

---

### 1.2 Claude Messages

**POST** `/v1/messages`

Claude 兼容的 Messages API。

**请求体**
```json
{
  "model": "claude-sonnet-4.5",
  "max_tokens": 1000,
  "messages": [
    {"role": "user", "content": "Hello!"}
  ],
  "system": "You are a helpful assistant.",
  "stream": false
}
```

**响应**
```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "content": [{
    "type": "text",
    "text": "Hello! How can I help you today?"
  }],
  "model": "claude-sonnet-4.5",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 20,
    "output_tokens": 10
  }
}
```

---

### 1.3 模型列表

**GET** `/v1/models`

获取支持的模型列表。

**响应**
```json
{
  "object": "list",
  "data": [
    {"id": "claude-sonnet-4.5", "object": "model"},
    {"id": "claude-haiku-4.5", "object": "model"},
    {"id": "claude-opus-4.5", "object": "model"},
    {"id": "gpt-4", "object": "model"},
    {"id": "gpt-4o", "object": "model"}
  ]
}
```

---

## 二、账号管理接口 (/api/accounts)

### 2.1 获取账号列表

**GET** `/api/accounts`

**响应**
```json
{
  "success": true,
  "data": [{
    "id": "acc_xxx",
    "email": "user@example.com",
    "authMethod": "social",
    "provider": "github",
    "region": "us-east-1",
    "machineId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "isAvailable": true,
    "errorCount": 0,
    "requestCount": 100,
    "lastUsed": 1706688000000,
    "expiresAt": 1706774400000,
    "createdAt": 1706601600000
  }]
}
```

---

### 2.2 添加账号

**POST** `/api/accounts`

**请求体**
```json
{
  "email": "user@example.com",
  "accessToken": "xxx",
  "refreshToken": "xxx",
  "expiresAt": 1706774400000,
  "authMethod": "social",
  "provider": "github",
  "region": "us-east-1",
  "machineId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

**响应**
```json
{
  "success": true,
  "data": {
    "id": "acc_xxx",
    "email": "user@example.com",
    ...
  }
}
```

---

### 2.3 更新账号

**PUT** `/api/accounts/:id`

**请求体**
```json
{
  "accessToken": "new-token",
  "refreshToken": "new-refresh-token",
  "expiresAt": 1706860800000
}
```

---

### 2.4 删除账号

**DELETE** `/api/accounts/:id`

**响应**
```json
{
  "success": true,
  "data": { "deleted": true }
}
```

---

### 2.5 刷新 Token

**POST** `/api/accounts/:id/refresh`

**响应**
```json
{
  "success": true,
  "data": {
    "success": true,
    "account": { ... }
  }
}
```

---

### 2.6 测试连通性

**POST** `/api/accounts/:id/test`

**响应**
```json
{
  "success": true,
  "data": {
    "success": true,
    "models": ["claude-sonnet-4.5", "claude-haiku-4.5"]
  }
}
```

---

### 2.7 重新生成机器码

**POST** `/api/accounts/:id/regenerate-machine-id`

**响应**
```json
{
  "success": true,
  "data": {
    "machineId": "new-machine-id"
  }
}
```

---

### 2.8 批量导入

**POST** `/api/accounts/batch/import`

**请求体**
```json
{
  "accounts": [
    { "email": "user1@example.com", ... },
    { "email": "user2@example.com", ... }
  ]
}
```

**响应**
```json
{
  "success": true,
  "data": {
    "success": 2,
    "failed": 0,
    "errors": []
  }
}
```

---

## 三、统计接口 (/api/stats)

### 3.1 统计概览

**GET** `/api/stats`

**响应**
```json
{
  "success": true,
  "data": {
    "global": {
      "totalRequests": 1000,
      "successRequests": 950,
      "failedRequests": 50,
      "totalTokens": 500000,
      "inputTokens": 200000,
      "outputTokens": 300000
    },
    "accounts": {
      "total": 5,
      "available": 4
    },
    "uptime": 86400000
  }
}
```

---

### 3.2 全局统计

**GET** `/api/stats/global`

---

### 3.3 账号统计

**GET** `/api/stats/accounts`
**GET** `/api/stats/accounts/:id`

---

### 3.4 模型统计

**GET** `/api/stats/models`

---

### 3.5 详细报告

**GET** `/api/stats/report`

---

### 3.6 重置统计

**POST** `/api/stats/reset`

---

## 四、日志接口 (/api/logs)

### 4.1 请求日志

**GET** `/api/logs/requests`

**查询参数**
| 参数 | 类型 | 说明 |
|------|------|------|
| limit | number | 返回条数，默认 100 |
| startTime | number | 开始时间戳 |
| endTime | number | 结束时间戳 |

**响应**
```json
{
  "success": true,
  "data": [{
    "id": "xxx",
    "timestamp": 1706688000000,
    "path": "/v1/chat/completions",
    "model": "claude-sonnet-4.5",
    "accountId": "acc_xxx",
    "inputTokens": 100,
    "outputTokens": 200,
    "responseTime": 1500,
    "success": true
  }]
}
```

---

### 4.2 系统日志

**GET** `/api/logs/system`

**查询参数**
| 参数 | 类型 | 说明 |
|------|------|------|
| limit | number | 返回条数 |
| level | string | 日志级别 (info/warn/error) |
| category | string | 日志分类 |

---

### 4.3 日志统计

**GET** `/api/logs/stats`

**响应**
```json
{
  "success": true,
  "data": {
    "requestCount": 10000,
    "systemCount": 5000
  }
}
```

---

### 4.4 最近错误

**GET** `/api/logs/errors?limit=10`

---

### 4.5 请求摘要

**GET** `/api/logs/summary?hours=24`

**响应**
```json
{
  "success": true,
  "data": {
    "total": 1000,
    "success": 950,
    "failed": 50,
    "avgResponseTime": 1200
  }
}
```

---

### 4.6 清空日志

**DELETE** `/api/logs/requests`
**DELETE** `/api/logs/system`

---

## 五、管理接口 (/api/admin)

### 5.1 获取配置

**GET** `/api/admin/config`

**响应**
```json
{
  "success": true,
  "data": {
    "port": 3000,
    "host": "0.0.0.0",
    "enableMultiAccount": true,
    "maxConcurrent": 10,
    "maxRetries": 3,
    "preferredEndpoint": "codewhisperer",
    "rateLimitEnabled": false
  }
}
```

---

### 5.2 更新配置

**PUT** `/api/admin/config`

**请求体**
```json
{
  "maxConcurrent": 20,
  "rateLimitEnabled": true
}
```

---

### 5.3 选中账号

**GET** `/api/admin/selected-accounts`
**PUT** `/api/admin/selected-accounts`

**请求体**
```json
{
  "accountIds": ["acc_xxx", "acc_yyy"]
}
```

---

### 5.4 API Key 管理

**GET** `/api/admin/apikeys`

**响应**
```json
{
  "success": true,
  "data": [{
    "id": "xxx",
    "name": "My API Key",
    "keyPreview": "sk-abc12...",
    "createdAt": 1706688000000,
    "lastUsed": 1706774400000
  }]
}
```

**POST** `/api/admin/apikeys`

**请求体**
```json
{
  "name": "My API Key"
}
```

**响应**
```json
{
  "success": true,
  "data": {
    "id": "xxx",
    "key": "sk-abc123def456...",
    "name": "My API Key"
  }
}
```

**DELETE** `/api/admin/apikeys/:id`

---

### 5.5 健康检查

**GET** `/api/admin/health`

**响应**
```json
{
  "status": "healthy",
  "redis": "connected",
  "timestamp": 1706688000000
}
```

---

## 六、健康检查

**GET** `/health`

无需认证。

**响应**
```json
{
  "status": "ok",
  "timestamp": 1706688000000,
  "version": "1.0.0"
}
```

---

## 七、错误响应格式

### 标准错误

```json
{
  "success": false,
  "error": {
    "message": "错误信息"
  }
}
```

### 认证错误 (401)

```json
{
  "error": {
    "message": "API key is required",
    "type": "authentication_error"
  }
}
```

### 限流错误 (429)

```json
{
  "error": {
    "message": "Too many requests, please try again later",
    "type": "rate_limit_error"
  }
}
```

### 404 错误

```json
{
  "error": {
    "message": "Route GET /unknown not found",
    "type": "not_found_error"
  }
}
```

---

## 八、限流响应头

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1706688060
```
