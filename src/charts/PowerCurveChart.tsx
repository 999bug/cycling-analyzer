/**
 * 功率曲线图表（规格 §39 P2）：X 轴为时长（对数刻度），Y 轴为最佳平均功率。
 * 曲线由 buildPowerCurve 纯函数产出，无功率数据时显示空态提示（规格 §25）。
 */
import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ActivityRecord } from '@/types/activity'
import { buildPowerCurve } from '@/features/analysis/powerCurve'
import ChartCard from '@/charts/ChartCard'

/**
 * 功率曲线图表 props。
 */
export interface PowerCurveChartProps {
  /** 逐点记录 */
  records: readonly ActivityRecord[]
}

/** 深色主题下坐标轴文字颜色（与 MetricChart 一致） */
const AXIS_TICK_COLOR = 'var(--text-secondary)'

/** 深色主题下网格线颜色（与 MetricChart 一致） */
const GRID_COLOR = 'var(--border)'

/**
 * 时长轴标签格式化（秒 → 人类可读）。
 *
 * @param seconds 时长（秒）
 * @returns 如 "5s" / "1min" / "1h"
 */
function formatCurveDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  }
  if (seconds < 3600) {
    return `${seconds / 60}min`
  }
  return `${seconds / 3600}h`
}

/**
 * 功率曲线图表。
 *
 * @param props 组件参数
 */
function PowerCurveChart({ records }: PowerCurveChartProps) {
  const curve = useMemo(() => buildPowerCurve(records), [records])
  // 功率取整展示（曲线语义为最佳平均功率，小数无意义）
  const data = curve.map((point) => ({
    duration: point.duration,
    power: Math.round(point.power),
  }))

  // 无功率数据时整区块隐藏（不保留空态卡片）
  if (data.length === 0) {
    return null
  }

  return (
    <ChartCard title="功率曲线" hasData={data.length > 0} emptyText="该活动没有功率数据">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="duration"
            type="number"
            scale="log"
            domain={[1, 'dataMax']}
            ticks={data.map((point) => point.duration)}
            tickFormatter={formatCurveDuration}
            tick={{ fill: AXIS_TICK_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
          />
          <YAxis
            width={44}
            domain={[0, 'auto']}
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
            labelFormatter={(label) => formatCurveDuration(Number(label))}
            formatter={(value) => [`${Number(value)} W`, '最佳平均功率']}
            cursor={{ stroke: 'var(--text-secondary)', strokeDasharray: '3 3' }}
          />
          <Line
            type="monotone"
            dataKey="power"
            stroke="#ff9f0a"
            strokeWidth={2}
            dot={{ r: 2, fill: '#ff9f0a' }}
            isAnimationActive={false}
          />
        </RechartsLineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export default PowerCurveChart
