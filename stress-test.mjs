#!/usr/bin/env node
/**
 * Kiro Gateway 压力测试脚本 — 真实用户模拟版
 *
 * 模拟真实开发者使用场景:
 *   - 带 system prompt 的对话
 *   - 多轮对话上下文
 *   - 不同长度/类型的 prompt (代码、文档、问答)
 *   - 混合流式/非流式请求
 *   - 请求间随机思考时间
 *   - 合理的 max_tokens (1024-4096)
 *
 * 用法:
 *   node stress-test.mjs --token <api-key> [options]
 *
 * 选项:
 *   --url          网关地址         (默认: http://localhost:3000)
 *   --token        API Key          (必填)
 *   --concurrency  并发用户数       (默认: 8)
 *   --total        总请求数         (默认: 50)
 *   --model        模型名           (默认: claude-sonnet-4.5)
 *   --think-time   用户思考时间ms   (默认: 2000, 0=无间隔)
 *   --ramp         逐步加压间隔ms   (默认: 500)
 */

const DEFAULT_CONFIG = {
  url: 'http://localhost:3000',
  token: '',
  concurrency: 8,
  total: 50,
  model: 'claude-sonnet-4.5',
  thinkTime: 2000,
  ramp: 500,
}

// ─── 参数解析 ───
function parseArgs() {
  const args = process.argv.slice(2)
  const config = { ...DEFAULT_CONFIG }
  for (let i = 0; i < args.length; i++) {
    const key = args[i], val = args[i + 1]
    switch (key) {
      case '--url':         config.url = val; i++; break
      case '--token':       config.token = val; i++; break
      case '--concurrency': config.concurrency = parseInt(val); i++; break
      case '--total':       config.total = parseInt(val); i++; break
      case '--model':       config.model = val; i++; break
      case '--think-time':  config.thinkTime = parseInt(val); i++; break
      case '--ramp':        config.ramp = parseInt(val); i++; break
      case '--help':        printHelp(); process.exit(0);
    }
  }
  if (!config.token) { console.error('❌ 必须提供 --token'); process.exit(1) }
  return config
}

function printHelp() {
  console.log(`
Kiro Gateway 压力测试 — 真实用户模拟

用法: node stress-test.mjs --token <api-key> [options]

选项:
  --url          网关地址         (默认: http://localhost:3000)
  --token        API Key          (必填)
  --concurrency  并发用户数       (默认: 8)
  --total        总请求数         (默认: 50)
  --model        模型名           (默认: claude-sonnet-4.5)
  --think-time   用户思考时间ms   (默认: 2000, 0=无间隔)
  --ramp         逐步加压间隔ms   (默认: 500, 逐个启动用户)

示例:
  # 8个并发用户, 每人间隔2s思考, 共50个请求
  node stress-test.mjs --token sk-xxx

  # 16个用户无思考时间 (极限压测)
  node stress-test.mjs --token sk-xxx --concurrency 16 --think-time 0 --total 100

  # 逐步加压, 每500ms加入一个用户
  node stress-test.mjs --token sk-xxx --concurrency 24 --ramp 500
`)
}

// ─── 真实场景模板 ───

const SYSTEM_PROMPTS = [
  'You are a senior software engineer. Write clean, production-ready code with proper error handling.',
  'You are a helpful coding assistant. Be concise and provide working code examples.',
  'You are an expert in TypeScript and Node.js. Follow best practices and explain your reasoning.',
  'You are a code reviewer. Analyze code for bugs, performance issues, and security vulnerabilities.',
  'You are a technical writer. Explain complex concepts clearly with examples.',
]

// 场景: 不同类型的真实请求
const SCENARIOS = [
  // ── 代码生成 (长 prompt, 高 max_tokens) ──
  {
    type: 'code_gen',
    stream: true,
    maxTokens: 4096,
    messages: [
      { role: 'user', content: `Write a TypeScript class that implements a connection pool for Redis with the following requirements:
- Maximum pool size configurable
- Automatic health checking with ping
- Connection timeout handling
- Graceful shutdown that waits for active connections
- Event emitter for pool events (acquire, release, error)
- Support for both standalone and cluster modes

Include full type definitions and JSDoc comments.` }
    ]
  },
  // ── 代码审查 (中等 prompt, 中等 max_tokens) ──
  {
    type: 'code_review',
    stream: true,
    maxTokens: 2048,
    messages: [
      { role: 'user', content: `Review this Express middleware for security issues and performance problems:

\`\`\`typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'default-secret';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, SECRET) as any;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid token' });
  }
}
\`\`\`

List all issues found with severity (critical/high/medium/low) and provide fixed code.` }
    ]
  },
  // ── 多轮对话: 调试 (带上下文) ──
  {
    type: 'debug_multiturn',
    stream: true,
    maxTokens: 2048,
    messages: [
      { role: 'user', content: 'I have a memory leak in my Node.js Express application. The RSS keeps growing by about 50MB per hour under load. Where should I start investigating?' },
      { role: 'assistant', content: 'Here are the key areas to investigate for Node.js memory leaks:\n\n1. **Event listeners** - Check for listeners that are added but never removed\n2. **Closures** - Large objects captured in closures that persist\n3. **Global caches** - Maps/objects that grow unbounded\n4. **Streams** - Streams not properly destroyed\n\nStart by taking heap snapshots with `--inspect` flag and comparing them.' },
      { role: 'user', content: `I took heap snapshots and found that the issue is in my request logging middleware. Here's the code:

\`\`\`javascript
const requestLogs = [];

app.use((req, res, next) => {
  const log = {
    method: req.method,
    url: req.url,
    timestamp: new Date(),
    headers: { ...req.headers },
    body: req.body,
  };
  requestLogs.push(log);
  next();
});
\`\`\`

The array keeps growing. How do I fix this while keeping the logging functionality?` }
    ]
  },
  // ── 架构设计 (长输出) ──
  {
    type: 'architecture',
    stream: true,
    maxTokens: 4096,
    messages: [
      { role: 'user', content: `Design a rate limiting system for an API gateway that supports:
- Per-user and per-API-key limits
- Sliding window algorithm
- Redis-backed for distributed deployment
- Configurable limits per endpoint
- Response headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)
- Graceful degradation when Redis is unavailable

Provide the architecture diagram in text, TypeScript interfaces, and core implementation.` }
    ]
  },
  // ── 简短问答 (短 prompt, 低 max_tokens) ──
  {
    type: 'quick_qa',
    stream: true,
    maxTokens: 1024,
    messages: [
      { role: 'user', content: 'What is the difference between `Promise.all` and `Promise.allSettled` in JavaScript? When should I use each one?' }
    ]
  },
  // ── 非流式: 代码补全 ──
  {
    type: 'completion',
    stream: false,
    maxTokens: 1024,
    messages: [
      { role: 'user', content: `Complete this function:

\`\`\`typescript
/**
 * Retries an async function with exponential backoff
 * @param fn - The async function to retry
 * @param options - Retry configuration
 */
async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
    retryOn?: (error: Error) => boolean;
  } = {}
): Promise<T> {
  // implement this
}
\`\`\`` }
    ]
  },
  // ── 非流式: 短问答 ──
  {
    type: 'short_answer',
    stream: false,
    maxTokens: 512,
    messages: [
      { role: 'user', content: 'Explain the event loop in Node.js in 3 sentences.' }
    ]
  },
  // ── 多轮: 重构讨论 ──
  {
    type: 'refactor_multiturn',
    stream: true,
    maxTokens: 3072,
    messages: [
      { role: 'user', content: 'I have a 500-line function that handles user registration. It validates input, checks for duplicates, hashes passwords, creates the user, sends a welcome email, and logs the event. How should I refactor it?' },
      { role: 'assistant', content: 'Break it into single-responsibility functions:\n1. `validateRegistrationInput()` - Input validation\n2. `checkDuplicateUser()` - Uniqueness check\n3. `createUserRecord()` - User creation with password hashing\n4. `sendWelcomeEmail()` - Email notification\n5. `logRegistrationEvent()` - Audit logging\n\nOrchestrate them in a `registerUser()` function that handles the flow and error cases.' },
      { role: 'user', content: 'Good approach. Now implement the orchestrator function with proper error handling, rollback on failure, and TypeScript types. Also add input validation using zod.' }
    ]
  },
  // ── SQL 优化 ──
  {
    type: 'sql_optimize',
    stream: true,
    maxTokens: 2048,
    messages: [
      { role: 'user', content: `This PostgreSQL query takes 12 seconds on a table with 50M rows. Optimize it:

\`\`\`sql
SELECT u.id, u.name, u.email,
       COUNT(o.id) as order_count,
       SUM(o.total) as total_spent,
       MAX(o.created_at) as last_order
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at >= '2024-01-01'
  AND u.status = 'active'
  AND o.status != 'cancelled'
GROUP BY u.id, u.name, u.email
HAVING COUNT(o.id) > 5
ORDER BY total_spent DESC
LIMIT 100;
\`\`\`

Provide the optimized query, explain what indexes to create, and estimate the improvement.` }
    ]
  },
  // ── Docker/DevOps ──
  {
    type: 'devops',
    stream: true,
    maxTokens: 2048,
    messages: [
      { role: 'user', content: 'Write a multi-stage Dockerfile for a Node.js TypeScript application that:\n- Uses pnpm as package manager\n- Builds TypeScript to JavaScript\n- Runs as non-root user\n- Has health check\n- Minimizes image size\n- Properly handles node_modules caching\n- Supports both ARM64 and AMD64' }
    ]
  },
  // ── 测试编写 ──
  {
    type: 'testing',
    stream: true,
    maxTokens: 3072,
    messages: [
      { role: 'user', content: `Write comprehensive unit tests for this function using vitest:

\`\`\`typescript
export async function processWebhook(
  payload: WebhookPayload,
  config: WebhookConfig
): Promise<WebhookResult> {
  if (!payload.event || !payload.data) {
    throw new WebhookError('Invalid payload', 'INVALID_PAYLOAD');
  }

  const handler = config.handlers[payload.event];
  if (!handler) {
    return { status: 'skipped', event: payload.event };
  }

  const isValid = await verifySignature(payload.signature, payload.data, config.secret);
  if (!isValid) {
    throw new WebhookError('Invalid signature', 'INVALID_SIGNATURE');
  }

  try {
    const result = await handler(payload.data);
    await config.onSuccess?.(payload.event, result);
    return { status: 'processed', event: payload.event, result };
  } catch (error) {
    await config.onError?.(payload.event, error);
    throw new WebhookError('Handler failed', 'HANDLER_ERROR', { cause: error });
  }
}
\`\`\`

Cover all branches, edge cases, and error scenarios. Mock external dependencies.` }
    ]
  },
  // ── 文档生成 ──
  {
    type: 'docs',
    stream: false,
    maxTokens: 2048,
    messages: [
      { role: 'user', content: 'Generate OpenAPI 3.0 YAML documentation for a REST API with these endpoints:\n- POST /auth/login (email, password) -> JWT token\n- GET /users/:id -> user profile\n- PUT /users/:id -> update profile\n- GET /users/:id/orders -> paginated order list with filters\n- POST /orders -> create order\nInclude request/response schemas, error responses, and authentication.' }
    ]
  },
]

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function randomBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

// 为每个请求生成随机变体，避免完全重复
function buildRequest(config, index) {
  const scenario = SCENARIOS[index % SCENARIOS.length]
  const system = pickRandom(SYSTEM_PROMPTS)

  // 给 prompt 加点随机性 (追加随机 ID 避免缓存)
  const messages = scenario.messages.map((m, i) => {
    if (i === scenario.messages.length - 1 && m.role === 'user') {
      return { ...m, content: m.content + `\n\n[Request #${index}-${Date.now().toString(36)}]` }
    }
    return m
  })

  return {
    model: config.model,
    max_tokens: scenario.maxTokens,
    system,
    messages,
    stream: scenario.stream,
    _type: scenario.type,
  }
}

// ─── 指标收集 ───
class Metrics {
  constructor() {
    this.results = []
    this.startTime = 0
    this.activeCount = 0
    this.peakActive = 0
    this.completed = 0
    this.total = 0
  }

  start(total) { this.total = total; this.startTime = Date.now() }

  record(result) { this.results.push(result); this.completed++ }

  trackActive(delta) {
    this.activeCount += delta
    if (this.activeCount > this.peakActive) this.peakActive = this.activeCount
  }

  printProgress() {
    const ok = this.results.filter(r => r.ok).length
    const fail = this.results.filter(r => !r.ok).length
    const pct = ((this.completed / this.total) * 100).toFixed(0)
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(0)
    process.stdout.write(
      `\r⏳ ${this.completed}/${this.total} (${pct}%) | ` +
      `✅${ok} ❌${fail} | ` +
      `并发: ${this.activeCount}/${this.peakActive} | ${elapsed}s  `
    )
  }

  printReport() {
    const elapsed = Date.now() - this.startTime
    const success = this.results.filter(r => r.ok)
    const failed = this.results.filter(r => !r.ok)
    const latencies = success.map(r => r.latency).sort((a, b) => a - b)

    const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0
    const rps = this.results.length / (elapsed / 1000)

    // 按场景类型统计
    const byType = {}
    for (const r of this.results) {
      if (!byType[r.type]) byType[r.type] = { ok: 0, fail: 0, latencies: [] }
      if (r.ok) { byType[r.type].ok++; byType[r.type].latencies.push(r.latency) }
      else byType[r.type].fail++
    }

    // 错误分组
    const errorGroups = {}
    for (const r of failed) {
      const key = `${r.status || 'NET'}: ${(r.error || 'unknown').slice(0, 80)}`
      errorGroups[key] = (errorGroups[key] || 0) + 1
    }

    const ttfbs = success.filter(r => r.ttfb > 0).map(r => r.ttfb).sort((a, b) => a - b)
    const totalInput = success.reduce((s, r) => s + (r.inputTokens || 0), 0)
    const totalOutput = success.reduce((s, r) => s + (r.outputTokens || 0), 0)

    console.log('\n')
    console.log('═══════════════════════════════════════════════════════════')
    console.log('           📊 压力测试报告 (真实用户模拟)')
    console.log('═══════════════════════════════════════════════════════════')
    console.log(`  总请求:    ${this.results.length}`)
    console.log(`  成功:      ${success.length}  |  失败: ${failed.length}`)
    console.log(`  成功率:    ${((success.length / this.results.length) * 100).toFixed(1)}%`)
    console.log(`  总耗时:    ${(elapsed / 1000).toFixed(1)}s`)
    console.log(`  吞吐量:    ${rps.toFixed(2)} req/s`)
    console.log(`  峰值并发:  ${this.peakActive}`)

    console.log('───────────────────────────────────────────────────────────')
    console.log('  端到端延迟 (ms):')
    console.log(`    Min:  ${fmt(latencies[0])}   Avg: ${fmt(avg)}   Max: ${fmt(latencies[latencies.length - 1])}`)
    console.log(`    P50:  ${fmt(pct(latencies, 50))}   P90: ${fmt(pct(latencies, 90))}   P95: ${fmt(pct(latencies, 95))}   P99: ${fmt(pct(latencies, 99))}`)

    if (ttfbs.length > 0) {
      console.log('───────────────────────────────────────────────────────────')
      console.log('  TTFB 首字节 (ms):')
      console.log(`    Min:  ${fmt(ttfbs[0])}   Avg: ${fmt(ttfbs.reduce((a, b) => a + b, 0) / ttfbs.length)}   Max: ${fmt(ttfbs[ttfbs.length - 1])}`)
      console.log(`    P50:  ${fmt(pct(ttfbs, 50))}   P90: ${fmt(pct(ttfbs, 90))}   P95: ${fmt(pct(ttfbs, 95))}`)
    }

    console.log('───────────────────────────────────────────────────────────')
    console.log('  场景分布:')
    for (const [type, data] of Object.entries(byType)) {
      const avgLat = data.latencies.length ? (data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length / 1000).toFixed(1) : '-'
      const status = data.fail > 0 ? `✅${data.ok} ❌${data.fail}` : `✅${data.ok}`
      console.log(`    ${type.padEnd(20)} ${status.padEnd(12)} avg: ${avgLat}s`)
    }

    if (Object.keys(errorGroups).length > 0) {
      console.log('───────────────────────────────────────────────────────────')
      console.log('  错误分布:')
      for (const [key, count] of Object.entries(errorGroups)) {
        console.log(`    ${key}: ${count}次`)
      }
    }

    if (totalInput > 0 || totalOutput > 0) {
      console.log('───────────────────────────────────────────────────────────')
      console.log(`  Token: 输入 ${totalInput.toLocaleString()} + 输出 ${totalOutput.toLocaleString()} = ${(totalInput + totalOutput).toLocaleString()}`)
    }

    console.log('═══════════════════════════════════════════════════════════')
  }
}

function fmt(n) { return n != null ? Math.round(n).toString() : '-' }
function pct(sorted, p) {
  if (!sorted.length) return 0
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
}

// ─── 单次请求 ───
async function sendRequest(config, index) {
  const body = buildRequest(config, index)
  const isStream = body.stream
  const type = body._type
  delete body._type

  const start = Date.now()
  let ttfb = 0

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 180_000) // 3min

    const res = await fetch(`${config.url}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      let errMsg = ''
      try { errMsg = JSON.parse(errText)?.error?.message || errText.slice(0, 200) } catch { errMsg = errText.slice(0, 200) }
      return { ok: false, type, status: res.status, error: errMsg, latency: Date.now() - start, ttfb: 0, inputTokens: 0, outputTokens: 0 }
    }

    let inputTokens = 0, outputTokens = 0

    if (isStream) {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let firstChunk = true, buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (firstChunk) { ttfb = Date.now() - start; firstChunk = false }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() // 保留不完整行
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'message_start' && data.message?.usage) inputTokens = data.message.usage.input_tokens || 0
            if (data.type === 'message_delta' && data.usage) outputTokens = data.usage.output_tokens || 0
          } catch {}
        }
      }
    } else {
      ttfb = Date.now() - start
      const data = await res.json()
      inputTokens = data.usage?.input_tokens || 0
      outputTokens = data.usage?.output_tokens || 0
    }

    return { ok: true, type, status: res.status, latency: Date.now() - start, ttfb, inputTokens, outputTokens }
  } catch (err) {
    return { ok: false, type, status: 0, error: err.name === 'AbortError' ? 'TIMEOUT' : err.message, latency: Date.now() - start, ttfb: 0, inputTokens: 0, outputTokens: 0 }
  }
}

// ─── 模拟用户 Worker ───
async function userWorker(workerId, config, metrics, taskQueue) {
  while (true) {
    const idx = taskQueue.next()
    if (idx === null) break

    metrics.trackActive(1)
    metrics.printProgress()

    const result = await sendRequest(config, idx)

    metrics.trackActive(-1)
    metrics.record(result)
    metrics.printProgress()

    // 模拟用户思考时间 (随机 ±50%)
    if (config.thinkTime > 0 && taskQueue.hasMore()) {
      const jitter = config.thinkTime * (0.5 + Math.random())
      await new Promise(r => setTimeout(r, jitter))
    }
  }
}

// 线程安全的任务队列
class TaskQueue {
  constructor(total) { this.total = total; this.cursor = 0 }
  next() { return this.cursor < this.total ? this.cursor++ : null }
  hasMore() { return this.cursor < this.total }
}

// ─── 主流程 ───
async function main() {
  const config = parseArgs()

  console.log('═══════════════════════════════════════════════════════════')
  console.log('     🚀 Kiro Gateway 压力测试 — 真实用户模拟')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`  目标:      ${config.url}/v1/messages`)
  console.log(`  模型:      ${config.model}`)
  console.log(`  并发用户:  ${config.concurrency}`)
  console.log(`  总请求:    ${config.total}`)
  console.log(`  思考时间:  ${config.thinkTime}ms (±50% 抖动)`)
  console.log(`  加压间隔:  ${config.ramp}ms`)
  console.log(`  场景数:    ${SCENARIOS.length} 种 (流式 ${SCENARIOS.filter(s => s.stream).length} / 非流式 ${SCENARIOS.filter(s => !s.stream).length})`)
  console.log('═══════════════════════════════════════════════════════════')
  console.log()

  const metrics = new Metrics()
  const taskQueue = new TaskQueue(config.total)
  metrics.start(config.total)

  // 逐步加入用户
  const workers = []
  for (let i = 0; i < config.concurrency; i++) {
    workers.push(userWorker(i, config, metrics, taskQueue))
    if (config.ramp > 0 && i < config.concurrency - 1) {
      await new Promise(r => setTimeout(r, config.ramp))
    }
  }

  await Promise.all(workers)
  metrics.printReport()
}

main().catch(err => { console.error('💥 压测异常:', err); process.exit(1) })
