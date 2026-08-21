/**
 * 表现趋势页面（规格 §39 表现趋势 / 每周训练综述）。
 *
 * 三块内容：
 * - 每周训练综述：本周 vs 上周聚合对比卡片（含较上周增减）
 * - 表现趋势：近 12 周训练量（距离/TSS/效率因子），EF 与 TSS 各自独立的右轴，
 *   叠加 4 周移动平均线便于识别趋势；FTP 未配置时隐藏 TSS（不伪造，规格 §26）
 * - 趋势解读：近 4 周 vs 前 4 周量化对比 + 最强/效率最高的一周（analyzePerformanceTrend）
 *
 * 数据流：摘要 → 周聚合纯函数（buildWeeklySeries / buildWeekReview）→ 趋势分析纯函数。
 * 依赖 FTP（训练配置）：无 FTP 仅隐藏 TSS 指标，其余照常展示。
 */
import { useEffect, useMemo, useState } from 'react'
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
import {
  analyzePerformanceTrend,
  formatPercentDelta,
  type PerformanceTrendInsights,
} from '@/features/analysis/performanceTrend'
import { formatDate } from '@/utils/format'
import { formatDistanceByUnit } from '@/features/settings/settings'
import '@/pages/PerformancePage.css'

/** 表现趋势周数（规格 §39） */
const TREND_WEEKS = 12

/** 图表高度（px） */
const CHART_HEIGHT = 280

/** 移动平均窗口（周，含当前周共 N 周） */
const MA_WINDOW_WEEKS = 4

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
const SERIES_COLORS = {
  distance: '#4f8cff',
  distanceMa4: '#8aa4c9',
  tss: '#ff9f0a',
  ef: '#34c759',
  efMa4: '#7db88b',
} as const

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

  // 趋势解读（纯函数，随周序列重算）
  const insights = useMemo(
    () => analyzePerformanceTrend(weeklySeries),
    [weeklySeries],
  )

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
          <TrendInsightsSection
            insights={insights}
            distanceUnit={distanceUnit}
            hasFtp={ftp !== undefined}
            totalWeeks={weeklySeries.length}
          />
        </>
      )}
    </>
  )
}

/**
 * 本周 vs 上周对比卡片（含较上周增减箭头）。
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
    {
      label: '骑行次数',
      value: current.rides,
      previous: previous.rides,
      format: (v: number) => `${v} 次`,
    },
    {
      label: '骑行距离',
      value: current.distance,
      previous: previous.distance,
      format: (v: number) => formatDistanceByUnit(v, distanceUnit),
    },
    {
      label: '骑行时长',
      value: current.duration,
      previous: previous.duration,
      format: formatDuration,
    },
    {
      label: '累计爬升',
      value: current.elevationGain,
      previous: previous.elevationGain,
      format: formatElevation,
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
            <span className="weekly-review__value">{row.format(row.value)}</span>
            <span className="weekly-review__previous">上周 {row.format(row.previous)}</span>
            <span className="weekly-review__delta">{deltaLabel(row.value, row.previous)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * 较上周增减文案（前值 0 时退化为有/无骑行）。
 *
 * @param value 本周值
 * @param previous 上周值
 * @returns 文案（如「较上周 ↑ 20.0%」/「较上周持平」）
 */
function deltaLabel(value: number, previous: number): string {
  if (previous === 0) {
    return value === 0 ? '较上周持平' : '较上周有骑行'
  }
  const ratio = (value - previous) / previous
  const percent = Math.abs(ratio) * 100
  if (percent < 0.5) {
    return '较上周持平'
  }
  return `较上周${ratio > 0 ? '↑' : '↓'} ${percent.toFixed(1)}%`
}

/**
 * 表现趋势区块：近 12 周距离柱 + 效率因子/TSS（独立右轴）+ 4 周移动平均线。
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
  // 图表数据 + 4 周移动平均（distance 恒有值；EF 无值时该周移动平均为已有值均值）
  const chartData = useMemo(
    () =>
      series.map((week, index) => {
        const window = series.slice(Math.max(0, index - MA_WINDOW_WEEKS + 1), index + 1)
        return {
          ...week,
          distanceMa4: movingAverage(window, 'distance'),
          efMa4: movingAverage(window, 'efficiencyFactor'),
        }
      }),
    [series],
  )

  return (
    <section className="performance-trend" aria-label="表现趋势">
      <h2 className="performance-trend__title">近 {TREND_WEEKS} 周表现趋势</h2>
      {hasFtp && (
        <p className="performance-trend__hint">
          柱：距离 · 橙线：TSS · 绿线：效率因子 · 虚线：4 周移动平均
        </p>
      )}
      {!hasFtp && (
        <p className="performance-trend__hint">
          柱：距离 · 绿线：效率因子 · 虚线：4 周移动平均（配置 FTP 后展示 TSS）
        </p>
      )}
      <div className="performance-trend__plot" role="img" aria-label="近 12 周距离与效率因子图">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT} initialDimension={INITIAL_DIMENSION}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
            {hasFtp && (
              <YAxis
                yAxisId="tss"
                orientation="right"
                tick={TICK_STYLE}
                tickLine={false}
                axisLine={false}
                width={42}
              />
            )}
            <YAxis
              yAxisId="ef"
              orientation="right"
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value, name) => {
                if (name === 'distance') {
                  return [formatDistanceByUnit(Number(value), distanceUnit), '距离']
                }
                if (name === 'distanceMa4') {
                  return [formatDistanceByUnit(Number(value), distanceUnit), '距离 4 周均']
                }
                if (name === 'tss') {
                  return [Math.round(Number(value)), 'TSS']
                }
                if (name === 'efMa4') {
                  const ef = Number(value)
                  return [Number.isFinite(ef) ? ef.toFixed(2) : '—', '效率因子 4 周均']
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
            <Line
              yAxisId="distance"
              type="monotone"
              dataKey="distanceMa4"
              stroke={SERIES_COLORS.distanceMa4}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            {hasFtp && (
              <Line
                yAxisId="tss"
                type="monotone"
                dataKey="tss"
                stroke={SERIES_COLORS.tss}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
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
            <Line
              yAxisId="ef"
              type="monotone"
              dataKey="efMa4"
              stroke={SERIES_COLORS.efMa4}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

/**
 * 趋势解读区块：近 4 周 vs 前 4 周量化对比 + 最强周/效率最高周。
 *
 * @param insights 趋势分析结果
 * @param distanceUnit 距离显示单位
 * @param hasFtp 是否配置了 FTP（决定是否展示 TSS 解读）
 * @param totalWeeks 观察窗口周数
 */
function TrendInsightsSection({
  insights,
  distanceUnit,
  hasFtp,
  totalWeeks,
}: {
  insights: PerformanceTrendInsights
  distanceUnit: 'km' | 'mi'
  hasFtp: boolean
  totalWeeks: number
}) {
  const cards = [
    {
      label: '近 4 周周均骑行',
      value: `${formatDistanceByUnit(insights.recentDistanceAvg, distanceUnit)}/周`,
      delta: formatPercentDelta(insights.distancePercentChange) ?? '—',
      deltaLabel: '较前 4 周',
    },
    {
      label: '近 4 周效率因子',
      value: insights.recentEfAvg !== undefined ? insights.recentEfAvg.toFixed(2) : '—',
      delta: formatPercentDelta(insights.efPercentChange) ?? '—',
      deltaLabel: '较前 4 周',
    },
  ]
  if (hasFtp) {
    cards.push({
      label: '近 4 周周均 TSS',
      value: insights.recentTssAvg !== undefined ? String(Math.round(insights.recentTssAvg)) : '—',
      delta: formatPercentDelta(insights.tssPercentChange) ?? '—',
      deltaLabel: '较前 4 周',
    })
  }
  cards.push({
    label: '训练节奏',
    value: `${insights.activeWeeks}/${totalWeeks} 周活跃 · ${insights.idleWeeks} 周休息`,
    delta: '',
    deltaLabel: '',
  })

  // 一段式解读（可读性优先，缺数据项跳过）
  const notes: string[] = []
  if (insights.distancePercentChange !== undefined) {
    const arrow = insights.distancePercentChange > 0 ? '上升' : '下降'
    notes.push(
      `训练量：近 4 周周均 ${formatDistanceByUnit(insights.recentDistanceAvg, distanceUnit)}，较前 4 周${arrow} ${Math.abs(insights.distancePercentChange).toFixed(0)}%（前 4 周周均 ${formatDistanceByUnit(insights.previousDistanceAvg, distanceUnit)}）。`,
    )
  }
  if (insights.efPercentChange !== undefined && insights.recentEfAvg !== undefined) {
    const arrow = insights.efPercentChange > 0 ? '提升' : '下降'
    notes.push(
      `效率因子：近 4 周平均 ${insights.recentEfAvg.toFixed(2)}，较前 4 周${arrow} ${Math.abs(insights.efPercentChange).toFixed(0)}%。`,
    )
  }
  if (insights.bestDistanceWeek !== undefined) {
    notes.push(
      `最强的一周：${formatWeekLabel(insights.bestDistanceWeek.weekStart)}，骑行 ${formatDistanceByUnit(insights.bestDistanceWeek.distance, distanceUnit)}。`,
    )
  }
  if (insights.bestEfWeek !== undefined) {
    notes.push(
      `效率最高的一周：${formatWeekLabel(insights.bestEfWeek.weekStart)}，效率因子 ${insights.bestEfWeek.efficiencyFactor!.toFixed(2)}。`,
    )
  }
  if (insights.idleWeeks > 0) {
    notes.push(`近 ${totalWeeks} 周有 ${insights.idleWeeks} 周完全休息，注意保持节奏一致性。`)
  }

  return (
    <section className="performance-insights" aria-label="趋势解读">
      <h2 className="performance-insights__title">趋势解读</h2>
      <div className="performance-insights__grid">
        {cards.map((card) => (
          <div className="performance-insights__card" key={card.label}>
            <span className="performance-insights__label">{card.label}</span>
            <span className="performance-insights__value">{card.value}</span>
            {card.delta !== '' && (
              <span className="performance-insights__delta">
                {card.deltaLabel} {card.delta}
              </span>
            )}
          </div>
        ))}
      </div>
      {notes.length > 0 && (
        <ul className="performance-insights__notes" aria-label="趋势解读说明">
          {notes.map((note, index) => (
            <li key={index} className="performance-insights__note">
              {note}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * 一组周字段的滚动均值（缺值周跳过；窗口无字段值返回 undefined）。
 *
 * @param weeks 窗口内周
 * @param field 指标字段
 * @returns 均值；无有效值 undefined
 */
function movingAverage(
  weeks: readonly WeekSummary[],
  field: 'distance' | 'efficiencyFactor',
): number | undefined {
  const values = weeks
    .map((week) => week[field])
    .filter((value): value is number => value !== undefined)
  if (values.length === 0) {
    return undefined
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * 周起点标签：YYYY-MM-DD → 本地日期。
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