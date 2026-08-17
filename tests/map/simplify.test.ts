/**
 * 轨迹抽稀测试（规格 §12）：Douglas-Peucker 正确性。
 * 覆盖：空数组、全同点、直线抽稀、折线拐点保留、无坐标过滤。
 */
import { describe, expect, it } from 'vitest'
import type { ActivityRecord } from '@/types/activity'
import { simplifyRoute } from '@/map/simplify'

/**
 * 构造逐点记录。
 *
 * @param latitude 纬度
 * @param longitude 经度
 * @param timestamp 时间（Unix 秒）
 */
function makeRecord(latitude: number, longitude: number, timestamp: number): ActivityRecord {
  return { timestamp, latitude, longitude }
}

describe('simplifyRoute', () => {
  it('空数组返回空数组', () => {
    expect(simplifyRoute([], 10)).toEqual([])
  })

  it('不足 2 点直接原样返回', () => {
    const single = [makeRecord(39.9, 116.4, 1)]
    expect(simplifyRoute(single, 10)).toHaveLength(1)
    const two = [makeRecord(39.9, 116.4, 1), makeRecord(39.91, 116.41, 2)]
    expect(simplifyRoute(two, 10)).toHaveLength(2)
  })

  it('全同点抽稀后仅保留首尾', () => {
    const points = [1, 2, 3, 4, 5].map((t) => makeRecord(39.9, 116.4, t))
    const result = simplifyRoute(points, 1)
    expect(result).toHaveLength(2)
    expect(result[0].latitude).toBe(39.9)
    expect(result[1].longitude).toBe(116.4)
  })

  it('直线轨迹按大阈值抽稀为仅首尾两点，且顺序保持', () => {
    // 同纬度正东方向 10 点（完全共线）
    const points = Array.from({ length: 10 }, (_, i) =>
      makeRecord(39.9, 116.4 + i * 0.005, i + 1),
    )
    const result = simplifyRoute(points, 50)
    expect(result.map((p) => p.timestamp)).toEqual([1, 10])
  })

  it('折线抽稀保留所有凸出拐点', () => {
    // 锯齿形折线：拐点相对基线东西偏差约 30 米（0.02° 经度），远大于 10 米阈值
    const points = [
      makeRecord(39.9, 116.4, 1), // 起点
      makeRecord(39.905, 116.42, 2), // 拐点（东偏）
      makeRecord(39.91, 116.4, 3), // 拐点（西偏）
      makeRecord(39.915, 116.42, 4), // 拐点（东偏）
      makeRecord(39.92, 116.4, 5), // 终点
    ]
    const result = simplifyRoute(points, 10)
    expect(result.map((p) => p.timestamp)).toEqual([1, 2, 3, 4, 5])
  })

  it('无坐标的逐点记录被剔除', () => {
    const points: ActivityRecord[] = [
      { timestamp: 1, latitude: 39.9, longitude: 116.4 },
      { timestamp: 2 }, // 无坐标
      { timestamp: 3, latitude: 39.91, longitude: 116.4 },
    ]
    const result = simplifyRoute(points, 10)
    expect(result).toHaveLength(2)
    expect(result.every((p) => p.latitude !== undefined && p.longitude !== undefined)).toBe(true)
  })

  it('抽稀保留全部超出阈值的起伏点', () => {
    // 每点都相对前段大幅偏移，小阈值下所有点都应保留
    const points = [
      makeRecord(39.9, 116.4, 1),
      makeRecord(39.9, 116.5, 2),
      makeRecord(39.91, 116.4, 3),
      makeRecord(39.91, 116.5, 4),
    ]
    const result = simplifyRoute(points, 10)
    expect(result).toHaveLength(4)
  })
})
