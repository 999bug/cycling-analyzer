/**
 * 共享指标图表实现（内部组件，不对外导出）。
 *
 * 四个公开图表（速度/心率/海拔/功率）的公共骨架：
 * - series 由 buildSeries 纯函数产出，缺失字段自动过滤
 * - X 轴支持 时间/距离 切换（switchable=false 时固定距离，海拔图用）
 * - Tooltip + Brush 缩放（规格 §17）
 * - 无数据时由 ChartCard 显示空态提示，不渲染图表（规格 §25）
 */
import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart as RechartsAreaChart,
  Brush,
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ActivityRecord } from '@/types/activity'
import { formatAxisDistance, formatAxisTime, formatValue } from '@/charts/axis'
import ChartCard from '@/charts/ChartCard'
import type { ChartSeriesPoint, MetricField, XAxisMode } from '@/charts/series'
import { buildSeries } from '@/charts/series'

/**
 * 指标元数据：颜色与 Tooltip 单位。
 */
export interface MetricMeta {
  /** 图表主色 */
  color: string

  /** 数值单位（Tooltip / Y 轴） */
  unit: string
}

/**
 * 共享图表 props。
 */
export interface MetricChartProps {
  /** 图表标题 */
  title: string

  /** 指标字段（series 取值字段） */
  metric: MetricField

  /** 逐点记录 */
  records: readonly ActivityRecord[]

  /** 指标元数据 */
  meta: MetricMeta

  /** 是否允许切换时间/距离 X 轴（false = 固定距离轴，海拔图用） */
  switchable?: boolean

  /** 无数据提示文案 */
  emptyText?: string

  /** 是否用面积渲染（海拔图） */
  area?: boolean
}

/** 深色主题下坐标轴文字颜色 */
const AXIS_TICK_COLOR = 'var(--text-secondary)'

/** 深色主题下网格线颜色 */
const GRID_COLOR = 'var(--border)'

/**
 * 共享指标图表。
 *
 * @param props 组件参数
 */
function MetricChart({
  title,
  metric,
  records,
  meta,
  switchable = true,
  emptyText,
  area = false,
}: MetricChartProps) {
  // X 轴模式：默认距离；不可切换时固定距离（海拔图）
  const [axisMode, setAxisMode] = useState<XAxisMode>('distance')
  const mode = switchable ? axisMode : 'distance'

  const series = useMemo(() => buildSeries(records, metric, mode), [records, metric, mode])

  const xLabel = (x: number) =>
    mode === 'time' ? formatAxisTime(x) : formatAxisDistance(x)

  // 面积图渐变填充 id（单个页面只有一张面积图，唯一即可）
  const gradientId = `chart-fill-${metric}`

  return (
    <ChartCard
      title={title}
      hasData={series.length > 0}
      emptyText={emptyText}
      extra={
        switchable ? (
          <div className="chart-card__toggle" role="group" aria-label="横轴切换">
            <button
              type="button"
              className={mode === 'distance' ? 'chart-card__toggle--active' : undefined}
              aria-pressed={mode === 'distance'}
              onClick={() => setAxisMode('distance')}
            >
              距离
            </button>
            <button
              type="button"
              className={mode === 'time' ? 'chart-card__toggle--active' : undefined}
              aria-pressed={mode === 'time'}
              onClick={() => setAxisMode('time')}
            >
              时间
            </button>
          </div>
        ) : undefined
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <ChartBase series={series} meta={meta} xLabel={xLabel} gradientId={gradientId} area={area} />
      </ResponsiveContainer>
    </ChartCard>
  )
}

/**
 * 图表骨架（坐标轴 + 网格 + Tooltip + Brush + 序列）。
 * recharts 3 中 Area 必须在 AreaChart 内渲染（LineChart 会忽略 Area 曲线），
 * 故按 area 标志切换容器组件。
 */
function ChartBase({
  series,
  meta,
  xLabel,
  gradientId,
  area,
}: {
  series: ChartSeriesPoint[]
  meta: MetricMeta
  xLabel: (x: number) => string
  gradientId: string
  area: boolean
}) {
  const axes = (
    <>
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
      <YAxis
        width={44}
        domain={['auto', 'auto']}
        tickFormatter={(value: number) => formatValue(value, meta.unit, false)}
        tick={{ fill: AXIS_TICK_COLOR, fontSize: 11 }}
        stroke={GRID_COLOR}
      />
      <Tooltip
        contentStyle={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 12,
        }}
        labelStyle={{ color: 'var(--text-secondary)' }}
        labelFormatter={(label) => xLabel(Number(label))}
        formatter={(value) => [formatValue(Number(value), meta.unit, true), meta.unit]}
        cursor={{ stroke: 'var(--text-secondary)', strokeDasharray: '3 3' }}
      />
    </>
  )

  const brush = (
    <Brush dataKey="x" height={22} travellerWidth={8} stroke={GRID_COLOR} fill="transparent" />
  )

  if (area) {
    return (
      <RechartsAreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        {axes}
        <AreaSeries meta={meta} gradientId={gradientId} />
        {brush}
      </RechartsAreaChart>
    )
  }
  return (
    <RechartsLineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
      {axes}
      <LineSeries meta={meta} />
      {brush}
    </RechartsLineChart>
  )
}

/** 折线序列 */
function LineSeries({ meta }: { meta: MetricMeta }) {
  return (
    <Line
      type="monotone"
      dataKey="y"
      stroke={meta.color}
      strokeWidth={2}
      dot={false}
      isAnimationActive={false}
    />
  )
}

/** 面积序列（海拔图渐变填充） */
function AreaSeries({ meta, gradientId }: { meta: MetricMeta; gradientId: string }) {
  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={meta.color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={meta.color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <Area
        type="monotone"
        dataKey="y"
        stroke={meta.color}
        strokeWidth={2}
        fill={`url(#${gradientId})`}
        dot={false}
        isAnimationActive={false}
      />
    </>
  )
}

export default MetricChart
