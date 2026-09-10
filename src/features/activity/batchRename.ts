/**
 * 批量重命名模板渲染（纯函数，规格外增强）。
 * 供 BatchRenameDialog 预览与测试复用；与组件分离以满足 react-refresh 单导出约束。
 */
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import { formatDate } from '@/utils/format'

/** 默认命名模板 */
export const DEFAULT_RENAME_TEMPLATE = '{日期} {类型} {距离}km'

/** 模板变量 chip 定义（点击追加到模板末尾） */
export const TEMPLATE_VARIABLES = [
  { token: '{日期}', label: '{日期}' },
  { token: '{类型}', label: '{类型}' },
  { token: '{距离}', label: '{距离}' },
  { token: '{爬升}', label: '{爬升}' },
  { token: '{序号}', label: '{序号}' },
] as const

/**
 * 按模板渲染单个活动的新名称。
 *
 * @param template 命名模板（含 {变量} 占位符）
 * @param item 活动摘要
 * @param index 列表序号（从 0 起，{序号} 显示为 01/02…）
 */
export function renderRenameTemplate(
  template: string,
  item: ActivitySummary,
  index: number,
): string {
  const date = formatDate(item.startTime)
  const distanceKm = String(Math.round(item.distance / 1000))
  // 缺失字段 = undefined ≠ 0：爬升缺失显示占位符
  const elevation = item.elevationGain === undefined ? '—' : String(Math.round(item.elevationGain))
  const seq = String(index + 1).padStart(2, '0')
  return template
    .replaceAll('{日期}', date)
    .replaceAll('{类型}', item.activityType)
    .replaceAll('{距离}', distanceKm)
    .replaceAll('{爬升}', elevation)
    .replaceAll('{序号}', seq)
}
