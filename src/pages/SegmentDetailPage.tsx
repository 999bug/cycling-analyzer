/**
 * 赛段详情页（赛段重设计一期）。
 *
 * 展示单个赛段的完整成绩信息：关键统计（距离/穿越次数/个人最好/最近一次）、
 * 个人前三、成绩趋势散点图（越低越快，金点 = PR，复用 Recharts）、
 * 历史成绩表（日期/用时/均速/均功率/均心率/vs PR）。
 *
 * 数据来源：
 * - 本地源：成绩读 segment_efforts 落库表（v6）；表为空且从未全量扫描过
 *   （effortsSyncedAt 缺失）时触发一次单赛段全量扫描并落库，之后读库即得；
 * - 作者源：赛段定义与全量成绩榜均为 CI 预计算快照，只读不落库。
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { db, type SegmentEntity } from '@/storage/db'
import { DexieSegmentRepository } from '@/storage/repositories/segmentRepository'
import { defaultSnapshotClient } from '@/storage/authorData/snapshotClient'
import type { SegmentEffort } from '@/features/segments/segmentMatching'
import { segmentDistanceMeters } from '@/features/segments/segmentStats'
import { computeLeaderboardsSync, createLeaderboardRunner } from '@/features/segments/leaderboardClient'
import { useActivityRepository } from '@/hooks/useActivityRepository'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import { listCyclingSummaries } from '@/features/activity/cyclingScope'
import { formatDate, formatDuration } from '@/utils/format'
import './SegmentDetailPage.css'

/** 趋势图高度（与全站图表卡一致，取 --chart-height 令牌） */
const CHART_HEIGHT = 220

/** 加载状态 */
type LoadState = 'loading' | 'ready' | 'error' | 'notFound'

/** 单条成绩的图表/表格视图数据 */
interface EffortView {
  activityId: string
  startTime: string
  durationSeconds: number
  avgSpeed?: number
  avgPower?: number
  avgHeartRate?: number
}

/** 日期轴刻度：MM-DD */
function formatTickDate(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 用时轴刻度：压缩为 m:ss */
function formatTickDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/** 差值文案：+Ns / -Ns（vs PR） */
function formatDelta(diffSeconds: number): string {
  const sign = diffSeconds >= 0 ? '+' : '-'
  return `${sign}${Math.round(Math.abs(diffSeconds))}s`
}

/** 趋势图悬浮卡 */
interface TrendTooltipPayload {
  active?: boolean
  payload?: readonly { payload: EffortView }[]
  prSeconds?: number
}

/**
 * 成绩趋势悬浮卡：日期 + 用时（+ vs PR）。
 */
function TrendTooltip({ active, payload, prSeconds }: TrendTooltipPayload) {
  if (!active || payload === undefined || payload.length === 0) {
    return null
  }
  const effort = payload[0]!.payload
  const diff = prSeconds !== undefined ? effort.durationSeconds - prSeconds : undefined
  return (
    <div className="segment-detail__tooltip">
      <div className="segment-detail__tooltip-date">{formatDate(effort.startTime)}</div>
      <div className="segment-detail__tooltip-time">{formatDuration(effort.durationSeconds)}</div>
      {diff !== undefined && diff > 0 && (
        <div className="segment-detail__tooltip-diff">{formatDelta(diff)} vs 最好</div>
      )}
      {diff !== undefined && diff === 0 && <div className="segment-detail__tooltip-diff">个人最好</div>}
    </div>
  )
}

/**
 * 赛段详情页。
 */
function SegmentDetailPage() {
  const { id } = useParams()
  const segmentId = Number(id)
  const source = useDataSourceStore(selectEffectiveSource)
  const activityRepository = useActivityRepository()

  const [state, setState] = useState<LoadState>('loading')
  const [segment, setSegment] = useState<SegmentEntity | null>(null)
  const [efforts, setEfforts] = useState<EffortView[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // 非法路由参数（非数字 id）：无 DB 查询必要，直接空态
      if (!Number.isFinite(segmentId) || id === undefined) {
        setState('notFound')
        return
      }
      // 重置上次加载残留（异步 IIFE 内调用，避免 effect 同步 setState 连锁渲染）
      setState('loading')
      setSegment(null)
      setEfforts([])
      try {
        if (source === 'author') {
          // 作者源：赛段定义 + 全量成绩榜均为 CI 预计算产物，只读直读
          const segments = await defaultSnapshotClient.getSegments().catch(() => [] as SegmentEntity[])
          const found = segments.find((item) => item.id === segmentId)
          if (cancelled) {
            return
          }
          if (found === undefined) {
            setState('notFound')
            return
          }
          const results = await defaultSnapshotClient
            .getSegmentResults()
            .catch(() => ({}) as Record<string, SegmentEffort[]>)
          const list = [...(results[String(segmentId)] ?? [])].sort(
            (a, b) => a.durationSeconds - b.durationSeconds,
          )
          setSegment(found)
          setEfforts(list)
          setState('ready')
          return
        }

        const repository = new DexieSegmentRepository(db)
        const found = await repository.getSegment(segmentId)
        if (cancelled) {
          return
        }
        if (found === undefined) {
          setState('notFound')
          return
        }
        let list = await repository.listEffortsBySegment(segmentId)

        // 首次进入且从未全量扫描过：单赛段扫一遍全部活动并落库（之后读库即得）。
        // 已有成绩或已扫描过（effortsSyncedAt 存在）则不再重扫——新活动导入后
        // 由赛段页全量扫描统一刷新。
        if (list.length === 0 && found.effortsSyncedAt === undefined) {
          const summaries = await listCyclingSummaries(activityRepository)
          const recordsByActivity = await activityRepository.getRecordsByActivityIds(
            summaries.map((item) => item.id),
          )
          const inputs = summaries.map((item) => ({
            activityId: item.id,
            startTime: item.startTime,
            records: recordsByActivity.get(item.id) ?? [],
          }))
          const runner = createLeaderboardRunner() ?? {
            compute: computeLeaderboardsSync,
            cancel: () => {},
          }
          try {
            const boards = await runner.compute({ segments: [found], inputs })
            const board = boards.get(found) ?? []
            await repository.replaceSegmentEfforts(segmentId, board)
          } finally {
            runner.cancel()
          }
          list = await repository.listEffortsBySegment(segmentId)
        }

        if (cancelled) {
          return
        }
        setSegment(found)
        setEfforts(
          list.map((effort) => ({
            activityId: effort.activityId,
            startTime: effort.startTime,
            durationSeconds: effort.durationSeconds,
            avgSpeed: effort.avgSpeed,
            avgPower: effort.avgPower,
            avgHeartRate: effort.avgHeartRate,
          })),
        )
        setState('ready')
      } catch (error: unknown) {
        console.error('Failed to load segment detail', error)
        if (!cancelled) {
          setState('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [segmentId, id, source, activityRepository])

  const pr = efforts[0]
  const latest = useMemo(
    () =>
      [...efforts].sort((a, b) => b.startTime.localeCompare(a.startTime))[0],
    [efforts],
  )
  const distance = useMemo(
    () => (segment !== null ? segmentDistanceMeters(segment) : undefined),
    [segment],
  )
  // 趋势图数据：按时间升序（x 轴），含 PR 标记
  const trendData = useMemo(
    () =>
      [...efforts]
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map((effort) => ({
          ...effort,
          timestamp: new Date(effort.startTime).getTime(),
          isPr: pr !== undefined && effort.durationSeconds === pr.durationSeconds,
        })),
    [efforts, pr],
  )

  if (state === 'loading') {
    return <p className="segment-detail__message">赛段加载中…</p>
  }
  if (state === 'notFound') {
    return (
      <p className="segment-detail__message">
        赛段不存在或已被删除。<Link to="/segments">返回赛段列表</Link>
      </p>
    )
  }
  if (state === 'error' || segment === null) {
    return (
      <p className="segment-detail__message">
        加载失败，请稍后重试。<Link to="/segments">返回赛段列表</Link>
      </p>
    )
  }

  const distanceText =
    distance === undefined
      ? '—'
      : `${(distance.meters / 1000).toFixed(2)} km${distance.estimated ? '（直线）' : ''}`

  return (
    <div className="segment-detail">
      <nav className="segment-detail__back">
        <Link to="/segments">← 返回赛段列表</Link>
      </nav>
      <h1 className="segment-detail__title">{segment.name}</h1>
      <p className="segment-detail__subtitle">
        {segment.stravaId !== undefined ? '来自 Strava 导入' : '起终点圆赛段'}
      </p>

      <div className="segment-detail__stats" aria-label="赛段统计">
        <div className="segment-detail__stat">
          <div className="segment-detail__stat-value">{distanceText}</div>
          <div className="segment-detail__stat-label">距离</div>
        </div>
        <div className="segment-detail__stat">
          <div className="segment-detail__stat-value">{efforts.length} 次</div>
          <div className="segment-detail__stat-label">穿越次数</div>
        </div>
        <div className="segment-detail__stat">
          <div className="segment-detail__stat-value segment-detail__stat-value--pr">
            {pr !== undefined ? formatDuration(pr.durationSeconds) : '—'}
          </div>
          <div className="segment-detail__stat-label">个人最好</div>
        </div>
        <div className="segment-detail__stat">
          <div className="segment-detail__stat-value">
            {latest !== undefined ? formatDate(latest.startTime) : '—'}
          </div>
          <div className="segment-detail__stat-label">最近一次</div>
        </div>
      </div>

      {efforts.length === 0 ? (
        <p className="segment-detail__message">
          暂无穿越记录。骑行经过该赛段（起终点圆半径 200 m）后自动记录成绩。
        </p>
      ) : (
        <>
          <section aria-label="个人前三" className="segment-detail__podium-section">
            <h2 className="segment-detail__section-title">个人前三</h2>
            <ol className="segment-detail__podium">
              {efforts.slice(0, 3).map((effort, index) => (
                <li key={effort.activityId} className="segment-detail__podium-item">
                  <span className={`segment-detail__rank segment-detail__rank--${index + 1}`}>
                    {index + 1}
                  </span>
                  <Link to={`/activities/${effort.activityId}`} className="segment-detail__podium-link">
                    <span className="segment-detail__podium-time">
                      {formatDuration(effort.durationSeconds)}
                    </span>
                    <span className="segment-detail__podium-date">{formatDate(effort.startTime)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>

          <section aria-label="成绩趋势" className="segment-detail__trend-section">
            <h2 className="segment-detail__section-title">
              成绩趋势 <span className="segment-detail__section-hint">点越低越快，金点为个人最好</span>
            </h2>
            <div className="segment-detail__chart">
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <ScatterChart margin={{ top: 12, right: 24, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    type="number"
                    dataKey="timestamp"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={formatTickDate}
                    stroke="var(--border)"
                    tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="durationSeconds"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={formatTickDuration}
                    width={56}
                    stroke="var(--border)"
                    tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  />
                  <Tooltip
                    content={<TrendTooltip prSeconds={pr?.durationSeconds} />}
                    cursor={{ strokeDasharray: '3 3', stroke: 'var(--border)' }}
                  />
                  <Scatter
                    data={trendData}
                    isAnimationActive={false}
                    shape={(props: { cx?: number; cy?: number; payload?: EffortView & { isPr?: boolean } }) => {
                      const { cx = 0, cy = 0, payload } = props
                      const isPr = payload?.isPr === true
                      return (
                        <circle
                          key={`${payload?.activityId ?? cx}-${payload?.startTime ?? cy}`}
                          cx={cx}
                          cy={cy}
                          r={isPr ? 6 : 4}
                          fill={isPr ? 'var(--warning)' : 'var(--info)'}
                        />
                      )
                    }}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section aria-label="历史成绩" className="segment-detail__history-section">
            <h2 className="segment-detail__section-title">历史成绩</h2>
            <div className="segment-detail__table-wrap">
              <table className="segment-detail__table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>用时</th>
                    <th>均速</th>
                    <th>均功率</th>
                    <th>均心率</th>
                    <th>vs 最好</th>
                  </tr>
                </thead>
                <tbody>
                  {[...efforts]
                    .sort((a, b) => b.startTime.localeCompare(a.startTime))
                    .map((effort) => {
                      const diff = pr !== undefined ? effort.durationSeconds - pr.durationSeconds : undefined
                      const isPr = diff === 0
                      return (
                        <tr key={effort.activityId} className={isPr ? 'segment-detail__pr-row' : undefined}>
                          <td>
                            <Link to={`/activities/${effort.activityId}`}>
                              {formatDate(effort.startTime)}
                            </Link>
                          </td>
                          <td className="segment-detail__num">{formatDuration(effort.durationSeconds)}</td>
                          <td className="segment-detail__num">
                            {effort.avgSpeed !== undefined ? `${(effort.avgSpeed * 3.6).toFixed(1)} km/h` : '—'}
                          </td>
                          <td className="segment-detail__num">
                            {effort.avgPower !== undefined ? `${Math.round(effort.avgPower)} W` : '—'}
                          </td>
                          <td className="segment-detail__num">
                            {effort.avgHeartRate !== undefined ? `${Math.round(effort.avgHeartRate)} bpm` : '—'}
                          </td>
                          <td className="segment-detail__num">
                            {diff === undefined
                              ? '—'
                              : isPr
                                ? '个人最好'
                                : formatDelta(diff)}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export default SegmentDetailPage
