/**
 * 加密工具
 * 用于加密存储敏感数据（Token、Secret 等）
 */

import crypto from 'crypto'
import { getConfig } from '../config/index.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

/**
 * 获取加密密钥
 * 如果未配置，返回 null（不加密）
 */
function getEncryptionKey(): Buffer | null {
  const config = getConfig()
  const key = config.security.encryptionKey

  if (!key || key.length === 0) {
    return null
  }

  // 使用 SHA-256 确保密钥长度为 32 字节
  return crypto.createHash('sha256').update(key).digest()
}

/**
 * 加密字符串
 * @param plaintext 明文
 * @returns 加密后的字符串（base64 格式）或原文（如果未配置密钥）
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey()

  if (!key) {
    // 未配置密钥，返回原文
    return plaintext
  }

  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  const authTag = cipher.getAuthTag()

  // 格式: iv:authTag:encrypted (都是 base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`
}

/**
 * 解密字符串
 * @param ciphertext 密文（base64 格式）
 * @returns 解密后的明文
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey()

  if (!key) {
    // 未配置密钥，返回原文
    return ciphertext
  }

  // 检查是否是加密格式
  const parts = ciphertext.split(':')
  if (parts.length !== 3) {
    // 不是加密格式，返回原文
    return ciphertext
  }

  try {
    const [ivBase64, authTagBase64, encrypted] = parts
    const iv = Buffer.from(ivBase64, 'base64')
    const authTag = Buffer.from(authTagBase64, 'base64')

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encrypted, 'base64', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch {
    // 解密失败，可能是未加密的数据，返回原文
    return ciphertext
  }
}

/**
 * 检查字符串是否已加密
 */
export function isEncrypted(text: string): boolean {
  const parts = text.split(':')
  if (parts.length !== 3) {
    return false
  }

  try {
    // 尝试解析 base64
    Buffer.from(parts[0], 'base64')
    Buffer.from(parts[1], 'base64')
    return true
  } catch {
    return false
  }
}
