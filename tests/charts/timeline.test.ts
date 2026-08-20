/**
 * 共享时间轴工具测试（findNearestByTimestamp / routePointAtTimestamp /
 * routePointAtLocation / haversineMeters / seriesPointAtTimestamp）。
 */
import { describe, expect, it } from 'vitest'
import {
  findNearestByTimestamp,
  haversineMeters,
  routePointAtLocation,
  routePointAtTimestamp,
  seriesPointAtTimestamp,
} from '@/charts/timeline'
import type { RoutePoint } from '@/types/activity'

/** 构造带时间戳的点列表（升序） */
function makePoints(): Array<{ timestamp: number; id: number }> {
  return [
    { timestamp: 0, id: 0 },
    { timestamp: 10, id: 1 },
    { timestamp: 30, id: 2 },
    { timestamp: 50, id: 3 },
  ]
}

describe('findNearestByTimestamp 时间戳最近点查找', () => {
  it('返回 timestamp 最接近目标的点', () => {
    const points = makePoints()
    expect(findNearestByTimestamp(points, 12)?.id).toBe(1)
    expect(findNearestByTimestamp(points, 25)?.id).toBe(2)
    expect(findNearestByTimestamp(points, 40)?.id).toBe(2)
  })

  it('端点边界：小于首个/大于末尾取端点', () => {
    const points = makePoints()
    expect(findNearestByTimestamp(points, -5)?.id).toBe(0)
    expect(findNearestByTimestamp(points, 999)?.id).toBe(3)
  })

  it('空列表返回 undefined', () => {
    expect(findNearestByTimestamp([], 10)).toBeUndefined()
  })

  it('单元素列表恒返回该元素', () => {
    expect(findNearestByTimestamp([{ timestamp: 7, id: 9 }], 100)?.id).toBe(9)
  })
})

describe('routePointAtTimestamp 悬停时间戳 → 轨迹点', () => {
  const points: RoutePoint[] = [
    { timestamp: 0, latitude: 31.2, longitude: 121.5 },
    { timestamp: 10, latitude: 31.201, longitude: 121.501 },
  ]

  it('按 timestamp 匹配最近轨迹点', () => {
    expect(routePointAtTimestamp(points, 8)?.timestamp).toBe(10)
    expect(routePointAtTimestamp(points, 3)?.timestamp).toBe(0)
  })

  it('无悬停时间戳返回 undefined', () => {
    expect(routePointAtTimestamp(points, undefined)).toBeUndefined()
  })

  it('空轨迹返回 undefined', () => {
    expect(routePointAtTimestamp([], 5)).toBeUndefined()
  })
})

describe('routePointAtLocation 地图悬停经纬度 → 轨迹点', () => {
  const points: RoutePoint[] = [
    { timestamp: 0, latitude: 31.2, longitude: 121.5 },
    { timestamp: 10, latitude: 31.201, longitude: 121.501 },
  ]

  it('匹配直线距离最近的轨迹点（在阈值内）', () => {
    // 悬停在第一点附近
    expect(routePointAtLocation(points, 31.2001, 121.5001)?.timestamp).toBe(0)
    // 悬停远离轨迹（>100m）不匹配
    expect(routePointAtLocation(points, 31.3, 121.6)).toBeUndefined()
  })

  it('空轨迹返回 undefined', () => {
    expect(routePointAtLocation([], 31.2, 121.5)).toBeUndefined()
  })
})

describe('haversineMeters 球面距离', () => {
  it('同点距离为 0', () => {
    expect(haversineMeters(31.2, 121.5, 31.2, 121.5)).toBe(0)
  })

  it('约 0.001 度纬度差 ≈ 111 米', () => {
    const distance = haversineMeters(31.2, 121.5, 31.201, 121.5)
    expect(distance).toBeGreaterThan(100)
    expect(distance).toBeLessThan(120)
  })
})

describe('seriesPointAtTimestamp 悬停时间戳 → 图表序列点', () => {
  const series = [
    { x: 0, y: 1, timestamp: 0 },
    { x: 100, y: 2, timestamp: 10 },
    { x: 200, y: 3, timestamp: 30 },
  ]

  it('匹配最近序列点', () => {
    expect(seriesPointAtTimestamp(series, 12)?.x).toBe(100)
  })

  it('无悬停返回 undefined', () => {
    expect(seriesPointAtTimestamp(series, undefined)).toBeUndefined()
  })

  it('空序列返回 undefined', () => {
    expect(seriesPointAtTimestamp([], 5)).toBeUndefined()
  })
})