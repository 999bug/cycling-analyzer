/**
 * 组合图表（规格 §17 后续增加）：速度+心率 / 功率+心率 双 Y 轴。
 * - 左 Y 轴为第一指标（速度/功率），右 Y 轴为心率（yAxisId 区分）
 * - X 轴支持 时间/距离 切换
 * - 双序列共用同一 x 基准（buildCombinedSeries），时间/距离轴严格对齐
 * - 单序列缺失时优雅降级：仅渲染有数据的一侧（如无心率只显示速度线）
 */
import { useMemo, useState } from 'react'
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ActivityRecord } from '@/types/activity'
import type { CategoricalChartFunc } from 'recharts/types/chart/types'
import { formatAxisDistance, formatAxisTime, formatValue } from '@/charts/axis'
import ChartCard from '@/charts/ChartCard'
import type { XAxisMode } from '@/charts/series'
import { buildCombinedSeries } from '@/charts/series'
import {
  seriesPointAtTimestamp,
  TIMELINE_CURSOR_COLOR,
  TIMELINE_CURSOR_DASH,
} from '@/charts/timeline'

/**
 * 组合模式：速度+心率 / 功率+心率。
 */
export type CombinedChartMode = 'speedHeartRate' | 'powerHeartRate'

/**
 * 组合图表 props。
 */
export interface CombinedChartProps {
  /** 组合模式 */
  mode: CombinedChartMode

  /** 逐点记录 */
  records: readonly ActivityRecord[]

  /** 共享时间轴：外部悬停时间戳 */
  hoverTimestamp?: number

  /** 共享时间轴：上报本图悬停时间戳 */
  onHover?: (timestamp: number | undefined) => void
}

/** 心率线颜色（与心率图一致） */
const HEART_RATE_COLOR = '#ff6482'

/** 深色主题下坐标轴文字颜色 */
const AXIS_TICK_COLOR = 'var(--text-secondary)'

/** 深色主题下网格线颜色 */
const GRID_COLOR = 'var(--border)'

/**
 * 组合模式展示元数据。
 */
interface ModeMeta {
  /** 图表标题 */
  title: string

  /** 第一指标名称（Tooltip 序列名） */
  primaryName: string

  /** 第一指标线颜色（与对应单指标图一致） */
  primaryColor: string

  /** 第一指标单位（km/h 为换算展示单位） */
  primaryUnit: string

  /** 无数据提示文案 */
  emptyText: string
}

/** 组合模式元数据表 */
const MODE_META: Record<CombinedChartMode, ModeMeta> = {
  speedHeartRate: {
    title: '速度 + 心率',
    primaryName: '速度',
    primaryColor: '#4f8cff',
    primaryUnit: 'km/h',
    emptyText: '该活动没有速度和心率数据',
  },
  powerHeartRate: {
    title: '功率 + 心率',
    primaryName: '功率',
    primaryColor: '#ff9f0a',
    primaryUnit: 'W',
    emptyText: '该活动没有功率和心率数据',
  },
}

/**
 * 组合图表。
 *
 * @param props 组件参数
 */
function CombinedChart({ mode, records, hoverTimestamp, onHover }: CombinedChartProps) {
  // X 轴模式：默认距离，与单指标图表一致
  const [axisMode, setAxisMode] = useState<XAxisMode>('distance')
  const meta = MODE_META[mode]
  const primaryField = mode === 'speedHeartRate' ? 'speed' : 'power'

  const series = useMemo(
    () => buildCombinedSeries(records, primaryField, axisMode),
    [records, primaryField, axisMode],
  )

  // 各序列是否有数据：仅渲染有数据的一侧（优雅降级）
  const hasPrimary = series.some((point) => point.primary !== undefined)
  const hasHeartRate = series.some((point) => point.heartRate !== undefined)

  // 外部悬停时间戳 → 本图序列点（ReferenceLine 定位 x）
  const cursorPoint = useMemo(
    () => seriesPointAtTimestamp(series, hoverTimestamp),
    [series, hoverTimestamp],
  )

  // 图表级鼠标移动：上报最接近的序列点时间戳（共享时间轴）
  const handleMouseMove: CategoricalChartFunc = (state) => {
    if (onHover === undefined) {
      return
    }
    const index = typeof state.activeTooltipIndex === 'number' ? state.activeTooltipIndex : undefined
    const point = index !== undefined ? series[index] : undefined
    onHover(point?.timestamp)
  }

  const handleMouseLeave = () => {
    onHover?.(undefined)
  }

  const xLabel = (x: number) => (axisMode === 'time' ? formatAxisTime(x) : formatAxisDistance(x))

  const formatPrimary = (value: number, withSuffix: boolean) =>
    formatValue(value, meta.primaryUnit, withSuffix)

  return (
    <ChartCard
      title={meta.title}
      hasData={series.length > 0}
      emptyText={meta.emptyText}
      extra={
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
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart
          data={series}
          margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
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
          {hasPrimary && (
            <YAxis
              yAxisId="primary"
              width={44}
              domain={['auto', 'auto']}
              tickFormatter={(value: number) => formatPrimary(value, false)}
              tick={{ fill: AXIS_TICK_COLOR, fontSize: 11 }}
              stroke={GRID_COLOR}
            />
          )}
          {hasHeartRate && (
            <YAxis
              yAxisId="heartRate"
              orientation="right"
              width={44}
              domain={['auto', 'auto']}
              tickFormatter={(value: number) => formatValue(value, 'bpm', false)}
              tick={{ fill: AXIS_TICK_COLOR, fontSize: 11 }}
              stroke={GRID_COLOR}
            />
          )}
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: 'var(--text-secondary)' }}
            labelFormatter={(label) => xLabel(Number(label))}
            formatter={(value, name) => {
              const label = String(name)
              // 心率恒为 bpm，其余按第一指标单位格式化
              const unit = label === '心率' ? 'bpm' : meta.primaryUnit
              return [formatValue(Number(value), unit, true), label]
            }}
            cursor={{ stroke: 'var(--text-secondary)', strokeDasharray: '3 3' }}
          />
          {cursorPoint !== undefined && (
            <ReferenceLine
              x={cursorPoint.x}
              stroke={TIMELINE_CURSOR_COLOR}
              strokeDasharray={TIMELINE_CURSOR_DASH}
              ifOverflow="discard"
            />
          )}
          {hasPrimary && (
            <Line
              type="monotone"
              yAxisId="primary"
              dataKey="primary"
              name={meta.primaryName}
              stroke={meta.primaryColor}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {hasHeartRate && (
            <Line
              type="monotone"
              yAxisId="heartRate"
              dataKey="heartRate"
              name="心率"
              stroke={HEART_RATE_COLOR}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          )}
          <Brush dataKey="x" height={22} travellerWidth={8} stroke={GRID_COLOR} fill="transparent" />
        </RechartsLineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export default CombinedChart
