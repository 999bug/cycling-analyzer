/**
 * 赛段迷你地图（卡片内嵌）。
 *
 * 有完整轨迹（GPX 导入）时画轨迹折线；仅有起终点（手动创建/API 导入）时
 * 画起终点标记。自动 fitBounds 适应赛段范围，不可交互（避免滚动页面误触）。
 */
import { useEffect } from 'react'
import { MapContainer, Polyline, CircleMarker, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { FallbackTileLayer } from '@/map/FallbackTileLayer'
import { wgs84ToGcj02 } from '@/map/tileSources'

/** 赛段迷你地图 props */
export interface SegmentMiniMapProps {
  /** 赛段完整轨迹（[纬度, 经度] 数组，GPX 导入时有值） */
  trackPoints?: readonly (readonly [number, number])[]

  /** 起点纬度 */
  startLatitude: number

  /** 起点经度 */
  startLongitude: number

  /** 终点纬度 */
  endLatitude: number

  /** 终点经度 */
  endLongitude: number

  /** 瓦片源索引（0 = OSM，1 = 高德） */
  sourceIndex: number

  /** 瓦片降级回调（OSM 连续失败时触发） */
  onFallback?: () => void
}

/** fitBounds 控制器（地图挂载后适应赛段范围） */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length >= 2) {
      map.fitBounds(points, { padding: [8, 8] })
    }
  }, [map, points])
  return null
}

/**
 * 赛段迷你地图组件。
 */
export function SegmentMiniMap({
  trackPoints,
  startLatitude,
  startLongitude,
  endLatitude,
  endLongitude,
  sourceIndex,
  onFallback,
}: SegmentMiniMapProps) {
  // 高德底图需 GCJ-02 坐标转换（OSM 源用原始 WGS-84）
  const convert = (lat: number, lng: number): [number, number] => {
    if (sourceIndex === 0) {
      return [lat, lng]
    }
    const point = wgs84ToGcj02({ longitude: lng, latitude: lat })
    return [point.latitude, point.longitude]
  }

  const hasTrack = trackPoints !== undefined && trackPoints.length >= 2
  const linePoints: [number, number][] = hasTrack
    ? trackPoints!.map(([lat, lng]) => convert(lat, lng))
    : [convert(startLatitude, startLongitude), convert(endLatitude, endLongitude)]

  const center = linePoints[Math.floor(linePoints.length / 2)] as [number, number]

  return (
    <MapContainer
      className="segment-card__map"
      center={center}
      zoom={14}
      scrollWheelZoom={false}
      dragging={false}
      doubleClickZoom={false}
      touchZoom={false}
      zoomControl={false}
      attributionControl={false}
    >
      <FallbackTileLayer sourceIndex={sourceIndex} onFallback={onFallback ?? (() => {})} />
      <Polyline
        positions={linePoints}
        pathOptions={{ color: '#fc4c02', weight: 3, opacity: 0.8 }}
      />
      {!hasTrack && (
        <>
          <CircleMarker
            center={linePoints[0] as [number, number]}
            radius={5}
            pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }}
          />
          <CircleMarker
            center={linePoints[1] as [number, number]}
            radius={5}
            pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }}
          />
        </>
      )}
      <FitBounds points={linePoints} />
    </MapContainer>
  )
}