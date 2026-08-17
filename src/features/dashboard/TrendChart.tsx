/**
 * 距离趋势图（规格 §13）：30 / 90 / 365 天每日骑行距离柱状图，Tab 切换粒度。
 * 使用 Recharts；深色主题复用全局 CSS 变量（--text-secondary / --border / --primary）。
 * jsdom 测试通过 initialDimension 提供固定初始尺寸，无需真实布局测量。
 */
import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TrendSeries } from '@/features/dashboard/statistics'
import {
  convertDistance,
  formatDistanceByUnit,
  type DistanceUnit,
} from '@/features/settings/settings'
import '@/features/dashboard/TrendChart.css'

interface TrendChartProps {
  /** 各粒度趋势序列 */
  trends: TrendSeries

  /** 距离显示单位（缺省公里，规格 §27） */
  distanceUnit?: DistanceUnit
}

/** 粒度切换选项 */
const RANGE_OPTIONS = [
  { key: 'days30', label: '近 30 天' },
  { key: 'days90', label: '近 90 天' },
  { key: 'year', label: '近一年' },
] as const

type RangeKey = (typeof RANGE_OPTIONS)[number]['key']

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

/**
 * 距离趋势图：粒度 Tab + Recharts 柱状图。
 *
 * @param props 趋势序列
 */
function TrendChart({ trends, distanceUnit = 'km' }: TrendChartProps) {
  const [rangeKey, setRangeKey] = useState<RangeKey>('days30')
  const data = trends[rangeKey]

  return (
    <section className="trend-chart" aria-label="距离趋势">
      <div className="trend-chart__tabs" role="tablist" aria-label="趋势粒度">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={rangeKey === option.key}
            className={
              rangeKey === option.key
                ? 'trend-chart__tab trend-chart__tab--active'
                : 'trend-chart__tab'
            }
            onClick={() => setRangeKey(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="trend-chart__plot" role="img" aria-label="每日骑行距离柱状图">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT} initialDimension={INITIAL_DIMENSION}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateTick}
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              minTickGap={32}
            />
            <YAxis
              tickFormatter={(meters: number) => formatDistanceTick(meters, distanceUnit)}
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value) => [formatDistanceByUnit(Number(value), distanceUnit), '距离']}
              labelFormatter={(label) => `日期 ${label}`}
            />
            <Bar dataKey="distance" fill="var(--primary)" radius={[2, 2, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

/**
 * 日期刻度显示：YYYY-MM-DD → MM-DD。
 *
 * @param date 完整日期键
 */
function formatDateTick(date: string): string {
  return date.slice(5)
}

/**
 * 距离刻度显示：米 → 当前单位整数（公里显示 '82k'，英里显示 '51mi'）。
 *
 * @param meters 距离（米）
 * @param unit 距离显示单位
 */
function formatDistanceTick(meters: number, unit: DistanceUnit): string {
  const value = Math.round(convertDistance(meters, unit))
  return unit === 'mi' ? `${value}mi` : `${value}k`
}

export default TrendChart
