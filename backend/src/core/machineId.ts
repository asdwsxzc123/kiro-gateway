/**
 * 机器码生成/验证模块
 * 简化版本，只保留生成和验证逻辑，移除系统操作
 */

import crypto from 'crypto'

/**
 * 生成随机机器码 (UUID 格式)
 * 格式: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
export function generateMachineId(): string {
  return crypto.randomUUID().toLowerCase()
}

/**
 * 验证机器码格式
 * 支持两种格式:
 * - UUID 格式: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * - 纯32位十六进制 (Linux machine-id 格式)
 */
export function isValidMachineId(machineId: string): boolean {
  if (!machineId || typeof machineId !== 'string') {
    return false
  }

  // UUID 格式: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  // 纯32位十六进制 (Linux machine-id 格式)
  const hexRegex = /^[0-9a-f]{32}$/i

  return uuidRegex.test(machineId) || hexRegex.test(machineId)
}

/**
 * 将32位十六进制转换为 UUID 格式
 */
export function formatAsUUID(hex: string): string {
  const clean = hex.replace(/-/g, '').toLowerCase()
  if (clean.length !== 32) {
    return clean
  }
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`
}

/**
 * 将 UUID 格式转换为32位十六进制
 */
export function formatAsHex(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase()
}

/**
 * 标准化机器码格式（统一为 UUID 格式）
 */
export function normalizeMachineId(machineId: string): string {
  if (!machineId) {
    return generateMachineId()
  }

  const clean = machineId.replace(/-/g, '').toLowerCase()

  // 如果是32位十六进制，转换为 UUID 格式
  if (clean.length === 32 && /^[0-9a-f]+$/i.test(clean)) {
    return formatAsUUID(clean)
  }

  // 如果已经是 UUID 格式，直接返回小写
  if (isValidMachineId(machineId)) {
    return machineId.toLowerCase()
  }

  // 无效格式，生成新的
  return generateMachineId()
}
