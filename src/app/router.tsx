/**
 * 应用路由路径常量。
 * 供导航组件与链接复用，避免路径字符串散落各处。
 */
export const ROUTES = [
  '/',
  '/activities',
  '/activities/:id',
  '/statistics',
  '/calendar',
  '/settings',
  '/heatmap',
  '/year-review',
  '/segments',
  '/routes-map',
  '/training-plan',
  '/performance',
] as const
