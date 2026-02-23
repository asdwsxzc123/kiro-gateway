# Log File Writing & Download Feature Design

## Summary

Add file-based log persistence and download functionality. Logs are written to a container-mounted directory using Winston daily rotation. The frontend gets a new "Log Files" tab for browsing and downloading log files.

## Requirements

- Write request logs + system logs to files (in addition to existing Redis storage)
- Request logs include full `messages` array (not truncated like Redis `userInput`)
- Files organized by day, auto-rotated, 30-day retention
- Docker volume mount for log directory persistence
- Backend API for listing and downloading log files
- Frontend UI for browsing and downloading files

## File Structure

```
/app/logs/                          # Docker mount point (host: ./logs)
├── requests/
│   ├── requests-2026-02-23.log     # JSON Lines format, one record per line
│   └── requests-2026-02-22.log
└── system/
    ├── system-2026-02-23.log
    └── system-2026-02-22.log
```

- Format: JSON Lines (each line is a complete JSON object)
- Rotation: Daily, 30-day retention, auto-delete expired files
- Encoding: UTF-8

## Request Log File Record

Existing fields from `RequestLog` type, plus:

```jsonl
{"id":"...","timestamp":1708700000000,"path":"/v1/chat/completions","model":"claude-3.5-sonnet","accountId":"...","inputTokens":100,"outputTokens":200,"responseTime":1500,"success":true,"messages":[{"role":"user","content":"Hello"}],...}
```

- `messages`: Full messages array from the request body (NOT truncated)
- Redis continues to store only `userInput` (500 char truncation) to keep memory low

## Backend Changes

### New Dependency

- `winston-daily-rotate-file` — Winston transport for daily file rotation

### Config (`packages/backend/src/config/`)

- New env var: `LOG_DIR` (default: `/app/logs`)

### Logger (`packages/backend/src/utils/logger.ts`)

- Add two `DailyRotateFile` transports:
  - requests: `LOG_DIR/requests/requests-%DATE%.log`
  - system: `LOG_DIR/system/system-%DATE%.log`
- Export `requestFileLogger` and `systemFileLogger` for direct use
- Both use JSON format, daily rotation, 30-day max retention

### Log Store (`packages/backend/src/storage/logStore.ts`)

- In `addRequestLog()`: after Redis write, also write full record (with `messages`) to request file logger
- In `addSystemLog()`: after Redis write, also write to system file logger
- `messages` parameter added to `addRequestLog()` signature

### Proxy Server (`packages/backend/src/core/proxyServer.ts`)

- Pass full `messages` array to `addRequestLog()` call

### New API Endpoints (`packages/backend/src/routes/logs.ts`)

- `GET /api/logs/files` — List all log files (name, type, size, date)
- `GET /api/logs/files/download?filename=<name>&type=<requests|system>` — Download a file
  - Path traversal protection: validate filename against allowed pattern
  - Response: `Content-Disposition: attachment; filename=<name>`

### Log Service (`packages/backend/src/services/logService.ts`)

- `getLogFiles()`: scan LOG_DIR/requests + LOG_DIR/system, return file metadata
- `downloadLogFile(type, filename)`: resolve and return file path with security checks

## Docker Changes

### Dockerfile

- Add `RUN mkdir -p /app/logs/requests /app/logs/system && chown -R nodejs:nodejs /app/logs`

### docker-compose.yml

- Add volume mount: `./logs:/app/logs`

## Frontend Changes

### API Client (`packages/frontend/src/api/logs.ts`)

```typescript
getLogFiles(): Promise<LogFile[]>
downloadLogFile(type: string, filename: string): void  // triggers browser download
```

### Logs Page (`packages/frontend/src/pages/Logs.tsx`)

- Add a "Log Files" tab/section alongside existing request log table
- File list table: filename, type (requests/system), size, date, download button
- Filter by type (requests/system/all)

## Shared Types (`packages/shared/src/types/index.ts`)

```typescript
interface LogFile {
  filename: string;
  type: 'requests' | 'system';
  size: number;
  date: string;
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| LOG_DIR  | /app/logs | Log file directory path |

## Security

- Download endpoint validates filename with regex: `/^(requests|system)-\d{4}-\d{2}-\d{2}\.log$/`
- Path traversal prevention: no `..` or `/` allowed in filename
- JWT auth required (existing middleware)
