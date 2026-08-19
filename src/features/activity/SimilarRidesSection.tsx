/**
 * 匹配的骑行区块：展示与当前活动同一路线（聚类分组）的其他骑行。
 * 作者源用 CI 预计算 route-groups.json；本地源实时扫描（缓存模式）。
 * 无匹配（独一路线）或计算失败时区块不渲染。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  buildRouteGroups,
  extractEndpoints,
  type RouteActivityInput,
  type RouteGroup,
} from '@/features/routes/routeGrouping'
import { compareDurations, findMatchingRides, type SimilarRide } from '@/features/routes/similarRides'
import { summariesScanKey } from '@/storage/scanCache'
import { formatDate, formatDuration } from '@/utils/format'
import {
  formatDistanceByUnit,
  formatSpeedByUnit,
  type DistanceUnit,
} from '@/features/settings/settings'
import { useActivityRepository } from '@/hooks/useActivityRepository'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import { defaultSnapshotClient } from '@/storage/authorData/snapshotClient'
import '@/features/activity/SimilarRidesSection.css'

/**
 * 本地源路线分组扫描模块级缓存（性能优化）：key = summariesScanKey。
 * 全量扫描提取起终点成本高，活动集合指纹不变时直接复用。
 */
let similarRidesScanCache: { key: string; groups: RouteGroup[] } | null = null

/**
 * 匹配的骑行区块 props。
 */
export interface SimilarRidesSectionProps {
  /** 当前活动 ID（匹配结果排除自身） */
  activityId: string

  /** 当前活动骑行时长（秒，用于竞速对比；缺失时不显示快慢） */
  currentDuration?: number

  /** 距离显示单位（规格 §27） */
  distanceUnit: DistanceUnit
}

/**
 * 匹配的骑行区块组件。
 *
 * @param props 组件参数
 */
function SimilarRidesSection({ activityId, currentDuration, distanceUnit }: SimilarRidesSectionProps) {
  // 匹配结果（null = 计算中；计算失败或空时区块不渲染）
  const [rides, setRides] = useState<SimilarRide[] | null>(null)
  const [failed, setFailed] = useState(false)
  // 当前数据源的活动仓库（源切换 → 实例变化 → 重新加载）
  const repository = useActivityRepository()
  // 当前数据源（作者源路线分组为 CI 预计算产物）
  const source = useDataSourceStore(selectEffectiveSource)

  useEffect(() => {
    let cancelled = false

    /**
     * 加载路线分组并匹配当前活动。
     * 作者源：getRouteGroups 预计算；本地源：全量扫描起终点 + 聚类（缓存）。
     */
    async function load() {
      let groups: RouteGroup[] | null
      if (source === 'author') {
        groups = await defaultSnapshotClient.getRouteGroups()
      } else {
        const summaries = await repository.listAllSummaries()
        const scanKey = summariesScanKey(summaries)
        if (similarRidesScanCache !== null && similarRidesScanCache.key === scanKey) {
          groups = similarRidesScanCache.groups
        } else {
          const routeItems: RouteActivityInput[] = []
          for (const summary of summaries) {
            const records = await repository.getRecords(summary.id)
            if (cancelled) {
              return
            }
            const endpoints = extractEndpoints(records)
            routeItems.push({
              id: summary.id,
              name: summary.name,
              startTime: summary.startTime,
              distance: summary.distance,
              duration: summary.duration,
              start: endpoints?.start,
              end: endpoints?.end,
            })
          }
          groups = buildRouteGroups(routeItems)
          similarRidesScanCache = { key: scanKey, groups }
        }
      }
      if (!cancelled) {
        setRides(findMatchingRides(groups, activityId))
      }
    }

    load().catch((error: unknown) => {
      if (!cancelled) {
        setFailed(true)
      }
      console.error('Failed to load similar rides', error)
    })
    return () => {
      cancelled = true
    }
  }, [repository, source, activityId])

  // 计算中 / 失败 / 无匹配：区块不渲染
  if (failed || rides === null || rides.length === 0) {
    return null
  }

  return (
    <section className="similar-rides" aria-label="匹配的骑行">
      <h2 className="similar-rides__title">匹配的骑行</h2>
      <ul className="similar-rides__list">
        {rides.map((ride) => {
          const comparison = compareDurations(currentDuration, ride.duration)
          return (
            <li key={ride.id}>
              <Link className="similar-rides__item" to={`/activities/${ride.id}`}>
                <span className="similar-rides__name" title={ride.name}>
                  {ride.name ?? '未命名活动'}
                </span>
                <span className="similar-rides__meta">
                  {formatDate(ride.startTime)} ·{' '}
                  {formatDistanceByUnit(ride.distance, distanceUnit)} ·{' '}
                  {formatDuration(ride.duration)} ·{' '}
                  {formatSpeedByUnit(ride.distance / ride.duration, distanceUnit)}
                </span>
                {comparison !== null && (
                  <span
                    className={
                      'similar-rides__race' +
                      (comparison.faster === true
                        ? ' similar-rides__race--faster'
                        : comparison.faster === false
                          ? ' similar-rides__race--slower'
                          : '')
                    }
                  >
                    {comparison.faster === true
                      ? `比本次快 ${formatDuration(comparison.diffSeconds)}`
                      : comparison.faster === false
                        ? `比本次慢 ${formatDuration(comparison.diffSeconds)}`
                        : '与本次持平'}
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default SimilarRidesSection
