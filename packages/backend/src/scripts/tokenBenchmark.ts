/**
 * Token 估算精度基准测试 v2
 *
 * 用 Anthropic count_tokens API 作为 ground truth，
 * 对比 gateway 实际使用的 countAllTokens() 路径的估算精度。
 *
 * 对比维度：
 * - raw:       cl100k_base 原始编码（无修正、无开销）
 * - gateway:   countAllTokens() 实际路径（含消息开销 + 内容感知修正）
 *
 * 用法:
 *   ANTHROPIC_API_KEY=sk-ant-xxx tsx src/scripts/tokenBenchmark.ts
 *
 * 可选参数:
 *   --model <model>     指定模型（默认 claude-sonnet-4-20250514）
 *   --json              JSON 格式输出
 */

import { getEncoding, type Tiktoken } from 'js-tiktoken'
import { countAllTokens } from '../core/tokenCounter.js'

// ============ 配置 ============

const API_KEY = process.env.ANTHROPIC_API_KEY
const API_BASE = process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com'
const DEFAULT_MODEL = 'claude-sonnet-4-20250514'
const API_VERSION = '2023-06-01'
const REQUEST_DELAY_MS = 500

// ============ CLI 参数解析 ============

function parseArgs() {
  const args = process.argv.slice(2)
  let model = DEFAULT_MODEL
  let jsonOutput = false

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--model':
        model = args[++i] || model
        break
      case '--json':
        jsonOutput = true
        break
    }
  }

  return { model, jsonOutput }
}

// ============ 测试用例 ============

interface TestCase {
  category: string
  label: string
  content: string
}

const TEST_CASES: TestCase[] = [
  // --- 英文文本 ---
  {
    category: 'English',
    label: 'Short sentence',
    content: 'Hello, how are you doing today?',
  },
  {
    category: 'English',
    label: 'Medium paragraph',
    content:
      'The transformer architecture has revolutionized natural language processing. ' +
      'By using self-attention mechanisms, these models can capture long-range dependencies ' +
      'in text more effectively than previous recurrent approaches. The key innovation lies ' +
      'in the ability to process all positions in a sequence simultaneously, enabling massive ' +
      'parallelization during training. This has led to the development of increasingly large ' +
      'language models that demonstrate emergent capabilities at scale.',
  },
  {
    category: 'English',
    label: 'Technical documentation',
    content: `## API Reference

### POST /v1/messages

Create a message using the specified model.

**Request Body:**
- \`model\` (string, required): The model to use (e.g., "claude-sonnet-4-20250514")
- \`messages\` (array, required): Array of message objects with \`role\` and \`content\`
- \`max_tokens\` (integer, required): Maximum number of tokens to generate
- \`temperature\` (float, optional): Sampling temperature between 0 and 1
- \`stream\` (boolean, optional): Whether to stream the response

**Response:**
Returns a Message object with the assistant's response, including usage statistics
showing input_tokens and output_tokens consumed.`,
  },

  // --- 中文文本 ---
  {
    category: 'Chinese',
    label: '短句',
    content: '你好，今天天气怎么样？',
  },
  {
    category: 'Chinese',
    label: '中等段落',
    content:
      '大型语言模型的出现彻底改变了人工智能的格局。这些模型通过在海量文本数据上进行训练，' +
      '学会了理解和生成人类语言的能力。从GPT系列到Claude系列，每一代模型都在推理能力、' +
      '知识广度和安全性方面取得了显著进步。然而，如何在保持模型能力的同时确保其安全可控，' +
      '仍然是当前研究的重要课题。未来的发展方向可能包括更高效的训练方法、更好的对齐技术，' +
      '以及更广泛的多模态能力整合。',
  },
  {
    category: 'Chinese',
    label: '技术文档',
    content: `## 接口说明

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| model | string | 是 | 模型标识符 |
| messages | array | 是 | 消息列表 |
| max_tokens | integer | 是 | 最大生成令牌数 |
| temperature | float | 否 | 采样温度，范围 0-1 |
| stream | boolean | 否 | 是否使用流式输出 |

### 响应格式

返回包含助手回复的消息对象，同时附带输入和输出令牌的使用统计信息。
错误情况下返回标准错误格式，包含错误码和详细描述。`,
  },

  // --- 代码 ---
  {
    category: 'Code',
    label: 'TypeScript function',
    content: `async function fetchWithRetry<T>(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30000),
      })

      if (!response.ok) {
        if (response.status === 429 && attempt < maxRetries) {
          const retryAfter = response.headers.get('retry-after')
          const delay = retryAfter
            ? parseInt(retryAfter) * 1000
            : baseDelay * Math.pow(2, attempt)
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        throw new Error(\`HTTP \${response.status}: \${response.statusText}\`)
      }

      return await response.json() as T
    } catch (error) {
      if (attempt === maxRetries) throw error
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)))
    }
  }
  throw new Error('Unreachable')
}`,
  },
  {
    category: 'Code',
    label: 'Python class',
    content: `class TokenBucket:
    """Rate limiter using token bucket algorithm."""

    def __init__(self, rate: float, capacity: int):
        self.rate = rate
        self.capacity = capacity
        self._tokens = capacity
        self._last_refill = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self, tokens: int = 1) -> float:
        async with self._lock:
            self._refill()
            if self._tokens >= tokens:
                self._tokens -= tokens
                return 0.0
            wait_time = (tokens - self._tokens) / self.rate
            await asyncio.sleep(wait_time)
            self._refill()
            self._tokens -= tokens
            return wait_time

    def _refill(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_refill
        self._tokens = min(self.capacity, self._tokens + elapsed * self.rate)
        self._last_refill = now`,
  },

  // --- JSON / 结构化数据 ---
  {
    category: 'JSON',
    label: 'API request payload',
    content: JSON.stringify(
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        temperature: 0.7,
        system:
          'You are a helpful coding assistant. Respond concisely and accurately.',
        messages: [
          {
            role: 'user',
            content:
              'Write a function that validates email addresses using regex.',
          },
          {
            role: 'assistant',
            content:
              'Here\'s a TypeScript function for email validation:\n\n```typescript\nfunction isValidEmail(email: string): boolean {\n  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/;\n  return regex.test(email);\n}\n```',
          },
          {
            role: 'user',
            content: 'Can you also add support for checking MX records?',
          },
        ],
        tools: [
          {
            name: 'dns_lookup',
            description: 'Look up DNS records for a domain',
            input_schema: {
              type: 'object',
              properties: {
                domain: { type: 'string', description: 'The domain to look up' },
                record_type: {
                  type: 'string',
                  enum: ['A', 'AAAA', 'MX', 'TXT', 'CNAME'],
                  description: 'DNS record type',
                },
              },
              required: ['domain', 'record_type'],
            },
          },
        ],
      },
      null,
      2
    ),
  },
  {
    category: 'JSON',
    label: 'Config object',
    content: JSON.stringify({
      database: {
        host: 'localhost',
        port: 5432,
        name: 'myapp_production',
        pool: { min: 5, max: 20, idle_timeout: 10000 },
        ssl: { enabled: true, reject_unauthorized: true },
      },
      cache: {
        driver: 'redis',
        url: 'redis://localhost:6379',
        ttl: 3600,
        prefix: 'app:cache:',
      },
      logging: {
        level: 'info',
        format: 'json',
        transports: ['console', 'file'],
        file: { path: '/var/log/app.log', max_size: '10m', max_files: 5 },
      },
    }),
  },

  // --- 混合内容 ---
  {
    category: 'Mixed',
    label: '中英混合技术讨论',
    content:
      '在实现 WebSocket 连接池时，我们需要考虑以下几个关键点：\n\n' +
      '1. **Connection Lifecycle Management** - 连接的创建、复用和销毁\n' +
      '2. **Health Check** - 定期发送 ping/pong 检测连接活性\n' +
      '3. **Backpressure Handling** - 当下游消费速度跟不上时的背压处理\n\n' +
      '```typescript\n' +
      'interface PoolConfig {\n' +
      '  maxConnections: number  // 最大连接数\n' +
      '  idleTimeout: number     // 空闲超时（ms）\n' +
      '  healthCheckInterval: number // 健康检查间隔\n' +
      '}\n' +
      '```\n\n' +
      '建议使用 Round-Robin 策略分配连接，同时配合 circuit breaker 模式防止级联故障。',
  },
  {
    category: 'Mixed',
    label: 'System prompt (typical)',
    content:
      'You are a senior software engineer with expertise in distributed systems, ' +
      'TypeScript, and cloud architecture. When answering questions:\n' +
      '- Provide concrete code examples\n' +
      '- Consider edge cases and error handling\n' +
      '- Follow SOLID principles\n' +
      '- Keep responses concise but thorough\n\n' +
      'Current project context: Building a high-throughput API gateway that handles ' +
      '10,000+ requests per second with sub-100ms latency requirements. The stack ' +
      'includes Node.js, Redis, and Docker.',
  },

  // --- 长文本 ---
  {
    category: 'Long',
    label: 'Repeated pattern (EN, 1k+ tok)',
    content: Array.from(
      { length: 50 },
      (_, i) =>
        `Item ${i + 1}: The quick brown fox jumps over the lazy dog. ` +
        `This is a test sentence to evaluate tokenizer accuracy across longer texts. ` +
        `Each repetition adds approximately 25-30 tokens to the total count.`
    ).join('\n'),
  },
  {
    category: 'Long',
    label: '长中文文本 (1k+ tok)',
    content: Array.from(
      { length: 30 },
      (_, i) =>
        `第${i + 1}条：人工智能技术的发展正在深刻改变着各行各业的运作方式。` +
        `从自然语言处理到计算机视觉，从自动驾驶到医疗诊断，AI 的应用场景不断拓展。` +
        `在这个快速变化的时代，持续学习和适应新技术是每个从业者必须面对的挑战。`
    ).join('\n'),
  },
]

// ============ Anthropic API 调用 ============

interface CountTokensResponse {
  input_tokens: number
}

async function callAnthropicCountTokens(
  model: string,
  content: string
): Promise<number> {
  if (!API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required')
  }

  const response = await fetch(`${API_BASE}/v1/messages/count_tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Anthropic API error ${response.status}: ${errorBody}`)
  }

  const data = (await response.json()) as CountTokensResponse
  return data.input_tokens
}

// ============ 本地 Token 计算 ============

/**
 * 使用 gateway 实际路径 countAllTokens() 估算
 * 模拟 API 发送 messages: [{ role: 'user', content }] 的结构
 */
function countWithGateway(model: string, content: string): number {
  return countAllTokens(
    model,
    undefined, // no system
    [{ role: 'user', content }], // single user message
    undefined  // no tools
  )
}

/**
 * 原始 cl100k_base 编码（无修正、无开销）作为参考基线
 */
function countRaw(encoder: Tiktoken, text: string): number {
  try {
    return encoder.encode(text).length
  } catch {
    return Math.floor(text.length / 4) + 1
  }
}

// ============ 结果类型 ============

interface BenchmarkResult {
  category: string
  label: string
  contentLength: number
  actual: number          // Anthropic API ground truth
  raw: number             // cl100k_base raw (baseline)
  gateway: number         // countAllTokens() 实际路径
  rawError: number
  gatewayError: number
  optimalFactor: number   // actual / raw
}

interface CategorySummary {
  category: string
  count: number
  avgRawError: number
  avgGatewayError: number
  maxGatewayAbsError: number
  avgOptimalFactor: number
}

// ============ 输出格式化 ============

function printTable(results: BenchmarkResult[]): void {
  console.log('\n' + '='.repeat(120))
  console.log('  Token Estimation Benchmark v2  |  Gateway countAllTokens() vs Anthropic count_tokens API')
  console.log('='.repeat(120))

  const header = [
    'Category'.padEnd(10),
    'Label'.padEnd(28),
    'Actual'.padStart(7),
    'Raw'.padStart(6),
    'GW'.padStart(6),
    'Raw%'.padStart(8),
    'GW%'.padStart(8),
    'BestF'.padStart(7),
  ].join(' | ')

  console.log(header)
  console.log('-'.repeat(120))

  for (const r of results) {
    const row = [
      r.category.padEnd(10),
      r.label.slice(0, 28).padEnd(28),
      String(r.actual).padStart(7),
      String(r.raw).padStart(6),
      String(r.gateway).padStart(6),
      fmtErr(r.rawError).padStart(8),
      fmtErr(r.gatewayError).padStart(8),
      r.optimalFactor.toFixed(2).padStart(7),
    ].join(' | ')
    console.log(row)
  }

  console.log('-'.repeat(120))
}

function printCategorySummary(summaries: CategorySummary[]): void {
  console.log('\n' + '='.repeat(90))
  console.log('  Category Summary')
  console.log('='.repeat(90))

  const header = [
    'Category'.padEnd(10),
    'Cases'.padStart(6),
    'Avg Raw%'.padStart(10),
    'Avg GW%'.padStart(10),
    'Max |GW%|'.padStart(10),
    'Avg BestF'.padStart(10),
  ].join(' | ')

  console.log(header)
  console.log('-'.repeat(90))

  for (const s of summaries) {
    const row = [
      s.category.padEnd(10),
      String(s.count).padStart(6),
      fmtErr(s.avgRawError).padStart(10),
      fmtErr(s.avgGatewayError).padStart(10),
      fmtErr(s.maxGatewayAbsError).padStart(10),
      s.avgOptimalFactor.toFixed(4).padStart(10),
    ].join(' | ')
    console.log(row)
  }

  console.log('-'.repeat(90))
}

function printOverallSummary(results: BenchmarkResult[]): void {
  const avgRawErr = avg(results.map((r) => r.rawError))
  const avgGWErr = avg(results.map((r) => r.gatewayError))
  const rawAbsErr = avg(results.map((r) => Math.abs(r.rawError)))
  const gwAbsErr = avg(results.map((r) => Math.abs(r.gatewayError)))
  const maxGWAbsErr = Math.max(...results.map((r) => Math.abs(r.gatewayError)))
  const avgOptimal = avg(results.map((r) => r.optimalFactor))
  const medianOptimal = median(results.map((r) => r.optimalFactor))
  const totalActual = results.reduce((s, r) => s + r.actual, 0)
  const totalRaw = results.reduce((s, r) => s + r.raw, 0)
  const weightedOptimal = totalActual / totalRaw

  console.log('\n' + '='.repeat(60))
  console.log('  Overall Summary')
  console.log('='.repeat(60))
  console.log(`  Avg raw error:            ${fmtErr(avgRawErr)}`)
  console.log(`  Avg gateway error:        ${fmtErr(avgGWErr)}`)
  console.log('  ─────────────────────────────────────────')
  console.log(`  Avg |raw| error:          ${rawAbsErr.toFixed(1)}%`)
  console.log(`  Avg |gateway| error:      ${gwAbsErr.toFixed(1)}%`)
  console.log(`  Max |gateway| error:      ${maxGWAbsErr.toFixed(1)}%`)
  console.log('  ─────────────────────────────────────────')
  console.log(`  Avg optimal factor:       ${avgOptimal.toFixed(4)}`)
  console.log(`  Median optimal factor:    ${medianOptimal.toFixed(4)}`)
  console.log(`  Weighted optimal factor:  ${weightedOptimal.toFixed(4)}`)
  console.log('='.repeat(60))

  const improvement = ((rawAbsErr - gwAbsErr) / rawAbsErr) * 100
  console.log(`\n  Gateway vs Raw improvement: ${improvement.toFixed(1)}% reduction in avg absolute error`)
  console.log(`  (${rawAbsErr.toFixed(1)}% → ${gwAbsErr.toFixed(1)}%)`)
}

// ============ 工具函数 ============

function fmtErr(pct: number): string {
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============ 主流程 ============

async function main(): Promise<void> {
  const { model, jsonOutput } = parseArgs()

  if (!API_KEY) {
    console.error(
      'Error: ANTHROPIC_API_KEY environment variable is required.\n' +
        'Usage: ANTHROPIC_API_KEY=sk-ant-xxx tsx src/scripts/tokenBenchmark.ts'
    )
    process.exit(1)
  }

  let encoder: Tiktoken
  try {
    encoder = getEncoding('cl100k_base')
  } catch (e) {
    console.error('Failed to initialize cl100k_base encoder:', e)
    process.exit(1)
  }

  if (!jsonOutput) {
    console.log(`\nModel: ${model}`)
    console.log(`Test cases: ${TEST_CASES.length}`)
    console.log(`API base: ${API_BASE}`)
    console.log(`Comparison: countAllTokens() (with overhead + content-aware correction)`)
    console.log('')
  }

  const results: BenchmarkResult[] = []

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i]

    if (!jsonOutput) {
      process.stdout.write(
        `  [${i + 1}/${TEST_CASES.length}] ${tc.category}/${tc.label}...`
      )
    }

    const raw = countRaw(encoder, tc.content)
    const gateway = countWithGateway(model, tc.content)

    let actual: number
    try {
      actual = await callAnthropicCountTokens(model, tc.content)
    } catch (error) {
      if (!jsonOutput) {
        console.log(` ERROR: ${(error as Error).message}`)
      }
      continue
    }

    const rawError = ((raw - actual) / actual) * 100
    const gatewayError = ((gateway - actual) / actual) * 100
    const optimalFactor = actual / raw

    results.push({
      category: tc.category,
      label: tc.label,
      contentLength: tc.content.length,
      actual,
      raw,
      gateway,
      rawError,
      gatewayError,
      optimalFactor,
    })

    if (!jsonOutput) {
      console.log(
        ` actual=${actual} raw=${raw} gw=${gateway}(${fmtErr(gatewayError)})`
      )
    }

    if (i < TEST_CASES.length - 1) {
      await sleep(REQUEST_DELAY_MS)
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ model, results }, null, 2))
    return
  }

  if (results.length === 0) {
    console.error('\nNo results collected. Check API key and network.')
    process.exit(1)
  }

  printTable(results)

  const categories = [...new Set(results.map((r) => r.category))]
  const summaries: CategorySummary[] = categories.map((cat) => {
    const catResults = results.filter((r) => r.category === cat)
    return {
      category: cat,
      count: catResults.length,
      avgRawError: avg(catResults.map((r) => r.rawError)),
      avgGatewayError: avg(catResults.map((r) => r.gatewayError)),
      maxGatewayAbsError: Math.max(
        ...catResults.map((r) => Math.abs(r.gatewayError))
      ),
      avgOptimalFactor: avg(catResults.map((r) => r.optimalFactor)),
    }
  })

  printCategorySummary(summaries)
  printOverallSummary(results)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
