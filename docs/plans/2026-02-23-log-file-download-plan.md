# Log File Writing & Download Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add file-based log persistence with daily rotation and a frontend download UI, writing to a Docker-mounted directory.

**Architecture:** Winston `DailyRotateFile` transports write request/system logs as JSON Lines to `/app/logs/{requests,system}/`. Request logs include the full `messages` array. New backend endpoints list and serve log files. Frontend adds a "Log Files" tab with download buttons.

**Tech Stack:** winston-daily-rotate-file, Express (sendFile), React + TanStack Query, shadcn/ui

---

### Task 1: Install winston-daily-rotate-file dependency

**Files:**
- Modify: `packages/backend/package.json`

**Step 1: Install the package**

Run:
```bash
cd /Users/mac/git/person/gateway && pnpm add -F @kiro-gateway/backend winston-daily-rotate-file
```

**Step 2: Verify package.json updated**

Run:
```bash
grep winston-daily-rotate-file packages/backend/package.json
```
Expected: line with `"winston-daily-rotate-file"` and a version

**Step 3: Commit**

```bash
git add packages/backend/package.json pnpm-lock.yaml
git commit -m "feat: add winston-daily-rotate-file dependency"
```

---

### Task 2: Add LOG_DIR to config

**Files:**
- Modify: `packages/backend/src/config/index.ts:62-65` (LogConfig interface)
- Modify: `packages/backend/src/config/index.ts:136-139` (log config loading)
- Modify: `packages/backend/src/config/defaults.ts:40-44` (DEFAULT_LOG_CONFIG)

**Step 1: Update LogConfig interface**

In `packages/backend/src/config/index.ts`, change the `LogConfig` interface:

```typescript
// 日志配置
export interface LogConfig {
  level: string
  maxEntries: number
  dir: string
}
```

**Step 2: Update loadConfig()**

In `packages/backend/src/config/index.ts`, update the `log` section inside `loadConfig()`:

```typescript
    log: {
      level: process.env.LOG_LEVEL || DEFAULT_LOG_CONFIG.level,
      maxEntries: parseInt(process.env.LOG_MAX_ENTRIES || String(DEFAULT_LOG_CONFIG.maxEntries), 10),
      dir: process.env.LOG_DIR || DEFAULT_LOG_CONFIG.dir
    },
```

**Step 3: Update defaults**

In `packages/backend/src/config/defaults.ts`, update `DEFAULT_LOG_CONFIG`:

```typescript
// 日志默认配置
export const DEFAULT_LOG_CONFIG = {
  level: 'info',
  maxEntries: 100000,
  dir: '/app/logs'
} as const
```

**Step 4: Verify typecheck passes**

Run:
```bash
cd /Users/mac/git/person/gateway && pnpm typecheck
```

**Step 5: Commit**

```bash
git add packages/backend/src/config/index.ts packages/backend/src/config/defaults.ts
git commit -m "feat: add LOG_DIR config for file-based logging"
```

---

### Task 3: Add file loggers to logger.ts

**Files:**
- Modify: `packages/backend/src/utils/logger.ts`

**Step 1: Rewrite logger.ts with file transports**

Replace the full content of `packages/backend/src/utils/logger.ts`:

```typescript
/**
 * 日志工具
 * 使用 winston 进行日志记录
 * 支持 console + 文件日志（按天轮转）
 */

import path from 'path'
import fs from 'fs'
import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import { getConfig } from '../config/index.js'

const config = getConfig()
const logDir = config.log.dir

// 确保日志目录存在
for (const sub of ['requests', 'system']) {
  const dir = path.join(logDir, sub)
  fs.mkdirSync(dir, { recursive: true })
}

// 控制台日志格式
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, category, ...meta }) => {
    const categoryStr = category ? `[${category}]` : ''
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
    return `${timestamp} ${level} ${categoryStr} ${message}${metaStr}`
  })
)

// 主 logger（控制台输出）
export const logger = winston.createLogger({
  level: config.log.level,
  transports: [
    new winston.transports.Console({ format: consoleFormat })
  ]
})

// 请求日志文件 logger（JSON Lines，按天轮转）
export const requestFileLogger = winston.createLogger({
  transports: [
    new DailyRotateFile({
      dirname: path.join(logDir, 'requests'),
      filename: 'requests-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ]
})

// 系统日志文件 logger（JSON Lines，按天轮转）
export const systemFileLogger = winston.createLogger({
  transports: [
    new DailyRotateFile({
      dirname: path.join(logDir, 'system'),
      filename: 'system-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ]
})

// 创建带类别的 logger
export function createLogger(category: string) {
  return {
    debug: (message: string, meta?: Record<string, unknown>) =>
      logger.debug(message, { category, ...meta }),
    info: (message: string, meta?: Record<string, unknown>) =>
      logger.info(message, { category, ...meta }),
    warn: (message: string, meta?: Record<string, unknown>) =>
      logger.warn(message, { category, ...meta }),
    error: (message: string, meta?: Record<string, unknown>) =>
      logger.error(message, { category, ...meta })
  }
}

// 导出默认 logger
export default logger
```

**Step 2: Verify typecheck passes**

Run:
```bash
cd /Users/mac/git/person/gateway && pnpm typecheck
```

**Step 3: Commit**

```bash
git add packages/backend/src/utils/logger.ts
git commit -m "feat: add daily-rotate file loggers for requests and system logs"
```

---

### Task 4: Write logs to file in logStore.ts

**Files:**
- Modify: `packages/backend/src/storage/logStore.ts:1-93` (addRequestLog function)
- Modify: `packages/backend/src/storage/logStore.ts:174-211` (addSystemLog function)

**Step 1: Update imports**

At the top of `packages/backend/src/storage/logStore.ts`, add file logger imports:

```typescript
import { createLogger, requestFileLogger, systemFileLogger } from '../utils/logger.js'
```

(Replace the existing `import { createLogger } from '../utils/logger.js'` line.)

**Step 2: Update addRequestLog signature and add file write**

Change the `addRequestLog` function signature to accept an optional `messages` parameter:

```typescript
export async function addRequestLog(
  log: Omit<RequestLog, 'id'>,
  messages?: unknown[]
): Promise<string> {
```

After the `return id` line (before the catch), add the file write:

```typescript
    // 写入文件日志（含完整 messages）
    requestFileLogger.info('request', {
      ...log,
      id,
      ...(messages ? { messages } : {})
    })

    return id
```

**Step 3: Add file write to addSystemLog**

After the existing `return id` in `addSystemLog` (before the catch), add:

```typescript
    // 写入文件日志
    systemFileLogger.info('system', {
      ...log,
      id
    })

    return id
```

**Step 4: Verify typecheck passes**

Run:
```bash
cd /Users/mac/git/person/gateway && pnpm typecheck
```

**Step 5: Commit**

```bash
git add packages/backend/src/storage/logStore.ts
git commit -m "feat: write request and system logs to daily-rotate files"
```

---

### Task 5: Pass messages from ProxyServer to logStore

**Files:**
- Modify: `packages/backend/src/core/proxyServer.ts:444-477` (recordRequest method)

**Step 1: Update recordRequest to accept and pass messages**

Change the `recordRequest` method to accept a `messages` parameter:

```typescript
  private recordRequest(log: Partial<RequestLog>, messages?: unknown[]): void {
```

Update the `logStore.addRequestLog` call at the bottom of the method:

```typescript
    // 写入 Redis 持久化日志
    logStore.addRequestLog(requestLog, messages).catch(err => {
      logger.error('Failed to persist request log', { error: (err as Error).message })
    })
```

**Step 2: Pass messages in non-stream handleClaudeRequest**

In `_handleClaudeRequest` (around line 800-817), find the `this.recordRequest({...})` call and add `effectiveRequest.messages` as the second argument:

```typescript
        this.recordRequest({
          path: '/v1/messages',
          model: effectiveRequest.model,
          accountId: usedAccount.id,
          machineId: usedAccount.machineId,
          inputTokens: uncachedInputTokens,
          outputTokens,
          kiroCredits,
          cacheCreationTokens: cacheWriteTokens,
          cacheReadTokens,
          cost: cost2.totalCost,
          responseTime: Date.now() - startTime,
          success: true,
          auxiliary: false,
          userInput
        }, effectiveRequest.messages)
```

**Step 3: Pass messages in stream handler**

In `handleClaudeStream` (around line 1391-1408), the `this.recordRequest` call inside the `onComplete` callback. This is trickier because `effectiveRequest` is not directly in scope here — it's the outer `_handleClaudeStreamRequest` scope.

We need to thread the messages through `handleClaudeStream`. Add a `messages` parameter to `handleClaudeStream`:

In the private method signature (line ~1074), add `messages?: unknown[]` as the last parameter before `signal`:

```typescript
  private async handleClaudeStream(
    callbacks: { ... },
    account: ProxyAccount,
    kiroPayload: KiroPayload,
    model: string,
    startTime: number,
    currentRound: number = 0,
    msgId?: string,
    _headersSent: boolean = false,
    contentBlockIndex: number = 0,
    matchedApiKey?: ApiKey,
    cacheRatio?: CacheRatio | null,
    sessionHash?: string | null,
    estimatedTotalInputTokens?: number,
    userOnlyTokens?: number,
    skipBilling?: boolean,
    userInput?: string,
    skipRecording?: boolean,
    messages?: unknown[],
    signal?: AbortSignal
  ): Promise<void> {
```

Then update the `this.recordRequest` call inside the stream completion handler to pass `messages`:

```typescript
            this.recordRequest({
              ...
            }, messages)
```

Update both call sites to `handleClaudeStream` in `_handleClaudeStreamRequest` (line ~1037-1056):

```typescript
      await this.handleClaudeStream(
        callbacks,
        account,
        kiroPayload,
        effectiveRequest.model,
        startTime,
        0,
        undefined,
        false,
        0,
        matchedApiKey,
        cacheRatio,
        sessionHash,
        estimatedTotalInputTokens,
        userOnlyTokens,
        skipBilling,
        userInput,
        topicDetection,
        effectiveRequest.messages,
        signal
      )
```

Also update the recursive `handleClaudeStream` call for auto-continue (line ~1503-1522), passing `messages` there too.

**Step 4: Verify typecheck passes**

Run:
```bash
cd /Users/mac/git/person/gateway && pnpm typecheck
```

**Step 5: Commit**

```bash
git add packages/backend/src/core/proxyServer.ts
git commit -m "feat: pass full messages array to file logger"
```

---

### Task 6: Add LogFile type to shared types

**Files:**
- Modify: `packages/shared/src/types/index.ts`

**Step 1: Add LogFile interface**

After the `LogsSummary` interface (around line 214), add:

```typescript
/**
 * 日志文件信息
 */
export interface LogFile {
  filename: string;
  type: 'requests' | 'system';
  size: number;
  date: string;
}
```

**Step 2: Rebuild shared**

Run:
```bash
cd /Users/mac/git/person/gateway/packages/shared && pnpm build
```

**Step 3: Commit**

```bash
git add packages/shared/src/types/index.ts
git commit -m "feat: add LogFile type to shared types"
```

---

### Task 7: Add getLogFiles and downloadLogFile to logService

**Files:**
- Modify: `packages/backend/src/services/logService.ts`

**Step 1: Add file-related imports and functions**

Add at the top of the file:

```typescript
import fs from 'fs'
import path from 'path'
import { getConfig } from '../config/index.js'
```

Add at the bottom of the file (before the closing):

```typescript
/**
 * 获取所有日志文件列表
 */
export async function getLogFiles(): Promise<Array<{
  filename: string
  type: 'requests' | 'system'
  size: number
  date: string
}>> {
  const logDir = getConfig().log.dir
  const files: Array<{ filename: string; type: 'requests' | 'system'; size: number; date: string }> = []

  for (const type of ['requests', 'system'] as const) {
    const dir = path.join(logDir, type)
    if (!fs.existsSync(dir)) continue

    const entries = fs.readdirSync(dir)
    for (const entry of entries) {
      if (!entry.endsWith('.log')) continue
      const filePath = path.join(dir, entry)
      const stat = fs.statSync(filePath)
      // 从文件名提取日期，如 requests-2026-02-23.log → 2026-02-23
      const dateMatch = entry.match(/\d{4}-\d{2}-\d{2}/)
      files.push({
        filename: entry,
        type,
        size: stat.size,
        date: dateMatch ? dateMatch[0] : ''
      })
    }
  }

  // 按日期降序排列
  files.sort((a, b) => b.date.localeCompare(a.date))
  return files
}

/**
 * 获取日志文件的绝对路径（含安全校验）
 */
export function getLogFilePath(type: string, filename: string): string | null {
  // 安全校验：只允许合法文件名
  const validFilename = /^(requests|system)-\d{4}-\d{2}-\d{2}\.log$/
  if (!validFilename.test(filename)) return null
  if (type !== 'requests' && type !== 'system') return null
  if (filename.includes('..') || filename.includes('/')) return null

  const logDir = getConfig().log.dir
  const filePath = path.join(logDir, type, filename)

  if (!fs.existsSync(filePath)) return null
  return filePath
}
```

**Step 2: Verify typecheck passes**

Run:
```bash
cd /Users/mac/git/person/gateway && pnpm typecheck
```

**Step 3: Commit**

```bash
git add packages/backend/src/services/logService.ts
git commit -m "feat: add log file listing and download path resolution"
```

---

### Task 8: Add API endpoints for log files

**Files:**
- Modify: `packages/backend/src/routes/logs.ts`

**Step 1: Add two new routes**

Add before the `export default router` line in `packages/backend/src/routes/logs.ts`:

```typescript
/**
 * 获取日志文件列表
 * GET /api/logs/files
 */
router.get('/files', async (_req: Request, res: Response) => {
  try {
    const files = await logService.getLogFiles()
    res.json({ success: true, data: files } as ApiResponse)
  } catch (error) {
    logger.error('Failed to get log files', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})

/**
 * 下载日志文件
 * GET /api/logs/files/download?type=requests&filename=requests-2026-02-23.log
 */
router.get('/files/download', async (req: Request, res: Response) => {
  try {
    const type = req.query.type as string
    const filename = req.query.filename as string

    if (!type || !filename) {
      res.status(400).json({
        success: false,
        error: { message: 'Missing type or filename parameter' }
      } as ApiResponse)
      return
    }

    const filePath = logService.getLogFilePath(type, filename)
    if (!filePath) {
      res.status(404).json({
        success: false,
        error: { message: 'File not found or invalid filename' }
      } as ApiResponse)
      return
    }

    res.download(filePath, filename)
  } catch (error) {
    logger.error('Failed to download log file', { error: (error as Error).message })
    res.status(500).json({
      success: false,
      error: { message: (error as Error).message }
    } as ApiResponse)
  }
})
```

**Step 2: Verify typecheck passes**

Run:
```bash
cd /Users/mac/git/person/gateway && pnpm typecheck
```

**Step 3: Commit**

```bash
git add packages/backend/src/routes/logs.ts
git commit -m "feat: add GET /api/logs/files and GET /api/logs/files/download endpoints"
```

---

### Task 9: Update Docker configuration

**Files:**
- Modify: `Dockerfile:89-98`
- Modify: `docker-compose.yml:5-35`

**Step 1: Update Dockerfile**

In `Dockerfile`, after the `RUN mkdir -p /app/data /app/packages/backend/data` line (line 89), add the logs directory:

Change:
```dockerfile
RUN mkdir -p /app/data /app/packages/backend/data
```
To:
```dockerfile
RUN mkdir -p /app/data /app/packages/backend/data /app/logs/requests /app/logs/system
```

Update the `chown` line to include `/app/logs`:

Change:
```dockerfile
RUN chown -R nodejs:nodejs /app/data /app/packages/backend/data
```
To:
```dockerfile
RUN chown -R nodejs:nodejs /app/data /app/packages/backend/data /app/logs
```

**Step 2: Update docker-compose.yml**

In `docker-compose.yml`, add a `volumes` section to the gateway service (after `networks`):

```yaml
    volumes:
      - ./logs:/app/logs
```

Add the `LOG_DIR` environment variable:

```yaml
      LOG_DIR: /app/logs
```

**Step 3: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat: add /app/logs volume mount and directory in Docker"
```

---

### Task 10: Add frontend API client for log files

**Files:**
- Modify: `packages/frontend/src/api/logs.ts`

**Step 1: Add API functions**

Add the following at the bottom of `packages/frontend/src/api/logs.ts`:

```typescript
import type { LogFile } from "@kiro-gateway/shared"

/**
 * 获取日志文件列表
 */
export async function getLogFiles(): Promise<LogFile[]> {
  const response = await apiClient.get<ApiResponse<LogFile[]>>("/logs/files")
  return response.data.data!
}

/**
 * 下载日志文件
 */
export function downloadLogFile(type: string, filename: string): void {
  const baseUrl = apiClient.defaults.baseURL || ''
  const token = localStorage.getItem('token')
  const url = `${baseUrl}/logs/files/download?type=${encodeURIComponent(type)}&filename=${encodeURIComponent(filename)}`

  // 使用隐藏 <a> 标签触发下载，附带 JWT token
  const link = document.createElement('a')
  link.href = url
  link.download = filename

  // 如果后端需要 JWT，使用 fetch + blob 方式下载
  fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
    .then(res => res.blob())
    .then(blob => {
      const blobUrl = URL.createObjectURL(blob)
      link.href = blobUrl
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(blobUrl)
    })
}
```

Note: also add `LogFile` to the existing import line from `@kiro-gateway/shared`:

```typescript
import type { RequestLog, SystemLog, LogsQuery, LogsSummary, ApiResponse, PaginatedLogsResponse, LogFile } from "@kiro-gateway/shared"
```

**Step 2: Verify typecheck passes**

Run:
```bash
cd /Users/mac/git/person/gateway && pnpm typecheck
```

**Step 3: Commit**

```bash
git add packages/frontend/src/api/logs.ts
git commit -m "feat: add frontend API client for log file listing and download"
```

---

### Task 11: Add "Log Files" tab to Logs page

**Files:**
- Modify: `packages/frontend/src/pages/Logs.tsx`

**Step 1: Update imports**

Add to the imports at the top:

```typescript
import { Download, FileText } from "lucide-react"
import { getLogFiles, downloadLogFile } from "@/api/logs"
```

**Step 2: Add tab state and log files query**

Inside the `Logs` component, add state for tab switching and a query for log files:

```typescript
  const [activeTab, setActiveTab] = useState<'requests' | 'files'>('requests')
  const [fileTypeFilter, setFileTypeFilter] = useState<string>('all')

  const { data: logFiles = [], isLoading: isFilesLoading, refetch: refetchFiles } = useQuery({
    queryKey: ['logFiles'],
    queryFn: getLogFiles,
    enabled: activeTab === 'files'
  })

  const filteredFiles = fileTypeFilter === 'all'
    ? logFiles
    : logFiles.filter(f => f.type === fileTypeFilter)
```

**Step 3: Add tab buttons before the filter card**

After the page title `<div>` and before the filter `<Card>`, add:

```tsx
      {/* Tab 切换 */}
      <div className="flex gap-2">
        <Button
          variant={activeTab === 'requests' ? 'default' : 'outline'}
          onClick={() => setActiveTab('requests')}
        >
          <Search className="mr-2 h-4 w-4" />
          请求日志
        </Button>
        <Button
          variant={activeTab === 'files' ? 'default' : 'outline'}
          onClick={() => setActiveTab('files')}
        >
          <FileText className="mr-2 h-4 w-4" />
          日志文件
        </Button>
      </div>
```

**Step 4: Wrap existing content in conditional and add files tab**

Wrap the existing filter card and log list card with `{activeTab === 'requests' && (...)}`.

Add the files tab content:

```tsx
      {activeTab === 'files' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>日志文件</span>
              <div className="flex gap-2">
                <Select value={fileTypeFilter} onValueChange={setFileTypeFilter}>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="文件类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部</SelectItem>
                    <SelectItem value="requests">请求日志</SelectItem>
                    <SelectItem value="system">系统日志</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={() => refetchFiles()}>
                  <Search className="mr-2 h-4 w-4" />
                  刷新
                </Button>
              </div>
            </CardTitle>
            <CardDescription>
              下载历史日志文件
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isFilesLoading ? (
              <div className="py-8 text-center">加载中...</div>
            ) : filteredFiles.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                暂无日志文件
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>文件名</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>日期</TableHead>
                    <TableHead className="text-right">大小</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFiles.map((file) => (
                    <TableRow key={`${file.type}-${file.filename}`}>
                      <TableCell className="font-mono text-sm">{file.filename}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          file.type === 'requests' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                        }`}>
                          {file.type === 'requests' ? '请求日志' : '系统日志'}
                        </span>
                      </TableCell>
                      <TableCell>{file.date}</TableCell>
                      <TableCell className="text-right">{formatFileSize(file.size)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => downloadLogFile(file.type, file.filename)}
                        >
                          <Download className="mr-1 h-4 w-4" />
                          下载
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
```

**Step 5: Add formatFileSize helper**

Add this helper function inside the `Logs` component (or outside it as a standalone function):

```typescript
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
```

**Step 6: Verify typecheck and build**

Run:
```bash
cd /Users/mac/git/person/gateway && pnpm typecheck && pnpm build:frontend
```

**Step 7: Commit**

```bash
git add packages/frontend/src/pages/Logs.tsx
git commit -m "feat: add log files tab with download functionality"
```

---

### Task 12: Verify full build and manual test

**Step 1: Full typecheck**

Run:
```bash
cd /Users/mac/git/person/gateway && pnpm typecheck
```
Expected: no errors

**Step 2: Full build**

Run:
```bash
cd /Users/mac/git/person/gateway && pnpm build
```
Expected: all packages build successfully

**Step 3: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: complete log file writing and download feature"
```
