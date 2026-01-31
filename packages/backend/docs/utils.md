# 工具模块文档

## 目录结构

```
src/utils/
├── logger.ts   # 日志工具
└── crypto.ts   # 加密工具
```

---

## 一、logger.ts - 日志系统

### 1.1 核心职责

- 提供统一的日志记录接口
- 支持分类日志（按模块）
- 支持多种日志级别
- 支持元数据记录

### 1.2 日志格式

```
${timestamp} ${level} [${category}] ${message} ${meta}

示例:
2026-01-31 08:20:06.123 INFO [auth] User login successful {"userId": "123"}
2026-01-31 08:20:07.456 ERROR [database] Connection failed {"error": "ECONNREFUSED"}
```

### 1.3 导出接口

```typescript
// 全局 logger 实例
export const logger: Logger

// 创建带类别的 logger
export function createLogger(category: string): {
  debug: (message: string, meta?: object) => void
  info: (message: string, meta?: object) => void
  warn: (message: string, meta?: object) => void
  error: (message: string, meta?: object) => void
}
```

### 1.4 使用示例

```typescript
import { logger, createLogger } from './utils/logger'

// 方式1: 全局 logger
logger.info("Application started")
logger.error("Database connection failed")

// 方式2: 模块级 logger
const authLogger = createLogger("auth")
authLogger.info("User login", { userId: "123" })
authLogger.warn("Invalid token", { token: "xxx" })
authLogger.error("Auth failed", { error: error.message })
```

### 1.5 日志级别

| 级别 | 用途 |
|------|------|
| debug | 调试信息 |
| info | 一般信息 |
| warn | 警告信息 |
| error | 错误信息 |

### 1.6 配置

```typescript
// 从配置读取日志级别
config.log.level  // 默认: 'info'
```

---

## 二、crypto.ts - 加密工具

### 2.1 核心职责

- 敏感数据加密存储
- 数据解密读取
- 加密格式检测

### 2.2 加密算法

```
算法: AES-256-GCM (Galois/Counter Mode)
密钥长度: 256 位 (32 字节)
IV 长度: 128 位 (16 字节)
认证模式: GCM (提供认证加密)
```

### 2.3 密文格式

```
base64(iv):base64(authTag):base64(encrypted)

示例:
abc123==:def456==:ghi789==
```

### 2.4 导出函数

```typescript
// 获取加密密钥
getEncryptionKey(): Buffer | null

// 加密
encrypt(plaintext: string): string

// 解密
decrypt(ciphertext: string): string

// 检查是否已加密
isEncrypted(text: string): boolean
```

### 2.5 使用示例

```typescript
import { encrypt, decrypt, isEncrypted } from './utils/crypto'

// 加密
const plaintext = "sensitive-token-12345"
const encrypted = encrypt(plaintext)
// 结果: "abc123==:def456==:ghi789=="

// 解密
const decrypted = decrypt(encrypted)
// 结果: "sensitive-token-12345"

// 检查
isEncrypted(encrypted)  // true
isEncrypted(plaintext)  // false
```

### 2.6 密钥管理

```typescript
// 从配置获取密钥
config.security.encryptionKey

// 使用 SHA-256 确保密钥长度为 32 字节
const key = crypto.createHash('sha256')
  .update(configKey)
  .digest()
```

### 2.7 安全特性

| 特性 | 说明 |
|------|------|
| 认证加密 | GCM 模式 + authTag 检测篡改 |
| 随机 IV | 每次加密生成新 IV |
| 密钥派生 | SHA-256 确保密钥长度 |
| 容错处理 | 解密失败返回原文 |

### 2.8 配置

```bash
# 环境变量
ENCRYPTION_KEY=your-secret-key
```

> 注意：如果未配置密钥，数据将以明文存储

---

## 三、模块依赖

```
logger.ts
├── winston (日志库)
└── config (日志级别配置)

crypto.ts
├── crypto (Node.js 内置)
└── config (加密密钥配置)
```

---

## 四、在项目中的使用

### 4.1 日志使用场景

- **中间件**: 请求日志、错误日志
- **服务层**: 业务操作日志
- **存储层**: 数据操作日志

### 4.2 加密使用场景

- **accountStore**: 加密存储 accessToken、refreshToken、clientSecret
- **序列化/反序列化**: 存储时加密，读取时解密
