# Thinking 功能修复记录

## 2026-02-02 — 全面修复 Thinking 支持

### 背景

参照 kiro.rs 项目的 thinking 实现，对 gateway (TypeScript) 中的 thinking 功能进行全面修复。此前 thinking 功能存在多个问题导致实际不可用。

---

### 修复清单

#### 1. OpenAI 路由 thinking 硬编码禁用

**文件**: `packages/backend/src/core/proxyServer.ts`

| 项目 | 内容 |
|------|------|
| 问题 | `thinkingEnabled` 被硬编码为 `false`，导致 OpenAI 路由的 thinking 完全不工作 |
| 修复 | 改为从 `config.modelThinkingMode` 按模型读取配置 |

```diff
- const thinkingEnabled = false
+ const thinkingEnabled = !!this.config.modelThinkingMode?.[request.model]
```

#### 2. Claude SSE 事件格式错误

**文件**: `packages/backend/src/core/proxyServer.ts`

| 项目 | 内容 |
|------|------|
| 问题 | thinking 内容被包裹在 XML 标签里作为 `text_delta` 发送，不符合 Anthropic 协议 |
| 修复 | 重写为标准 thinking content block：`content_block_start`(type=thinking) → `thinking_delta` → `content_block_stop` |

修复前（错误格式）：
```json
{"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "<thinking>...</thinking>"}}
```

修复后（正确格式）：
```json
{"type": "content_block_start", "index": 1, "content_block": {"type": "thinking", "thinking": ""}}
{"type": "content_block_delta", "index": 1, "delta": {"type": "thinking_delta", "thinking": "..."}}
{"type": "content_block_delta", "index": 1, "delta": {"type": "thinking_delta", "thinking": ""}}
{"type": "content_block_stop", "index": 1}
```

新增三个辅助函数统一管理 SSE 事件发送：
- `closeThinkingBlock()` — 关闭 thinking 块（空 delta + stop）
- `sendThinkingDelta(text)` — 发送 thinking 增量（自动开启块）
- `sendTextDelta(text)` — 发送文本增量（自动关闭 thinking 块）

#### 3. Claude 路由 reasoningContentEvent 处理

**文件**: `packages/backend/src/core/proxyServer.ts`

| 项目 | 内容 |
|------|------|
| 问题 | `isThinking=true` 的回调也使用了错误的 SSE 格式 |
| 修复 | 直接调用 `sendThinkingDelta(text)`，统一走正确的 thinking block 流程 |

#### 4. thinking 后紧跟 tool_use 边界处理

**文件**: `packages/backend/src/core/proxyServer.ts`

| 项目 | 内容 |
|------|------|
| 问题 | tool_use 开始时未关闭 thinking 块，也未 flush 文本缓冲区 |
| 修复 | `process_tool_use` 逻辑前增加 thinking 块关闭和 buffer flush |

#### 5. 流结束时 thinking 块未关闭

**文件**: `packages/backend/src/core/proxyServer.ts`

| 项目 | 内容 |
|------|------|
| 问题 | completion handler 中未检查 thinking 块是否仍然打开 |
| 修复 | `processClaudeText('', true)` 后增加 `closeThinkingBlock()` 调用 |

#### 6. thinking 提示注入位置

**文件**: `packages/backend/src/core/proxyServer.ts`

| 项目 | 内容 |
|------|------|
| 问题 | thinking XML 标签注入到 `currentMessage.content`（当前用户消息），不符合 kiro.rs 的系统消息位置注入 |
| 修复 | 优先注入到 `history[0].userInputMessage.content`（系统消息位置），无 history 时回退到 currentMessage |

同时支持 Claude 请求中的 `budget_tokens` 参数：
```
<thinking_mode>enabled</thinking_mode>
<max_thinking_length>{budget_tokens}</max_thinking_length>
```

#### 7. Claude 请求 thinking 参数支持

**文件**: `packages/backend/src/core/proxyServer.ts`

| 项目 | 内容 |
|------|------|
| 问题 | Claude 路由只检查 config 和 header，不支持请求体中的 `thinking` 字段 |
| 修复 | 增加 `request.thinking?.type === 'enabled'` 检测 |

```typescript
const thinkingEnabled = modelThinkingEnabled || headerThinking || requestThinking
```

#### 8. 调试代码残留

**文件**: `packages/backend/src/core/proxyServer.ts`

| 项目 | 内容 |
|------|------|
| 问题 | `console.log("TCL: headers", headers)` 残留在生产代码中 |
| 修复 | 删除 |

#### 9. 类型定义补全

**文件**: `packages/backend/src/core/types.ts`

新增/修改：
- `ClaudeThinkingConfig` — thinking 请求配置接口
- `ClaudeRequest.thinking` — 可选 thinking 字段
- `ClaudeContentBlock.type` — 增加 `'thinking'` 类型
- `ClaudeContentBlock.thinking` — thinking 文本内容字段
- `ClaudeStreamEvent.content_block` — 支持 thinking 块类型
- `ClaudeStreamEvent.delta.thinking` — 支持 thinking_delta

#### 10. 历史消息 thinking 回传

**文件**: `packages/backend/src/core/translator.ts`

| 项目 | 内容 |
|------|------|
| 问题 | `extractClaudeAssistantContent` 不识别 thinking 类型的 ContentBlock，多轮对话中 thinking 上下文丢失 |
| 修复 | 解析 thinking 块，以 `<thinking>...</thinking>\n\n` 格式拼接到 assistant 消息正文前 |

---

### 涉及文件

| 文件 | 改动类型 |
|------|---------|
| `packages/backend/src/core/types.ts` | 类型新增/修改 |
| `packages/backend/src/core/proxyServer.ts` | 逻辑重写 |
| `packages/backend/src/core/translator.ts` | 逻辑修改 |

### 触发 Thinking 的三种方式

| 方式 | 适用路由 | 说明 |
|------|---------|------|
| `config.modelThinkingMode[model] = true` | OpenAI + Claude | 后台配置按模型启用 |
| `anthropic-beta` header 包含 `thinking` | Claude | 请求头触发 |
| `request.thinking.type = "enabled"` | Claude | 请求体标准参数 |

### 与 kiro.rs 实现的对照

| 功能点 | kiro.rs | gateway (修复后) |
|--------|---------|-----------------|
| 状态机 | `in_thinking_block` / `thinking_extracted` / `thinking_enabled` | `hasStartedThinkingBlock` / `inThinkingTagBlock` / `thinkingEnabled` |
| SSE 事件 | `thinking` type content_block + `thinking_delta` | 同左 |
| 关闭信号 | 空 `thinking_delta` + `content_block_stop` | 同左 |
| 部分标签保护 | 保留 `tag.len()` 尾部 + `find_char_boundary` | 保留 15 字节尾部 |
| 引号标签跳过 | `find_real_thinking_end_tag` | 未实现（TypeScript 暂不需要） |
| tool_use 边界 | `process_tool_use` 前检查并关闭 | 同左 |
| 历史回传 | `<thinking>...</thinking>\n\n` 拼接 | 同左 |
| 提示注入 | 系统消息位置 | history[0] 优先，回退 currentMessage |
