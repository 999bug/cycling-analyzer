/**
 * 精选热门路线注册表：按地区聚合，UI 层从这里取数。
 * 扩展地区时：新增数据文件 + 在 REGIONS 登记（routeIds 必须与数据文件一致，测试把关）。
 */
import type { CuratedRegionId, CuratedRoute } from '@/features/curatedRoutes/types'
import { BEIJING_CURATED_ROUTES } from '@/features/curatedRoutes/beijing'
import { NATIONAL_CURATED_ROUTES } from '@/features/curatedRoutes/national'

/** 一个地区的精选路线集合 */
export interface CuratedRegion {
  id: CuratedRegionId
  label: string
  routes: CuratedRoute[]
}

/** 按地区 ID 过滤全国路线集合 */
function nationalRoutesOf(region: CuratedRegionId): CuratedRoute[] {
  return NATIONAL_CURATED_ROUTES.filter((route) => route.region === region)
}

/** 地区注册表（按展示顺序） */
export const CURATED_REGIONS: CuratedRegion[] = [
  { id: 'beijing', label: '北京', routes: BEIJING_CURATED_ROUTES },
  { id: 'xian', label: '西安', routes: nationalRoutesOf('xian') },
  { id: 'hangzhou', label: '杭州', routes: nationalRoutesOf('hangzhou') },
  { id: 'taizhou', label: '台州', routes: nationalRoutesOf('taizhou') },
  { id: 'shenzhen', label: '深圳', routes: nationalRoutesOf('shenzhen') },
  { id: 'chengdu', label: '成都', routes: nationalRoutesOf('chengdu') },
  { id: 'kunming', label: '昆明', routes: nationalRoutesOf('kunming') },
  { id: 'shanghai', label: '上海', routes: nationalRoutesOf('shanghai') },
  { id: 'chongqing', label: '重庆', routes: nationalRoutesOf('chongqing') },
  { id: 'guangzhou', label: '广州', routes: nationalRoutesOf('guangzhou') },
  { id: 'wuhan', label: '武汉', routes: nationalRoutesOf('wuhan') },
  { id: 'xiamen', label: '厦门', routes: nationalRoutesOf('xiamen') },
  { id: 'nanjing', label: '南京', routes: nationalRoutesOf('nanjing') },
  { id: 'dali', label: '大理', routes: nationalRoutesOf('dali') },
  { id: 'hainan', label: '海南', routes: nationalRoutesOf('hainan') },
]

/** 全部精选路线（地区顺序拼接） */
export const ALL_CURATED_ROUTES: CuratedRoute[] = CURATED_REGIONS.flatMap(
  (region) => region.routes,
)

/** 按地区 ID 取路线集合 */
export function curatedRoutesOf(region: CuratedRegionId): CuratedRoute[] {
  return CURATED_REGIONS.find((entry) => entry.id === region)?.routes ?? []
}
