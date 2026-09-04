/**
 * 导入错误分类（规格 §24）。
 *
 * 错误分为三类：
 * - 非 FIT 文件（NotFitFileError）→ "不是有效的 FIT 文件"；
 * - CRC 损坏（CorruptedFitError）→ "FIT 文件 CRC 校验失败"；
 * - IndexedDB 配额超限（DOMException name === 'QuotaExceededError'）
 *   → "浏览器存储空间不足"；
 * - 其他异常 → 原始错误信息（英文）。
 *
 * 分类在 worker 内执行（解析失败的消息无需跨线程传 Error 对象），
 * 主线程与 worker 共用本模块。QuotaExceededError 实际上仅在主线程
 * addActivity / addActivities 写入时触发，但统同一处分类便于 importer
 * catch 统一处理。
 */
import { CorruptedFitError, NotFitFileError } from '@/fit/decoder/errors'

/**
 * 判断是否为 IndexedDB 存储配额超限错误。
 *
 * jsdom fake-indexeddb 不抛 QuotaExceededError，但真浏览器
 * （Chrome/Firefox/Safari iOS 16+ 满后）会抛 DOMException。
 */
function isQuotaExceededError(error: unknown): boolean {
  if (error instanceof Error && 'name' in error) {
    return (error as { name?: string }).name === 'QuotaExceededError'
  }
  return false
}

/**
 * 将未知错误分类为可展示的文案。
 *
 * @param error 任意异常
 * @returns 分类后的错误信息（中文文案或原始英文消息）
 */
export function classifyParseError(error: unknown): string {
  if (error instanceof NotFitFileError) {
    return '不是有效的 FIT 文件'
  }
  if (error instanceof CorruptedFitError) {
    return 'FIT 文件 CRC 校验失败'
  }
  if (isQuotaExceededError(error)) {
    return '浏览器存储空间不足，请清理浏览器数据后重试'
  }
  return error instanceof Error ? error.message : String(error)
}
