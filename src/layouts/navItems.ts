/**
 * 侧边栏导航清单（独立模块：react-refresh 要求组件文件只导出组件）。
 *
 * 路径全部取自 ROUTES 具名常量，避免与路由表形成两份手工同步清单
 * （2026-09-16 前正是两份清单 + 下标引用导致「路线图」打开训练计划页）。
 */
import { ROUTES } from '@/app/router'

/** 导航项：路径、中文名称；end 仅对根路径生效，避免其他路径命中所有链接 */
export interface NavItem {
  to: string
  label: string
  end?: boolean
}

/** 侧边栏全部导航项（数组顺序 = 展示顺序） */
export const NAV_ITEMS: NavItem[] = [
  { to: ROUTES.home, label: '仪表盘', end: true },
  { to: ROUTES.activities, label: '骑行记录' },
  { to: ROUTES.statistics, label: '统计' },
  { to: ROUTES.calendar, label: '日历' },
  { to: ROUTES.heatmap, label: '热力图' },
  { to: ROUTES.routesMap, label: '路线图' },
  { to: ROUTES.yearReview, label: '年度回顾' },
  { to: ROUTES.segments, label: '赛段' },
  { to: ROUTES.trainingPlan, label: '训练计划' },
  { to: ROUTES.performance, label: '表现趋势' },
  // 2.64.0 起「更多」= 原设置页：更新日志与鸣谢移入其中（/changelog、
  // /acknowledgments 路由保留兼容旧链接）
  { to: ROUTES.settings, label: '更多' },
]

/**
 * 移动端底部 TabBar 的高频页（2026-09-11 手机端体验优化）：
 * 4 个高频页 1 击直达，次级页全部收进「更多」（点击打开抽屉）。
 */
export const TAB_ITEMS: NavItem[] = [
  { to: ROUTES.home, label: '仪表盘', end: true },
  { to: ROUTES.activities, label: '记录' },
  { to: ROUTES.statistics, label: '统计' },
  { to: ROUTES.routesMap, label: '路线' },
]
