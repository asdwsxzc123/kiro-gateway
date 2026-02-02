# WebSearch 工具支持

## 概述

Gateway 支持 Anthropic `web_search` 工具。当 Claude Messages API 请求中**仅包含一个** `web_search` 工具时，请求将绕过 Kiro `generateAssistantResponse` 流程，直接调用 Kiro MCP 端点完成搜索，并以 Claude 兼容的 SSE 格式返回结果。

参考实现：kiro.rs commit `0d66014`

## 请求格式

```json
POST /v1/messages
{
  "model": "claude-sonnet-4.5",
  "max_tokens": 4096,
  "stream": true,
  "tools": [
    {
      "type": "web_search_20250305",
      "name": "web_search",
      "max_uses": 8
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Perform a web search for the query: rust latest version 2026"
    }
  ]
}
```

### 触发条件

- `tools` 数组有且仅有 **1 个**元素
- 该工具的 `name` 为 `"web_search"`

不满足条件时（如有多个工具或无 `web_search`），走正常 Kiro 代理流程。

### 查询提取规则

1. 取最后一条 `role: "user"` 的消息
2. 提取第一个 `type: "text"` 内容块的文本
3. 如果文本以 `"Perform a web search for the query: "` 开头，去除该前缀
4. 去除首尾空白后作为搜索查询

## 内部处理流程

```
客户端请求 (POST /v1/messages, tools=[web_search])
  │
  ▼
proxyServer.ts: handleClaudeStreamRequest()
  │ hasWebSearchTool(request) === true
  ▼
websearch.ts: handleWebSearchStream()
  │
  ├─ 1. extractSearchQuery()  → 提取搜索查询
  ├─ 2. createMcpRequest()    → 构建 JSON-RPC 请求
  ├─ 3. callMcpApi()          → POST https://q.us-east-1.amazonaws.com/mcp
  ├─ 4. 估算 input tokens
  └─ 5. generateWebSearchSSE() → 生成 Claude SSE 事件序列
       │
       ▼
    SSE 流式响应返回客户端
```

## MCP 调用细节

### 端点

```
POST https://q.us-east-1.amazonaws.com/mcp
```

### 请求头

| Header | 值 |
|--------|----|
| Content-Type | `application/json` |
| User-Agent | `aws-sdk-js/1.0.18 ua/2.1 os/windows lang/js ... KiroIDE-{version}-{machineId}` |
| X-Amz-User-Agent | `aws-sdk-js/1.0.18 KiroIDE {version} {machineId}` |
| Amz-Sdk-Invocation-Id | UUID v4 |
| Amz-Sdk-Request | `attempt=1; max=3` |
| Authorization | `Bearer {accessToken}` |
| x-amzn-device-id | `{machineId}` (如果存在) |

User-Agent 函数复用自 `kiroApi.ts` 的 `getKiroUserAgent()` / `getKiroAmzUserAgent()`。

### 请求体 (JSON-RPC)

```json
{
  "id": "web_search_tooluse_{22位随机}_{毫秒时间戳}_{8位随机}",
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "web_search",
    "arguments": {
      "query": "搜索查询内容"
    }
  }
}
```

**ID 格式说明：**
- 22位：大小写字母 + 数字
- 时间戳：`Date.now()` 毫秒级
- 8位：小写字母 + 数字

### 响应体

```json
{
  "id": "...",
  "jsonrpc": "2.0",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"results\":[{\"title\":\"...\",\"url\":\"...\",\"snippet\":\"...\"}],\"totalResults\":10}"
      }
    ],
    "isError": false
  }
}
```

`result.content[0].text` 为 JSON 字符串，解析后得到 `WebSearchResults`：

```typescript
interface WebSearchResults {
  results: WebSearchResult[]
  totalResults?: number
  query?: string
  error?: string
}

interface WebSearchResult {
  title: string
  url: string
  snippet?: string
  publishedDate?: number
  id?: string
  domain?: string
}
```

## SSE 响应事件序列

Gateway 将 MCP 搜索结果转换为 Anthropic Claude 格式的 SSE 流，事件顺序如下：

```
event: message_start
data: { type: "message_start", message: { id, role: "assistant", model, content: [], usage: { input_tokens } } }

event: content_block_start       ← index 0: server_tool_use
data: { index: 0, content_block: { id: toolUseId, type: "server_tool_use", name: "web_search", input: {} } }

event: content_block_delta       ← tool input
data: { index: 0, delta: { type: "input_json_delta", partial_json: "{\"query\":\"...\"}" } }

event: content_block_stop
data: { index: 0 }

event: content_block_start       ← index 1: web_search_tool_result
data: { index: 1, content_block: { type: "web_search_tool_result", tool_use_id: toolUseId, content: [
  { type: "web_search_result", title: "...", url: "...", encrypted_content: "snippet...", page_age: null },
  ...
] } }

event: content_block_stop
data: { index: 1 }

event: content_block_start       ← index 2: text (摘要)
data: { index: 2, content_block: { type: "text", text: "" } }

event: content_block_delta       ← 分块发送，每块约 100 字符
data: { index: 2, delta: { type: "text_delta", text: "1. **Title**\n   snippet...\n   Source: url\n\n" } }
... (多个 delta 事件)

event: content_block_stop
data: { index: 2 }

event: message_delta
data: { delta: { stop_reason: "end_turn" }, usage: { output_tokens } }

event: message_stop
data: { type: "message_stop" }
```

### 三个内容块说明

| index | type | 说明 |
|-------|------|------|
| 0 | `server_tool_use` | 标识调用了 `web_search` 工具及其输入参数 |
| 1 | `web_search_tool_result` | 原始搜索结果（title, url, snippet） |
| 2 | `text` | 人类可读的搜索结果摘要，分块流式输出 |

## 涉及文件

| 文件 | 说明 |
|------|------|
| `packages/backend/src/core/websearch.ts` | WebSearch 核心模块（检测、MCP 调用、SSE 生成） |
| `packages/backend/src/core/proxyServer.ts:836-845` | 拦截入口，在 `handleClaudeStreamRequest` 中判断并路由 |
| `packages/backend/src/core/kiroApi.ts:41,46` | 导出 `getKiroUserAgent` / `getKiroAmzUserAgent` 供复用 |
| `packages/backend/src/core/types.ts:126-132` | `ClaudeTool` 扩展 `type?` 和 `max_uses?` 字段 |

## 错误处理

| 场景 | 行为 |
|------|------|
| 无法提取搜索查询 | 返回 Error: `"无法从消息中提取搜索查询"` |
| MCP 端点返回非 2xx | 日志记录错误，`searchResults` 为 null，摘要显示 "No results found" |
| MCP 返回 JSON-RPC error | 同上 |
| MCP 响应解析失败 | 同上 |
| 账号无可用 token | 由 `proxyServer.ts` 在调用 WebSearch 前拦截（`getAvailableAccount`） |

搜索失败不会中断 SSE 流，仍会返回完整的事件序列，只是搜索结果为空。
