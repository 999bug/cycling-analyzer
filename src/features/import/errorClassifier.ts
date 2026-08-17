/**
 * 导入错误分类（规格 §24）。
 *
 * 错误分为三类：
 * - 非 FIT 文件（NotFitFileError）→ "不是有效的 FIT 文件"；
 * - CRC 损坏（CorruptedFitError）→ "FIT 文件 CRC 校验失败"；
 * - 其他异常 → 原始错误信息（英文）。
 *
 * 分类在 worker 内执行（解析失败的消息无需跨线程传 Error 对象），
 * 主线程与 worker 共用本模块。
 */
import { CorruptedFitError, NotFitFileError } from '@/fit/decoder/errors'

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
  return error instanceof Error ? error.message : String(error)
}
