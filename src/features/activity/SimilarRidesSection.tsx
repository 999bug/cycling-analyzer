/**
 * 匹配的骑行区块：折线图展示所有匹配骑行（同路线分组），
 * 点代表一次骑行，鼠标悬停弹出骑行信息（名称/日期/距离/时长/竞速对比）。
 * 点击点跳转至对应骑行详情。
 * 作者源用 CI 预计算 route-groups.json；本地源实时扫描（缓存模式）。
 * 无匹配（独一路线）或计算失败时区块不渲染。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  buildRouteGroups,
  extractEndpoints,
  type RouteActivityInput,
  type RouteGroup,
} from '@/features/routes/routeGrouping'
import {
  compareDurations,
  findMatchingRides,
  type SimilarRide,
} from '@/features/routes/similarRides'
import { formatDate, formatDuration } from '@/utils/format'
import {
  formatDistanceByUnit,
  type DistanceUnit,
} from '@/features/settings/settings'
import { useActivityRepository } from '@/hooks/useActivityRepository'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import { defaultSnapshotClient } from '@/storage/authorData/snapshotClient'
import '@/features/activity/SimilarRidesSection.css'

/** 深色主题下坐标轴颜色 */
const AXIS_TICK_COLOR = 'var(--text-secondary)'
const GRID_COLOR = 'var(--border)'

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

/** CustomTooltip 组件 props */
interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ payload: { id: string; name?: string; startTime: string; distance: number; duration: number } }>
  currentDuration?: number
  distanceUnit: DistanceUnit
}

/**
 * 折线图 Tooltip 内容（定义在组件外避免 react-hooks/static-components 警告）。
 */
function CustomTooltip({ active, payload, currentDuration, distanceUnit }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null
  }
  const ride = payload[0].payload
  const comparison = compareDurations(currentDuration, ride.duration)
  return (
    <div className="similar-rides__tooltip">
      <Link className="similar-rides__tooltip-link" to={`/activities/${ride.id}`}>
        <strong className="similar-rides__tooltip-name">{ride.name ?? '未命名活动'}</strong>
        <span className="similar-rides__tooltip-meta">
          {formatDate(ride.startTime)} · {formatDistanceByUnit(ride.distance, distanceUnit)} · {formatDuration(ride.duration)}
        </span>
        {comparison !== null && (
          <span
            className={
              'similar-rides__tooltip-compare' +
              (comparison.faster === true
                ? ' similar-rides__tooltip-compare--faster'
                : comparison.faster === false
                  ? ' similar-rides__tooltip-compare--slower'
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
    </div>
  )
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

    async function load() {
      let groups: RouteGroup[] | null
      if (source === 'author') {
        groups = await defaultSnapshotClient.getRouteGroups()
      } else {
        const summaries = await repository.listAllSummaries()
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

  // 按时间升序排列（折线图 x 轴按时间）
  const sorted = [...rides].sort((a, b) => a.startTime.localeCompare(b.startTime))
  const chartData = sorted.map((ride) => ({
    ...ride,
    durationMinutes: Math.round(ride.duration / 60),
    dateLabel: formatDate(ride.startTime),
  }))

  return (
    <section className="similar-rides" aria-label="匹配的骑行">
      <h2 className="similar-rides__title">匹配的骑行</h2>
      <p className="similar-rides__summary">
        共 {rides.length} 条同路线骑行，点大小代表时长，悬停查看详情
      </p>

      <div className="similar-rides__chart">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="dateLabel"
              tick={{ fill: AXIS_TICK_COLOR, fontSize: 11 }}
              stroke={GRID_COLOR}
              interval="preserveStartEnd"
            />
            <YAxis
              width={44}
              tick={{ fill: AXIS_TICK_COLOR, fontSize: 11 }}
              stroke={GRID_COLOR}
              domain={[0, 'auto']}
              tickFormatter={(v) => `${v}min`}
            />
            <Tooltip content={<CustomTooltip currentDuration={currentDuration} distanceUnit={distanceUnit} />} cursor={{ stroke: 'var(--text-secondary)', strokeDasharray: '3 3' }} />
            <Line
              type="monotone"
              dataKey="durationMinutes"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={{ r: 5, fill: 'var(--primary)', stroke: 'var(--bg-surface)', strokeWidth: 2 }}
              activeDot={{ r: 7, fill: 'var(--primary)', stroke: '#fff', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

export default SimilarRidesSection