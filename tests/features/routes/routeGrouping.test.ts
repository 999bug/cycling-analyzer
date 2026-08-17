/**
 * 路线分组纯函数测试（规格 §39）。
 *
 * 验证起终点 proximity + 距离相似度聚类：同路线归组、端点超阈值分组、
 * 距离差异过大分组、无坐标活动跳过、结果按次数/最近骑行排序。
 */
import { describe, expect, it } from 'vitest'
import {
  ROUTE_DISTANCE_TOLERANCE,
  ROUTE_PROXIMITY_METERS,
  buildRouteGroups,
  extractEndpoints,
  haversineMeters,
  type RouteActivityInput,
} from '@/features/routes/routeGrouping'

/** 路线 A 起点（上海一带） */
const A_START = { latitude: 31.2, longitude: 121.5 }

/** 路线 A 终点 */
const A_END = { latitude: 31.3, longitude: 121.6 }

/** 路线 B 起点（杭州一带，距 A 起终点远超 500m） */
const B_START = { latitude: 30.2, longitude: 120.1 }

/** 路线 B 终点 */
const B_END = { latitude: 30.3, longitude: 120.2 }

/**
 * 构造分组输入。
 *
 * @param id 活动 ID
 * @param startTime 开始时间（ISO 8601）
 * @param distance 距离（米）
 * @param duration 时长（秒）
 * @param start 起点坐标（可缺省）
 * @param end 终点坐标（可缺省）
 */
function makeInput(
  id: string,
  startTime: string,
  distance: number,
  duration: number,
  start?: RouteActivityInput['start'],
  end?: RouteActivityInput['end'],
): RouteActivityInput {
  return { id, startTime, distance, duration, start, end }
}

describe('haversineMeters', () => {
  it('纬度 0.001 度约 111 米', () => {
    const a = { latitude: 31.2, longitude: 121.5 }
    const b = { latitude: 31.201, longitude: 121.5 }
    expect(haversineMeters(a, b)).toBeGreaterThan(100)
    expect(haversineMeters(a, b)).toBeLessThan(120)
  })

  it('同一点距离为 0', () => {
    expect(haversineMeters(A_START, A_START)).toBe(0)
  })
})

describe('buildRouteGroups', () => {
  it('起终点相近且距离相似的活动归为一组', () => {
    const groups = buildRouteGroups([
      makeInput('a1', '2026-08-01T08:00:00Z', 30000, 3600, A_START, A_END),
      // 起点漂移约 100m、终点漂移约 100m、距离 +5%：仍属同一路线
      makeInput('a2', '2026-08-03T08:00:00Z', 31500, 3500, { latitude: 31.2008, longitude: 121.5005 }, { latitude: 31.3009, longitude: 121.6 }),
      makeInput('a3', '2026-08-05T08:00:00Z', 29500, 3700, A_START, A_END),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(3)
    expect(groups[0].avgDistance).toBeCloseTo(30333, 0)
    expect(groups[0].bestDuration).toBe(3500)
    expect(groups[0].lastRideTime).toBe('2026-08-05T08:00:00Z')
    expect(groups[0].lastActivityId).toBe('a3')
  })

  it('起点或终点超阈值的活动分为不同组', () => {
    const groups = buildRouteGroups([
      makeInput('a1', '2026-08-01T08:00:00Z', 30000, 3600, A_START, A_END),
      makeInput('b1', '2026-08-02T08:00:00Z', 30000, 3400, B_START, B_END),
      // 起点同 A、终点不同：不同路线
      makeInput('c1', '2026-08-03T08:00:00Z', 30000, 3200, A_START, { latitude: 31.35, longitude: 121.65 }),
    ])

    expect(groups).toHaveLength(3)
  })

  it('端点相同但距离差异超过容差的活动分为不同组', () => {
    const groups = buildRouteGroups([
      makeInput('a1', '2026-08-01T08:00:00Z', 30000, 3600, A_START, A_END),
      // 同起终点但距离翻倍（绕行）：不同路线
      makeInput('a2', '2026-08-02T08:00:00Z', 60000, 7200, A_START, A_END),
    ])

    expect(groups).toHaveLength(2)
  })

  it('起点超阈值后新建组，相近活动归入各自路线', () => {
    const groups = buildRouteGroups([
      makeInput('a1', '2026-08-01T08:00:00Z', 30000, 3600, A_START, A_END),
      makeInput('b1', '2026-08-02T08:00:00Z', 20000, 2400, B_START, B_END),
      makeInput('a2', '2026-08-03T08:00:00Z', 30500, 3550, A_START, A_END),
      makeInput('b2', '2026-08-04T08:00:00Z', 20100, 2450, B_START, B_END),
    ])

    // 两条路线各 2 次；次数相同按最近骑行降序（B 路线 08-04 在前）
    expect(groups).toHaveLength(2)
    expect(groups[0].count).toBe(2)
    expect(groups[0].lastRideTime).toBe('2026-08-04T08:00:00Z')
    expect(groups[1].lastRideTime).toBe('2026-08-03T08:00:00Z')
  })

  it('无坐标活动不参与分组', () => {
    const groups = buildRouteGroups([
      makeInput('a1', '2026-08-01T08:00:00Z', 30000, 3600, A_START, A_END),
      makeInput('indoor', '2026-08-02T08:00:00Z', 30000, 3600),
      makeInput('half', '2026-08-03T08:00:00Z', 30000, 3600, A_START, undefined),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(1)
  })

  it('空输入返回空数组', () => {
    expect(buildRouteGroups([])).toEqual([])
  })

  it('结果按骑行次数降序排列', () => {
    const groups = buildRouteGroups([
      makeInput('a1', '2026-08-01T08:00:00Z', 30000, 3600, A_START, A_END),
      makeInput('b1', '2026-08-02T08:00:00Z', 20000, 2400, B_START, B_END),
      makeInput('b2', '2026-08-03T08:00:00Z', 20500, 2500, B_START, B_END),
      makeInput('b3', '2026-08-04T08:00:00Z', 19800, 2300, B_START, B_END),
    ])

    expect(groups[0].count).toBe(3)
    expect(groups[1].count).toBe(1)
  })

  it('阈值常量口径：500 米 / ±10%', () => {
    expect(ROUTE_PROXIMITY_METERS).toBe(500)
    expect(ROUTE_DISTANCE_TOLERANCE).toBe(0.1)
  })
})

describe('extractEndpoints（性能优化：合并扫描用）', () => {
  it('提取首尾坐标点，跳过无坐标记录', () => {
    const endpoints = extractEndpoints([
      { timestamp: 0 },
      { timestamp: 1, latitude: 31.2, longitude: 121.5 },
      { timestamp: 2, latitude: 31.25, longitude: 121.55 },
      { timestamp: 3, latitude: 31.3, longitude: 121.6 },
      { timestamp: 4 },
    ])
    expect(endpoints).toEqual({
      start: { latitude: 31.2, longitude: 121.5 },
      end: { latitude: 31.3, longitude: 121.6 },
    })
  })

  it('无坐标记录返回 undefined', () => {
    expect(extractEndpoints([{ timestamp: 0 }])).toBeUndefined()
    expect(extractEndpoints([])).toBeUndefined()
  })
})
