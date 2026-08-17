/**
 * 年度回顾月度距离图（后续工作项：年度回顾）。
 *
 * 选中年份的 1-12 月骑行距离柱状图，Tooltip 展示距离与次数。
 * 深色主题复用全局 CSS 变量；jsdom 测试通过 initialDimension 提供固定尺寸。
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MonthlyDistance } from '@/features/yearReview/yearReview'
import {
  convertDistance,
  formatDistanceByUnit,
  type DistanceUnit,
} from '@/features/settings/settings'

/** 图表高度（px） */
const CHART_HEIGHT = 240

/** 测试环境固定初始尺寸（jsdom 无布局测量） */
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

interface MonthlyDistanceChartProps {
  /** 12 个月聚合数据 */
  months: readonly MonthlyDistance[]

  /** 距离显示单位（缺省公里，规格 §27） */
  distanceUnit?: DistanceUnit
}

/**
 * 年度月度距离柱状图。
 *
 * @param props 组件参数
 */
function MonthlyDistanceChart({ months, distanceUnit = 'km' }: MonthlyDistanceChartProps) {
  const data = months.map((entry) => ({
    label: `${entry.month}月`,
    distance: Math.round(convertDistance(entry.distance, distanceUnit) * 10) / 10,
    count: entry.count,
    rawDistance: entry.distance,
  }))

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT} initialDimension={INITIAL_DIMENSION}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={TICK_STYLE} tickLine={false} axisLine={false} />
        <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: 'rgba(255, 255, 255, 0.04)' }}
          formatter={(_, __, item) => [
            `${formatDistanceByUnit(item.payload.rawDistance, distanceUnit)} / ${item.payload.count} 次`,
            '距离',
          ]}
        />
        <Bar dataKey="distance" fill="var(--primary)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export default MonthlyDistanceChart
