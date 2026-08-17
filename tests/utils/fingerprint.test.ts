/**
 * 文件指纹（SHA-256）测试：用于 FIT 重复导入检测。
 */
import { describe, expect, it } from 'vitest'
import { computeFingerprint } from '@/utils/fingerprint'

describe('computeFingerprint', () => {
  it('同一内容两次计算指纹一致', async () => {
    const bytes = new TextEncoder().encode('hello world').buffer

    const first = await computeFingerprint(bytes)
    const second = await computeFingerprint(bytes)

    expect(first).toBe(second)
  })

  it('不同内容指纹不同', async () => {
    const a = new TextEncoder().encode('ride-a').buffer
    const b = new TextEncoder().encode('ride-b').buffer

    const fingerprintA = await computeFingerprint(a)
    const fingerprintB = await computeFingerprint(b)

    expect(fingerprintA).not.toBe(fingerprintB)
  })

  it('输出为 64 位小写十六进制', async () => {
    const bytes = new TextEncoder().encode('abc').buffer

    const fingerprint = await computeFingerprint(bytes)

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('空内容也生成确定指纹', async () => {
    const fingerprint = await computeFingerprint(new ArrayBuffer(0))

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })
})
