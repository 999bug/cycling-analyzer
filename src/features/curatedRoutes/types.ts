/**
 * 精选热门路线（curated routes）领域类型。
 *
 * 与用户自有路线（routeGrouping）不同：精选路线为静态手工整理数据，
 * 起点对外只读，无活动关联（无 lastActivityId / count）。
 * 几何统一 WGS-84，由生成脚本从 OSM 路网产出（见 scripts/generate-curated-routes.mjs），
 * 渲染前需经 projectPoint 投影到底图坐标系。
 */

/** 一条精选路线 */
export interface CuratedRoute {
  /** 唯一 ID（`bj-` 前缀 + 拼音，深链可用） */
  id: string

  /** 路线名（如「妙峰山」） */
  name: string

  /** 所属地区（一期北京，二期扩展全国） */
  region: CuratedRegionId

  /** 区域内位置（如「门头沟」） */
  area: string

  /** 里程（米，官方/权威口径） */
  distanceMeters: number

  /** 累计爬升（米，官方/权威口径） */
  elevationGainMeters: number

  /** 难度 1–5（1 最易） */
  difficulty: 1 | 2 | 3 | 4 | 5

  /** 路线类型：爬坡 / 耐力 */
  kind: 'climb' | 'endurance'

  /** 一句话介绍 */
  description: string

  /** 骑行提示（补给、路况、季节等） */
  tips: string

  /** 里程与爬升的数据来源（权威口径标注） */
  source: string

  /**
   * 路径线（WGS-84 [纬度, 经度][]，每条路线可为多段折线）。
   * OSM 简化示意，可能与官方口径里程有出入——展示时以 distanceMeters 为准并注明。
   */
  tracks: [number, number][][]
}

/** 精选路线地区 ID（二期新增地区即扩展此联合类型并加数据文件） */
export type CuratedRegionId = 'beijing'

/** 难度文案（展示用，避免 UI 层散落映射） */
export function difficultyLabel(difficulty: CuratedRoute['difficulty']): string {
  switch (difficulty) {
    case 1:
      return '休闲'
    case 2:
      return '新手入门'
    case 3:
      return '中级进阶'
    case 4:
      return '硬核挑战'
    default:
      return '极限挑战'
  }
}

/** 路线类型文案 */
export function routeKindLabel(kind: CuratedRoute['kind']): string {
  return kind === 'climb' ? '爬坡' : '耐力'
}
