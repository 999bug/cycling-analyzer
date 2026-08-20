/**
 * 骑行质量评分测试（computeQualityScore）。
 *
 * 构造稳定/波动/掉速/爬坡等场景的逐点记录，验证综合分、
 * 各分项得分、缺失数据跳过、总体评价文案。
 */
import { describe, expect, it } from 'vitest'
import type { ActivityRecord } from '@/types/activity'
import { computeQualityScore } from '@/features/analysis/qualityScore'

/**
 * 构造逐点记录。
 *
 * @param specs [距离, 海拔, 速度m/s, 功率W, 心率bpm] 元组
 * @param stepSeconds 相邻点时间间隔（秒）
 */
function makeRecords(
  specs: Array<[number, number, number, number, number]>,
  stepSeconds = 10,
): ActivityRecord[] {
  return specs.map(([distance, altitude, speed, power, heartRate], index) => ({
    timestamp: index * stepSeconds,
    latitude: 31.2 + index * 0.0001,
    longitude: 121.5 + index * 0.0001,
    distance,
    altitude,
    speed,
    power,
    heartRate,
  }))
}

describe('computeQualityScore 综合评分', () => {
  it('稳定匀速输出得高分（配速/心率/功率波动极小）', () => {
    // 30 个点：速度 8、功率 200、心率 150 恒定，前后半程速度一致
    const records = makeRecords(
      Array.from({ length: 30 }, (_, index) => [
        index * 100,
        100,
        8,
        200,
        150,
      ] as [number, number, number, number, number]),
    )
    const result = computeQualityScore(records)

    // 配速/心率/功率波动为 0 → 100；后程比 1 → 100；无爬坡 → 爬坡表现 undefined
    const byKey = Object.fromEntries(result.subScores.map((item) => [item.key, item.score]))
    expect(byKey.paceStability).toBe(100)
    expect(byKey.heartRateControl).toBe(100)
    expect(byKey.powerStability).toBe(100)
    expect(byKey.climbPerformance).toBeUndefined()
    expect(byKey.endurance).toBe(100)
    expect(result.overall).toBe(100)
    expect(result.verdict).toContain('状态出色')
  })

  it('速度波动大时配速稳定性低分', () => {
    // 30 个点速度在 2~14 间大幅摆动（均值 8，CV≈0.6 → 0 分）
    const records = makeRecords(
      Array.from({ length: 30 }, (_, index) => [
        index * 100,
        100,
        index % 2 === 0 ? 14 : 2,
        200,
        150,
      ] as [number, number, number, number, number]),
    )
    const result = computeQualityScore(records)

    const pace = result.subScores.find((item) => item.key === 'paceStability')
    expect(pace?.score).toBe(0)
  })

  it('后程掉速明显时后程状态低分', () => {
    // 前半程速度 8，后半程速度 3（比 0.375 ≤ 0.4 → 0 分）
    const records = makeRecords([
      ...[0, 500, 1000, 1500, 2000].map((d) => [d, 100, 8, 200, 150] as [number, number, number, number, number]),
      ...[2500, 3000, 3500, 4000, 4500].map((d) => [d, 100, 3, 200, 150] as [number, number, number, number, number]),
    ])
    const result = computeQualityScore(records)

    const endurance = result.subScores.find((item) => item.key === 'endurance')
    expect(endurance?.score).toBe(0)
  })

  it('爬坡保持功率时爬坡表现高分', () => {
    // 全程均功率 200；爬坡段（1000-2000）均功率 240（比 1.2 → 100 分）
    const records = makeRecords([
      [0, 100, 8, 200, 150],
      [500, 100, 8, 200, 150],
      [1000, 100, 8, 200, 150],
      [1250, 125, 4, 240, 160],
      [1500, 150, 4, 240, 160],
      [1750, 175, 4, 240, 160],
      [2000, 200, 4, 240, 160],
      [2500, 200, 8, 200, 150],
      [3000, 200, 8, 200, 150],
    ])
    const result = computeQualityScore(records)

    const climbPerf = result.subScores.find((item) => item.key === 'climbPerformance')
    expect(climbPerf?.score).toBe(100)
  })

  it('无任何指标数据时综合评分 undefined', () => {
    const records: ActivityRecord[] = Array.from({ length: 20 }, (_, index) => ({
      timestamp: index * 10,
      latitude: 31.2,
      longitude: 121.5,
      distance: index * 100,
      altitude: 100,
    }))
    const result = computeQualityScore(records)

    expect(result.overall).toBeUndefined()
    expect(result.verdict).toBeUndefined()
    expect(result.subScores.every((item) => item.score === undefined)).toBe(true)
  })

  it('样本数不足时变异系数类分项为 undefined（不伪造评分）', () => {
    // 仅 5 个点（少于最小样本 10）
    const records = makeRecords([
      [0, 100, 8, 200, 150],
      [100, 100, 8, 200, 150],
      [200, 100, 8, 200, 150],
      [300, 100, 8, 200, 150],
      [400, 100, 8, 200, 150],
    ])
    const result = computeQualityScore(records)

    expect(result.subScores.find((item) => item.key === 'paceStability')?.score).toBeUndefined()
    expect(result.subScores.find((item) => item.key === 'heartRateControl')?.score).toBeUndefined()
    expect(result.subScores.find((item) => item.key === 'powerStability')?.score).toBeUndefined()
  })

  it('无爬坡段时爬坡表现分项为 undefined', () => {
    const records = makeRecords([
      [0, 100, 8, 200, 150],
      [500, 100, 8, 200, 150],
      [1000, 100, 8, 200, 150],
      [1500, 100, 8, 200, 150],
      [2000, 100, 8, 200, 150],
    ])
    const result = computeQualityScore(records)

    expect(result.subScores.find((item) => item.key === 'climbPerformance')?.score).toBeUndefined()
  })

  it('缺功率数据时功率稳定性与爬坡表现分项为 undefined，其余照常', () => {
    const records: ActivityRecord[] = Array.from({ length: 20 }, (_, index) => ({
      timestamp: index * 10,
      latitude: 31.2,
      longitude: 121.5,
      distance: index * 100,
      altitude: 100,
      speed: 8,
      heartRate: 150,
    }))
    const result = computeQualityScore(records)

    expect(result.subScores.find((item) => item.key === 'powerStability')?.score).toBeUndefined()
    expect(result.subScores.find((item) => item.key === 'climbPerformance')?.score).toBeUndefined()
    expect(result.subScores.find((item) => item.key === 'paceStability')?.score).toBe(100)
    expect(result.overall).not.toBeUndefined()
  })

  it('综合评分取有效分项平均', () => {
    // 配速/心率/功率稳定(100) + 后程稳定(100)；无爬坡 → 平均 100
    const records = makeRecords(
      Array.from({ length: 20 }, (_, index) => [
        index * 100,
        100,
        8,
        200,
        150,
      ] as [number, number, number, number, number]),
    )
    const result = computeQualityScore(records)

    expect(result.overall).toBe(100)
  })

  it('部分指标缺失时综合评分仅按有效分项平均', () => {
    // 速度恒定(100)、心率缺失、功率缺失 → 仅配速/后程 → 平均 100
    const records: ActivityRecord[] = Array.from({ length: 20 }, (_, index) => ({
      timestamp: index * 10,
      latitude: 31.2,
      longitude: 121.5,
      distance: index * 100,
      altitude: 100,
      speed: 8,
    }))
    const result = computeQualityScore(records)

    expect(result.subScores.filter((item) => item.score !== undefined).length).toBe(2)
    expect(result.overall).toBe(100)
  })
})