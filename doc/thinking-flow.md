# Kiro.rs Thinking 流程文档

## 概述

Thinking 功能允许客户端通过 Anthropic Claude 兼容 API 请求模型输出"思考过程"。上游 Kiro API 本身不感知 thinking 协议，因此 Gateway 需要：

1. **请求侧**：将 thinking 配置转换为 XML 标签注入 prompt
2. **响应侧**：从流式文本中解析 `<thinking>...</thinking>` 块，转换为 Anthropic 标准 SSE 事件

---

## 一、请求阶段

### 1.1 客户端请求格式

客户端在 `/v1/messages` 请求体中携带 thinking 配置：

```json
{
  "model": "claude-sonnet-4-20250514",
  "messages": [...],
  "stream": true,
  "thinking": {
    "type": "enabled",
    "budget_tokens": 20000
  }
}
```

对应类型定义（`types.rs`）：

```rust
pub struct Thinking {
    pub thinking_type: String,   // "enabled"
    pub budget_tokens: i32,      // 默认 20000
}
```

### 1.2 Thinking 标签注入（converter.rs）

Gateway 将 thinking 配置转换为 XML 标签，注入到发送给上游 Kiro API 的系统消息最前面：

```
<thinking_mode>enabled</thinking_mode><max_thinking_length>20000</max_thinking_length>
```

注入规则：

| 场景 | 行为 |
|------|------|
| 有系统消息且无 thinking 标签 | 在系统消息前拼接 thinking 标签 |
| 有系统消息且已有 thinking 标签 | 不重复注入 |
| 无系统消息 | 创建新的 user + assistant("OK") 消息对，user 消息内容为 thinking 标签 |

### 1.3 历史消息中的 Thinking 回传（converter.rs）

当客户端发送多轮对话时，assistant 消息中可能包含 thinking 类型的 ContentBlock：

```json
{
  "role": "assistant",
  "content": [
    {"type": "thinking", "thinking": "让我分析一下..."},
    {"type": "text", "text": "答案是42"}
  ]
}
```

Gateway 将其重新组装为上游能理解的纯文本格式：

```
<thinking>让我分析一下...</thinking>

答案是42
```

---

## 二、响应阶段 — 流式处理

### 2.1 状态机

`StreamContext` 使用三个布尔值构成状态机：

```
┌─────────────────────┐
│  in_thinking: false  │
│  extracted:   false  │──── 初始状态，扫描 <thinking>
└─────────┬───────────┘
          │ 找到 <thinking>
          ▼
┌─────────────────────┐
│  in_thinking: true   │
│  extracted:   false  │──── thinking 块内，扫描 </thinking>
└─────────┬───────────┘
          │ 找到 </thinking>
          ▼
┌─────────────────────┐
│  in_thinking: false  │
│  extracted:   true   │──── thinking 已完成，内容作为 text_delta 输出
└─────────────────────┘
```

关键字段：

```rust
pub struct StreamContext {
    pub thinking_enabled: bool,            // 是否启用
    pub thinking_buffer: String,           // 内容缓冲区
    pub in_thinking_block: bool,           // 是否在 thinking 块内
    pub thinking_extracted: bool,          // thinking 是否已提取完成
    pub thinking_block_index: Option<i32>, // SSE 中的 block index
}
```

### 2.2 核心处理流程（process_content_with_thinking）

每次上游返回一个 chunk 文本时：

```
上游 chunk 到达
    │
    ▼
追加到 thinking_buffer
    │
    ▼
┌─── 当前状态？───────────────────────────────────┐
│                                                  │
▼                        ▼                         ▼
【初始态】            【thinking 内】           【已提取】
扫描 <thinking>       扫描 </thinking>          直接输出
│                     │                         text_delta
├─ 找到？             ├─ 找到？
│  ├─ YES             │  ├─ YES
│  │  ├─ 标签前内容    │  │  ├─ 标签前内容
│  │  │  → text_delta │  │  │  → thinking_delta
│  │  ├─ 发送          │  │  ├─ 发送
│  │  │  block_start  │  │  │  block_stop
│  │  └─ 切换到        │  │  └─ 切换到
│  │     thinking内    │  │     已提取
│  │                   │  │
│  └─ NO              │  └─ NO
│     保留末尾         │     安全输出部分内容
│     <thinking>.len  │     保留末尾
│     字节防截断       │     </thinking>.len
│                     │     字节防截断
└─────────────────────┴──────────────────────────┘
```

### 2.3 部分标签保护

流式传输中 `<thinking>` 或 `</thinking>` 可能被拆分到两个 chunk。处理方式：

- 每次只输出 `buffer.len() - tag.len()` 之前的安全内容
- 剩余部分留在 buffer 等待下一个 chunk 拼接
- 使用 `find_char_boundary()` 确保不在 UTF-8 多字节字符中间切割

### 2.4 引号包裹标签跳过

模型输出中可能在代码或引用中提到 `<thinking>` 标签（如解释自己的协议）。Gateway 通过 `find_real_thinking_start_tag` / `find_real_thinking_end_tag` 跳过被引号字符包裹的标签：

```
被跳过的情况：`<thinking>`  '<thinking>'  "<thinking>"
正常识别的情况：<thinking>（前后无引号字符）
```

### 2.5 边界场景：thinking 后紧跟 tool_use

当 `</thinking>` 后面没有 `\n\n` 而是直接进入 tool_use 时，结束标签会残留在 buffer。

处理位置：`process_tool_use` 方法开头

```
process_tool_use 被调用
    │
    ├─ thinking_enabled && in_thinking_block ?
    │  │
    │  YES → 调用 find_real_thinking_end_tag_at_buffer_end
    │        │
    │        ├─ 找到 → 输出 thinking_delta + block_stop，清理 buffer
    │        └─ 未找到 → 继续（异常情况）
    │
    └─ 继续正常的 tool_use 处理
```

`find_real_thinking_end_tag_at_buffer_end` 的特殊约束：只有当 `</thinking>` 后面**全部是空白字符**时才认定为真正的结束标签。

### 2.6 最终 flush（generate_final_events）

流结束时 `generate_final_events` 对 buffer 中残留内容做最终处理：

| buffer 状态 | 处理 |
|---|---|
| `in_thinking_block` 且末尾有 `</thinking>` | 过滤标签，输出 thinking_delta + block_stop |
| `in_thinking_block` 且无结束标签 | 全部输出为 thinking_delta，强制 block_stop |
| 非 thinking 状态，buffer 非空 | 输出为 text_delta |

---

## 三、SSE 输出事件序列

一次完整的 thinking 响应产生以下 SSE 事件流：

```
event: message_start
data: {"type":"message_start","message":{...}}

event: content_block_start                          ← text block (index=0)
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_start                          ← thinking block (index=1)
data: {"type":"content_block_start","index":1,"content_block":{"type":"thinking","thinking":""}}

event: content_block_delta                          ← thinking 内容增量（多次）
data: {"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":"让我想想..."}}

event: content_block_delta                          ← 空 thinking_delta（关闭信号）
data: {"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":""}}

event: content_block_stop                           ← thinking block 结束
data: {"type":"content_block_stop","index":1}

event: content_block_delta                          ← 正文内容增量（多次）
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"答案是..."}}

event: content_block_stop                           ← text block 结束
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{...}}

event: message_stop
data: {"type":"message_stop"}
```

---

## 四、涉及文件清单

| 文件 | 职责 |
|------|------|
| `src/anthropic/types.rs` | `Thinking` 结构体、`ContentBlock.thinking` 字段 |
| `src/anthropic/converter.rs` | thinking 标签注入、历史消息 thinking 回传 |
| `src/anthropic/handlers.rs` | 从请求中提取 `thinking_enabled`，传入 StreamContext |
| `src/anthropic/stream.rs` | 流式解析状态机、标签检测、SSE 事件生成 |
