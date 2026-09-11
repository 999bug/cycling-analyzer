/**
 * 精选热门路线注册表：按地区聚合，UI 层从这里取数。
 * 二期扩展全国时新增数据文件并在 REGIONS 登记（routeIds 必须与数据文件一致，测试把关）。
 */
import type { CuratedRegionId, CuratedRoute } from '@/features/curatedRoutes/types'
import { BEIJING_CURATED_ROUTES } from '@/features/curatedRoutes/beijing'

/** 一个地区的精选路线集合 */
export interface CuratedRegion {
  id: CuratedRegionId
  label: string
  routes: CuratedRoute[]
}

/** 地区注册表（按展示顺序） */
export const CURATED_REGIONS: CuratedRegion[] = [
  { id: 'beijing', label: '北京', routes: BEIJING_CURATED_ROUTES },
]

/** 全部精选路线（地区顺序拼接） */
export const ALL_CURATED_ROUTES: CuratedRoute[] = CURATED_REGIONS.flatMap(
  (region) => region.routes,
)

/** 按地区 ID 取路线集合 */
export function curatedRoutesOf(region: CuratedRegionId): CuratedRoute[] {
  return CURATED_REGIONS.find((entry) => entry.id === region)?.routes ?? []
}
