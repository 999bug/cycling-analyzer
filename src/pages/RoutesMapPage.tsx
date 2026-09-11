/**
 * 骑行路线图页（路线总览地图）。
 *
 * 页面分两大板块，顶部为大分区切换（带副标题）：
 * - 我的路线：骑行历史聚类，地图 + 统计格 + 列表；
 * - 热门路线：精选静态数据，地图 + 地区筛选 chips + 卡片网格 + 详情侧栏
 *   （详情含来源等级标注与免责声明——里程/爬升为官方或社区口径，非本站实测）。
 * 点击列表项/卡片高亮该路线（其余路线降透明度），再次点击恢复。
 * 作者源用 CI 预计算 route-tracks.json；本地源实时扫描（复用热力图缓存模式）。
 * 右下角提供底图模式切换（正常 / 卫星 / 卫星+路网），记忆与热力图、详情页共用。
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Polyline, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import {
  buildRouteGroups,
  extractEndpoints,
  haversineMeters,
  type RouteActivityInput,
} from '@/features/routes/routeGrouping'
import { buildRouteMapRoutes, routeColor, type RouteMapRoute } from '@/features/routes/routeMap'
import { simplifyRoute } from '@/map/simplify'
import { FallbackTileLayer } from '@/map/FallbackTileLayer'
import MapModeSwitcher from '@/map/MapModeSwitcher'
import { useMapMode } from '@/map/useMapMode'
import {
  isGcjSource,
  loadStoredSourceIndex,
  mapSystem,
  storeSourceIndex,
} from '@/map/tileSources'
import { applyOffsetMeters, toWgs84 } from '@/geo/coordinateSystem'
import { projectPoint } from '@/geo/projection'
import {
  SCAN_CACHE_ROUTES_MAP,
  loadScanCache,
  saveScanCache,
  summariesScanKey,
} from '@/storage/scanCache'
import {
  FullscreenSync,
  MapFullscreenButton,
  ResizeSync,
  ZoomControlBottomRight,
} from '@/map/mapFullscreen'
import { useActivityRepository } from '@/hooks/useActivityRepository'
import { formatDistance } from '@/utils/format'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import { defaultSnapshotClient } from '@/storage/authorData/snapshotClient'
import { listCyclingSummaries } from '@/features/activity/cyclingScope'
import { ALL_CURATED_ROUTES, CURATED_REGIONS } from '@/features/curatedRoutes'
import {
  difficultyLabel,
  routeKindLabel,
  sourceGradeLabel,
  type CuratedRegionId,
  type CuratedRoute,
} from '@/features/curatedRoutes/types'
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

/** 页面板块：「我的路线」（聚类自骑行历史）/「热门路线」（精选静态数据） */
type RouteTab = 'mine' | 'curated'

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
 * 热门路线的地图展示数据（模块级常量：精选路线为静态数据，配色与我的路线共用
 * 黄金角色板，索引即数组序）。count / lastActivityId 为占位值，精选路线无活动关联。
 */
const CURATED_DISPLAY: RouteMapRoute[] = ALL_CURATED_ROUTES.map((route, index) => ({
  index,
  color: routeColor(index),
  name: route.name,
  count: 0,
  tracks: route.tracks,
  lastActivityId: '',
}))

/**
 * 骑行路线图页面。
 */
function RoutesMapPage() {
  const [state, setState] = useState<LoadState>('loading')
  const [routes, setRoutes] = useState<RouteMapRoute[]>([])
  // 板块切换：我的路线（骑行历史聚类）/ 热门路线（精选静态数据）
  const [tab, setTab] = useState<RouteTab>('mine')
  // 选中路线索引（null = 全部高亮）：我的路线为聚类索引，热门路线为 ALL_CURATED_ROUTES 索引
  const [selected, setSelected] = useState<number | null>(null)
  // 热门路线的地区筛选（'all' = 全部地区）；切换地区时清空选中
  const [regionFilter, setRegionFilter] = useState<CuratedRegionId | 'all'>('all')
  // 当前瓦片源索引：默认高德；本会话已降级过则直接使用 OSM
  const [sourceIndex, setSourceIndex] = useState(() => loadStoredSourceIndex())
  // 底图模式（正常 / 卫星 / 卫星+路网）：与热力图、详情页共用同一份记忆
  const [mapMode, setMapMode] = useMapMode()
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

  // 切换板块：选中态随之清空（两个板块的索引空间互不通用）
  const handleTabSelect = useCallback((next: RouteTab) => {
    setTab(next)
    setSelected(null)
  }, [])

  // 切换地区筛选：选中态随之清空（索引仍指向全集，但展示集合已变）
  const handleRegionFilter = useCallback((next: CuratedRegionId | 'all') => {
    setRegionFilter(next)
    setSelected(null)
  }, [])

  // 当前板块的路线集合：热门路线为静态数据，无需加载
  const activeRoutes = tab === 'curated' ? CURATED_DISPLAY : routes

  // 热门路线中通过地区筛选的索引集合（null = 不筛选，全部显示）
  const curatedVisible = useMemo(() => {
    if (tab !== 'curated' || regionFilter === 'all') {
      return null
    }
    return new Set(
      ALL_CURATED_ROUTES.map((route, index) =>
        route.region === regionFilter ? index : -1,
      ).filter((index) => index >= 0),
    )
  }, [tab, regionFilter])

  // 地区筛选后的精选路线（卡片列表渲染用，index 指向全集）
  const visibleCurated = useMemo(() => {
    if (curatedVisible === null) {
      return ALL_CURATED_ROUTES.map((route, index) => ({ route, index }))
    }
    return [...curatedVisible].map((index) => ({
      route: ALL_CURATED_ROUTES[index]!,
      index,
    }))
  }, [curatedVisible])

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

      const summaries = await listCyclingSummaries(repository)
      const scanKey = summariesScanKey(summaries)
      // 两级缓存：内存（同会话）→ IndexedDB 持久化（刷新后免重扫）
      if (routeScanCache !== null && routeScanCache.key === scanKey) {
        if (!cancelled) {
          setRoutes(routeScanCache.routes)
          setState(routeScanCache.routes.length > 0 ? 'ready' : 'empty')
        }
        return
      }
      const persisted = await loadScanCache<RouteMapRoute[]>(SCAN_CACHE_ROUTES_MAP, scanKey)
      if (persisted !== null) {
        routeScanCache = { key: scanKey, routes: persisted }
        if (!cancelled) {
          setRoutes(persisted)
          setState(persisted.length > 0 ? 'ready' : 'empty')
        }
        return
      }

      const routeItems: RouteActivityInput[] = []
      const trackById = new Map<string, LatLng[]>()
      // 单次批量查询替代逐活动串行读（与热力图页同优化）
      const recordsByActivity = await repository.getRecordsByActivityIds(
        summaries.map((summary) => summary.id),
      )
      for (const summary of summaries) {
        const records = recordsByActivity.get(summary.id) ?? []
        if (cancelled) {
          return
        }
        const points = simplifyRoute(records, ROUTES_SIMPLIFY_TOLERANCE_METERS)
        if (points.length >= MIN_TRACK_POINTS) {
          // 按各活动自身坐标系归一化到 WGS-84（含手动微调）再缓存：与热力图页同口径，
          // 国内 App（行者等 GCJ-02）导入的活动不做归一化会整体偏移数百米
          trackById.set(
            summary.id,
            points.map((point) => {
              const normalized = toWgs84(point, summary.coordinateSystem ?? 'wgs84')
              const shifted = applyOffsetMeters(
                normalized,
                summary.trackOffset?.northMeters ?? 0,
                summary.trackOffset?.eastMeters ?? 0,
              )
              return [shifted.latitude, shifted.longitude] as LatLng
            }),
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
      // 路线聚类产物持久化：刷新后首次进入免重扫（写入失败不阻塞展示）
      void saveScanCache(SCAN_CACHE_ROUTES_MAP, scanKey, built)
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

  // 展示路线：数据统一为 WGS-84，渲染前投影到底图坐标系（与热力图页同口径）；
  // 转换仅作用于渲染，activeRoutes 中的 WGS-84 轨迹保持不变
  const displayRoutes = useMemo(() => {
    const target = mapSystem(sourceIndex)
    if (target === 'wgs84') {
      return activeRoutes
    }
    return activeRoutes.map((route) => ({
      ...route,
      tracks: route.tracks.map((track) =>
        track.map(([lat, lng]) => {
          const point = projectPoint({ longitude: lng, latitude: lat }, { to: target })
          return [point.latitude, point.longitude] as [number, number]
        }),
      ),
    }))
  }, [activeRoutes, sourceIndex])

  // 全部轨迹（fitBounds 视野用）：选中时仅选中路线；地区筛选时仅筛选命中地区
  const visibleTracks = useMemo(() => {
    if (selected !== null) {
      return displayRoutes[selected]?.tracks ?? []
    }
    return displayRoutes.flatMap((route, index) =>
      curatedVisible === null || curatedVisible.has(index) ? route.tracks : [],
    )
  }, [displayRoutes, selected, curatedVisible])

  // 我的路线底部统计：路线数 / 累计骑行次数 / 覆盖里程（里程按轨迹累加，与地图所见一致）
  const summary = useMemo(() => {
    let totalMeters = 0
    for (const route of activeRoutes) {
      for (const track of route.tracks) {
        for (let i = 1; i < track.length; i += 1) {
          const previous = track[i - 1]!
          const current = track[i]!
          totalMeters += haversineMeters(
            { latitude: previous[0], longitude: previous[1] },
            { latitude: current[0], longitude: current[1] },
          )
        }
      }
    }
    return {
      routeCount: activeRoutes.length,
      totalRides: activeRoutes.reduce((sum, route) => sum + route.count, 0),
      totalMeters,
    }
  }, [activeRoutes])

  // 热门路线板块当前选中的精选路线（详情侧栏展示用；索引指向全集）
  const selectedCurated: CuratedRoute | undefined =
    tab === 'curated' && selected !== null ? ALL_CURATED_ROUTES[selected] : undefined

  /** 地图折线渲染：白色光晕 + 彩色主线两层；地区筛选未命中的精选路线不渲染 */
  const renderRoutePolylines = (route: RouteMapRoute) => {
    if (curatedVisible !== null && !curatedVisible.has(route.index)) {
      return null
    }
    return route.tracks.map((track, trackIndex) => {
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
    })
  }

  return (
    <div className="routes-map-page">
      <div className="routes-map-page__head">
        <h1>骑行路线图</h1>
        <div className="routes-map-page__switch" role="group" aria-label="路线板块切换">
          <button
            type="button"
            className={
              'routes-map-page__switch-btn' +
              (tab === 'mine' ? ' routes-map-page__switch-btn--active' : '')
            }
            aria-pressed={tab === 'mine'}
            onClick={() => handleTabSelect('mine')}
          >
            我的路线
            <span className="routes-map-page__switch-hint">我的骑行足迹聚合</span>
          </button>
          <button
            type="button"
            className={
              'routes-map-page__switch-btn' +
              (tab === 'curated' ? ' routes-map-page__switch-btn--active' : '')
            }
            aria-pressed={tab === 'curated'}
            onClick={() => handleTabSelect('curated')}
          >
            热门路线
            <span className="routes-map-page__switch-hint">精选经典赛段 · 按地区</span>
          </button>
        </div>
      </div>
      {tab === 'mine' && state === 'loading' && <p className="routes-map-page__notice">路线加载中…</p>}
      {tab === 'mine' && state === 'error' && (
        <p className="routes-map-page__notice">路线加载失败，请刷新重试</p>
      )}
      {tab === 'mine' && state === 'empty' && (
        <p className="routes-map-page__notice">还没有可展示的骑行路线，先导入含 GPS 的骑行数据</p>
      )}
      {(tab === 'curated' || state === 'ready') && (
        <div
          className={
            'routes-map-page__layout' +
            (tab === 'curated' ? ' routes-map-page__layout--curated' : '')
          }
        >
          {/* 主列：地图 +（我的路线：统计格 / 热门路线：地区 chips + 卡片网格） */}
          <div className="routes-map-page__primary">
            <div className="routes-map-page__map-wrapper map-fullscreen-wrapper" ref={wrapperRef}>
              <MapContainer
                className="routes-map-page__map"
                center={visibleTracks[0]?.[0] ?? [31.2, 121.5]}
                zoom={12}
                scrollWheelZoom
              >
                <FallbackTileLayer
                  sourceIndex={sourceIndex}
                  mapMode={mapMode}
                  onFallback={handleFallback}
                />
                {displayRoutes.map(renderRoutePolylines)}
                <FitAllBounds tracks={visibleTracks} />
                <ResizeSync targetRef={wrapperRef} />
                <FullscreenSync />
                <ZoomControlBottomRight />
              </MapContainer>
              <MapFullscreenButton targetRef={wrapperRef} />
              <MapModeSwitcher
                value={mapMode}
                onChange={setMapMode}
                enabled={isGcjSource(sourceIndex)}
              />
            </div>
            {tab === 'mine' && (
              <div className="routes-map-page__stats">
                <span className="routes-map-page__stat">
                  <span className="routes-map-page__stat-label">路线</span>
                  <span className="routes-map-page__stat-value">{summary.routeCount} 条</span>
                </span>
                <span className="routes-map-page__stat">
                  <span className="routes-map-page__stat-label">累计骑行</span>
                  <span className="routes-map-page__stat-value">{summary.totalRides} 次</span>
                </span>
                <span className="routes-map-page__stat">
                  <span className="routes-map-page__stat-label">覆盖里程</span>
                  <span className="routes-map-page__stat-value">
                    {formatDistance(summary.totalMeters)}
                  </span>
                </span>
                <span className="routes-map-page__stat">
                  <span className="routes-map-page__stat-label">当前选中</span>
                  <span className="routes-map-page__stat-value">
                    {selected === null ? '全部路线' : (activeRoutes[selected]?.name ?? '全部路线')}
                  </span>
                </span>
              </div>
            )}
            {tab === 'curated' && (
              <>
                <div className="routes-map-page__chips" role="group" aria-label="地区筛选">
                  <button
                    type="button"
                    className={
                      'routes-map-page__chip' +
                      (regionFilter === 'all' ? ' routes-map-page__chip--active' : '')
                    }
                    aria-pressed={regionFilter === 'all'}
                    onClick={() => handleRegionFilter('all')}
                  >
                    全部 · {ALL_CURATED_ROUTES.length}
                  </button>
                  {CURATED_REGIONS.map((region) => (
                    <button
                      key={region.id}
                      type="button"
                      className={
                        'routes-map-page__chip' +
                        (regionFilter === region.id ? ' routes-map-page__chip--active' : '')
                      }
                      aria-pressed={regionFilter === region.id}
                      onClick={() => handleRegionFilter(region.id)}
                    >
                      {region.label} · {region.routes.length}
                    </button>
                  ))}
                </div>
                <ul className="routes-map-page__cards" aria-label="热门路线列表">
                  {visibleCurated.map(({ route, index }) => (
                    <li key={route.id}>
                      <button
                        type="button"
                        className={
                          'routes-map-page__card' +
                          (selected === index ? ' routes-map-page__card--active' : '')
                        }
                        style={{ borderLeftColor: CURATED_DISPLAY[index]?.color }}
                        aria-pressed={selected === index}
                        onClick={() => setSelected(selected === index ? null : index)}
                      >
                        <span className="routes-map-page__card-top">
                          <span className="routes-map-page__card-name">{route.name}</span>
                          <span className="routes-map-page__tag routes-map-page__tag--kind">
                            {routeKindLabel(route.kind)}
                          </span>
                          <span
                            className={
                              'routes-map-page__tag routes-map-page__tag--diff-' +
                              route.difficulty
                            }
                          >
                            {difficultyLabel(route.difficulty)}
                          </span>
                        </span>
                        <span className="routes-map-page__card-meta">
                          <span>{formatDistance(route.distanceMeters)}</span>
                          <span>爬升 {Math.round(route.elevationGainMeters)} m</span>
                        </span>
                        <span className="routes-map-page__card-area" title={route.description}>
                          {route.area} · {route.description}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          {/* 副列：我的路线 = 聚类列表；热门路线 = 详情侧栏 */}
          {tab === 'mine' ? (
            <ul className="routes-map-page__list" aria-label="路线列表">
              {routes.map((route) => (
                <li key={route.index}>
                  <button
                    type="button"
                    className={
                      'routes-map-page__item' +
                      (selected === route.index ? ' routes-map-page__item--active' : '')
                    }
                    aria-pressed={selected === route.index}
                    onClick={() => setSelected(selected === route.index ? null : route.index)}
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
          ) : (
            <aside className="routes-map-page__panel" aria-label="路线详情">
              {selectedCurated ? (
                <div className="routes-map-page__detail">
                  <h2>
                    {selectedCurated.name}
                    <span className="routes-map-page__detail-area">{selectedCurated.area}</span>
                  </h2>
                  <p className="routes-map-page__detail-desc">{selectedCurated.description}</p>
                  <p>
                    <strong>骑行提示：</strong>
                    {selectedCurated.tips}
                  </p>
                  <p className="routes-map-page__detail-meta">
                    {formatDistance(selectedCurated.distanceMeters)} · 爬升{' '}
                    {Math.round(selectedCurated.elevationGainMeters)} m · 难度{' '}
                    {selectedCurated.difficulty}/5（{difficultyLabel(selectedCurated.difficulty)}）
                  </p>
                  <p className="routes-map-page__detail-src">
                    来源（{selectedCurated.sourceGrade
                      ? sourceGradeLabel(selectedCurated.sourceGrade)
                      : '未分级'}
                    ）：{selectedCurated.source}
                  </p>
                  {selectedCurated.geometryScope === 'core' && (
                    <p className="routes-map-page__detail-src">
                      路径线仅覆盖核心精华段，未含全程绕行
                    </p>
                  )}
                  <p className="routes-map-page__detail-src">
                    路径线为 OSM 简化示意，导航以实际道路为准
                  </p>
                </div>
              ) : (
                <div className="routes-map-page__panel-hint">
                  <p>点击路线卡片在地图上单独高亮并查看详情，再次点击恢复全部。</p>
                  <p>
                    里程/爬升来自官方或社区码表口径，与本站轨迹无关；更多地区陆续上线中。
                  </p>
                </div>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  )
}

export default RoutesMapPage
