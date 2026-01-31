# 核心模块文档

## 目录结构

```
src/core/
├── types.ts          # 全局类型定义
├── kiroApi.ts        # Kiro API 调用
├── translator.ts     # 格式转换器
├── tokenRefresh.ts   # Token 刷新管理
└── machineId.ts      # 机器码管理
```

---

## 一、types.ts - 类型定义系统

### 1.1 OpenAI 兼容格式

```typescript
// 请求格式
interface OpenAIChatRequest {
  model: string
  messages: OpenAIMessage[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  tools?: OpenAITool[]
}

// 消息格式
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OpenAIContentPart[]
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

// 响应格式
interface OpenAIChatResponse {
  id: string
  object: 'chat.completion'
  choices: OpenAIChoice[]
  usage: { prompt_tokens, completion_tokens, total_tokens }
}
```

### 1.2 Claude 兼容格式

```typescript
// 请求格式
interface ClaudeRequest {
  model: string
  messages: ClaudeMessage[]
  system?: string
  max_tokens: number
  stream?: boolean
  tools?: ClaudeTool[]
}

// 内容块类型
type ClaudeContentBlock =
  | { type: 'text', text: string }
  | { type: 'image', source: {...} }
  | { type: 'tool_use', id, name, input }
  | { type: 'tool_result', tool_use_id, content }
```

### 1.3 Kiro API 格式

```typescript
// 请求负载
interface KiroPayload {
  conversationState: KiroConversationState
  profileArn?: string
  source?: string
  dryRun?: boolean
}

// 对话状态
interface KiroConversationState {
  conversationId?: string
  currentMessage: KiroUserInputMessage
  chatTriggerType: string
  customizationArn?: string
}
```

### 1.4 账号管理类型

```typescript
interface ProxyAccount {
  id: string
  email: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  authMethod: 'social' | 'idc'
  provider?: 'github' | 'google'
  region?: string
  machineId: string           // 必填，设备绑定
  machineIdCreatedAt?: number
  isAvailable: boolean
  errorCount: number
  requestCount: number
  lastUsed?: number
  cooldownUntil?: number
  createdAt: number
}
```

---

## 二、kiroApi.ts - Kiro API 调用

### 2.1 端点配置

```typescript
const KIRO_ENDPOINTS = [
  {
    url: 'https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse',
    origin: 'AI_EDITOR',
    amzTarget: 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse',
    name: 'CodeWhisperer'
  },
  {
    url: 'https://q.us-east-1.amazonaws.com/generateAssistantResponse',
    origin: 'CLI',
    amzTarget: 'AmazonQDeveloperStreamingService.SendMessage',
    name: 'AmazonQ'
  }
]
```

### 2.2 模型映射

```typescript
const MODEL_ID_MAP = {
  'claude-sonnet-4-5': 'claude-sonnet-4.5',
  'claude-haiku-4-5': 'claude-haiku-4.5',
  'gpt-4': 'claude-sonnet-4.5',      // GPT 映射到 Claude
  'gpt-4o': 'claude-sonnet-4.5',
  'default': 'claude-sonnet-4.5'
}
```

### 2.3 消息清理规则

Kiro API 对消息格式有严格要求，`sanitizeConversation()` 执行以下清理：

1. **确保以用户消息开始** - 如果第一条是 assistant，插入空用户消息
2. **移除空用户消息** - 除第一条外，移除空内容的用户消息
3. **验证工具调用匹配** - 工具调用必须有对应的工具结果
4. **确保消息交替** - user → assistant → user 交替出现
5. **确保以用户消息结束** - 如果最后是 assistant，追加空用户消息

### 2.4 核心函数

```typescript
// 构建 Kiro 请求负载
buildKiroPayload(
  content: string,
  modelId: string,
  origin: string,
  history?: KiroHistoryMessage[],
  tools?: KiroToolWrapper[],
  toolResults?: KiroToolResult[],
  images?: KiroImage[],
  profileArn?: string,
  inferenceConfig?: {...}
): KiroPayload

// 流式 API 调用
callKiroApiStream(
  account: ProxyAccount,
  payload: KiroPayload,
  onChunk: (text: string, toolUse?: KiroToolUse) => void,
  onComplete: (usage) => void,
  onError: (error) => void,
  signal?: AbortSignal,
  preferredEndpoint?: 'codewhisperer' | 'amazonq'
): Promise<void>

// 非流式 API 调用
callKiroApi(
  account: ProxyAccount,
  payload: KiroPayload,
  signal?: AbortSignal
): Promise<{ content, toolUses, usage }>
```

### 2.5 AWS Event Stream 解析

```
Frame 结构:
┌──────────────┬──────────────┬──────────┬──────────┬─────────┐
│ 总长度 (4B)  │ 头长度 (4B)  │ 头数据   │ 负载数据 │ CRC (4B)│
└──────────────┴──────────────┴──────────┴──────────┴─────────┘

事件类型:
- assistantResponseEvent: 文本响应
- toolUseEvent: 工具调用
- messageMetadataEvent: Token 使用统计
- meteringEvent: 计费信息
```

### 2.6 故障转移策略

```
尝试首选端点
    │
    ├─ 成功 → 返回结果
    │
    ├─ 429 (配额超限) → 尝试下一个端点
    │
    ├─ 401/403 (认证错误) → 立即抛出异常
    │
    └─ 其他错误 → 尝试下一个端点
```

---

## 三、translator.ts - 格式转换器

### 3.1 转换流程

```
OpenAI 请求 ──→ openaiToKiro() ──→ Kiro 请求
                                      │
                                      ▼
                                  Kiro API
                                      │
                                      ▼
OpenAI 响应 ←── kiroToOpenaiResponse() ←── Kiro 响应
```

### 3.2 核心函数

```typescript
// OpenAI → Kiro
openaiToKiro(request: OpenAIChatRequest, profileArn?): KiroPayload

// Kiro → OpenAI
kiroToOpenaiResponse(
  content: string,
  toolUses: KiroToolUse[],
  usage: { inputTokens, outputTokens },
  model: string
): OpenAIChatResponse

// Claude → Kiro
claudeToKiro(request: ClaudeRequest, profileArn?): KiroPayload

// Kiro → Claude
kiroToClaudeResponse(
  content: string,
  toolUses: KiroToolUse[],
  usage: { inputTokens, outputTokens },
  model: string
): ClaudeResponse
```

### 3.3 转换规则

**消息角色映射：**
- `system` → 注入到第一条用户消息
- `user` → `userInputMessage`
- `assistant` → `assistantResponseMessage`
- `tool` → `toolResults`

**工具定义限制：**
- 工具描述最大 10237 字符
- 工具名称最大 64 字符

**图像处理：**
- 支持 Data URL 格式
- 支持 jpeg, png, gif, webp

---

## 四、tokenRefresh.ts - Token 刷新管理

### 4.1 认证方式

| 方式 | 端点 | 用途 |
|------|------|------|
| OIDC | `https://oidc.{region}.amazonaws.com/token` | AWS SSO (BuilderId/IdC) |
| Social | `https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken` | GitHub/Google 登录 |

### 4.2 核心函数

```typescript
// OIDC Token 刷新
refreshOidcToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  region?: string
): Promise<TokenRefreshResult>

// 社交 Token 刷新
refreshSocialToken(refreshToken: string): Promise<TokenRefreshResult>

// 统一刷新接口
refreshTokenByMethod(account: ProxyAccount): Promise<TokenRefreshResult>

// 过期检查
needsTokenRefresh(account: ProxyAccount, beforeExpirySec?: number): boolean
isTokenExpired(account: ProxyAccount): boolean
```

### 4.3 刷新策略

- 默认提前 5 分钟刷新 Token
- 刷新失败时标记账号为不可用
- 支持自动重试

---

## 五、machineId.ts - 机器码管理

### 5.1 核心函数

```typescript
// 生成随机机器码 (UUID 格式)
generateMachineId(): string
// 返回: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

// 验证机器码格式
isValidMachineId(machineId: string): boolean
// 支持: UUID 格式 或 32位十六进制

// 格式转换
formatAsUUID(hex: string): string      // 十六进制 → UUID
formatAsHex(uuid: string): string      // UUID → 十六进制

// 标准化机器码
normalizeMachineId(machineId: string): string
```

### 5.2 机器码用途

- 设备识别与绑定
- API 请求头 `x-amzn-device-id`
- 配额管理

---

## 六、模块依赖关系

```
types.ts (基础层)
    ↑
    ├── kiroApi.ts
    │   └── 使用: KiroPayload, KiroHistoryMessage, ProxyAccount
    │
    ├── translator.ts
    │   ├── 使用: OpenAI/Claude/Kiro 类型
    │   └── 依赖: kiroApi.buildKiroPayload, mapModelId
    │
    ├── tokenRefresh.ts
    │   └── 使用: ProxyAccount, TokenRefreshResult
    │
    └── machineId.ts
        └── 无依赖
```
