# Kiro API Gateway

独立的 Express.js 网关服务，提供 OpenAI/Claude 兼容的 API 代理，支持多账号管理。

## 功能特性

- **API 代理**: 兼容 OpenAI 和 Claude API 格式
- **多账号管理**: 支持添加多个 Kiro 账号，自动轮询
- **机器码绑定**: 每个账号绑定独立的虚拟机器码
- **Token 自动刷新**: 支持 Social 和 IDC 认证方式的 Token 刷新
- **统计和日志**: 完整的请求统计和日志记录
- **API Key 认证**: 可配置的 API Key 认证
- **限流保护**: 基于 Redis 的滑动窗口限流

## 快速开始

### 使用 Docker Compose（推荐）

```bash
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f gateway

# 停止服务
docker-compose down
```

### 手动运行

```bash
# 安装依赖
npm install

# 构建
npm run build

# 启动（需要先启动 Redis）
npm start
```

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| PORT | 3000 | 服务端口 |
| HOST | 0.0.0.0 | 监听地址 |
| REDIS_URL | redis://localhost:16999 | Redis 连接地址 |
| REDIS_PASSWORD | - | Redis 密码 |
| REDIS_DB | 0 | Redis 数据库 |
| REDIS_KEY_PREFIX | gateway: | Redis Key 前缀 |
| REQUIRE_API_KEY | false | 是否要求 API Key |
| ENCRYPTION_KEY | - | 敏感数据加密密钥 |
| RATE_LIMIT_ENABLED | false | 是否启用限流 |
| RATE_LIMIT_WINDOW_MS | 60000 | 限流窗口（毫秒） |
| RATE_LIMIT_MAX_REQUESTS | 100 | 窗口内最大请求数 |
| LOG_LEVEL | info | 日志级别 |

## API 接口

### 代理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/chat/completions` | OpenAI Chat API |
| POST | `/v1/messages` | Claude Messages API |
| GET | `/v1/models` | 模型列表 |
| GET | `/health` | 健康检查 |

### 账号管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/accounts` | 获取账号列表 |
| POST | `/api/accounts` | 添加账号 |
| GET | `/api/accounts/:id` | 获取账号详情 |
| PUT | `/api/accounts/:id` | 更新账号 |
| DELETE | `/api/accounts/:id` | 删除账号 |
| POST | `/api/accounts/:id/refresh` | 刷新 Token |
| POST | `/api/accounts/:id/test` | 测试连通性 |
| POST | `/api/accounts/:id/regenerate-machine-id` | 重新生成机器码 |
| POST | `/api/accounts/batch/import` | 批量导入 |

### 统计接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stats` | 统计概览 |
| GET | `/api/stats/global` | 全局统计 |
| GET | `/api/stats/accounts` | 账号统计 |
| GET | `/api/stats/models` | 模型统计 |
| POST | `/api/stats/reset` | 重置统计 |

### 日志接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/logs/requests` | 请求日志 |
| GET | `/api/logs/system` | 系统日志 |
| DELETE | `/api/logs/requests` | 清空请求日志 |

### 管理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/config` | 获取配置 |
| PUT | `/api/admin/config` | 更新配置 |
| GET | `/api/admin/apikeys` | API Key 列表 |
| POST | `/api/admin/apikeys` | 创建 API Key |
| DELETE | `/api/admin/apikeys/:id` | 删除 API Key |
| GET | `/api/admin/health` | 健康检查 |

## 添加账号示例

```bash
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "accessToken": "your-access-token",
    "refreshToken": "your-refresh-token",
    "authMethod": "social",
    "provider": "github"
  }'
```

## 使用代理

### OpenAI 格式

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4.5",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### Claude 格式

```bash
curl http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4.5",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## 目录结构

```
gateway/
├── src/
│   ├── index.ts              # 入口文件
│   ├── app.ts                # Express 应用
│   ├── config/               # 配置
│   ├── core/                 # 核心模块
│   │   ├── kiroApi.ts        # Kiro API 调用
│   │   ├── translator.ts     # 格式转换
│   │   ├── types.ts          # 类型定义
│   │   ├── tokenRefresh.ts   # Token 刷新
│   │   └── machineId.ts      # 机器码
│   ├── services/             # 业务服务
│   ├── storage/              # Redis 存储
│   ├── routes/               # API 路由
│   ├── middleware/           # 中间件
│   └── utils/                # 工具函数
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## License

MIT
