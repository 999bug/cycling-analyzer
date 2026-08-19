/**
 * 路线总览地图数据构建测试。
 *
 * - routeColor：黄金角色相分布（确定性、前 12 色互异、HSL 格式）；
 * - buildRouteMapRoutes：路线分组 + 活动轨迹映射 → 地图数据（名称回退/轨迹过滤/顺序）。
 */
import { describe, expect, it } from 'vitest'
import { buildRouteMapRoutes, routeColor } from '@/features/routes/routeMap'
import type { RouteGroup } from '@/features/routes/routeGrouping'

/** 构造一条路线分组（2 次骑行） */
function makeGroup(idPrefix: string, overrides: Partial<RouteGroup> = {}): RouteGroup {
  return {
    activities: [
      { id: `${idPrefix}-1`, startTime: '2026-08-01T08:00:00', distance: 20000, duration: 3600 },
      { id: `${idPrefix}-2`, startTime: '2026-08-02T08:00:00', distance: 21000, duration: 3800 },
    ],
    count: 2,
    avgDistance: 20500,
    bestDuration: 3600,
    lastRideTime: '2026-08-02T08:00:00',
    lastActivityId: `${idPrefix}-2`,
    ...overrides,
  }
}

describe('routeColor 路线配色', () => {
  it('同索引颜色确定', () => {
    expect(routeColor(3)).toBe(routeColor(3))
  })

  it('前 12 条路线颜色互不相同（黄金角均匀分布）', () => {
    const colors = Array.from({ length: 12 }, (_, index) => routeColor(index))
    expect(new Set(colors).size).toBe(12)
  })

  it('输出现代 CSS hsl 格式（亮度 42% 浅色瓦片上醒目）', () => {
    expect(routeColor(0)).toMatch(/^hsl\(\d+ 70% 42%\)$/)
  })
})

describe('buildRouteMapRoutes 路线地图数据', () => {
  it('按分组顺序输出路线（名称/次数/颜色/索引）', () => {
    const groups = [makeGroup('a', { lastActivityName: '机场东路' }), makeGroup('b')]
    const trackById = new Map<string, [number, number][]>([
      ['a-1', [[31.2, 121.5]]],
      ['a-2', [[31.21, 121.51]]],
      ['b-1', [[40.1, 116.3]]],
      ['b-2', [[40.11, 116.31]]],
    ])

    const routes = buildRouteMapRoutes(groups, trackById)

    expect(routes).toHaveLength(2)
    expect(routes[0].index).toBe(0)
    expect(routes[0].name).toBe('机场东路')
    expect(routes[0].count).toBe(2)
    expect(routes[0].color).toBe(routeColor(0))
    expect(routes[0].tracks).toEqual([[[31.2, 121.5]], [[31.21, 121.51]]])
    expect(routes[1].name).toBe('路线 2')
    expect(routes[1].lastActivityId).toBe('b-2')
  })

  it('无轨迹映射的活动跳过（缺失轨迹不产出空折线）', () => {
    const groups = [makeGroup('a')]
    const trackById = new Map<string, [number, number][]>([['a-1', [[31.2, 121.5]]]]) // a-2 无轨迹

    const routes = buildRouteMapRoutes(groups, trackById)

    expect(routes[0].tracks).toEqual([[[31.2, 121.5]]])
  })

  it('组内全部轨迹缺失时整条路线跳过', () => {
    const groups = [makeGroup('a')]
    const routes = buildRouteMapRoutes(groups, new Map())

    expect(routes).toEqual([])
  })

  it('空分组输出空数组', () => {
    expect(buildRouteMapRoutes([], new Map())).toEqual([])
  })
})
