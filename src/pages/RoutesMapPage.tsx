/**
 * 骑行路线图页（路线总览地图）。
 *
 * 全部骑行路线按路线聚类画在一张地图上：同一条路线同一颜色（黄金角色相分布），
 * 点击路线列表高亮该路线（其余路线降透明度），再次点击恢复。
 * 作者源用 CI 预计算 route-tracks.json；本地源实时扫描（复用热力图缓存模式）。
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Polyline, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import {
  buildRouteGroups,
  extractEndpoints,
  type RouteActivityInput,
} from '@/features/routes/routeGrouping'
import { buildRouteMapRoutes, routeColor, type RouteMapRoute } from '@/features/routes/routeMap'
import { simplifyRoute } from '@/map/simplify'
import { FallbackTileLayer } from '@/map/FallbackTileLayer'
import { loadStoredSourceIndex, storeSourceIndex } from '@/map/tileSources'
import { summariesScanKey } from '@/storage/scanCache'
import {
  FullscreenSync,
  MapFullscreenButton,
  ZoomControlBottomRight,
} from '@/map/mapFullscreen'
import { useActivityRepository } from '@/hooks/useActivityRepository'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import { defaultSnapshotClient } from '@/storage/authorData/snapshotClient'
import '@/pages/RoutesMapPage.css'

/** 轨迹抽稀阈值（米）：路线图与热力图口径一致 */
const ROUTES_SIMPLIFY_TOLERANCE_METERS = 10

/** 一条可绘制轨迹至少需要 2 个点 */
const MIN_TRACK_POINTS = 2

/** 路线线宽（像素，常规 / 选中加粗） */
const ROUTE_WEIGHT = 4
const ROUTE_WEIGHT_SELECTED = 6

/** 白色描边光晕宽度（比彩色线粗的量，浅色瓦片上增强对比） */
const ROUTE_HALO_WEIGHT = 2

/** 路线透明度（常规 / 未选中几乎隐藏） */
const ROUTE_OPACITY = 0.95
const ROUTE_OPACITY_DIM = 0.06

/** 加载状态：loading / empty / ready / error */
type LoadState = 'loading' | 'empty' | 'ready' | 'error'

/** 经纬度元组（Leaflet 坐标） */
type LatLng = [number, number]

/**
 * 本地源路线扫描模块级缓存（性能优化）：key = summariesScanKey。
 * 全量轨迹加载+分组成本高，活动集合指纹不变时直接复用。
 */
let routeScanCache: { key: string; routes: RouteMapRoute[] } | null = null

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
 * 骑行路线图页面。
 */
function RoutesMapPage() {
  const [state, setState] = useState<LoadState>('loading')
  const [routes, setRoutes] = useState<RouteMapRoute[]>([])
  // 选中路线索引（null = 全部高亮）
  const [selected, setSelected] = useState<number | null>(null)
  // 当前瓦片源索引：默认高德；本会话已降级过则直接使用 OSM
  const [sourceIndex, setSourceIndex] = useState(() => loadStoredSourceIndex())
  // 全屏包裹层引用：全屏按钮对包裹层调用 Fullscreen API
  const wrapperRef = useRef<HTMLDivElement>(null)
  // 当前数据源的活动仓库（源切换 → 实例变化 → 重新加载）
  const repository = useActivityRepository()
  // 当前数据源（作者源路线 → 轨迹为 CI 预计算产物，分支见下）
  const source = useDataSourceStore(selectEffectiveSource)

  // 降级回调：切换 OSM 源并记忆（单向，本会话内刷新页面仍直接使用降级源）
  const handleFallback = useCallback(() => {
    setSourceIndex(1)
    storeSourceIndex(1)
  }, [])

  // 加载路线地图数据：作者源预计算 / 本地源全量扫描
  useEffect(() => {
    let cancelled = false

    /**
     * 汇总路线地图数据（路线 → 轨迹 + 配色）。
     * 作者源：CI 预计算 route-tracks.json；本地源：逐活动扫描抽稀 + 路线聚类。
     */
    async function loadRoutes() {
      if (source === 'author') {
        const file = await defaultSnapshotClient.getRouteTracks()
        const authorRoutes: RouteMapRoute[] = file.routes.map((route, index) => ({
          index,
          color: routeColor(index),
          name: route.name ?? `路线 ${index + 1}`,
          count: route.count,
          tracks: route.tracks,
          lastActivityId: route.lastActivityId,
        }))
        if (!cancelled) {
          setRoutes(authorRoutes)
          setState(authorRoutes.length > 0 ? 'ready' : 'empty')
        }
        return
      }

      const summaries = await repository.listAllSummaries()
      const scanKey = summariesScanKey(summaries)
      if (routeScanCache !== null && routeScanCache.key === scanKey) {
        if (!cancelled) {
          setRoutes(routeScanCache.routes)
          setState(routeScanCache.routes.length > 0 ? 'ready' : 'empty')
        }
        return
      }

      const routeItems: RouteActivityInput[] = []
      const trackById = new Map<string, LatLng[]>()
      for (const summary of summaries) {
        const records = await repository.getRecords(summary.id)
        if (cancelled) {
          return
        }
        const points = simplifyRoute(records, ROUTES_SIMPLIFY_TOLERANCE_METERS)
        if (points.length >= MIN_TRACK_POINTS) {
          trackById.set(
            summary.id,
            points.map((point) => [point.latitude, point.longitude] as LatLng),
          )
        }
        const endpoints = extractEndpoints(records)
        routeItems.push({
          id: summary.id,
          name: summary.name,
          startTime: summary.startTime,
          distance: summary.distance,
          duration: summary.duration,
          start: endpoints?.start,
          end: endpoints?.end,
        })
      }
      const built = buildRouteMapRoutes(buildRouteGroups(routeItems), trackById)
      routeScanCache = { key: scanKey, routes: built }
      if (!cancelled) {
        setRoutes(built)
        setState(built.length > 0 ? 'ready' : 'empty')
      }
    }

    loadRoutes().catch((error: unknown) => {
      if (!cancelled) {
        setState('error')
      }
      console.error('Failed to load route map', error)
    })
    return () => {
      cancelled = true
    }
  }, [repository, source])

  // 全部轨迹（fitBounds 视野用；选中时仅选中路线轨迹）
  const visibleTracks = useMemo(
    () =>
      selected === null
        ? routes.flatMap((route) => route.tracks)
        : (routes[selected]?.tracks ?? []),
    [routes, selected],
  )

  return (
    <div className="routes-map-page">
      <h1>骑行路线图</h1>
      {state === 'loading' && <p className="routes-map-page__notice">路线加载中…</p>}
      {state === 'error' && <p className="routes-map-page__notice">路线加载失败，请刷新重试</p>}
      {state === 'empty' && (
        <p className="routes-map-page__notice">还没有可展示的骑行路线，先导入含 GPS 的骑行数据</p>
      )}
      {state === 'ready' && (
        <div className="routes-map-page__layout">
          <ul className="routes-map-page__list" aria-label="路线列表">
            {routes.map((route) => (
              <li key={route.index}>
                <button
                  type="button"
                  className={
                    'routes-map-page__item' +
                    (selected === route.index ? ' routes-map-page__item--active' : '')
                  }
                  onClick={() =>
                    setSelected(selected === route.index ? null : route.index)
                  }
                >
                  <span
                    className="routes-map-page__dot"
                    style={{ backgroundColor: route.color }}
                  />
                  <span className="routes-map-page__name" title={route.name}>
                    {route.name}
                  </span>
                  <span className="routes-map-page__count">{route.count} 次</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="routes-map-page__map-wrapper map-fullscreen-wrapper" ref={wrapperRef}>
            <MapContainer
              className="routes-map-page__map"
              center={visibleTracks[0]?.[0] ?? [31.2, 121.5]}
              zoom={12}
              scrollWheelZoom
            >
              <FallbackTileLayer sourceIndex={sourceIndex} onFallback={handleFallback} />
              {routes.map((route) =>
                route.tracks.map((track, trackIndex) => {
                  // 未选中时几乎隐藏；选中路线加粗 + 白描边光晕（浅色瓦片上醒目）
                  const isDimmed = selected !== null && selected !== route.index
                  const isSelected = selected === route.index
                  const weight = isSelected ? ROUTE_WEIGHT_SELECTED : ROUTE_WEIGHT
                  return (
                    <Fragment key={`${route.index}-${trackIndex}`}>
                      <Polyline
                        positions={track}
                        pathOptions={{
                          color: '#ffffff',
                          weight: weight + ROUTE_HALO_WEIGHT,
                          opacity: isDimmed ? 0 : 0.35,
                          lineCap: 'round',
                        }}
                      />
                      <Polyline
                        positions={track}
                        pathOptions={{
                          color: route.color,
                          weight,
                          opacity: isDimmed ? ROUTE_OPACITY_DIM : ROUTE_OPACITY,
                          lineCap: 'round',
                        }}
                      />
                    </Fragment>
                  )
                }),
              )}
              <FitAllBounds tracks={visibleTracks} />
              <FullscreenSync />
              <ZoomControlBottomRight />
            </MapContainer>
            <MapFullscreenButton targetRef={wrapperRef} />
          </div>
        </div>
      )}
    </div>
  )
}

export default RoutesMapPage
