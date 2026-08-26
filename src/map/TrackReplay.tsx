/**
 * 轨迹在线回放（规格外：用户需求）。
 *
 * 在活动轨迹地图上叠加回放控制条：播放/暂停、进度拖动、倍速选择。
 * 播放时当前位置光标沿轨迹推进，地图自动跟随平移；HUD 展示已骑距离/当前速度/心率。
 * 可选叠加 OpenTopoMap 地形底图（免费无 key，WGS-84 坐标系与 OSM 一致；
 * 高德源下地形层坐标偏差可接受——地形仅作参考背景，轨迹仍以底图纠偏为准）。
 *
 * 性能设计（修复播放卡顿）：
 * - 权威进度存 ref 由 rAF 每帧推进；React 状态仅 10Hz 节流同步，
 *   驱动滑块/HUD/已走轨迹——控制条 DOM 不再每帧 reconcile；
 * - 当前位置光标每帧经 Leaflet 实例 setLatLng 命令式更新（不触发 React 渲染），
 *   高倍速下依然平滑；
 * - 已走高亮折线用 ≤2000 点的均匀抽稀骨架渲染（原为全量点 slice + map 每帧
 *   重建数组并整条重绘 SVG path，是卡顿主因），抽稀在街道级缩放下视觉无损。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, Polyline, TileLayer, useMap } from 'react-leaflet'
import { DomEvent } from 'leaflet'
import type { CircleMarker as LeafletCircleMarker, LatLngTuple } from 'leaflet'
import type { RoutePoint } from '@/types/activity'
import { formatDistanceByUnit, type DistanceUnit } from '@/features/settings/settings'
import { buildReplaySkeleton, findIndexAtTimestamp, interpolatePositionAt } from '@/map/replayCore'
import './TrackReplay.css'

/** 回放速度选项（倍率）：1x = 真实时间流速 */
const SPEED_OPTIONS = [1, 8, 32, 128] as const

/** React 状态同步间隔（ms）：滑块/HUD/已走轨迹的刷新频率，光标不受此限制 */
const REPLAY_SYNC_INTERVAL_MS = 100

/** 已走高亮折线的最大点数（均匀抽稀上限，封顶 SVG path 重绘成本） */
const REPLAY_LINE_MAX_POINTS = 2000

/** 单帧推进的骑行时间上限（秒）：标签页切回后 rAF 恢复时不跳进度 */
const MAX_FRAME_DT_SECONDS = 1

/** 回放跟随的地图缩放级别：街道级，能看清当前路段细节 */
const FOLLOW_ZOOM = 16

/** 已走轨迹高亮色（与底图轨迹形成明显对比） */
const TRAVELED_COLOR = '#ff9f43'

/** 当前位置点颜色（亮青发光） */
const CURSOR_COLOR = '#34d9ff'

/** 跟随触发边距（比例）：光标超出视口该比例范围才平移，避免频繁 setView 打断动画 */
const FOLLOW_EDGE_RATIO = 0.25

/** 跟随镜头单次平移时长（秒）：小幅 panBy 配短动画，镜头平稳不甩动 */
const FOLLOW_PAN_DURATION_SECONDS = 0.25

/**
 * 格式化秒 → mm:ss 或 h:mm:ss。
 *
 * @param seconds 秒数
 */
function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * 回放控制条 props。
 */
export interface TrackReplayProps {
  /** 轨迹点（展示坐标系，与地图渲染一致） */
  points: RoutePoint[]

  /** 距离单位偏好（km/mi） */
  distanceUnit: DistanceUnit

  /** 地形图层开关状态 + 切换回调由父级管理（保持与着色切换一致的受控模式） */
  terrainVisible: boolean

  /** 地形图层开关回调 */
  onTerrainToggle: () => void
}

/**
 * 地图跟随子组件：渲染当前位置标记与已走高亮轨迹。
 * 播放期间自跑 rAF 循环：每帧读权威进度 ref → 二分定位 → 邻点线性插值 →
 * 光标 setLatLng + 按需最小幅度平移（丝滑关键：位置连续、镜头不居中跳变）。
 * 暂停/拖动路径由 syncPosition 经 effect 命令式对齐——播放中 React 状态
 * 不反向写入光标，避免节流同步造成的位置回跳。
 *
 * @param props.syncPosition 展示进度对应的轨迹点（仅非播放态用于对齐光标）
 * @param props.progressRef 权威进度（0~1，父级 rAF 每帧推进）
 * @param props.traveledLatLngs 已走轨迹骨架坐标列表（节流更新）
 * @param props.following 是否处于跟随模式（播放中）
 */
function ReplayCursor({ points, progressRef, traveledLatLngs, following, syncPosition, firstTs, totalSpan }: {
  points: RoutePoint[]
  progressRef: { current: number }
  traveledLatLngs: [number, number][]
  following: boolean
  syncPosition: RoutePoint
  firstTs: number
  totalSpan: number
}) {
  const map = useMap()
  const haloRef = useRef<LeafletCircleMarker | null>(null)
  const coreRef = useRef<LeafletCircleMarker | null>(null)
  // 是否已执行过初始缩放（每次进入跟随模式只 zoom 一次，之后仅按需 pan）
  const zoomedOnceRef = useRef(false)
  // 用户手动改过缩放后不再强制 zoom
  const userZoomedRef = useRef(false)
  // 跟随镜头动画进行中标志：动画未结束前不叠加新的平移，避免抖动
  const panningRef = useRef(false)

  // 监听用户手势触发的缩放（程序化调用前置标志位跳过）
  useEffect(() => {
    let programmatic = false
    const beforeZoom = () => { programmatic = true }
    const onZoomEnd = () => {
      if (!programmatic) {
        userZoomedRef.current = true
      }
      programmatic = false
    }
    const onMoveStart = () => { panningRef.current = true }
    const onMoveEnd = () => { panningRef.current = false }
    map.on('zoomstart', beforeZoom)
    map.on('zoomend', onZoomEnd)
    map.on('movestart', onMoveStart)
    map.on('moveend', onMoveEnd)
    return () => {
      map.off('zoomstart', beforeZoom)
      map.off('zoomend', onZoomEnd)
      map.off('movestart', onMoveStart)
      map.off('moveend', onMoveEnd)
    }
  }, [map])

  /** 把光标拉回视口边距内的最小幅度平移（不居中，镜头稳）；首入跟随先一次性缩放 */
  const followCursor = (latLng: LatLngTuple) => {
    if (!zoomedOnceRef.current && !userZoomedRef.current) {
      zoomedOnceRef.current = true
      map.setView(latLng, FOLLOW_ZOOM, { animate: true })
      return
    }
    if (panningRef.current) {
      return
    }
    const size = map.getSize()
    const point = map.latLngToContainerPoint(latLng)
    const edgeX = size.x * FOLLOW_EDGE_RATIO
    const edgeY = size.y * FOLLOW_EDGE_RATIO
    let dx = 0
    let dy = 0
    if (point.x < edgeX) {
      dx = point.x - edgeX
    } else if (point.x > size.x - edgeX) {
      dx = point.x - (size.x - edgeX)
    }
    if (point.y < edgeY) {
      dy = point.y - edgeY
    } else if (point.y > size.y - edgeY) {
      dy = point.y - (size.y - edgeY)
    }
    if (dx !== 0 || dy !== 0) {
      map.panBy([dx, dy], { animate: true, duration: FOLLOW_PAN_DURATION_SECONDS })
    }
  }

  // 播放中每帧命令式更新光标与跟随（不经 React 渲染路径，保证高倍速平滑）
  useEffect(() => {
    if (!following) {
      return
    }
    let raf = 0
    const frame = () => {
      const ts = firstTs + progressRef.current * totalSpan
      const index = findIndexAtTimestamp(points, ts)
      // 邻点线性插值：消除记录点间隔导致的逐点跳动
      const pt = interpolatePositionAt(points, index, ts)
      const latLng: LatLngTuple = [pt.latitude, pt.longitude]
      haloRef.current?.setLatLng(latLng)
      coreRef.current?.setLatLng(latLng)
      followCursor(latLng)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- followCursor 内部只依赖 map 与稳定 ref
  }, [following, points, firstTs, totalSpan, map])

  // 非播放态（暂停/拖动进度）：光标对齐展示进度位置（播放中由 rAF 循环全权接管）
  useEffect(() => {
    if (following) {
      return
    }
    const latLng: LatLngTuple = [syncPosition.latitude, syncPosition.longitude]
    haloRef.current?.setLatLng(latLng)
    coreRef.current?.setLatLng(latLng)
  }, [following, syncPosition])

  return (
    <>
      {/* 已走轨迹高亮（抽稀骨架，节流更新）；光标 center 仅作初值，后续全部命令式更新 */}
      <Polyline positions={traveledLatLngs} pathOptions={{ color: TRAVELED_COLOR, weight: 6, opacity: 0.95 }} />
      <CircleMarker
        ref={haloRef}
        center={initialCenterOf(points)}
        radius={14}
        pathOptions={{ color: CURSOR_COLOR, weight: 2, fillColor: CURSOR_COLOR, fillOpacity: 0.25, stroke: false }}
      />
      <CircleMarker
        ref={coreRef}
        center={initialCenterOf(points)}
        radius={7}
        pathOptions={{ color: '#fff', weight: 2, fillColor: CURSOR_COLOR, fillOpacity: 1 }}
      />
    </>
  )
}

/** 光标初始中心（首点坐标）：组件内保持稳定引用，避免 props 变化反向驱动光标 */
function initialCenterOf(points: RoutePoint[]): LatLngTuple {
  const first = points[0]
  return first !== undefined ? [first.latitude, first.longitude] : [0, 0]
}

/**
 * 地形图层子组件：terrainVisible 时叠加 OpenTopoMap 瓦片。
 *
 * @param visible 是否显示地形层
 */
function TerrainLayer({ visible }: { visible: boolean }) {
  if (!visible) {
    return null
  }
  return (
    <TileLayer
      url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
      subdomains={['a', 'b', 'c']}
      attribution='&copy; <a href="https://www.opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
      maxZoom={17}
      opacity={0.85}
    />
  )
}

/**
 * 轨迹在线回放控制条（挂在 MapContainer 内部，使用 useMap 联动）。
 *
 * @param props 组件参数
 */
export function TrackReplay({ points, distanceUnit, terrainVisible, onTerrainToggle }: TrackReplayProps) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(1)
  // 权威进度（rAF 每帧推进，不触发渲染）；展示进度由循环节流同步
  const progressRef = useRef(0)
  const [displayProgress, setDisplayProgress] = useState(0)

  // rAF 驱动的动画循环引用
  const rafRef = useRef<number>(0)

  // 控制条根节点：阻断点击/滚轮事件冒泡到地图容器，
  // 避免双击按钮误触地图缩放、拖动滑块误拖地图（Leaflet 自定义控件标准做法）
  const barRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = barRef.current
    if (el !== null) {
      DomEvent.disableClickPropagation(el)
      DomEvent.disableScrollPropagation(el)
    }
  }, [])

  // 首末时间戳
  const firstTs = points[0]?.timestamp ?? 0
  const lastTs = points[points.length - 1]?.timestamp ?? 0
  const totalSpan = Math.max(lastTs - firstTs, 1)

  // 展示进度对应的当前点索引（节流后 10Hz 重算，二分 O(log N) 可忽略）
  const currentIndex = useMemo(
    () => findIndexAtTimestamp(points, firstTs + displayProgress * totalSpan),
    [points, firstTs, displayProgress, totalSpan],
  )
  const currentPosition = points[Math.min(currentIndex, points.length - 1)] ?? points[0]

  // 已走高亮骨架：≤2000 点均匀抽稀，按展示进度切片（10Hz × O(≤2000)，成本可忽略）
  const skeleton = useMemo(() => buildReplaySkeleton(points, REPLAY_LINE_MAX_POINTS), [points])
  const stride = points.length > 0 ? Math.max(1, Math.ceil(points.length / REPLAY_LINE_MAX_POINTS)) : 1
  const traveledLatLngs = useMemo<[number, number][]>(
    () => skeleton.slice(0, Math.min(skeleton.length, Math.floor(currentIndex / stride) + 1))
      .map((p) => [p.latitude, p.longitude] as [number, number]),
    [skeleton, stride, currentIndex],
  )

  // 已骑距离 / 当前速度 / 当前心率（缺失字段不伪造，显示 '—'）
  const distanceLabel = currentPosition?.distance !== undefined
    ? formatDistanceByUnit(currentPosition.distance, distanceUnit)
    : '—'
  const speedLabel = currentPosition?.speed !== undefined
    ? `${(currentPosition.speed * 3.6).toFixed(1)} km/h`
    : '—'
  const heartRateLabel = currentPosition?.heartRate !== undefined
    ? `${currentPosition.heartRate} bpm`
    : '—'

  // 播放循环：rAF 推进权威进度 ref，React 状态仅 100ms 节流同步
  // （此前每帧 setState 导致全子树 60fps 重渲 + 已走轨迹全量重建，是卡顿根因）
  useEffect(() => {
    if (!playing) {
      return
    }
    let lastTick: number | null = null
    let lastSync = 0

    function tick(now: number) {
      // 首帧仅记录基准时钟（rAF 时间戳来源可能与 performance.now() 不同源，防负 dt）
      if (lastTick === null) {
        lastTick = now
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      // 单帧上限：标签页后台一段时间后切回，不一次性跳进度
      const dt = Math.min((now - lastTick) / 1000, MAX_FRAME_DT_SECONDS)
      lastTick = now
      // dt 秒真实时间 × 倍速 = 推进的骑行时间；除以总时长得 progress 增量
      progressRef.current = Math.min(progressRef.current + (dt * speed) / totalSpan, 1)
      if (progressRef.current >= 1) {
        // 播完：终态同步后自动暂停（不再排下一帧）
        setDisplayProgress(1)
        setPlaying(false)
        return
      }
      if (now - lastSync >= REPLAY_SYNC_INTERVAL_MS) {
        lastSync = now
        setDisplayProgress(progressRef.current)
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, speed, totalSpan])

  // 卸载时清理 rAF
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  /** 拖动进度：同时写权威 ref 与展示状态（立即生效，无需等待下一轮节流） */
  const handleSeek = (value: number) => {
    progressRef.current = value
    setDisplayProgress(value)
  }

  return (
    <>
      <TerrainLayer visible={terrainVisible} />
      {currentPosition !== undefined && (
        <ReplayCursor
          points={points}
          progressRef={progressRef}
          traveledLatLngs={traveledLatLngs}
          following={playing}
          syncPosition={currentPosition}
          firstTs={firstTs}
          totalSpan={totalSpan}
        />
      )}
      <div className="track-replay" ref={barRef}>
        {/* 进度滑块 */}
        <input
          type="range"
          className="track-replay__slider"
          min={0}
          max={1000}
          value={Math.round(displayProgress * 1000)}
          aria-label="回放进度"
          onChange={(event) => handleSeek(Number(event.target.value) / 1000)}
        />
        <div className="track-replay__row">
          <button
            type="button"
            className="track-replay__btn track-replay__btn--primary"
            onClick={() => {
              if (!playing && progressRef.current >= 1) {
                handleSeek(0)
              }
              setPlaying(!playing)
            }}
          >
            {playing ? '⏸' : '▶'}
          </button>
          {SPEED_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={
                speed === option
                  ? 'track-replay__btn track-replay__speed--active'
                  : 'track-replay__btn'
              }
              onClick={() => setSpeed(option)}
            >
              {option}×
            </button>
          ))}
          <span className="track-replay__clock">{formatClock(displayProgress * totalSpan)}</span>
          <span className="track-replay__stat">{distanceLabel}</span>
          <span className="track-replay__stat">{speedLabel}</span>
          <span className="track-replay__stat">{heartRateLabel}</span>
          <button
            type="button"
            className={terrainVisible ? 'track-replay__btn track-replay__terrain--active' : 'track-replay__btn'}
            onClick={onTerrainToggle}
            title="切换地形图底图"
          >
            地形
          </button>
        </div>
      </div>
    </>
  )
}
