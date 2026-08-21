/**
 * 多指标曲线卡片（规格 §17 演进：单指标图合并为开关式多指标卡）。
 *
 * 地图下方唯一的「数据曲线」卡：速度/心率/踏频/功率/温度等指标通过
 * chip 开关自由叠加，默认显示海拔曲线（无海拔数据时取第一个有数据的指标）。
 * 悬停 Tooltip 显示所有已打开指标在该点的真实数值（缺失显示 '—'，规格 §25）。
 *
 * 量纲差异大，各指标归一化到 [0,1] 叠加渲染（Y 轴隐藏），真实数值由
 * 渲染点携带的原始值字段供 Tooltip 展示；海拔用面积渐变作视觉锚点。
 *
 * 悬浮联动与性能：与爬坡剖面一致——图表子树 memo 化（props 全稳定），
 * 自悬停（hoverTimestamp 与本图最近上报值一致）时跳过外部参考线，
 * mousemove 期间整棵图表子树零重渲染。
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { Fragment } from 'react'
import {
  Area,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CategoricalChartFunc } from 'recharts/types/chart/types'
import type { ActivityRecord } from '@/types/activity'
import type { MetricField, XAxisMode } from '@/charts/series'
import {
  availableMetrics,
  buildMultiMetricRenderData,
  buildMultiMetricSeries,
  metricRanges,
  MULTI_METRIC_META,
  normDataKey,
  type MultiMetricMetaEntry,
  type MultiMetricRenderPoint,
} from '@/charts/multiMetricSeries'
import { formatAxisDistance, formatAxisTime, formatValue } from '@/charts/axis'
import {
  activeTooltipIndexToNumber,
  findNearestByTimestamp,
  TIMELINE_CURSOR_COLOR,
  TIMELINE_CURSOR_DASH,
} from '@/charts/timeline'
import '@/charts/charts.css'
import '@/charts/multiMetric.css'

/**
 * 多指标曲线卡片 props。
 */
export interface MultiMetricChartProps {
  /** 逐点记录（建议传入抽稀后的数据，性能优化见 downsampleRecords） */
  records: readonly ActivityRecord[]

  /** 共享时间轴：外部悬停时间戳（Unix 秒）；命中时渲染参考线光标 */
  hoverTimestamp?: number

  /** 共享时间轴：上报本图悬停时间戳（移出传 undefined） */
  onHover?: (timestamp: number | undefined) => void
}

/** 坐标轴文字颜色 */
const AXIS_TICK_COLOR = 'var(--text-secondary)'

/** 网格线颜色 */
const GRID_COLOR = 'var(--border)'

/** 海拔面积渐变填充 id（详情页仅一张多指标卡，唯一即可） */
const ALTITUDE_GRADIENT_ID = 'multi-metric-altitude-fill'

/** 归一化 Y 轴显示域（上下各留 6% 呼吸空间） */
const NORM_AXIS_DOMAIN: [number, number] = [-0.06, 1.06]

/** 无任何可用指标时的空态文案 */
const EMPTY_NO_DATA_TEXT = '该活动没有曲线数据'

/** 全部开关关闭时的引导文案 */
const EMPTY_ALL_OFF_TEXT = '已关闭全部指标，点击上方开关查看曲线'

/** Recharts Tooltip 传入项（payload 内层为渲染数据行） */
interface TooltipEntry {
  payload?: MultiMetricRenderPoint
}

/** 自定义 Tooltip 组件 props（metrics/axisMode 经 content 元素透传） */
interface MultiMetricTooltipProps {
  active?: boolean
  payload?: ReadonlyArray<TooltipEntry>
  metrics: readonly MultiMetricMetaEntry[]
  axisMode: XAxisMode
}

/**
 * 多指标悬浮卡（Recharts Tooltip 自定义内容）：
 * 标题为悬停位置（距离/时间），每行一个已开指标（色点 + 名称 + 真实数值）。
 *
 * @param props 组件参数
 */
function MultiMetricTooltipContent({ active, payload, metrics, axisMode }: MultiMetricTooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || point === undefined) {
    return null
  }
  const xAxis = point.x ?? 0
  const title = axisMode === 'time' ? formatAxisTime(xAxis) : formatAxisDistance(xAxis)

  return (
    <div className="multi-metric__tooltip" data-testid="multi-metric-tooltip">
      <p className="multi-metric__tooltip-title">{title}</p>
      {metrics.map((meta) => {
        const value = point[meta.field]
        return (
          <div className="multi-metric__tooltip-row" key={meta.field}>
            <i className="multi-metric__tooltip-dot" style={{ backgroundColor: meta.color }} />
            <span className="multi-metric__tooltip-name">{meta.label}</span>
            <span className="multi-metric__tooltip-value">
              {value === undefined ? '—' : formatValue(value, meta.unit, true)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** 图表子树 props（全部稳定引用：数据经 useMemo、回调经 useCallback） */
interface MetricCurveChartProps {
  /** 归一化渲染数据（画线 + Tooltip 原始值同点携带） */
  data: MultiMetricRenderPoint[]

  /** 已开指标元数据（MULTI_METRIC_META 顺序） */
  metrics: readonly MultiMetricMetaEntry[]

  /** X 轴模式（距离/时间） */
  axisMode: XAxisMode

  /** 外部共享时间轴光标 x（本图自悬停时为 undefined） */
  cursorX: number | undefined

  /** 悬停上报：滑过曲线时上报所在点时间戳（Unix 秒）；移出时传 undefined */
  onHover: (timestamp: number | undefined) => void
}

/**
 * 图表子树（memo 化）：mousemove 期间 recharts 只更新内部 Tooltip，
 * 本子树因 props 全稳定而不重渲染——悬停流畅的关键。
 *
 * @param props 组件参数
 */
const MetricCurveChart = memo(function MetricCurveChart({
  data,
  metrics,
  axisMode,
  cursorX,
  onHover,
}: MetricCurveChartProps) {
  // 图表鼠标移动：Tooltip 命中数据点 → 上报时间戳（共享时间轴联动地图/剖面）
  const handleMouseMove: CategoricalChartFunc = (state) => {
    const index = activeTooltipIndexToNumber(state.activeTooltipIndex)
    const point = index !== undefined ? data[index] : undefined
    onHover(point?.timestamp)
  }

  // 移出图表：清除共享时间轴悬停
  const handleMouseLeave = () => {
    onHover(undefined)
  }

  const xLabel = (x: number) => (axisMode === 'time' ? formatAxisTime(x) : formatAxisDistance(x))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={data}
        margin={{ top: 16, right: 8, bottom: 0, left: 0 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="x"
          type="number"
          domain={['auto', 'auto']}
          tickCount={6}
          tickFormatter={xLabel}
          tick={{ fill: AXIS_TICK_COLOR, fontSize: 11 }}
          stroke={GRID_COLOR}
        />
        {/* 量纲不同，各指标归一化叠加；单一刻度轴无意义故隐藏 */}
        <YAxis hide domain={NORM_AXIS_DOMAIN} width={0} />

        {metrics.map((meta) =>
          meta.field === 'altitude' ? (
            <Fragment key="altitude">
              <defs>
                <linearGradient id={ALTITUDE_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={meta.color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={meta.color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey={normDataKey('altitude')}
                name={meta.label}
                stroke={meta.color}
                strokeWidth={2}
                fill={`url(#${ALTITUDE_GRADIENT_ID})`}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
                activeDot={false}
              />
            </Fragment>
          ) : (
            <Line
              key={meta.field}
              type="monotone"
              dataKey={normDataKey(meta.field)}
              name={meta.label}
              stroke={meta.color}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
              activeDot={false}
            />
          ),
        )}

        {/* 外部共享时间轴光标（本图自悬停时由 Tooltip 光标指示，不渲染） */}
        {cursorX !== undefined && (
          <ReferenceLine
            x={cursorX}
            stroke={TIMELINE_CURSOR_COLOR}
            strokeDasharray={TIMELINE_CURSOR_DASH}
            ifOverflow="discard"
          />
        )}

        <Tooltip
          content={<MultiMetricTooltipContent metrics={metrics} axisMode={axisMode} />}
          cursor={{ stroke: 'var(--text-secondary)', strokeDasharray: '3 3' }}
          isAnimationActive={false}
        />
        <Brush dataKey="x" height={22} travellerWidth={8} stroke={GRID_COLOR} fill="transparent" />
      </ComposedChart>
    </ResponsiveContainer>
  )
})

/**
 * 多指标曲线卡片。
 *
 * @param props 组件参数
 */
function MultiMetricChart({ records, hoverTimestamp, onHover }: MultiMetricChartProps) {
  // X 轴模式：默认距离，与原单指标图表一致
  const [axisMode, setAxisMode] = useState<XAxisMode>('distance')
  // 用户显式开关状态（undefined = 尚未操作，用默认：海拔或首个有数据指标）
  const [userEnabled, setUserEnabled] = useState<readonly MetricField[]>()

  // 有数据的指标（chips 只展示这些，避免死开关）
  const available = useMemo(() => availableMetrics(records), [records])

  // 生效指标：默认海拔（无海拔取首个可用）；用户操作后以其选择为准，
  // 与可用指标取交集防御活动切换后的过期选择
  const enabled = useMemo(() => {
    const base =
      userEnabled ??
      (available.includes('altitude') ? ['altitude' as const] : available.slice(0, 1))
    return base.filter((field) => available.includes(field))
  }, [userEnabled, available])

  // 对齐序列 + 值域 + 归一化渲染数据
  const series = useMemo(
    () => buildMultiMetricSeries(records, enabled, axisMode),
    [records, enabled, axisMode],
  )
  const ranges = useMemo(() => metricRanges(series, enabled), [series, enabled])
  const chartData = useMemo(
    () => buildMultiMetricRenderData(series, ranges, enabled),
    [series, ranges, enabled],
  )

  // chip / Tooltip 用的元数据（保持 MULTI_METRIC_META 顺序；引用稳定供 memo 子树）
  const availableMeta = useMemo(
    () => MULTI_METRIC_META.filter((meta) => available.includes(meta.field)),
    [available],
  )
  const enabledMeta = useMemo(
    () => MULTI_METRIC_META.filter((meta) => enabled.includes(meta.field)),
    [enabled],
  )

  // 最近一次由本图上报的悬停时间戳（区分「自己悬停」与「外部联动」）
  const lastReportedTimestampRef = useRef<number | undefined>(undefined)

  // 本图悬停上报：记录时间戳后转发上层（共享时间轴）
  const handleChartHover = useCallback(
    (timestamp: number | undefined) => {
      lastReportedTimestampRef.current = timestamp
      onHover?.(timestamp)
    },
    [onHover],
  )

  // 指标开关：点击 chip 切换启用状态（以当前生效集合为基础增删）
  const handleToggle = useCallback(
    (field: MetricField) => {
      setUserEnabled((previous) => {
        const base =
          previous ??
          (available.includes('altitude') ? ['altitude' as const] : available.slice(0, 1))
        return base.includes(field)
          ? base.filter((item) => item !== field)
          : [...base, field]
      })
    },
    [available],
  )

  // 外部共享时间轴光标：仅在悬停来自其他图表/地图时渲染。
  // 自悬停（hoverTimestamp 与本图最近上报值一致）时跳过——Tooltip 光标已在指示
  // 位置，参考线冗余；跳过后 memo 化的图表子树在 mousemove 期间完全免于重渲染
  const cursorPoint =
    hoverTimestamp !== undefined &&
    // ref 在事件处理器里先于触发本渲染的 setState 写入，渲染期读取安全
    // （最坏情况仅光标显隐一帧误差），故豁免 react-hooks/refs
    // eslint-disable-next-line react-hooks/refs -- 自悬停判定需渲染期对比最近上报值
    hoverTimestamp !== lastReportedTimestampRef.current
      ? findNearestByTimestamp(series, hoverTimestamp)
      : undefined

  const hasData = series.length > 0
  const emptyText = available.length === 0 ? EMPTY_NO_DATA_TEXT : EMPTY_ALL_OFF_TEXT

  return (
    <section className="chart-card multi-metric" aria-label="数据曲线">
      <header className="chart-card__header">
        <h3 className="chart-card__title">数据曲线</h3>
        <div className="chart-card__toggle" role="group" aria-label="横轴切换">
          <button
            type="button"
            className={axisMode === 'distance' ? 'chart-card__toggle--active' : undefined}
            aria-pressed={axisMode === 'distance'}
            onClick={() => setAxisMode('distance')}
          >
            距离
          </button>
          <button
            type="button"
            className={axisMode === 'time' ? 'chart-card__toggle--active' : undefined}
            aria-pressed={axisMode === 'time'}
            onClick={() => setAxisMode('time')}
          >
            时间
          </button>
        </div>
      </header>

      {availableMeta.length > 0 && (
        <div className="multi-metric__toggles" role="group" aria-label="指标开关">
          {availableMeta.map((meta) => {
            const active = enabled.includes(meta.field)
            return (
              <button
                key={meta.field}
                type="button"
                className="multi-metric__toggle"
                aria-pressed={active}
                onClick={() => handleToggle(meta.field)}
                style={
                  active
                    ? {
                        borderColor: meta.color,
                        color: meta.color,
                        backgroundColor: `${meta.color}1f`,
                      }
                    : undefined
                }
              >
                <i className="multi-metric__toggle-dot" style={{ backgroundColor: meta.color }} />
                {meta.label}
              </button>
            )
          })}
        </div>
      )}

      {hasData ? (
        <div className="chart-card__body">
          <MetricCurveChart
            data={chartData}
            metrics={enabledMeta}
            axisMode={axisMode}
            cursorX={cursorPoint?.x}
            onHover={handleChartHover}
          />
        </div>
      ) : (
        <div className="chart-card__empty">{emptyText}</div>
      )}
    </section>
  )
}

export default MultiMetricChart
