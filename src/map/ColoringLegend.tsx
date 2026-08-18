/**
 * 轨迹着色图例（规格 §16 辅助说明）。
 *
 * 详情页开启轨迹着色（速度/心率/功率/海拔）时展示：
 * 色阶渐变条（与轨迹 jetRamp 同源）+ 值域端点（左低右高）。
 * 速度随单位偏好显示 km/h / mph；海拔值域随数据（min-max），
 * 其余为固定物理域（与轨迹着色口径一致，同一颜色同一水平）。
 * 该指标全部缺失时不渲染（地图同时回退单色轨迹）。
 */
import { useMemo } from 'react'
import {
  COLORING_LEGEND_GRADIENT,
  getMetricValue,
  getValueRange,
  type ColoringMode,
} from '@/map/routeColoring'
import { formatSpeedByUnit, type DistanceUnit } from '@/features/settings/settings'
import type { RoutePoint } from '@/types/activity'
import '@/map/ColoringLegend.css'

/** 各着色模式的中文名称 */
const MODE_LABELS: Record<ColoringMode, string> = {
  speed: '速度',
  heartRate: '心率',
  power: '功率',
  altitude: '海拔',
}

/**
 * 值域端点格式化：速度随单位偏好换算，其余取整加单位。
 *
 * @param value 端点值（速度 m/s，心率 bpm，功率 W，海拔 m）
 * @param mode 着色模式
 * @param distanceUnit 距离显示单位
 * @returns 端点显示文本
 */
function formatRangeValue(value: number, mode: ColoringMode, distanceUnit: DistanceUnit): string {
  switch (mode) {
    case 'speed':
      return formatSpeedByUnit(value, distanceUnit)
    case 'heartRate':
      return `${Math.round(value)} bpm`
    case 'power':
      return `${Math.round(value)} W`
    case 'altitude':
      return `${Math.round(value)} m`
  }
}

/**
 * 着色图例 props。
 */
export interface ColoringLegendProps {
  /** 着色模式（非 'none' 才挂载本组件） */
  mode: ColoringMode

  /** 轨迹点（用于判断指标数据存在性与海拔值域） */
  points: RoutePoint[]

  /** 距离显示单位（速度端点换算 km/h / mph） */
  distanceUnit: DistanceUnit
}

/**
 * 轨迹着色图例：渐变条 + 值域端点。
 *
 * @param props 组件参数
 */
function ColoringLegend({ mode, points, distanceUnit }: ColoringLegendProps) {
  // 指标数据存在性：全部缺失时地图回退单色，图例同步不渲染
  const hasData = useMemo(
    () => points.some((point) => getMetricValue(point, mode) !== undefined),
    [points, mode],
  )

  // 值域：与轨迹着色同一口径（getValueRange）
  const range = useMemo(() => getValueRange(points, mode), [points, mode])

  if (!hasData) {
    return null
  }

  return (
    <div className="coloring-legend" aria-label={`${MODE_LABELS[mode]}着色图例`}>
      <span className="coloring-legend__value">
        低 {formatRangeValue(range.min, mode, distanceUnit)}
      </span>
      <div
        className="coloring-legend__bar"
        style={{ background: COLORING_LEGEND_GRADIENT }}
        role="img"
        aria-label={`${MODE_LABELS[mode]}由低到高：蓝到红`}
      />
      <span className="coloring-legend__value">
        高 {formatRangeValue(range.max, mode, distanceUnit)}
      </span>
    </div>
  )
}

export default ColoringLegend
