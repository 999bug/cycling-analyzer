/**
 * 测试样例读取辅助。
 * 样例来源：Garmin 官方 FIT SDK 公开示例 + 本地合成文件（generate-samples.mjs）。
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

/**
 * 读取 FIT 样例文件为 ArrayBuffer。
 */
export function readFixtureBytes(name: string): ArrayBuffer {
  const buf = readFileSync(join(FIXTURES_DIR, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

/**
 * 生成指定大小的随机字节（模拟非 FIT 文件）。
 */
export function randomBytes(size: number): ArrayBuffer {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    bytes[i] = Math.floor(Math.random() * 256)
  }
  return bytes.buffer
}
