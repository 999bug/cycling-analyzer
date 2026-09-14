/**
 * 赛段穿越窗口指标计算测试。
 *
 * 覆盖：均速（GPS 路径距离 / 用时）、均功率 / 均心率（有值记录的算术平均）、
 * 缺失字段 = undefined ≠ 0 的口径，以及与 matchSegmentEffortDetail 窗口的端到端配合。
 */
import { describe, expect, it } from 'vitest'
import { computeEffortMetrics } from '@/features/segments/effortMetrics'
import { matchSegmentEffortDetail } from '@/features/segments/segmentMatching'
import type { ActivityRecord } from '@/types/activity'

/** 与 segmentRepository/segmentsPage 测试一致的赛段几何 */
const SEGMENT = {
  startLatitude: 31.2,
  startLongitude: 121.5,
  endLatitude: 31.3,
  endLongitude: 121.6,
}

/** 起终点圆连线方向的轨迹点（每秒一个点，100s 走完） */
function makeTrackRecords(): ActivityRecord[] {
  const records: ActivityRecord[] = []
  for (let i = 0; i <= 100; i += 1) {
    records.push({
      timestamp: i,
      latitude: 31.2 + (0.1 * i) / 100,
      longitude: 121.5 + (0.1 * i) / 100,
      // 前 60 秒功率 200W，后 40 秒 300W → 窗口内均值可手算
      power: i <= 60 ? 200 : 300,
      heartRate: i <= 60 ? 150 : 170,
    })
  }
  return records
}

describe('computeEffortMetrics', () => {
  it('窗口内均功率/均心率为有值记录的算术平均', () => {
    // 窗口 [10, 60]：功率 200W × 51 点，心率 150 × 51 点（timestamp 边界含两端）
    const metrics = computeEffortMetrics(makeTrackRecords(), 10, 60)
    expect(metrics.avgPower).toBe(200)
    expect(metrics.avgHeartRate).toBe(150)
  })

  it('窗口跨越功率分段时取窗口内实际平均', () => {
    // 窗口 [60, 100]：60s 为 200W（1 点），61-100 为 300W（40 点）
    const metrics = computeEffortMetrics(makeTrackRecords(), 60, 100)
    expect(metrics.avgPower).toBeCloseTo((200 * 1 + 300 * 40) / 41, 5)
    expect(metrics.avgHeartRate).toBeCloseTo((150 * 1 + 170 * 40) / 41, 5)
  })

  it('窗口内无传感器数据时功率/心率为 undefined（缺失 ≠ 0）', () => {
    const records: ActivityRecord[] = [
      { timestamp: 0, latitude: 31.2, longitude: 121.5 },
      { timestamp: 10, latitude: 31.21, longitude: 121.51 },
    ]
    const metrics = computeEffortMetrics(records, 0, 10)
    expect(metrics.avgPower).toBeUndefined()
    expect(metrics.avgHeartRate).toBeUndefined()
  })

  it('均速 = 窗口内 GPS 路径距离 / 用时', () => {
    // 轨迹沿起终点连线匀速行进：100 秒走完 0.1° 纬度 + 0.1° 经度的连线
    // （0.1° 纬度 ≈ 11.1 km，0.1° 经度 @31.2° ≈ 9.5 km，路径 ≈ 14.6 km）
    const metrics = computeEffortMetrics(makeTrackRecords(), 0, 100)
    expect(metrics.avgSpeed).toBeGreaterThan(130)
    expect(metrics.avgSpeed!).toBeLessThan(160)
  })

  it('无 GPS 数据时均速为 undefined', () => {
    const records: ActivityRecord[] = [
      { timestamp: 0, power: 200 },
      { timestamp: 10, power: 210 },
    ]
    const metrics = computeEffortMetrics(records, 0, 10)
    expect(metrics.avgSpeed).toBeUndefined()
    // 窗口含两端：功率均值 = (200 + 210) / 2
    expect(metrics.avgPower).toBe(205)
  })

  it('与 matchSegmentEffortDetail 窗口端到端：指标只落在穿越窗口内', () => {
    const records = makeTrackRecords()
    // 起终点圆半径 200m：首点在起点圆内（圈内停留刷新计时起点），
    // 末点前 1 秒（i=99）已进入终点圆 → 完赛点 timestamp = 99
    const match = matchSegmentEffortDetail(SEGMENT, records)
    expect(match).toBeDefined()
    expect(match!.endTimestamp).toBe(99)
    expect(match!.durationSeconds).toBe(99 - 1)
    const metrics = computeEffortMetrics(records, match!.startTimestamp, match!.endTimestamp)
    expect(metrics.avgPower).toBeDefined()
    expect(metrics.avgHeartRate).toBeDefined()
  })
})
