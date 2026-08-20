/**
 * 轨迹纠偏测试（规格 §39 轨迹纠偏）。
 *
 * 验证：识别两侧瞬时速度均超阈值的飞点并剔除、保留首末点、
 * 无坐标点不参与判定、无飞点时原样返回、空/单点/两点边界、
 * 真实高速段（单侧快）不被误删。
 */
import { describe, expect, it } from 'vitest'
import type { ActivityRecord } from '@/types/activity'
import {
  cleanTrackDrift,
  DRIFT_SPEED_THRESHOLD_MPS,
} from '@/features/activity/trackCleanup'

/**
 * 构造带坐标的逐点记录。
 *
 * @param index 序号（时间 = 基准 + index × 5s，默认 5s 间隔）
 * @param latitude 纬度
 * @param longitude 经度
 * @param overrides 覆盖字段
 */
function makeRecord(
  index: number,
  latitude: number,
  longitude: number,
  overrides: Partial<ActivityRecord> = {},
): ActivityRecord {
  return {
    timestamp: 1735689600 + index * 5,
    latitude,
    longitude,
    altitude: 100,
    ...overrides,
  } as ActivityRecord
}

describe('cleanTrackDrift', () => {
  it('空输入原样返回', () => {
    expect(cleanTrackDrift([])).toEqual({ cleaned: [], removedCount: 0 })
  })

  it('单点/两点不清理', () => {
    const one = [makeRecord(0, 39.9, 116.4)]
    expect(cleanTrackDrift(one)).toEqual({ cleaned: one, removedCount: 0 })

    const two = [makeRecord(0, 39.9, 116.4), makeRecord(1, 39.9, 116.41)]
    expect(cleanTrackDrift(two)).toEqual({ cleaned: two, removedCount: 0 })
  })

  it('两侧瞬时速度均超阈值的飞点被剔除，首末点保留', () => {
    // 直线点列：a-b 正常，b 跳到 c（远），c 跳回 d：b-c 与 c-d 均超速
    const records = [
      makeRecord(0, 39.9, 116.4),
      makeRecord(1, 39.9, 116.401),
      // 飞点：距前后点各约 1 个纬度（~111km），5s 内瞬时速度远超阈值
      makeRecord(2, 40.9, 116.4),
      makeRecord(3, 39.9, 116.402),
      makeRecord(4, 39.9, 116.403),
    ]

    const result = cleanTrackDrift(records)
    expect(result.removedCount).toBe(1)
    expect(result.cleaned.map((r) => r.timestamp)).toEqual([
      records[0].timestamp,
      records[1].timestamp,
      records[3].timestamp,
      records[4].timestamp,
    ])
  })

  it('单侧超速（真实快速段）不误删', () => {
    // b→c 超速（快速移动）但 c→d 正常（c 紧邻 d）：非飞点，整体保留
    const records = [
      makeRecord(0, 39.9, 116.4),
      makeRecord(1, 39.9, 116.401),
      makeRecord(2, 40.9, 116.4),
      makeRecord(3, 40.9001, 116.4001),
    ]

    const result = cleanTrackDrift(records)
    expect(result.removedCount).toBe(0)
    expect(result.cleaned).toHaveLength(4)
  })

  it('无坐标点不参与判定且保留', () => {
    const records = [
      makeRecord(0, 39.9, 116.4),
      { timestamp: 1735689610, latitude: undefined, longitude: undefined } as ActivityRecord,
      makeRecord(2, 39.9, 116.402),
    ]

    const result = cleanTrackDrift(records)
    expect(result.removedCount).toBe(0)
    expect(result.cleaned).toHaveLength(3)
  })

  it('时间不递增的段不参与判定', () => {
    const records = [
      makeRecord(0, 39.9, 116.4),
      { ...makeRecord(1, 39.9, 116.401), timestamp: 1735689600 },
      makeRecord(2, 39.9, 116.402),
    ]

    const result = cleanTrackDrift(records)
    expect(result.removedCount).toBe(0)
  })

  it('阈值可配置：低于默认阈值的飞点不剔除', () => {
    // 跳跃距离 ~1 个纬度 / 10s → 速度约 11100 m/s > 默认阈值，但用极小阈值验证可配置性
    const records = [
      makeRecord(0, 39.9, 116.4),
      makeRecord(5, 39.91, 116.4),
      makeRecord(10, 39.9, 116.401),
    ]

    // 默认阈值下 11m/5s ≈ 2.2 m/s 不触发
    expect(cleanTrackDrift(records).removedCount).toBe(0)
    // 调低阈值后触发
    expect(cleanTrackDrift(records, 2).removedCount).toBe(1)
  })

  it('默认阈值已导出（50 m/s）', () => {
    expect(DRIFT_SPEED_THRESHOLD_MPS).toBe(50)
  })
})