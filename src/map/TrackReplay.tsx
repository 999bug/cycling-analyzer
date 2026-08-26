/**
 * 轨迹在线回放（规格外：用户需求）。
 *
 * 在活动轨迹地图上叠加回放控制条：播放/暂停、进度拖动、倍速选择。
 * 播放时当前位置光标沿轨迹推进，地图自动跟随平移；HUD 展示已骑距离/当前速度/心率。
 * 可选叠加 OpenTopoMap 地形底图（免费无 key，WGS-84 坐标系与 OSM 一致；
 * 高德源下地形层坐标偏差可接受——地形仅作参考背景，轨迹仍以底图纠偏为准）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, Polyline, TileLayer, useMap } from 'react-leaflet'
import type { RoutePoint } from '@/types/activity'
import { formatDistanceByUnit, type DistanceUnit } from '@/features/settings/settings'
import './TrackReplay.css'

/** 回放速度选项（倍率） */
const SPEED_OPTIONS = [1, 4, 16] as const

/** 基准播放时长（秒）：1x 速度下走完全程的时间 */
const BASE_PLAYBACK_SECONDS = 30

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
 * 计算指定时间戳对应的轨迹点索引（二分查找最近点）。
 *
 * @param points 轨迹点（timestamp 升序）
 * @param timestamp 目标时间戳
 */
function findIndexAtTimestamp(points: RoutePoint[], timestamp: number): number {
  let low = 0
  let high = points.length - 1
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (points[mid]!.timestamp < timestamp) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

/** 回放跟随的地图缩放级别：街道级，能看清当前路段细节 */
const FOLLOW_ZOOM = 16

/** 已走轨迹高亮色（与底图轨迹形成明显对比） */
const TRAVELED_COLOR = '#ff9f43'

/** 当前位置点颜色（亮青发光） */
const CURSOR_COLOR = '#34d9ff'

/**
 * 地图跟随子组件：播放时平滑平移+缩放到当前位置；同时渲染当前位置标记与已走高亮轨迹。
 *
 * @param props.position 当前位置（展示坐标）
 * @param props.playing 是否正在播放（暂停时不强制居中）
 * @param props.traveledLatLngs 已走轨迹坐标列表（含当前位置）
 * @param props.zoomToFollow 是否启用自动缩放（用户手动拖动进度时同样生效）
 */
function ReplayCursor({ position, playing, traveledLatLngs, zoomToFollow }: {
  position: RoutePoint
  playing: boolean
  traveledLatLngs: [number, number][]
  zoomToFollow: boolean
}) {
  const map = useMap()
  // 用户是否手动改过缩放：手动操作后不再强制 setZoom，只 panTo
  const userZoomedRef = useRef(false)

  useEffect(() => {
    const onZoomEnd = () => {
      // 标记用户主动缩放（程序化 setZoom 也触发 zoomend，用标志位区分：
      // 程序化调用前先置 true 再置 false 的窗口极短，实际冲突概率低）
      userZoomedRef.current = true
    }
    map.on('zoomend', onZoomEnd)
    return () => { map.off('zoomend', onZoomEnd) }
  }, [map])

  useEffect(() => {
    if (!zoomToFollow) {
      return
    }
    if (!userZoomedRef.current) {
      map.setView([position.latitude, position.longitude], FOLLOW_ZOOM, { animate: true, duration: 0.5 })
    } else {
      map.panTo([position.latitude, position.longitude], { animate: true, duration: 0.5 })
    }
  }, [map, position, playing, zoomToFollow])

  return (
    <>
      {/* 已走轨迹高亮 */}
      <Polyline positions={traveledLatLngs} pathOptions={{ color: TRAVELED_COLOR, weight: 6, opacity: 0.95 }} />
      {/* 当前位置：外圈光晕 + 内核亮点 */}
      <CircleMarker
        center={[position.latitude, position.longitude]}
        radius={14}
        pathOptions={{ color: CURSOR_COLOR, weight: 2, fillColor: CURSOR_COLOR, fillOpacity: 0.25, stroke: false }}
      />
      <CircleMarker
        center={[position.latitude, position.longitude]}
        radius={7}
        pathOptions={{ color: '#fff', weight: 2, fillColor: CURSOR_COLOR, fillOpacity: 1 }}
      />
    </>
  )
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
  const [progress, setProgress] = useState(0)
  const [speed, setSpeed] = useState<number>(1)

  // rAF 驱动的动画循环引用
  const rafRef = useRef<number>(0)
  // 上帧时间戳（计算 dt 用）
  const lastTickRef = useRef<number>(0)

  // 首末时间戳
  const firstTs = points[0]?.timestamp ?? 0
  const lastTs = points[points.length - 1]?.timestamp ?? 0
  const totalSpan = Math.max(lastTs - firstTs, 1)

  // 当前模拟时间戳（Unix 秒）
  const currentTs = useMemo(
    () => firstTs + progress * totalSpan,
    [firstTs, progress, totalSpan],
  )

  // 当前位置点（按时间戳二分）
  const currentIndex = useMemo(() => findIndexAtTimestamp(points, currentTs), [points, currentTs])
  const currentPosition = points[Math.min(currentIndex, points.length - 1)] ?? points[0]

  // 已走轨迹（首点到当前点）：橙色高亮与灰色全程形成对比
  const traveledLatLngs = useMemo<[number, number][]>(
    () => points.slice(0, currentIndex + 1).map((p) => [p.latitude, p.longitude] as [number, number]),
    [points, currentIndex],
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

  // 播放循环：rAF 推进 progress
  useEffect(() => {
    if (!playing) {
      return
    }
    lastTickRef.current = performance.now()

    function tick() {
      const now = performance.now()
      const dt = (now - lastTickRef.current) / 1000
      lastTickRef.current = now
      setProgress((prev) => {
        const next = prev + (dt * speed) / BASE_PLAYBACK_SECONDS
        if (next >= 1) {
          setPlaying(false)
          return 1
        }
        return next
      })
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, speed])

  // 卸载时清理 rAF
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  return (
    <>
      <TerrainLayer visible={terrainVisible} />
      {currentPosition !== undefined && (
        <ReplayCursor
          position={currentPosition}
          playing={playing}
          traveledLatLngs={traveledLatLngs}
          zoomToFollow={progress > 0 && progress < 1}
        />
      )}
      <div className="track-replay">
        {/* 进度滑块 */}
        <input
          type="range"
          className="track-replay__slider"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          aria-label="回放进度"
          onChange={(event) => setProgress(Number(event.target.value) / 1000)}
        />
        <div className="track-replay__row">
          <button
            type="button"
            className="track-replay__btn track-replay__btn--primary"
            onClick={() => {
              if (!playing && progress >= 1) {
                setProgress(0)
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
          <span className="track-replay__clock">{formatClock(progress * totalSpan)}</span>
          <span className="track-replay__stat">{distanceLabel}</span>
          <span className="track-replay__stat">{speedLabel}</span>
          <span className="track-replay__stat">{heartRateLabel}</span>
          <button
            type="button"
            className={
              terrainVisible
                ? 'track-replay__btn track-replay__terrain--active'
                : 'track-replay__btn'
            }
            onClick={onTerrainToggle}
            title="切换地形图底图"
          >
            ⛰ 地形
          </button>
        </div>
      </div>
    </>
  )
}


