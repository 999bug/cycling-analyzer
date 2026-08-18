/**
 * 活动轨迹地图（规格 §16）。
 *
 * react-leaflet 绘制轨迹 Polyline + 起点绿色圆点 / 终点黑白格旗标，
 * 地图自动 fitBounds 到轨迹范围。
 * 默认单色轨迹；coloring 指定时按速度/心率/功率/海拔分段着色。
 * 支持右上角按钮全屏查看（mapFullscreen），缩放控件统一在右下角。
 */
import { useEffect, useMemo, useRef } from 'react'
import { divIcon } from 'leaflet'
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { RoutePoint } from '@/types/activity'
import {
  buildBucketLines,
  buildSegments,
  getMetricValue,
  type ColoringMode,
  type ColoredLine,
} from '@/map/routeColoring'
import {
  FullscreenSync,
  MapFullscreenButton,
  ZoomControlBottomRight,
} from '@/map/mapFullscreen'
import '@/map/ActivityMap.css'

/** 一条可绘制轨迹至少需要 2 个点 */
const MIN_POINTS = 2

/** 起点标记颜色（绿色圆点） */
const START_COLOR = '#34c759'

/** 终点黑白格旗标（完赛旗样式，CSS 绘制棋盘格） */
const FINISH_ICON = divIcon({
  className: 'activity-map__finish-marker',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

/** 轨迹线颜色（主题主色） */
const ROUTE_COLOR = '#4f8cff'

/** 轨迹线宽（像素） */
const ROUTE_WEIGHT = 4

/**
 * 精确着色（每段一条 Polyline）的最大段数。
 * 超过后分桶合并，避免大量 Leaflet 图层导致渲染卡顿。
 */
const MAX_DETAILED_SEGMENTS = 500

/**
 * 地图组件 props。
 */
export interface ActivityMapProps {
  /** 轨迹点（已抽稀），少于 2 点或无坐标时显示占位提示 */
  points: RoutePoint[]

  /** 轨迹着色模式：'none'（默认）单色轨迹；其余按指标分段着色 */
  coloring?: ColoringMode | 'none'
}

/**
 * 自动适配视野子组件：轨迹点变化时重算 fitBounds。
 * MapContainer 的子组件才能访问 map 实例（react-leaflet context）。
 *
 * @param points 轨迹点
 */
function FitBounds({ points }: { points: RoutePoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length >= MIN_POINTS) {
      const latLngs = points.map((point) => [point.latitude, point.longitude] as [number, number])
      map.fitBounds(latLngs, { padding: [24, 24] })
    }
    // points 变化时重新适配视野
  }, [map, points])
  return null
}

/**
 * 活动轨迹地图。
 *
 * @param props 组件参数
 */
function ActivityMap({ points, coloring = 'none' }: ActivityMapProps) {
  // 全屏包裹层引用：全屏按钮对包裹层调用 Fullscreen API
  const wrapperRef = useRef<HTMLDivElement>(null)

  // 经纬度元组列表：Polyline / CircleMarker / Marker 共用
  const latLngs = useMemo(
    () => points.map((point) => [point.latitude, point.longitude] as [number, number]),
    [points],
  )

  // 着色模式下是否具备该指标数据（全部缺失时回退单色轨迹）
  const hasMetricData = useMemo(() => {
    if (coloring === 'none') {
      return false
    }
    return points.some((point) => getMetricValue(point, coloring) !== undefined)
  }, [points, coloring])

  // 着色折线：段数少时逐段精确着色（每条线段一条 Polyline）；
  // 段数多时分桶合并，同桶相邻段共一条 Polyline，降低图层数
  const coloredLines = useMemo<ColoredLine[]>(() => {
    if (coloring === 'none' || !hasMetricData) {
      return []
    }
    if (points.length - 1 <= MAX_DETAILED_SEGMENTS) {
      return buildSegments(points, coloring).map((segment) => ({
        color: segment.color,
        positions: [
          [segment.lat1, segment.lng1],
          [segment.lat2, segment.lng2],
        ],
      }))
    }
    return buildBucketLines(points, coloring)
  }, [points, coloring, hasMetricData])

  if (points.length < MIN_POINTS) {
    return <div className="activity-map activity-map--empty">该活动没有坐标轨迹</div>
  }

  const start = latLngs[0]
  const end = latLngs[latLngs.length - 1]

  return (
    <div className="map-fullscreen-wrapper" ref={wrapperRef}>
      <MapContainer
        className="activity-map"
        center={start}
        zoom={14}
        bounds={latLngs}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {hasMetricData
          ? coloredLines.map((line, index) => (
              <Polyline
                key={index}
                positions={line.positions}
                pathOptions={{ color: line.color, weight: ROUTE_WEIGHT }}
              />
            ))
          : <Polyline positions={latLngs} pathOptions={{ color: ROUTE_COLOR, weight: ROUTE_WEIGHT }} />}
        <CircleMarker center={start} radius={6} pathOptions={{ color: START_COLOR, fillColor: START_COLOR, fillOpacity: 1 }} />
        <Marker position={end} icon={FINISH_ICON} />
        <FitBounds points={points} />
        <FullscreenSync />
        <ZoomControlBottomRight />
      </MapContainer>
      <MapFullscreenButton targetRef={wrapperRef} />
    </div>
  )
}

export default ActivityMap
