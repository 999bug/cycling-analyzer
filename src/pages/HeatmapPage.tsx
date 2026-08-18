/**
 * 骑行热力图页（规格 §39 P2）。
 *
 * 将全部活动的轨迹以低透明度折线叠加绘制，重合路段颜色自然加深，
 * 形成"热力"效果（无新依赖，纯 Leaflet Polyline 叠加）。
 * 轨迹抽稀复用 Douglas-Peucker（simplifyRoute），加载期间显示进度，
 * 无坐标数据时显示引导文案（不伪造）。
 * 支持右上角按钮全屏查看（mapFullscreen），缩放控件统一在右下角。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Polyline, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { simplifyRoute } from '@/map/simplify'
import { buildGridCoverage } from '@/features/heatmap/gridCoverage'
import { summariesScanKey } from '@/storage/scanCache'
import {
  FullscreenSync,
  MapFullscreenButton,
  ZoomControlBottomRight,
} from '@/map/mapFullscreen'
import { useActivityRepository } from '@/hooks/useActivityRepository'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import { defaultSnapshotClient } from '@/storage/authorData/snapshotClient'
import '@/pages/HeatmapPage.css'

/** 轨迹抽稀阈值（米）：热力图只看路线分布，允许更大的简化 */
const HEATMAP_SIMPLIFY_TOLERANCE_METERS = 10

/** 一条可绘制轨迹至少需要 2 个点 */
const MIN_TRACK_POINTS = 2

/** 热力线颜色（紫色，OSM 浅色瓦片上对比度高，与轨迹路线主蓝 #4f8cff 明显区分） */
const TRACK_COLOR = '#9333ea'

/** 热力线宽（像素）：略粗保证远景缩放时可见 */
const TRACK_WEIGHT = 3

/** 热力线透明度（低透明度叠加，重合越多越深；单条轨迹也要清晰可见） */
const TRACK_OPACITY = 0.45

/** 经纬度元组（Leaflet 坐标） */
type LatLng = [number, number]

/**
 * 轨迹扫描模块级缓存（性能优化）：key = summariesScanKey。
 * 全量轨迹加载+抽稀成本高，活动集合指纹不变时直接复用（离开再回来秒开）。
 */
let trackScanCache: { key: string; tracks: LatLng[][] } | null = null

/** 加载状态：loading / empty（无轨迹）/ ready / error */
type LoadState = 'loading' | 'empty' | 'ready' | 'error'

/**
 * 自动适配视野子组件：把所有轨迹点纳入地图视野。
 *
 * @param tracks 轨迹列表（每条为经纬度元组数组）
 */
function FitAllBounds({ tracks }: { tracks: LatLng[][] }) {
  const map = useMap()
  useEffect(() => {
    const all = tracks.flat()
    if (all.length >= MIN_TRACK_POINTS) {
      map.fitBounds(all, { padding: [24, 24] })
    }
  }, [map, tracks])
  return null
}

/**
 * 骑行热力图页面。
 */
function HeatmapPage() {
  const [state, setState] = useState<LoadState>('loading')
  const [tracks, setTracks] = useState<LatLng[][]>([])
  // 全屏包裹层引用：全屏按钮对包裹层调用 Fullscreen API
  const wrapperRef = useRef<HTMLDivElement>(null)
  // 当前数据源的活动仓库（源切换 → 实例变化 → 重新加载）
  const repository = useActivityRepository()
  // 当前数据源（作者源轨迹为 CI 预计算产物，分支见下）
  const source = useDataSourceStore(selectEffectiveSource)

  // 加载全部活动轨迹：摘要列表 → 逐活动加载逐点 → 抽稀取坐标
  useEffect(() => {
    let cancelled = false

    /**
     * 汇总全部活动的抽稀轨迹（无坐标的活动自动剔除）。
     * 命中模块级缓存时跳过全量扫描（性能优化）。
     */
    async function loadTracks() {
      if (source === 'author') {
        // 作者源：CI 预计算抽稀轨迹（免全量逐点下载，约 25MB → 百 KB 级）
        const file = await defaultSnapshotClient.getTracks()
        if (!cancelled) {
          setTracks(file.tracks)
          setState(file.tracks.length > 0 ? 'ready' : 'empty')
        }
        return
      }

      const summaries = await repository.listAllSummaries()
      const scanKey = summariesScanKey(summaries)
      if (trackScanCache !== null && trackScanCache.key === scanKey) {
        if (!cancelled) {
          setTracks(trackScanCache.tracks)
          setState(trackScanCache.tracks.length > 0 ? 'ready' : 'empty')
        }
        return
      }

      const loaded: LatLng[][] = []
      for (const summary of summaries) {
        const records = await repository.getRecords(summary.id)
        const points = simplifyRoute(records, HEATMAP_SIMPLIFY_TOLERANCE_METERS)
        if (points.length >= MIN_TRACK_POINTS) {
          loaded.push(points.map((point) => [point.latitude, point.longitude] as LatLng))
        }
        if (cancelled) {
          return
        }
      }
      trackScanCache = { key: scanKey, tracks: loaded }
      if (!cancelled) {
        setTracks(loaded)
        setState(loaded.length > 0 ? 'ready' : 'empty')
      }
    }

    loadTracks().catch((error: unknown) => {
      if (!cancelled) {
        setState('error')
      }
      console.error('Failed to load heatmap tracks', error)
    })
    return () => {
      cancelled = true
    }
  }, [repository, source])

  // 区域覆盖统计（0.01° ≈ 1km 网格，骑过即覆盖，重复不计）
  const coverage = useMemo(() => buildGridCoverage(tracks), [tracks])

  return (
    <div className="heatmap-page">
      <h1>骑行热力图</h1>
      {state === 'loading' && <p className="heatmap-page__notice">轨迹加载中…</p>}
      {state === 'error' && <p className="heatmap-page__notice">加载失败，请刷新重试</p>}
      {state === 'empty' && (
        <p className="heatmap-page__notice">还没有可展示的骑行轨迹，先导入含 GPS 的骑行数据</p>
      )}
      {state === 'ready' && (
        <>
          <p className="heatmap-page__summary">
            共 {tracks.length} 条轨迹，已探索 {coverage.cellCount} 个 1km 网格（约{' '}
            {coverage.areaKm2} km²），骑得越多的路段颜色越深
          </p>
          <div className="heatmap-page__map-wrapper map-fullscreen-wrapper" ref={wrapperRef}>
            <MapContainer className="heatmap-page__map" center={tracks[0][0]} zoom={12} scrollWheelZoom>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {tracks.map((track, index) => (
                <Polyline
                  key={index}
                  positions={track}
                  pathOptions={{ color: TRACK_COLOR, weight: TRACK_WEIGHT, opacity: TRACK_OPACITY }}
                />
              ))}
              <FitAllBounds tracks={tracks} />
              <FullscreenSync />
              <ZoomControlBottomRight />
            </MapContainer>
            <MapFullscreenButton targetRef={wrapperRef} />
          </div>
        </>
      )}
    </div>
  )
}

export default HeatmapPage
