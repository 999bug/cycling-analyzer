/**
 * 标准化功率（NP）单测（规格 §26）。
 * 覆盖：30 秒滑动平均手算小数据集、缺失功率过滤、样本不足 30 秒降级、全缺降级、乱序防御。
 */
import { describe, expect, it } from 'vitest'
import { calculateNormalizedPower } from '@/features/analysis/normalizedPower'
import type { ActivityRecord } from '@/types/activity'

/**
 * 构造逐点记录（未提供的可选字段为 undefined，模拟缺失）。
 *
 * @param timestamp 时间（Unix 秒）
 * @param power 功率（W，可缺失）
 * @returns 逐点记录
 */
function makeRecord(timestamp: number, power?: number): ActivityRecord {
  return { timestamp, power }
}

describe('calculateNormalizedPower', () => {
  it('恒功率序列：滑动平均恒等，NP 等于功率值', () => {
    // 8 个点、间隔 10 秒、功率恒 200W，总跨度 70 秒
    const records = Array.from({ length: 8 }, (_, i) => makeRecord(i * 10, 200))
    expect(calculateNormalizedPower(records)).toBeCloseTo(200, 10)
  })

  it('已知小数据集手算：滑动平均 [200, 200, 200, 300] → NP ≈ 238.3046', () => {
    // 30 秒滑动平均（窗口 [t-30s, t]）：
    // t=0  → [0]      → 200
    // t=10 → [0,10]   → 200
    // t=20 → [0,20]   → 200
    // t=30 → [0,30]   → (200+200+200+600)/4 = 300
    // NP = ((200⁴×3 + 300⁴)/4)^(1/4) ≈ 238.3046
    const records = [
      makeRecord(0, 200),
      makeRecord(10, 200),
      makeRecord(20, 200),
      makeRecord(30, 600),
    ]
    expect(calculateNormalizedPower(records)).toBeCloseTo(238.30460225938302, 10)
  })

  it('滑动窗口只累计 30 秒内的记录（窗口滑出旧点）', () => {
    // 交替 100/300W、间隔 10 秒，30 秒窗口：
    // t=0→[0]=100、t=10→[0,10]=200、t=20→[0,20]=166.67、
    // t=30→[0,30]=200、t=40→[10,40]=200（t=0 的 100 已滑出窗口）、t=50→[20,50]=200
    // NP ≈ 186.5820
    const records = [100, 300, 100, 300, 100, 300].map((power, i) => makeRecord(i * 10, power))
    expect(calculateNormalizedPower(records)).toBeCloseTo(186.5820053057386, 10)
  })

  it('缺失功率的记录被过滤，剩余记录按时间重算窗口', () => {
    // 原始序列 t=0/10/20/30 功率 100/缺/200/300，过滤后为 t=0/20/30
    // 滑动平均：t=0→100、t=20→150、t=30→200；NP ≈ 164.6772
    const records = [
      makeRecord(0, 100),
      makeRecord(10),
      makeRecord(20, 200),
      makeRecord(30, 300),
    ]
    expect(calculateNormalizedPower(records)).toBeCloseTo(164.67715939211172, 10)
  })

  it('总跨度恰好 30 秒时视为样本足量', () => {
    const records = [makeRecord(0, 100), makeRecord(30, 300)]
    expect(calculateNormalizedPower(records)).not.toBeUndefined()
  })

  it('样本不足 30 秒返回 undefined（跨度 20 秒）', () => {
    const records = [makeRecord(0, 200), makeRecord(20, 300)]
    expect(calculateNormalizedPower(records)).toBeUndefined()
  })

  it('单条记录返回 undefined', () => {
    expect(calculateNormalizedPower([makeRecord(0, 200)])).toBeUndefined()
  })

  it('全部记录缺失功率返回 undefined', () => {
    expect(calculateNormalizedPower([makeRecord(0), makeRecord(30)])).toBeUndefined()
  })

  it('空数组返回 undefined', () => {
    expect(calculateNormalizedPower([])).toBeUndefined()
  })

  it('乱序输入结果与有序输入一致（防御排序）', () => {
    const unordered = [makeRecord(30, 200), makeRecord(0, 100), makeRecord(20, 200), makeRecord(10, 200)]
    const ordered = [makeRecord(0, 100), makeRecord(10, 200), makeRecord(20, 200), makeRecord(30, 200)]
    expect(calculateNormalizedPower(unordered)).toBeCloseTo(calculateNormalizedPower(ordered) as number, 10)
  })
})
