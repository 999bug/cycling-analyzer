/**
 * 活动轨迹地图（规格 §16）。
 *
 * react-leaflet 绘制轨迹 Polyline + 起点绿色圆点 / 终点黑白格旗标，
 * 地图自动 fitBounds 到轨迹范围。
 * 默认单色轨迹；coloring 指定时按速度/心率/功率/海拔分段着色。
 * 支持右上角按钮全屏查看（mapFullscreen），缩放控件统一在右下角。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { divIcon } from 'leaflet'
import { CircleMarker, MapContainer, Marker, Polyline, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { projectPoint, projectPoints, type ProjectOptions } from '@/geo/projection'
import type { CoordinateSystem } from '@/geo/coordinateSystem'
import type { RoutePoint, TrackOffset } from '@/types/activity'
import { routePointAtLocation } from '@/charts/timeline'
import { FallbackTileLayer } from '@/map/FallbackTileLayer'
import {
  buildBucketLines,
  buildSegments,
  getMetricValue,
  type ColoringMode,
  type ColoredLine,
} from '@/map/routeColoring'
import { TrackReplay } from '@/map/TrackReplay'
import { clampMapHeight, loadSavedMapHeight, saveMapHeight } from '@/map/mapResize'
import { isGcjSource, loadStoredSourceIndex, mapSystem, storeSourceIndex, type MapMode } from '@/map/tileSources'
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

/** 悬停圆点颜色（与轨迹主色一致，视觉强调当前点位） */
const HOVER_COLOR = '#4f8cff'

/**
 * 地图组件 props。
 */
export interface ActivityMapProps {
  /** 轨迹点（已抽稀），少于 2 点或无坐标时显示占位提示 */
  points: RoutePoint[]

  /** 轨迹着色模式：'none'（默认）单色轨迹；其余按指标分段着色 */
  coloring?: ColoringMode | 'none'

  /** 悬停轨迹点（爬坡剖面/图表悬停联动；undefined = 无悬停，不渲染圆点） */
  hoverPoint?: { latitude: number; longitude: number }

  /** 地图悬停上报（共享时间轴反向联动）：鼠标移到轨迹附近时上报最近点时间戳 */
  onHover?: (timestamp: number | undefined) => void

  /** 是否启用在线回放控制条 */
  replayEnabled?: boolean

  /**
   * 回放判定暂停用的密集采样源（未抽稀的逐点记录）。
   *
   * `points` 是抽稀结果，采样间隔可达分钟级；回放若直接用它判定暂停，
   * 「>60s 缺口 = 暂停」会把正常骑行段误判成暂停，光标会横跨数百米瞬移。
   */
  replayMotionSource?: readonly { timestamp: number; distance?: number }[]

  /** 地图显示模式（底图样式，父级受控；缺省「正常」矢量底图） */
  mapMode?: MapMode

  /** 地图模式切换回调（父级受控） */
  onMapModeChange?: (mode: MapMode) => void

  /** 距离单位偏好（回放 HUD 展示用；缺省 km） */
  distanceUnit?: 'km' | 'mi'

  /** 轨迹原始坐标所属坐标系（纠偏用；缺省 wgs84） */
  coordinateSystem?: CoordinateSystem

  /** 轨迹手动微调量（米，在归一化到 WGS-84 之后叠加） */
  trackOffset?: TrackOffset

  /**
   * 对比投影（纠偏面板用）：以此参数投影出一条灰虚线叠加在主轨迹下方，
   * 展示「纠偏前」的位置，主轨迹则为「纠偏后」实时预览。
   * undefined = 不显示对比线。
   */
  compare?: {
    coordinateSystem?: CoordinateSystem
    trackOffset?: TrackOffset
  }
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
 * 地图悬停上报子组件：鼠标移动时匹配最近轨迹点并上报其时间戳（共享时间轴反向联动）。
 * 仅当 onHover 提供时挂载监听，避免无联动的场景产生事件开销。
 * 匹配用展示坐标（与地图渲染一致，高德源为 GCJ-02）。
 *
 * @param displayPoints 展示坐标轨迹点
 * @param onHover 上报回调（undefined = 不启用联动）
 */
function MapHoverReporter({
  displayPoints,
  onHover,
}: {
  displayPoints: RoutePoint[]
  onHover: ((timestamp: number | undefined) => void) | undefined
}) {
  const map = useMap()
  useEffect(() => {
    if (onHover === undefined) {
      return
    }
    const handleMove = (event: { latlng: { lat: number; lng: number } }) => {
      const point = routePointAtLocation(displayPoints, event.latlng.lat, event.latlng.lng)
      onHover(point?.timestamp)
    }
    const handleOut = () => {
      onHover(undefined)
    }
    map.on('mousemove', handleMove)
    map.on('mouseout', handleOut)
    return () => {
      map.off('mousemove', handleMove)
      map.off('mouseout', handleOut)
    }
  }, [map, displayPoints, onHover])
  return null
}

/**
 * 自动尺寸同步：容器尺寸变化（拖拽调整高度、全屏切换）时调用 invalidateSize，
 * 保证瓦片与矢量图形按新尺寸重投影。jsdom 测试环境无 ResizeObserver 时跳过。
 */
function AutoInvalidate() {
  const map = useMap()
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const container = map.getContainer()
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [map])
  return null
}

/**
 * 活动轨迹地图。
 *
 * @param props 组件参数
 */
function ActivityMap({ points, coloring = 'none', hoverPoint, onHover, replayEnabled = false, replayMotionSource, mapMode = 'normal', onMapModeChange, distanceUnit = 'km', coordinateSystem, trackOffset, compare }: ActivityMapProps) {
  // 全屏包裹层引用：全屏按钮对包裹层调用 Fullscreen API
  const wrapperRef = useRef<HTMLDivElement>(null)

  // 地图高度：拖拽把手调整并持久化；null = 未自定义，走 CSS 默认高度
  const [mapHeight, setMapHeight] = useState<number | null>(() => loadSavedMapHeight())
  // 拖拽会话状态：指针按下时的起始 y 与起始高度（拖拽中直接改 style，松手才 setState 避免高频重渲）
  const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)
  const pendingHeightRef = useRef<number | null>(null)

  /** 开始拖拽：捕获指针并记录起始位置 */
  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const wrapper = wrapperRef.current
    if (wrapper === null) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: wrapper.offsetHeight,
    }
  }, [])

  /** 拖拽中：直接写包裹层高度（把手在顶部，向上拖 = 拉高地图），实时 invalidate 由 AutoInvalidate 完成 */
  const handleResizeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const wrapper = wrapperRef.current
    if (drag === null || wrapper === null || event.pointerId !== drag.pointerId) {
      return
    }
    const height = clampMapHeight(drag.startHeight + (drag.startY - event.clientY), window.innerHeight)
    wrapper.style.height = `${height}px`
    pendingHeightRef.current = height
  }, [])

  /** 结束拖拽：提交高度到状态并持久化 */
  const handleResizeEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null || event.pointerId !== drag.pointerId) {
      return
    }
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    const height = pendingHeightRef.current
    pendingHeightRef.current = null
    if (height !== null) {
      setMapHeight(height)
      saveMapHeight(height)
    }
  }, [])

  // 当前瓦片源索引：默认高德；本会话已降级过则直接使用 OSM
  const [sourceIndex, setSourceIndex] = useState(() => loadStoredSourceIndex())

  // 降级回调：切换 OSM 源并记忆（单向，本会话内刷新页面仍直接使用降级源）
  const handleFallback = useCallback(() => {
    setSourceIndex(1)
    storeSourceIndex(1)
  }, [])

  // 展示投影：原始坐标 → 归一化到 WGS-84 → 叠加手动微调 → 投影到底图坐标系。
  // 全站统一走 @/geo/projection，records 保持原始值不动，改来源只是改标记。
  const projection = useMemo<ProjectOptions>(
    () => ({
      from: coordinateSystem,
      to: mapSystem(sourceIndex),
      northMeters: trackOffset?.northMeters,
      eastMeters: trackOffset?.eastMeters,
    }),
    [coordinateSystem, trackOffset, sourceIndex],
  )

  const displayPoints = useMemo(() => projectPoints(points, projection), [points, projection])

  // 对比线（纠偏前位置）：按 compare 参数投影同一份原始坐标，灰虚线渲染
  const compareLatLngs = useMemo(() => {
    if (compare === undefined) {
      return []
    }
    const before = projectPoints(points, {
      from: compare.coordinateSystem,
      to: mapSystem(sourceIndex),
      northMeters: compare.trackOffset?.northMeters,
      eastMeters: compare.trackOffset?.eastMeters,
    })
    return before.map((point) => [point.latitude, point.longitude] as [number, number])
  }, [points, compare, sourceIndex])

  // 悬停圆点展示坐标：与轨迹走同一投影，保证联动不偏
  const hoverDisplay = useMemo(() => {
    if (hoverPoint === undefined) {
      return undefined
    }
    return projectPoint(hoverPoint, projection)
  }, [hoverPoint, projection])

  // 经纬度元组列表：Polyline / CircleMarker / Marker 共用
  const latLngs = useMemo(
    () => displayPoints.map((point) => [point.latitude, point.longitude] as [number, number]),
    [displayPoints],
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
    if (displayPoints.length - 1 <= MAX_DETAILED_SEGMENTS) {
      return buildSegments(displayPoints, coloring).map((segment) => ({
        color: segment.color,
        positions: [
          [segment.lat1, segment.lng1],
          [segment.lat2, segment.lng2],
        ],
      }))
    }
    return buildBucketLines(displayPoints, coloring)
  }, [displayPoints, coloring, hasMetricData])

  if (points.length < MIN_POINTS) {
    return <div className="activity-map activity-map--empty">该活动没有坐标轨迹</div>
  }

  const start = latLngs[0]
  const end = latLngs[latLngs.length - 1]

  return (
    <div
      className="map-fullscreen-wrapper activity-map-wrapper"
      ref={wrapperRef}
      style={mapHeight !== null ? { height: mapHeight } : undefined}
    >
      {/* 高度拖拽把手：置于地图顶缘中央，上下拖动调整地图高度（松手持久化） */}
      <div
        className="map-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖动调整地图高度"
        title="上下拖动调整地图高度"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
      />
      <MapContainer
        className="activity-map"
        center={start}
        zoom={14}
        bounds={latLngs}
        scrollWheelZoom
      >
        <FallbackTileLayer sourceIndex={sourceIndex} mapMode={mapMode} onFallback={handleFallback} />
        {compareLatLngs.length >= MIN_POINTS && (
          <Polyline
            positions={compareLatLngs}
            pathOptions={{ color: '#8e8e93', weight: 2, dashArray: '6 6', opacity: 0.8 }}
          />
        )}
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
        {hoverDisplay !== undefined && (
          <CircleMarker
            center={[hoverDisplay.latitude, hoverDisplay.longitude]}
            radius={7}
            pathOptions={{
              color: HOVER_COLOR,
              weight: 3,
              fillColor: HOVER_COLOR,
              fillOpacity: 0.4,
            }}
          />
        )}
        <FitBounds points={displayPoints} />
        <MapHoverReporter displayPoints={displayPoints} onHover={onHover} />
        {replayEnabled && (
          <TrackReplay
            points={displayPoints}
            motionSource={replayMotionSource}
            distanceUnit={distanceUnit}
            mapMode={mapMode}
            onMapModeChange={onMapModeChange ?? (() => {})}
            mapModeEnabled={isGcjSource(sourceIndex)}
          />
        )}
        <FullscreenSync />
        <AutoInvalidate />
        <ZoomControlBottomRight />
      </MapContainer>
      <MapFullscreenButton targetRef={wrapperRef} />
    </div>
  )
}

export default ActivityMap


