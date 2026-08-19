/**
 * 路线总览地图数据构建（纯函数）。
 *
 * 路线颜色按黄金角在色相环上均匀分布：任意数量路线颜色互异可区分；
 * 轨迹与路线分组关联（本地源实时计算 / 作者源预计算共用同一输出结构）。
 */
import type { RouteGroup } from '@/features/routes/routeGrouping'

/** 一条路线的地图展示数据 */
export interface RouteMapRoute {
  /** 路线索引（0 起，配色来源） */
  index: number

  /** 路线颜色（现代 CSS HSL，深色/浅色主题均可见） */
  color: string

  /** 路线名称（最近骑行标题；缺失回退「路线 N」） */
  name: string

  /** 骑行次数 */
  count: number

  /** 该路线全部轨迹（[纬度, 经度] 元组数组；无轨迹的活动不产出） */
  tracks: [number, number][][]

  /** 最近骑行活动 ID（跳转详情） */
  lastActivityId: string
}

/** 黄金角（度）：色相步进，任意数量颜色均匀分布 */
const GOLDEN_ANGLE = 137.5

/** 路线颜色饱和度（%） */
const ROUTE_COLOR_SATURATION = 70

/**
 * 路线颜色亮度（%）——地图底图为浅色瓦片，深色系路线对比最强。
 * 用户反馈全局总览颜色偏淡：60% → 42%（浅底上醒目且各色相可辨）。
 */
const ROUTE_COLOR_LIGHTNESS = 42

/**
 * 路线配色：按索引取黄金角色相（确定性，同路线永远同色）。
 *
 * @param index 路线索引（0 起）
 * @returns 现代 CSS HSL 颜色字符串
 */
export function routeColor(index: number): string {
  const hue = Math.round((index * GOLDEN_ANGLE) % 360)
  return `hsl(${hue} ${ROUTE_COLOR_SATURATION}% ${ROUTE_COLOR_LIGHTNESS}%)`
}

/**
 * 由路线分组 + 活动轨迹映射构建路线地图数据。
 * 组内无轨迹映射的活动跳过；整组无轨迹时该路线不产出。
 *
 * @param groups 路线分组（buildRouteGroups 结果，按次数降序）
 * @param trackById 活动 ID → 抽稀轨迹（[纬度, 经度] 元组数组）
 * @returns 路线地图数据（保持分组顺序，索引连续）
 */
export function buildRouteMapRoutes(
  groups: readonly RouteGroup[],
  trackById: ReadonlyMap<string, [number, number][]>,
): RouteMapRoute[] {
  const routes: RouteMapRoute[] = []
  for (const group of groups) {
    const tracks = group.activities
      .map((activity) => trackById.get(activity.id))
      .filter((track): track is [number, number][] => track !== undefined)
    if (tracks.length === 0) {
      continue
    }
    routes.push({
      index: routes.length,
      color: routeColor(routes.length),
      name: group.lastActivityName ?? `路线 ${routes.length + 1}`,
      count: group.count,
      tracks,
      lastActivityId: group.lastActivityId,
    })
  }
  return routes
}
