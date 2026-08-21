/**
 * 路线分析区块（规格 §39 P2）：相似骑行聚类为"路线"后的卡片墙。
 *
 * 每张卡片展示路线序号、骑行次数、平均距离、最快用时与最近骑行日期，
 * 点击跳转最近一次骑行的详情页。
 * 需扫描全部活动轨迹端点，计算期间显示提示文案；
 * 无足够起终点坐标时同样显示提示（不伪造，规格 §25）。
 */
import { Link } from 'react-router-dom'
import { formatDate, formatDuration } from '@/utils/format'
import { formatDistanceByUnit, type DistanceUnit } from '@/features/settings/settings'
import type { RouteGroup } from '@/features/routes/routeGrouping'
import '@/features/routes/routeGroups.css'

/**
 * 路线分析区块 props。
 */
export interface RouteGroupCardsProps {
  /** 路线分组（null = 计算中；空数组 = 无可分组轨迹） */
  groups: readonly RouteGroup[] | null

  /** 分组扫描是否失败（true 时显示失败提示） */
  failed?: boolean

  /** 距离显示单位（缺省公里，规格 §27） */
  distanceUnit?: DistanceUnit
}

/**
 * 路线分析区块。
 *
 * @param props 组件参数
 */
function RouteGroupCards({ groups, failed = false, distanceUnit = 'km' }: RouteGroupCardsProps) {
  return (
    <section className="route-groups" aria-label="路线分析">
      <h3 className="route-groups__title">路线分析</h3>
      {failed ? (
        <p className="route-groups__hint">路线分析加载失败</p>
      ) : groups === null ? (
        <p className="route-groups__hint">路线分析计算中…</p>
      ) : groups.length === 0 ? (
        <p className="route-groups__hint">暂无可分组的路线，导入含 GPS 轨迹的骑行后展示</p>
      ) : (
        <div className="route-groups__grid">
          {groups.map((group, index) => (
            <Link key={group.lastActivityId} className="route-card" to={`/activities/${group.lastActivityId}`}>
              <div className="route-card__header">
                <span className="route-card__name" title={group.lastActivityName}>
                  {group.lastActivityName ?? `路线 ${index + 1}`}
                </span>
                <span className="route-card__count">{group.count} 次</span>
              </div>
              <div className="route-card__stats">
                <div className="route-card__stat">
                  <span className="route-card__stat-label">平均距离</span>
                  <span className="route-card__stat-value">{formatDistanceByUnit(group.avgDistance, distanceUnit)}</span>
                </div>
                <div className="route-card__stat">
                  <span className="route-card__stat-label">最快用时</span>
                  <span className="route-card__stat-value">{formatDuration(group.bestDuration)}</span>
                </div>
                <div className="route-card__stat">
                  <span className="route-card__stat-label">最近骑行</span>
                  <span className="route-card__stat-value">{formatDate(group.lastRideTime)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

export default RouteGroupCards
