/**
 * 单文件解析任务（worker 与主线程共用，规格 §23）。
 *
 * 把"解码 + 标准化"抽成纯函数：worker 只做消息分发，测试直接测本模块，
 * 避免 Web Worker 在 jsdom/vitest 中无法运行的问题。
 * gzip 解压与指纹计算在 importer 主线程完成（去重必须先于解码），
 * worker 收到的字节已是解压后的 FIT 内容。
 */
import { decodeFit } from '@/fit/decoder/fitDecoder'
import { normalizeActivity } from '@/fit/normalizer/normalizer'
import type { Activity } from '@/types/activity'

/**
 * 解析任务的输入。
 */
export interface ParseTaskInput {
  /** 源文件名 */
  fileName: string

  /** 已解压的 FIT 字节 */
  bytes: ArrayBuffer

  /** 文件内容指纹（SHA-256，主线程去重后传入） */
  fingerprint: string
}

/**
 * 单文件解析函数类型（主线程与 worker 解析的统一签名，可注入测试替身）。
 */
export type ParseFileFn = (input: ParseTaskInput) => Promise<Activity>

/**
 * 主线程 → worker 的请求消息。
 */
export interface ParseRequest extends ParseTaskInput {
  /** 请求编号（主线程用于关联响应） */
  id: number
}

/**
 * worker → 主线程的响应消息。
 */
export type ParseResponse =
  | { id: number; ok: true; activity: Activity }
  | { id: number; ok: false; errorMessage: string }

/**
 * 解析单个 FIT 字节流并标准化为 Activity。
 *
 * @param input 解析输入
 * @returns 领域模型活动（id 在此生成，随机 UUID）
 * @throws FitParseError 解码失败（NotFitFileError / CorruptedFitError）
 */
export function parseFitBytes(input: ParseTaskInput): Activity {
  const fit = decodeFit(input.bytes)
  return normalizeActivity(fit, {
    id: crypto.randomUUID(),
    fileName: input.fileName,
    fingerprint: input.fingerprint,
  })
}
