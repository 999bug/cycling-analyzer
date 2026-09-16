/**
 * 应用路由路径常量（具名，供导航组件与链接复用）。
 *
 * 2026-09-16：原为数组 + `ROUTES[n]` 下标引用，中间插入新路由会让后续映射
 * 整体错位（'/routes-map' 渲染出训练计划页、'/training-plan' 渲染出表现趋势页）。
 * 改为具名常量对象后，新增/插入路由不再影响既有映射。
 */
export const ROUTES = {
  home: '/',
  activities: '/activities',
  activityDetail: '/activities/:id',
  statistics: '/statistics',
  calendar: '/calendar',
  settings: '/settings',
  heatmap: '/heatmap',
  yearReview: '/year-review',
  segments: '/segments',
  segmentDetail: '/segments/:id',
  routesMap: '/routes-map',
  trainingPlan: '/training-plan',
  performance: '/performance',
  changelog: '/changelog',
  acknowledgments: '/acknowledgments',
} as const

/** 全部路由路径（供文档核对与测试断言去重） */
export const ALL_ROUTES: readonly string[] = Object.values(ROUTES)
