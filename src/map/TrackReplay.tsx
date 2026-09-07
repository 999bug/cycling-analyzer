/**
 * 轨迹在线回放（规格外：用户需求）——重写版。
 *
 * 在活动轨迹地图上叠加回放控制条：播放/暂停、进度拖动、倍速选择。
 * 播放时当前位置光标沿轨迹推进，地图自动跟随平移；HUD 展示已骑距离/当前速度/心率。
 * 可选叠加 OpenTopoMap 地形底图（免费无 key，WGS-84 坐标系与 OSM 一致）。
 *
 * 架构（重写）：全部时序逻辑收敛到 `ReplayEngine`（框架无关状态机，唯一 rAF 循环），
 * 组件只做两件事：
 * - 控制条：useSyncExternalStore 订阅引擎 10Hz 快照 → 滑块/时钟/HUD 常规渲染；
 * - 地图覆盖层（ReplayOverlay）：订阅引擎 60Hz 帧广播 → 纯命令式 Leaflet 更新，
 *   播放期间 React 状态零变化，DOM/SVG 不进入 reconcile 路径。
 *
 * 平滑关键：
 * - 光标每帧 setLatLng + 邻点线性插值（消除记录点间隔的逐点跳动）；
 * - 已走高亮折线增量 addLatLng（Leaflet 仅更新 path 尾段），仅 seek 回退时
 *   setLatLngs 全量对齐——杜绝整条折线周期性重绘；
 * - 跟随镜头每帧无动画最小平移：60fps 下等效匀速跟拍，无"动画阻塞 →
 *   结束猛蹿"的走停节奏。
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { CircleMarker, Polyline, TileLayer, useMap } from 'react-leaflet'
import { DomEvent } from 'leaflet'
import type { CircleMarker as LeafletCircleMarker, Polyline as LeafletPolyline, LatLngTuple } from 'leaflet'
import type { RoutePoint } from '@/types/activity'
import { formatDistanceByUnit, type DistanceUnit } from '@/features/settings/settings'
import { ReplayEngine } from '@/map/replayEngine'
import { buildReplaySkeleton, findIndexAtTimestamp } from '@/map/replayCore'
import './TrackReplay.css'

/** 回放速度选项（倍率）：1x = 真实时间流速 */
const SPEED_OPTIONS = [1, 8, 32, 128] as const

/** 已走高亮折线的最大点数（均匀抽稀上限，封顶 SVG path 重绘成本） */
const REPLAY_LINE_MAX_POINTS = 2000

/** 回放跟随的地图缩放级别：街道级，能看清当前路段细节 */
const FOLLOW_ZOOM = 16

/** 已走轨迹高亮色（与底图轨迹形成明显对比） */
const TRAVELED_COLOR = '#ff9f43'

/** 当前位置点颜色（亮青发光） */
const CURSOR_COLOR = '#34d9ff'

/** 跟随触发边距（比例）：光标超出视口该比例范围才平移，避免镜头持续微抖 */
const FOLLOW_EDGE_RATIO = 0.25

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
 * 地图覆盖层子组件：渲染当前位置标记与已走高亮轨迹。
 * 订阅引擎帧广播做纯命令式更新——播放期间不经任何 React 渲染路径。
 *
 * @param props.engine 回放引擎（帧广播来源）
 * @param props.points 全量轨迹点
 * @param props.skeleton 已走轨迹抽稀骨架（skeleton[i] ↔ points[i*stride]）
 * @param props.stride 抽稀步长
 */
function ReplayOverlay({ engine, points, skeleton, stride }: {
  engine: ReplayEngine
  points: RoutePoint[]
  skeleton: RoutePoint[]
  stride: number
}) {
  const map = useMap()
  const haloRef = useRef<LeafletCircleMarker | null>(null)
  const coreRef = useRef<LeafletCircleMarker | null>(null)
  const traveledRef = useRef<LeafletPolyline | null>(null)
  // 是否已执行过初始缩放（每次进入跟随只 zoom 一次，之后仅按需 pan）
  const zoomedOnceRef = useRef(false)
  // 用户手动改过缩放后不再强制 zoom
  const userZoomedRef = useRef(false)

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
    map.on('zoomstart', beforeZoom)
    map.on('zoomend', onZoomEnd)
    return () => {
      map.off('zoomstart', beforeZoom)
      map.off('zoomend', onZoomEnd)
    }
  }, [map])

  /**
   * 把已走高亮折线命令式对齐到目标轨迹点索引。
   * 前进（播放推进）：仅增量 addLatLng 追加新跨过的骨架点，Leaflet 局部更新；
   * 回退（拖动/重播/初始）：setLatLngs 全量重建。以折线实际点数判断，
   * 不依赖额外状态，天然兼容 remount。
   */
  const syncTraveledTo = (pointIndex: number) => {
    const line = traveledRef.current
    if (line === null) {
      return
    }
    const clamped = Math.min(Math.max(pointIndex, 0), points.length - 1)
    const targetCount = Math.min(skeleton.length, Math.floor(clamped / stride) + 1)
    const currentCount = line.getLatLngs().length
    if (currentCount === 0 || currentCount > targetCount) {
      line.setLatLngs(skeleton.slice(0, targetCount).map((p) => [p.latitude, p.longitude] as LatLngTuple))
      return
    }
    for (let i = currentCount; i < targetCount; i++) {
      const p = skeleton[i]!
      line.addLatLng([p.latitude, p.longitude])
    }
  }

  /** 把光标拉回视口边距内的最小幅度平移（不居中，无动画 → 匀速镜头）；首入跟随先一次性缩放 */
  const followCursor = (latLng: LatLngTuple) => {
    if (!zoomedOnceRef.current && !userZoomedRef.current) {
      zoomedOnceRef.current = true
      map.setView(latLng, FOLLOW_ZOOM, { animate: true })
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
      // 无动画瞬时平移：每帧仅数像素，等效匀速跟拍；
      // 带动画的 panBy 会产生"动画中阻塞 → 结束后猛蹿"的走停节奏
      map.panBy([dx, dy], { animate: false })
    }
  }

  // 订阅引擎帧广播：光标 + 已走轨迹 + 镜头跟随，全部命令式（60fps）
  useEffect(() => {
    const unsubscribe = engine.onFrame((frame) => {
      const latLng: LatLngTuple = [frame.latitude, frame.longitude]
      haloRef.current?.setLatLng(latLng)
      coreRef.current?.setLatLng(latLng)
      syncTraveledTo(frame.index)
      followCursor(latLng)
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncTraveledTo/followCursor 仅依赖稳定 props 与 map 实例
  }, [engine, map])

  return (
    <>
      {/* 已走轨迹高亮：初始为空，全部由帧广播命令式更新（增量 addLatLng） */}
      <Polyline ref={traveledRef} positions={[]} pathOptions={{ color: TRAVELED_COLOR, weight: 6, opacity: 0.95 }} />
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
 * 时序逻辑全部委托 ReplayEngine；本组件仅按 10Hz 快照渲染 UI。
 *
 * @param props 组件参数
 */
export function TrackReplay({ points, distanceUnit, terrainVisible, onTerrainToggle }: TrackReplayProps) {
  // 引擎与轨迹点生命周期绑定：points 变更（切换活动）即重建引擎
  const engine = useMemo(() => new ReplayEngine(points), [points])
  useEffect(() => () => engine.dispose(), [engine])

  // 10Hz 快照订阅：滑块/时钟/HUD 的唯一渲染驱动（播放中每秒仅 ~10 次 reconcile）
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot)

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

  const firstTs = points[0]?.timestamp ?? 0
  const lastTs = points[points.length - 1]?.timestamp ?? 0
  const totalSpan = Math.max(lastTs - firstTs, 1)

  // HUD 数据源：按快照进度定位当前点（10Hz × O(log N) 二分，成本可忽略）
  const currentIndex = useMemo(
    () => findIndexAtTimestamp(points, firstTs + snapshot.progress * totalSpan),
    [points, firstTs, snapshot.progress, totalSpan],
  )
  const currentPosition = points[Math.min(currentIndex, points.length - 1)] ?? points[0]

  // 已走高亮骨架：≤2000 点均匀抽稀，由覆盖层命令式增量消费（不进入渲染路径）
  const skeleton = useMemo(() => buildReplaySkeleton(points, REPLAY_LINE_MAX_POINTS), [points])
  const stride = points.length > 0 ? Math.max(1, Math.ceil(points.length / REPLAY_LINE_MAX_POINTS)) : 1

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

  /** 拖动进度：引擎立即出帧，覆盖层（光标/已走轨迹/镜头）实时对齐 */
  const handleSeek = (value: number) => {
    engine.seek(value)
  }

  return (
    <>
      <TerrainLayer visible={terrainVisible} />
      {points.length > 0 && (
        <ReplayOverlay engine={engine} points={points} skeleton={skeleton} stride={stride} />
      )}
      <div className="track-replay" ref={barRef}>
        {/* 进度滑块 */}
        <input
          type="range"
          className="track-replay__slider"
          min={0}
          max={1000}
          value={Math.round(snapshot.progress * 1000)}
          aria-label="回放进度"
          onChange={(event) => handleSeek(Number(event.target.value) / 1000)}
        />
        <div className="track-replay__row">
          <button
            type="button"
            className="track-replay__btn track-replay__btn--primary"
            onClick={() => engine.toggle()}
          >
            {snapshot.playing ? '⏸' : '▶'}
          </button>
          {SPEED_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={
                snapshot.speed === option
                  ? 'track-replay__btn track-replay__speed--active'
                  : 'track-replay__btn'
              }
              onClick={() => engine.setSpeed(option)}
            >
              {option}×
            </button>
          ))}
          <span className="track-replay__clock">{formatClock(snapshot.progress * totalSpan)}</span>
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
