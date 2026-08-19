/**
 * 爬坡分析测试。
 *
 * buildClimbs：从逐点记录识别爬坡段（连续爬升累计 ≥ 30m 且平均坡度 ≥ 1.5%），
 * 输出段距离/爬升/平均坡度/最大坡度；下坡或缺失海拔断开段。
 */
import { describe, expect, it } from 'vitest'
import { buildClimbs } from '@/features/activity/climbs'
import type { ActivityRecord } from '@/types/activity'

/**
 * 构造逐点记录。
 *
 * @param items [timestamp, altitude, distance] 三元组
 */
function makeRecords(items: Array<[number, number, number]>): ActivityRecord[] {
  return items.map(([timestamp, altitude, distance]) => ({ timestamp, altitude, distance }))
}

describe('buildClimbs 爬坡分析', () => {
  it('平路无爬坡返回空数组', () => {
    const records = makeRecords([
      [0, 10, 0],
      [10, 10, 100],
      [20, 10, 200],
    ])
    expect(buildClimbs(records)).toEqual([])
  })

  it('连续爬升识别为一个爬坡（爬升/坡度/距离正确）', () => {
    // 1000m 距离爬升 40m → 平均坡度 4%
    const records = makeRecords([
      [0, 100, 0],
      [100, 110, 250],
      [200, 120, 500],
      [300, 130, 750],
      [400, 140, 1000],
    ])
    const climbs = buildClimbs(records)

    expect(climbs).toHaveLength(1)
    expect(climbs[0].distanceMeters).toBeCloseTo(1000, 0)
    expect(climbs[0].elevationGain).toBeCloseTo(40, 0)
    expect(climbs[0].avgGradePercent).toBeCloseTo(4, 0)
  })

  it('爬升不足 30 米不算爬坡', () => {
    // 500m 爬升 10m → 坡度 2% 但爬升不足
    const records = makeRecords([
      [0, 100, 0],
      [100, 102.5, 250],
      [200, 105, 500],
    ])
    expect(buildClimbs(records)).toEqual([])
  })

  it('下坡断开段：两个独立爬坡', () => {
    // 爬 40m → 下 30m → 再爬 40m
    const records = makeRecords([
      [0, 100, 0],
      [100, 120, 500],
      [200, 140, 1000],
      [300, 120, 1300],
      [400, 110, 1500],
      [500, 130, 2000],
      [600, 150, 2500],
    ])
    const climbs = buildClimbs(records)

    expect(climbs).toHaveLength(2)
    expect(climbs[0].elevationGain).toBeCloseTo(40, 0)
    expect(climbs[1].elevationGain).toBeCloseTo(40, 0)
  })

  it('缺失海拔的段内点跳过（不产生假爬升）', () => {
    const records = makeRecords([
      [0, 100, 0],
      [100, 130, 500], // 先涨 30
      [200, 130, 600], // 海拔缺失前的平台
    ])
    records[1] = { timestamp: 100, distance: 500 } // 海拔缺失
    // 实际只有 0→? 无法判断：缺失点断开
    const climbs = buildClimbs(records)
    expect(climbs).toEqual([])
  })

  it('最大坡度为段内相邻点最大坡度', () => {
    // 相邻坡度：5%、5%、1.67%、3.33%、7.5%（末段 15m/200m）→ 最大 7.5%
    const records = makeRecords([
      [0, 100, 0],
      [100, 105, 100],
      [200, 110, 200],
      [300, 115, 500],
      [400, 125, 800],
      [500, 140, 1000],
    ])
    const climbs = buildClimbs(records)

    expect(climbs).toHaveLength(1)
    expect(climbs[0].maxGradePercent).toBeCloseTo(7.5, 0)
  })
})
