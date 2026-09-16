/**
 * 路由常量与侧边导航清单的一致性（回归防护）。
 *
 * 2026-09-16 事故：App.tsx 用 ROUTES[下标] 引用路径，新增路由后整体错位，
 * 「路线图」打开训练计划页、「训练计划」打开表现趋势页。改为具名常量后，
 * 本测试守住「导航项指向的路由存在」与「标签 ↔ 路径不错配」两条底线。
 */
import { describe, expect, it } from 'vitest'
import { ALL_ROUTES, ROUTES } from '@/app/router'
import { NAV_ITEMS, TAB_ITEMS } from '@/layouts/navItems'

describe('路由路径常量', () => {
  it('关键路径字面量稳定（改动需同步导航与文档）', () => {
    expect(ROUTES.home).toBe('/')
    expect(ROUTES.activities).toBe('/activities')
    expect(ROUTES.activityDetail).toBe('/activities/:id')
    expect(ROUTES.segments).toBe('/segments')
    expect(ROUTES.segmentDetail).toBe('/segments/:id')
    expect(ROUTES.routesMap).toBe('/routes-map')
    expect(ROUTES.trainingPlan).toBe('/training-plan')
    expect(ROUTES.performance).toBe('/performance')
    expect(ROUTES.changelog).toBe('/changelog')
    expect(ROUTES.acknowledgments).toBe('/acknowledgments')
  })

  it('路径无重复、均为绝对路径', () => {
    expect(new Set(ALL_ROUTES).size).toBe(ALL_ROUTES.length)
    for (const path of ALL_ROUTES) {
      expect(path.startsWith('/')).toBe(true)
    }
  })
})

describe('侧边导航清单', () => {
  it('每个导航项都指向已定义的路由', () => {
    for (const item of NAV_ITEMS) {
      expect(ALL_ROUTES).toContain(item.to)
    }
  })

  it('标签与路径一一对应（防止整列错位）', () => {
    const labelToPath = new Map(NAV_ITEMS.map((item) => [item.label, item.to]))
    expect(labelToPath.get('仪表盘')).toBe(ROUTES.home)
    expect(labelToPath.get('骑行记录')).toBe(ROUTES.activities)
    expect(labelToPath.get('统计')).toBe(ROUTES.statistics)
    expect(labelToPath.get('日历')).toBe(ROUTES.calendar)
    expect(labelToPath.get('热力图')).toBe(ROUTES.heatmap)
    expect(labelToPath.get('路线图')).toBe(ROUTES.routesMap)
    expect(labelToPath.get('年度回顾')).toBe(ROUTES.yearReview)
    expect(labelToPath.get('赛段')).toBe(ROUTES.segments)
    expect(labelToPath.get('训练计划')).toBe(ROUTES.trainingPlan)
    expect(labelToPath.get('表现趋势')).toBe(ROUTES.performance)
    expect(labelToPath.get('更多')).toBe(ROUTES.settings)
  })

  it('移动端底部 TabBar 高频页同样指向已定义的路由', () => {
    expect(TAB_ITEMS).toHaveLength(4)
    for (const item of TAB_ITEMS) {
      expect(ALL_ROUTES).toContain(item.to)
    }
    expect(TAB_ITEMS.at(-1)?.to).toBe(ROUTES.routesMap)
  })
})
