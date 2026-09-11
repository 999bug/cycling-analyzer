/**
 * 活动轨迹地图（规格 §16）。
 *
 * react-leaflet 绘制轨迹 Polyline + 起点绿色圆点 / 终点黑白格旗标，
 * 地图自动 fitBounds 到轨迹范围。
 * 默认单色轨迹；coloring 指定时按速度/心率/功率/海拔分段着色。
 * 支持右上角按钮全屏查看（mapFullscreen），缩放控件统一在右下角。
 * 底图模式（正常 / 卫星 / 卫星+路网）非回放态由右下角角标切换（MapModeSwitcher，父级受控），
 * 回放态交给控制条内的紧凑版，两处互斥不重复。
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
import { TrackReplay, type ReplayExportSession } from '@/map/TrackReplay'
import { clampMapHeight, loadSavedMapHeight, saveMapHeight } from '@/map/mapResize'
import { isGcjSource, loadStoredSourceIndex, mapSystem, storeSourceIndex, type MapMode } from '@/map/tileSources'
import MapModeSwitcher from '@/map/MapModeSwitcher'
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
 * 静态视图下的地图交互选项（覆盖 MapContainer 默认值）：
 * 全部关掉——静态视图里地图只是一张「真实截图」，且 zoomControl 必须关闭，
 * 否则 ZoomControlBottomRight 的 `map.zoomControl.setPosition` 会因控件不存在而报错。
 */
const STATIC_VIEW_MAP_OPTIONS = {
  dragging: false,
  scrollWheelZoom: false,
  doubleClickZoom: false,
  touchZoom: false,
  boxZoom: false,
  keyboard: false,
  zoomControl: false,
  // 拖拽把手不渲染时也固定住光标样式，避免静态视图里出现可交互的暗示
  cursor: false,
} as const

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
   * 回放录制会话（导出视频用）：传入后回放自动按指定倍速开播、禁用跟随镜头，
   * 播放结束回调父级。undefined = 正常交互模式。
   */
  replayExportSession?: ReplayExportSession

  /**
   * 导出录制态：地图变成铺满窗口的黑色舞台 + 居中竖屏画框（`map-export-frame`），
   * 供 pageCaptureExport 裁出成片区域。窗口未必竖屏，故不能直接铺满整窗。
   */
  exportStage?: boolean

  /**
   * 导出录制进度文案（如「录制中 4/30 秒」）。录制舞台顶部会显示一个醒目的状态条
   * （红色脉动点 + 文案 + 提示勿切换标签页），它位于画框外的黑边区，不会进成片。
   */
  exportProgressLabel?: string

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

  /**
   * 静态视图（分享卡出图等）：隐藏全部交互控件（高度拖拽把手 / 全屏按钮 /
   * 底图模式角标 / 缩放控件）、禁用地图交互、高度撑满容器（忽略拖拽记忆高度）。
   *
   * 用途是把地图作为「一张真实截图」嵌进别处（如分享舞台），出图不含任何控件；
   * 底图版权署名照常显示（合规要求，不随视图模式隐藏）。
   */
  staticView?: boolean
}

/**
 * 自动适配视野子组件：轨迹点变化时重算 fitBounds，容器尺寸变化时重新适配。
 * MapContainer 的子组件才能访问 map 实例（react-leaflet context）。
 *
 * 为什么必须监听 resize：`invalidateSize()` 只保持 center + zoom，**不会**重算缩放级别。
 * 全屏时容器从「宽扁」变成「竖长」，沿用旧缩放级别会让轨迹缩成画面中间一小团
 * （实测横向仅占 44%，而 fitBounds 本应约 96%）。Leaflet 在 invalidateSize 时
 * 触发 resize 事件，据此重算即可。
 *
 * 尊重用户操作：用户手动拖拽/缩放后不再自动适配，避免尺寸抖动（窗口缩放、旋转屏幕）
 * 把正在看细节的用户强行拉回全景；切换轨迹（换活动）时重置该标记。
 *
 * `forceRefit`（导出录制态）例外：录制必须从整条轨迹的全景开始，故忽略用户操作标记，
 * 每次尺寸变化都重新适配——否则用户此前拖过地图会让成片取景错位。
 *
 * @param points 轨迹点
 * @param forceRefit 是否无条件重新适配（导出录制态）
 */
function FitBounds({ points, forceRefit = false }: { points: RoutePoint[]; forceRefit?: boolean }) {
  const map = useMap()
  // 用户是否手动调整过视野（dragstart / 轮播缩放、按钮缩放触发的 zoomstart）
  const userMovedRef = useRef(false)
  // 自动 fitBounds 进行中标记：fitBounds 自身也会触发 zoomstart，不能算作「用户操作」
  const autoFitRef = useRef(false)

  useEffect(() => {
    // dragstart 只可能来自用户拖拽（fitBounds / setView 不会触发 dragstart），无条件计入
    const markUserDragged = () => {
      userMovedRef.current = true
    }
    // zoomstart 会被自动 fitBounds 自身触发，需用 autoFitRef 排除，否则每次适配都自我标记
    const markUserZoomed = () => {
      if (!autoFitRef.current) {
        userMovedRef.current = true
      }
    }
    map.on('dragstart', markUserDragged)
    map.on('zoomstart', markUserZoomed)
    return () => {
      map.off('dragstart', markUserDragged)
      map.off('zoomstart', markUserZoomed)
    }
  }, [map])

  useEffect(() => {
    if (points.length < MIN_POINTS) {
      return undefined
    }
    // 轨迹变了（换活动/纠偏后坐标变化）视为新一轮适配，重置用户操作标记
    userMovedRef.current = false
    const latLngs = points.map((point) => [point.latitude, point.longitude] as [number, number])
    const fit = () => {
      autoFitRef.current = true
      // animate: false —— 尺寸变化时立即落位，避免过渡动画期间的中间帧抖动
      map.fitBounds(latLngs, { padding: [24, 24], animate: false })
      // 兜底延迟清除：zoomstart 若被异步派发也不会误记为「用户操作」
      setTimeout(() => {
        autoFitRef.current = false
      }, 0)
    }
    fit()
    const handleResize = () => {
      if (forceRefit || !userMovedRef.current) {
        fit()
      }
    }
    map.on('resize', handleResize)
    return () => {
      map.off('resize', handleResize)
    }
  }, [map, points, forceRefit])
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
 * 导出录制画框同步：给 Leaflet 容器挂/摘 `map-export-frame` 类。
 *
 * 为什么不能直接写在 `<MapContainer className>` 上：MapContainer 只在首次挂载时
 * 把 className 落到 DOM，后续 prop 变化不会更新容器类名（实测 rerender 后类名不变），
 * 而录制舞台是运行时切换的。类名变化会让容器尺寸变化，ResizeObserver → invalidateSize
 * → fitBounds，取景自动重算（见 FitBounds 的 forceRefit）。
 *
 * @param props.enabled 是否处于导出录制态
 */
function ExportFrameSync({ enabled }: { enabled: boolean }) {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    container.classList.toggle('map-export-frame', enabled)
    return () => container.classList.remove('map-export-frame')
  }, [map, enabled])
  return null
}

/**
 * 活动轨迹地图。
 *
 * @param props 组件参数
 */
function ActivityMap({ points, coloring = 'none', hoverPoint, onHover, replayEnabled = false, replayMotionSource, replayExportSession, exportStage = false, exportProgressLabel, mapMode = 'normal', onMapModeChange, distanceUnit = 'km', coordinateSystem, trackOffset, compare, staticView = false }: ActivityMapProps) {
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
      className={
        exportStage
          ? 'map-fullscreen-wrapper activity-map-wrapper map-export-stage'
          : staticView
            ? 'map-fullscreen-wrapper activity-map-wrapper activity-map-wrapper--static'
            : 'map-fullscreen-wrapper activity-map-wrapper'
      }
      ref={wrapperRef}
      // 静态视图高度由外层区块决定（撑满），不受拖拽记忆高度影响
      style={!staticView && mapHeight !== null ? { height: mapHeight } : undefined}
    >
      {/* 录制状态条：位于画框外的顶部黑边区，不进成片（cropSourceOf 只裁画框） */}
      {exportStage && (
        <div className="activity-map__export-status" role="status">
          <span className="activity-map__export-status-dot" aria-hidden="true" />
          <span>{exportProgressLabel ?? '正在准备录制…'}</span>
          <span className="activity-map__export-status-tip">请勿切换或最小化标签页</span>
        </div>
      )}
      {/* 高度拖拽把手：置于地图顶缘中央，上下拖动调整地图高度（松手持久化） */}
      {!staticView && (
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
      )}
      <MapContainer
        className="activity-map"
        center={start}
        zoom={14}
        bounds={latLngs}
        scrollWheelZoom
        {...(staticView ? STATIC_VIEW_MAP_OPTIONS : {})}
      >
        <FallbackTileLayer
          sourceIndex={sourceIndex}
          mapMode={mapMode}
          onFallback={handleFallback}
          // 静态视图要整屏画进 canvas（分享卡出图）：瓦片带 crossOrigin 加载，画布不被污染
          crossOrigin={staticView}
        />
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
        <FitBounds points={displayPoints} forceRefit={exportStage} />
        <MapHoverReporter displayPoints={displayPoints} onHover={onHover} />
        {replayEnabled && (
          <TrackReplay
            points={displayPoints}
            motionSource={replayMotionSource}
            distanceUnit={distanceUnit}
            mapMode={mapMode}
            onMapModeChange={onMapModeChange ?? (() => {})}
            mapModeEnabled={isGcjSource(sourceIndex)}
            exportSession={replayExportSession}
          />
        )}
        <FullscreenSync />
        <ExportFrameSync enabled={exportStage} />
        <AutoInvalidate />
        {/* 缩放控件在静态视图里不挂载：zoomControl 已关，setPosition 会踩空 */}
        {!staticView && <ZoomControlBottomRight />}
      </MapContainer>
      {!staticView && <MapFullscreenButton targetRef={wrapperRef} />}
      {/* 底图模式切换（非回放态入口）。回放态由控制条内的紧凑版负责——
          两者同时出现会重复，且角标贴右下角会与通栏控制栏堆在一起 */}
      {!staticView && !replayEnabled && (
        <MapModeSwitcher
          value={mapMode}
          onChange={onMapModeChange ?? (() => {})}
          enabled={isGcjSource(sourceIndex)}
        />
      )}
    </div>
  )
}

export default ActivityMap


