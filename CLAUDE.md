# Kiro Gateway — Project Memory

## Project Overview

Kiro Gateway is an independent API gateway service that provides OpenAI/Claude-compatible API proxies. It supports multi-account management, automatic load balancing, token auto-refresh, and request analytics.

- **License**: AGPL-3.0
- **Node.js**: >=18.0.0
- **Package Manager**: pnpm 9.0 (monorepo)
- **Language**: TypeScript 5.9 (strict mode)

## Monorepo Structure

```
gateway/
├── packages/
│   ├── backend/          # Express.js 后端服务 (port 3000)
│   ├── frontend/         # React 19 + Vite 管理面板 (port 5173)
│   └── shared/           # 共享 TypeScript 类型定义
├── Dockerfile            # 多阶段构建 (prod port 8000)
├── docker-compose.yml    # Gateway + Redis
└── pnpm-workspace.yaml
```

## Commands

```bash
# Development
pnpm dev:backend          # 启动后端开发服务器
pnpm dev:frontend         # 启动前端开发服务器

# Build
pnpm build                # 构建所有包
pnpm build:backend        # 仅构建后端
pnpm build:frontend       # 仅构建前端

# Quality
pnpm lint                 # 全量 lint
pnpm typecheck            # 全量类型检查
```

## Backend Architecture (packages/backend)

### Tech Stack

- **Framework**: Express.js 4.21
- **Database**: Redis only (ioredis 5.4), no SQL
- **Auth**: JWT (jsonwebtoken) + API Key dual authentication
- **Logging**: Winston
- **Rate Limiting**: express-rate-limit + rate-limit-redis
- **Encryption**: bcryptjs, custom AES crypto utils

### Directory Layout

```
src/
├── index.ts              # Entry: server startup, token refresh scheduling
├── app.ts                # Express app config, middleware pipeline
├── config/               # Environment-based configuration
│   ├── index.ts          # Config loader
│   └── defaults.ts       # Default values
├── core/                 # Core business logic
│   ├── proxyServer.ts    # Main proxy: request routing & orchestration
│   ├── kiroApi.ts        # Kiro API client (AWS endpoints)
│   ├── translator.ts     # Format conversion: OpenAI ↔ Claude ↔ Kiro
│   ├── tokenRefresh.ts   # Auto token renewal (every 5 min)
│   ├── machineId.ts      # Virtual machine ID generation
│   ├── accountPool.ts    # Multi-account pool & load balancing
│   └── types.ts          # Internal type definitions
├── routes/               # Route handlers
│   ├── index.ts          # Route aggregation
│   ├── proxy.ts          # /v1/* (OpenAI/Claude compatible endpoints)
│   ├── auth.ts           # /api/auth/* (login, logout, password)
│   ├── accounts.ts       # /api/accounts/* (account CRUD)
│   ├── admin.ts          # /api/admin/* (config, API keys)
│   ├── stats.ts          # /api/stats/* (statistics)
│   └── logs.ts           # /api/logs/* (request/system logs)
├── services/             # Business logic layer
│   ├── accountService.ts
│   ├── proxyService.ts
│   ├── logService.ts
│   └── statsService.ts
├── middleware/            # Express middleware
│   ├── jwtAuth.ts        # JWT auth for /api/* routes
│   ├── auth.ts           # API Key auth for /v1/* routes
│   ├── requestLogger.ts  # Request/response logging
│   ├── rateLimit.ts      # Redis-based sliding window rate limiter
│   └── errorHandler.ts   # Global error handler + 404
├── storage/              # Redis data persistence
│   ├── redis.ts          # Redis client init
│   ├── accountStore.ts   # Account data (encrypted sensitive fields)
│   ├── adminStore.ts     # Admin credentials (bcrypt hashed)
│   ├── configStore.ts    # Gateway configuration
│   ├── tokenStore.ts     # JWT whitelist for revocation
│   ├── logStore.ts       # Request/system logs
│   └── statsStore.ts     # Request statistics
└── utils/
    ├── logger.ts         # Winston logger setup
    ├── crypto.ts         # AES encrypt/decrypt
    └── response.ts       # Standardized API response helpers
```

### Middleware Pipeline (order matters)

1. CORS
2. express.json (50MB limit)
3. express.urlencoded
4. requestLogger (Winston)
5. rateLimit (Redis-based, disabled by default)
6. jwtAuth → protects `/api/*` (except `/api/auth/login`)
7. authMiddleware → protects `/v1/*` with API Key
8. errorHandler (global)

### API Routes Summary

```
# Proxy (OpenAI/Claude compatible, API Key auth)
POST   /v1/chat/completions          # OpenAI chat format
POST   /v1/messages                  # Claude messages format
GET    /v1/models                    # Available models
GET    /v1/stats                     # Proxy statistics

# Auth (JWT)
POST   /api/auth/login
GET    /api/auth/me
PUT    /api/auth/password
POST   /api/auth/logout

# Account Management (JWT)
GET    /api/accounts
POST   /api/accounts
GET    /api/accounts/:id
PUT    /api/accounts/:id
DELETE /api/accounts/:id
POST   /api/accounts/:id/refresh
POST   /api/accounts/:id/test
POST   /api/accounts/:id/regenerate-machine-id
GET    /api/accounts/:id/usage
GET    /api/accounts/usage/all
POST   /api/accounts/batch/import

# Admin (JWT)
GET    /api/admin/config
PUT    /api/admin/config
GET    /api/admin/apikeys
POST   /api/admin/apikeys
DELETE /api/admin/apikeys/:id
GET    /api/admin/health

# Stats (JWT)
GET    /api/stats
GET    /api/stats/global
GET    /api/stats/accounts
GET    /api/stats/accounts/:id
GET    /api/stats/models
GET    /api/stats/report
POST   /api/stats/reset

# Logs (JWT)
GET    /api/logs/requests
GET    /api/logs/system
GET    /api/logs/errors
GET    /api/logs/stats
GET    /api/logs/summary
DELETE /api/logs/requests
DELETE /api/logs/system

# Public
GET    /health
```

### External API Integrations

- **CodeWhisperer**: `https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse`
- **Amazon Q**: `https://q.us-east-1.amazonaws.com/generateAssistantResponse`
- **Model List**: `https://codewhisperer.us-east-1.amazonaws.com/ListAvailableModels`
- **Usage Limits**: `https://q.us-east-1.amazonaws.com/getUsageLimits`
- **Token Refresh (Social)**: `https://prod.us-east-1.auth.desktop.kiro.dev`
- **Token Refresh (IDC)**: `https://oidc.{region}.amazonaws.com/token`

### Key Patterns

- **Account Pool**: Round-robin selection, error cooldown (60s default), max 3 consecutive errors before disable
- **Token Refresh**: Scheduled every 5 minutes, supports `social` and `idc` auth methods
- **Machine ID**: Each account bound to a unique virtual machine ID, stored encrypted
- **Redis Key Prefix**: `gateway:` for all keys
- **Streaming**: Native SSE support for all LLM proxy endpoints
- **Format Translation**: Bidirectional OpenAI ↔ Claude ↔ Kiro format conversion with tool calling support

## Frontend Architecture (packages/frontend)

### Tech Stack

- **Framework**: React 19.2 + React Router 7.1
- **Build**: Vite 7.2
- **Styling**: Tailwind CSS 3.4 + shadcn/ui (Radix UI primitives)
- **State**: AuthContext (auth) + TanStack React Query 5 (server state)
- **HTTP**: Axios with JWT interceptors (30s timeout)
- **Charts**: recharts 2.15
- **Icons**: lucide-react

### Directory Layout

```
src/
├── main.tsx                # Bootstrap
├── App.tsx                 # Router + QueryClientProvider + AuthProvider
├── index.css               # Tailwind + CSS variables (light/dark)
├── api/                    # Typed API clients
│   ├── client.ts           # Axios instance + interceptors
│   ├── auth.ts
│   ├── accounts.ts
│   ├── stats.ts
│   ├── logs.ts
│   └── config.ts
├── contexts/
│   └── AuthContext.tsx      # JWT token management (localStorage)
├── pages/
│   ├── Login.tsx
│   ├── Dashboard.tsx        # Stats cards + trend chart + account grid
│   ├── Accounts.tsx         # Account CRUD, import, test, refresh (40KB)
│   ├── Logs.tsx             # Log viewer with filters
│   └── Settings.tsx         # Config, API keys, rate limit (31KB)
├── components/
│   ├── auth/ProtectedRoute.tsx
│   ├── layout/{Layout,Header,Sidebar}.tsx
│   └── ui/                  # shadcn/ui components
├── hooks/
│   └── use-toast.ts
└── lib/
    └── utils.ts             # cn() class merge helper
```

### Routes

```
/login          → Login (public)
/dashboard      → Dashboard (protected)
/accounts       → Account Management (protected)
/logs           → Log Viewer (protected)
/settings       → System Settings (protected)
```

### Dev Proxy

Vite dev server proxies `/api` and `/v1` to `http://localhost:3000` (backend).

## Shared Types (packages/shared)

Single file: `src/types/index.ts` (383 lines)

Key types exported:
- `Account`, `AccountCredentials`, `AddAccountRequest`
- `GatewayConfig`, `UpdateConfigRequest`
- `ProxyStats`, `AccountStats`, `StatsOverview`
- `RequestLog`, `SystemLog`, `LogsQuery`
- `ApiKeyRecord`, `CreateApiKeyRequest`
- `UsageLimitsResponse`, `AccountUsage`
- `OpenAIChatRequest`, `OpenAIChatResponse`
- `ClaudeRequest`, `ClaudeResponse`
- `KiroPayload`
- `ApiResponse<T>` — generic response wrapper

## Data Flow (Proxy Request)

```
Client (OpenAI/Claude SDK)
  → POST /v1/chat/completions
  → API Key validation (middleware/auth.ts)
  → Rate limit check (middleware/rateLimit.ts)
  → ProxyServer (core/proxyServer.ts)
    → Translator: OpenAI → Kiro format (core/translator.ts)
    → AccountPool: select available account (core/accountPool.ts)
    → KiroAPI: call AWS endpoint (core/kiroApi.ts)
    → Translator: Kiro → OpenAI format
    → Stats/Log write to Redis
  → SSE stream or JSON response back to client
```

## Deployment

- **Docker**: Multi-stage build (Node 20-alpine), non-root user, health check
- **Services**: Gateway (port 8000) + Redis 7 (port 16999)
- **Network**: `kiro-network` (Docker bridge)
- **Redis Config**: 256MB max memory, LRU eviction
- **Frontend**: Static files served by Express from `/public` in production

## Environment Variables (Key)

```
PORT=3000                    # Backend port
HOST=0.0.0.0                # Bind address
REDIS_URL=redis://localhost:16999
JWT_SECRET=...               # JWT signing secret
JWT_EXPIRES_IN=24h
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
REQUIRE_API_KEY=false        # Toggle API key requirement
RATE_LIMIT_ENABLED=false
RATE_LIMIT_WINDOW=60000      # ms
RATE_LIMIT_MAX=100
```
