/**
 * gzip 解压工具测试：压缩-解压往返、magic 字节识别、按文件名/内容判断。
 */
import { gzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { gunzipBytes, isGzipContent, shouldGunzip } from '@/features/import/gzip'
import { randomBytes } from '../../helpers/fixtures'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

describe('gunzipBytes 解压', () => {
  it('gzip 压缩-解压往返一致（含中文内容）', () => {
    const original = encoder.encode('fit data 中文内容')
    const compressed = gzipSync(original)

    const restored = gunzipBytes(compressed.buffer)

    expect(decoder.decode(restored)).toBe('fit data 中文内容')
  })

  it('空内容压缩后解压为空', () => {
    const compressed = gzipSync(new Uint8Array(0))

    expect(gunzipBytes(compressed.buffer).byteLength).toBe(0)
  })

  it('解压非 gzip 数据抛出错误', () => {
    expect(() => gunzipBytes(randomBytes(64))).toThrow()
  })
})

describe('isGzipContent 识别', () => {
  it('gzip 流返回 true', () => {
    expect(isGzipContent(gzipSync(encoder.encode('data')).buffer)).toBe(true)
  })

  it('空字节与普通内容返回 false', () => {
    expect(isGzipContent(new ArrayBuffer(0))).toBe(false)
    expect(isGzipContent(encoder.encode('plain').buffer)).toBe(false)
  })
})

describe('shouldGunzip 判断', () => {
  const plain = encoder.encode('plain content').buffer

  it('扩展名为 .gz（不区分大小写）即需解压', () => {
    expect(shouldGunzip('ride.fit.gz', plain)).toBe(true)
    expect(shouldGunzip('RIDE.FIT.GZ', plain)).toBe(true)
  })

  it('内容为 gzip 流（改名场景）也需解压', () => {
    const gzipped = gzipSync(encoder.encode('data')).buffer
    expect(shouldGunzip('ride.fit', gzipped)).toBe(true)
  })

  it('普通 FIT 文件无需解压', () => {
    expect(shouldGunzip('ride.fit', plain)).toBe(false)
  })
})
