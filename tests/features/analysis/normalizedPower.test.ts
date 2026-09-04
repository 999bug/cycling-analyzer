/**
 * 标准化功率（NP）单测（规格 §26）。
 *
 * 标准算法（TrainingPeaks / Garmin）：30 秒滑动平均 → 4 次方平均 → 4 次方根。
 * 仅当窗口时间跨度 ≥ 30s 时才计入 4 次方平均（不满窗数据不参与 NP 计算，
 * 避免前/后不满窗数据拉低 NP，对齐行业标准）。
 */
import { describe, expect, it } from 'vitest'
import { calculateNormalizedPower } from '@/features/analysis/normalizedPower'
import type { ActivityRecord } from '@/types/activity'

function makeRecord(timestamp: number, power?: number): ActivityRecord {
  return { timestamp, power }
}

describe('calculateNormalizedPower', () => {
  it('恒功率序列：滑动平均恒等，NP 等于功率值', () => {
    // 8 个点、间隔 10 秒、功率恒 200W，所有满窗均值 = 200
    const records = Array.from({ length: 8 }, (_, i) => makeRecord(i * 10, 200))
    expect(calculateNormalizedPower(records)).toBeCloseTo(200, 10)
  })

  it('已知小数据集：满窗均值 [300]，NP = 300', () => {
    // 4 个点 t=0/10/20/30，跨度 30s 满足最低 30s 要求
    // 满窗仅 t=30 时刻（窗口 [0,30] 跨度 30s）：
    // t=0  → 跨度 0、< 30 → 不计入
    // t=10 → 跨度 10、< 30 → 不计入
    // t=20 → 跨度 20、< 30 → 不计入
    // t=30 → 跨度 30、≥ 30 → 计入（窗口均值 = (200+200+200+600)/4 = 300）
    // NP = 300
    const records = [
      makeRecord(0, 200),
      makeRecord(10, 200),
      makeRecord(20, 200),
      makeRecord(30, 600),
    ]
    expect(calculateNormalizedPower(records)).toBeCloseTo(300, 10)
  })

  it('满窗数据点足够：仅满窗的滑动平均计入 NP', () => {
    // 6 个点 t=0..50 间隔 10s，跨度 50s
    // 满窗：t=30 [0,30]、t=40 [10,40]、t=50 [20,50]（各 30s，含 4 个点）
    // 每个满窗均值 = (100+300+100+300)/4 = 200
    // NP = 200
    const records = [100, 300, 100, 300, 100, 300].map((power, i) => makeRecord(i * 10, power))
    expect(calculateNormalizedPower(records)).toBeCloseTo(200, 10)
  })

  it('缺失功率的记录被过滤，仅满窗计入 NP', () => {
    // 过滤后 3 个点 t=0/20/30，跨度 30s
    // 满窗：t=30 [0,30] = (100+200+300)/3 = 200
    // NP = 200
    const records = [
      makeRecord(0, 100),
      makeRecord(10),
      makeRecord(20, 200),
      makeRecord(30, 300),
    ]
    expect(calculateNormalizedPower(records)).toBeCloseTo(200, 10)
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
