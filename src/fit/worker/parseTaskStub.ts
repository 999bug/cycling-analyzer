/**
 * FIT 主线程解析桩（仅生产构建使用，见 vite.config.ts resolve.alias）。
 *
 * 背景：主线程降级路径动态 import parseTask 会让生产构建额外打包一份
 * 完整 @garmin/fitsdk（~384KB），与 worker chunk 内容重复。浏览器环境
 * 一律走 Worker 解析，本桩在生产构建中替换该动态 import 目标；
 * vitest（command=serve）不受 alias 影响，仍用真实实现。
 *
 * 正常情况下本文件永不该执行：所有目标浏览器均支持 module Worker，
 * 触发即说明运行环境异常，按解析失败处理（英文消息，errorClassifier 兼容）。
 */
import type { ParseTaskInput } from '@/fit/worker/parseTask'
import type { Activity } from '@/types/activity'

export function parseFitBytes(_input: ParseTaskInput): Activity {
  void _input
  throw new Error('FIT parsing requires Web Worker support')
}
