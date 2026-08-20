/**
 * 表现趋势页面（规格 §39 表现趋势 / 每周训练综述）。
 *
 * 两块内容：
 * - 表现趋势：近 12 周训练量（骑行次数/距离/时长/爬升/TSS）与效率因子
 *   （EF = ΣNP×时长 / Σ心率×时长）折线图，FTP 未配置时不显示 TSS（不伪造，规格 §26）
 * - 每周训练综述：本周 vs 上周聚合对比卡片
 *
 * 数据流：摘要 → 周聚合纯函数（buildWeeklySeries / buildWeekReview）。
 * 依赖 FTP（训练配置）：无 FTP 仅隐藏 TSS 指标，其余照常展示。
 */
import { useEffect, useState } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  Bar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import { getEffectiveProfile } from '@/features/settings/effectiveProfile'
import { useActivityRepository } from '@/hooks/useActivityRepository'
import { useUnits } from '@/hooks/useUnits'
import { useImportStore } from '@/stores/importStore'
import {
  buildWeeklySeries,
  buildWeekReview,
  type WeekSummary,
} from '@/features/analysis/weeklyStats'
import { formatDate } from '@/utils/format'
import { formatDistanceByUnit } from '@/features/settings/settings'
import '@/pages/PerformancePage.css'

/** 表现趋势周数（规格 §39） */
const TREND_WEEKS = 12

/** 图表高度（px） */
const CHART_HEIGHT = 280

/** 测试环境固定初始尺寸（jsdom 无布局测量，ResizeObserver 不可用） */
const INITIAL_DIMENSION = { width: 800, height: CHART_HEIGHT }

/** 轴刻度样式（复用全局 CSS 变量） */
const TICK_STYLE = { fill: 'var(--text-secondary)', fontSize: 12 }

/** Tooltip 内容样式（深色） */
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
}

/** 图表系列颜色 */
const SERIES_COLORS = { distance: '#4f8cff', tss: '#ff9f0a', ef: '#34c759' } as const

/** 加载状态机 */
type LoadState = 'loading' | 'empty' | 'ready' | 'error'

/** 状态文案映射（ready 不显示文案） */
const STATE_MESSAGES: Record<Exclude<LoadState, 'ready'>, string> = {
  loading: '表现趋势加载中…',
  empty: '暂无骑行数据，先导入 FIT 文件',
  error: '表现趋势加载失败',
}

/**
 * 表现趋势页面。
 */
function PerformancePage() {
  const [state, setState] = useState<LoadState>('loading')
  const [weeklySeries, setWeeklySeries] = useState<readonly WeekSummary[]>([])
  const [review, setReview] = useState<{ current: WeekSummary; previous: WeekSummary }>()
  const [ftp, setFtp] = useState<number>()
  // 订阅导入结果：数据导入完成后自动刷新（规格 §8）
  const importSummary = useImportStore((s) => s.summary)
  // 当前数据源的活动仓库（源切换 → 实例变化 → 重新加载）
  const repository = useActivityRepository()
  // 数据源（训练配置随源）
  const source = useDataSourceStore(selectEffectiveSource)
  // 距离显示单位（规格 §27）
  const { distance: distanceUnit } = useUnits()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const profile = await getEffectiveProfile(source)
        if (cancelled) {
          return
        }
        const summaries = await repository.listAllSummaries()
        if (cancelled) {
          return
        }
        if (summaries.length === 0) {
          setState('empty')
          return
        }
        const currentFtp = profile.ftp && profile.ftp > 0 ? profile.ftp : undefined
        const weekStart = new Date().toISOString()
        setFtp(currentFtp)
        setWeeklySeries(buildWeeklySeries(summaries, TREND_WEEKS, currentFtp))
        setReview(buildWeekReview(summaries, weekStart.slice(0, 10), currentFtp))
        setState('ready')
      } catch (err: unknown) {
        if (!cancelled) {
          setState('error')
        }
        console.error('Failed to load performance trends', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [importSummary, source, repository])

  return (
    <>
      <h1>表现趋势</h1>
      {state !== 'ready' ? (
        <p className="performance-page__message">{STATE_MESSAGES[state]}</p>
      ) : (
        <>
          <WeeklyReviewSection
            current={review!.current}
            previous={review!.previous}
            distanceUnit={distanceUnit}
          />
          <TrendSection
            series={weeklySeries}
            distanceUnit={distanceUnit}
            hasFtp={ftp !== undefined}
          />
        </>
      )}
    </>
  )
}

/**
 * 每周训练综述区块：本周 vs 上周对比卡片（规格 §39 每周训练综述）。
 *
 * @param current 本周聚合
 * @param previous 上周聚合
 * @param distanceUnit 距离显示单位
 */
function WeeklyReviewSection({
  current,
  previous,
  distanceUnit,
}: {
  current: WeekSummary
  previous: WeekSummary
  distanceUnit: 'km' | 'mi'
}) {
  const rows = [
    { label: '骑行次数', value: current.rides, previous: previous.rides, suffix: ' 次' },
    {
      label: '骑行距离',
      value: formatDistanceByUnit(current.distance, distanceUnit),
      previous: formatDistanceByUnit(previous.distance, distanceUnit),
    },
    {
      label: '骑行时长',
      value: formatDuration(current.duration),
      previous: formatDuration(previous.duration),
    },
    {
      label: '累计爬升',
      value: formatElevation(current.elevationGain),
      previous: formatElevation(previous.elevationGain),
    },
  ]

  return (
    <section className="weekly-review" aria-label="每周训练综述">
      <h2 className="weekly-review__title">每周训练综述</h2>
      <p className="weekly-review__week">本周 {formatWeekLabel(current.weekStart)} · 上周对比</p>
      <div className="weekly-review__grid">
        {rows.map((row) => (
          <div className="weekly-review__card" key={row.label}>
            <span className="weekly-review__label">{row.label}</span>
            <span className="weekly-review__value">{row.value}</span>
            <span className="weekly-review__previous">上周 {row.previous}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * 表现趋势区块：近 12 周距离柱 + 效率因子折线（规格 §39 表现趋势）。
 *
 * @param series 周聚合序列
 * @param distanceUnit 距离显示单位
 * @param hasFtp 是否配置了 FTP（决定是否展示 TSS）
 */
function TrendSection({
  series,
  distanceUnit,
  hasFtp,
}: {
  series: readonly WeekSummary[]
  distanceUnit: 'km' | 'mi'
  hasFtp: boolean
}) {
  return (
    <section className="performance-trend" aria-label="表现趋势">
      <h2 className="performance-trend__title">近 {TREND_WEEKS} 周表现趋势</h2>
      {hasFtp && <p className="performance-trend__hint">柱：距离 · 绿线：效率因子 · 橙线：TSS</p>}
      {!hasFtp && <p className="performance-trend__hint">柱：距离 · 绿线：效率因子（配置 FTP 后展示 TSS）</p>}
      <div className="performance-trend__plot" role="img" aria-label="近 12 周距离与效率因子图">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT} initialDimension={INITIAL_DIMENSION}>
          <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="weekStart"
              tickFormatter={(date: string) => date.slice(5)}
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              minTickGap={24}
            />
            <YAxis
              yAxisId="distance"
              tickFormatter={(meters: number) => formatDistanceTick(meters, distanceUnit)}
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <YAxis
              yAxisId="ef"
              orientation="right"
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value, name) => {
                if (name === 'distance') {
                  return [formatDistanceByUnit(Number(value), distanceUnit), '距离']
                }
                if (name === 'tss') {
                  return [Math.round(Number(value)), 'TSS']
                }
                const ef = Number(value)
                return [Number.isFinite(ef) ? ef.toFixed(2) : '—', '效率因子']
              }}
              labelFormatter={(label) => `周起始 ${label}`}
            />
            <Bar
              yAxisId="distance"
              dataKey="distance"
              fill={SERIES_COLORS.distance}
              radius={[2, 2, 0, 0]}
              maxBarSize={18}
            />
            {hasFtp && (
              <Line
                yAxisId="ef"
                type="monotone"
                dataKey="tss"
                stroke={SERIES_COLORS.tss}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            )}
            <Line
              yAxisId="ef"
              type="monotone"
              dataKey="efficiencyFactor"
              stroke={SERIES_COLORS.ef}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

/**
 * 周起点标签：YYYY-MM-DD → MM-DD。
 *
 * @param date 周起点日期键
 */
function formatWeekLabel(date: string): string {
  return formatDate(`${date}T00:00:00`)
}

/**
 * 距离刻度显示：米 → 当前单位整数（公里显示 '82k'，英里显示 '51mi'）。
 *
 * @param meters 距离（米）
 * @param unit 距离显示单位
 */
function formatDistanceTick(meters: number, unit: 'km' | 'mi'): string {
  const value = Math.round(
    unit === 'mi' ? meters * 0.000621371 : meters / 1000,
  )
  return unit === 'mi' ? `${value}mi` : `${value}k`
}

/**
 * 时长格式化（周综述卡片用）。
 *
 * @param seconds 秒
 */
function formatDuration(seconds: number): string {
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/**
 * 爬升格式化（周综述卡片用）。
 *
 * @param meters 米
 */
function formatElevation(meters: number): string {
  return `${Math.round(meters)} m`
}

export default PerformancePage