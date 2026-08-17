/**
 * gzip 解压工具（Strava 导出为 .fit.gz，规格 §8）。
 *
 * 方案决策：全程使用 fflate（纯 JS）而非浏览器原生 DecompressionStream：
 * 1. DecompressionStream 需要流式消费 API，jsdom/vitest 环境缺失，测试需额外 mock；
 * 2. fflate 在浏览器与 Node 行为一致，且 Strava 单文件体量小（几 MB），
 *    同步解压（gunzipSync）耗时毫秒级，无阻塞 UI 风险（FIT 解析本身在 worker 中）。
 */
import { gunzipSync } from 'fflate'

/**
 * gzip 解压。
 *
 * @param bytes gzip 压缩的字节
 * @returns 解压后的字节
 * @throws Error 输入不是有效的 gzip 数据
 */
export function gunzipBytes(bytes: ArrayBuffer): ArrayBuffer {
  return gunzipSync(new Uint8Array(bytes)).buffer
}

/**
 * 判断字节内容是否为 gzip 流（magic bytes：1f 8b）。
 *
 * @param bytes 文件内容
 */
export function isGzipContent(bytes: ArrayBuffer): boolean {
  const view = new Uint8Array(bytes)
  return view.length >= 2 && view[0] === 0x1f && view[1] === 0x8b
}

/**
 * 判断文件是否需要解压：扩展名为 .gz，或内容本身是 gzip 流
 * （覆盖用户把 .fit.gz 改名为 .fit 的场景）。
 *
 * @param fileName 文件名
 * @param bytes 文件内容
 */
export function shouldGunzip(fileName: string, bytes: ArrayBuffer): boolean {
  return fileName.toLowerCase().endsWith('.gz') || isGzipContent(bytes)
}
