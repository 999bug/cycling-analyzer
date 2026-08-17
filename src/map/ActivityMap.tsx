/**
 * 活动轨迹地图（规格 §16）。
 *
 * react-leaflet 绘制轨迹 Polyline + 起点/终点 CircleMarker，
 * 地图自动 fitBounds 到轨迹范围。
 * MVP 只实现默认单色轨迹；按速度/心率/功率/海拔着色为 P1 功能。
 */
import { useEffect, useMemo } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { RoutePoint } from '@/types/activity'
import '@/map/ActivityMap.css'

/** 一条可绘制轨迹至少需要 2 个点 */
const MIN_POINTS = 2

/** 起点标记颜色（绿色） */
const START_COLOR = '#34c759'

/** 终点标记颜色（红色） */
const END_COLOR = '#ff453a'

/** 轨迹线颜色（主题主色） */
const ROUTE_COLOR = '#4f8cff'

/** 轨迹线宽（像素） */
const ROUTE_WEIGHT = 4

/**
 * 地图组件 props。
 */
export interface ActivityMapProps {
  /** 轨迹点（已抽稀），少于 2 点或无坐标时显示占位提示 */
  points: RoutePoint[]
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
function ActivityMap({ points }: ActivityMapProps) {
  // 经纬度元组列表：Polyline / CircleMarker 共用
  const latLngs = useMemo(
    () => points.map((point) => [point.latitude, point.longitude] as [number, number]),
    [points],
  )

  if (points.length < MIN_POINTS) {
    return <div className="activity-map activity-map--empty">该活动没有坐标轨迹</div>
  }

  const start = latLngs[0]
  const end = latLngs[latLngs.length - 1]

  return (
    <MapContainer
      className="activity-map"
      center={start}
      zoom={14}
      bounds={latLngs}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Polyline positions={latLngs} pathOptions={{ color: ROUTE_COLOR, weight: ROUTE_WEIGHT }} />
      <CircleMarker center={start} radius={6} pathOptions={{ color: START_COLOR, fillColor: START_COLOR, fillOpacity: 1 }} />
      <CircleMarker center={end} radius={6} pathOptions={{ color: END_COLOR, fillColor: END_COLOR, fillOpacity: 1 }} />
      <FitBounds points={points} />
    </MapContainer>
  )
}

export default ActivityMap
