/**
 * 强度因子（IF）与训练压力分数（TSS）单测（规格 §26）。
 * 覆盖：公式精确值、无效参数（无 FTP/NP）降级。
 */
import { describe, expect, it } from 'vitest'
import { calculateIntensityFactor, calculateTss } from '@/features/analysis/intensity'

describe('calculateIntensityFactor', () => {
  it('IF = NP / FTP，精确值', () => {
    expect(calculateIntensityFactor(200, 250)).toBe(0.8)
    expect(calculateIntensityFactor(250, 250)).toBe(1)
    expect(calculateIntensityFactor(300, 200)).toBe(1.5)
  })

  it('NP 为 0 时 IF 为 0（恒零功率的有效结果）', () => {
    expect(calculateIntensityFactor(0, 250)).toBe(0)
  })

  it('FTP 无效（0/负数/NaN）时返回 undefined', () => {
    expect(calculateIntensityFactor(200, 0)).toBeUndefined()
    expect(calculateIntensityFactor(200, -250)).toBeUndefined()
    expect(calculateIntensityFactor(200, Number.NaN)).toBeUndefined()
  })

  it('NP 无效（NaN/负数）时返回 undefined', () => {
    expect(calculateIntensityFactor(Number.NaN, 250)).toBeUndefined()
    expect(calculateIntensityFactor(-200, 250)).toBeUndefined()
  })
})

describe('calculateTss', () => {
  it('TSS = (时长 × IF² × 100) / 3600，精确值', () => {
    // IF=1 持续 1 小时 = 100 分（基准定义）
    expect(calculateTss(3600, 1, 250)).toBe(100)
    // IF=0.8 持续 30 分钟 = 32 分
    expect(calculateTss(1800, 0.8, 250)).toBe(32)
    // IF=1.2 持续 2 小时 = 288 分
    expect(calculateTss(7200, 1.2, 250)).toBe(288)
  })

  it('IF 无效（0/负数/NaN）时返回 undefined（无 NP 降级）', () => {
    expect(calculateTss(3600, 0, 250)).toBeUndefined()
    expect(calculateTss(3600, -1, 250)).toBeUndefined()
    expect(calculateTss(3600, Number.NaN, 250)).toBeUndefined()
  })

  it('FTP 无效（0/负数/NaN）时返回 undefined（无 FTP 降级）', () => {
    expect(calculateTss(3600, 1, 0)).toBeUndefined()
    expect(calculateTss(3600, 1, -250)).toBeUndefined()
    expect(calculateTss(3600, 1, Number.NaN)).toBeUndefined()
  })

  it('时长无效（0/负数/NaN）时返回 undefined', () => {
    expect(calculateTss(0, 1, 250)).toBeUndefined()
    expect(calculateTss(-3600, 1, 250)).toBeUndefined()
    expect(calculateTss(Number.NaN, 1, 250)).toBeUndefined()
  })
})
