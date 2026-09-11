/**
 * 降级瓦片层：监听瓦片加载失败，连续失败达阈值后回调上层切换瓦片源。
 *
 * OSM 等默认源在国内直连失败时底图空白；本组件统计 tileerror / tileload，
 * 连续失败（期间无成功）达阈值即触发降级回调，由上层切换 TILE_SOURCES 索引。
 */
import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { useOfflinePreferences } from '@/hooks/useOfflinePreferences'
import { CachingTileLayerComponent } from '@/map/CachingTileLayer'
import {
  FALLBACK_TILE_ERROR_THRESHOLD,
  isGcjSource,
  mapModeOf,
  TILE_SOURCES,
  type MapMode,
} from '@/map/tileSources'

/** 预缓冲圈数（Leaflet 默认 2）：平移时视口外多保留几圈旧瓦片，边缘更少露白 */
const TILE_KEEP_BUFFER = 4

/**
 * 降级瓦片层 props。
 */
export interface FallbackTileLayerProps {
  /** 当前瓦片源索引（TILE_SOURCES 下标） */
  sourceIndex: number

  /**
   * 地图显示模式（底图样式）。仅对高德源生效——降级到 OSM 后没有多模式底图，
   * 一律按该源自身渲染。缺省「正常」（矢量底图），其它用图组件无需关心模式。
   */
  mapMode?: MapMode

  /** 连续失败达阈值时触发的降级回调（单向，仅触发一次） */
  onFallback: () => void

  /**
   * 瓦片是否带 `crossOrigin=anonymous` 加载（默认 false）。
   *
   * 需要把底图整屏画进 canvas 的场景（分享卡 DOM 快照出图、导出视频）必须为 true：
   * 未带该属性的跨域 img 一旦被 drawImage，画布即被污染，toBlob/toDataURL 直接抛错。
   * 高德与 OSM 均返回 `Access-Control-Allow-Origin: *`，带 CORS 不影响正常加载。
   */
  crossOrigin?: boolean
}

/**
 * 降级瓦片层组件。
 *
 * @param props 组件参数
 */
export function FallbackTileLayer({ sourceIndex, mapMode = 'normal', onFallback, crossOrigin = false }: FallbackTileLayerProps) {
  const map = useMap()
  const { tileCacheEnabled } = useOfflinePreferences()
  // 连续失败计数（任一瓦片成功加载后清零，避免网络抖动误判）
  const failCountRef = useRef(0)
  // 已降级标记（单向防重：降级后不再重复回调）
  const fallenBackRef = useRef(false)

  useEffect(() => {
    const onTileError = () => {
      if (fallenBackRef.current) {
        return
      }
      failCountRef.current += 1
      if (failCountRef.current >= FALLBACK_TILE_ERROR_THRESHOLD) {
        fallenBackRef.current = true
        onFallback()
      }
    }

    // 任一瓦片加载成功说明网络可达，重置失败计数
    const onTileLoad = () => {
      failCountRef.current = 0
    }

    map.on('tileerror', onTileError)
    map.on('tileload', onTileLoad)
    return () => {
      map.off('tileerror', onTileError)
      map.off('tileload', onTileLoad)
    }
  }, [map, onFallback])

  const source = TILE_SOURCES[sourceIndex]
  // key 随源变化：换源时强制重建瓦片图层，立即清空旧源瓦片重新加载
  // 高德源按地图模式渲染图层栈（底图 + 可选透明注记叠加层），坐标系同为 GCJ-02
  if (isGcjSource(sourceIndex)) {
    // 本地预缓存只有矢量底图瓦片（清单 key 不含底图模式）：非「正常」模式必须关掉，
    // 否则卫星请求会命中本地矢量瓦片，作者数据区域切卫星后出现「矢量/卫星混杂」
    const allowLocalTile = mapMode === 'normal'
    return (
      <>
        {mapModeOf(mapMode).layers.map((layer, index) => (
          <CachingTileLayerComponent
            key={layer.url}
            url={layer.url}
            subdomains={layer.subdomains}
            // 署名只挂底图：叠加层重复署名会让版权控件出现两遍
            attribution={index === 0 ? source.attribution : ''}
            opacity={layer.opacity ?? 1}
            keepBuffer={TILE_KEEP_BUFFER}
            cacheEnabled={tileCacheEnabled}
            allowLocalTile={allowLocalTile}
            crossOrigin={crossOrigin ? 'anonymous' : undefined}
          />
        ))}
      </>
    )
  }
  return (
    <CachingTileLayerComponent
      key={source.url}
      url={source.url}
      subdomains={source.subdomains}
      attribution={source.attribution}
      keepBuffer={TILE_KEEP_BUFFER}
      cacheEnabled={tileCacheEnabled}
      crossOrigin={crossOrigin ? 'anonymous' : undefined}
    />
  )
}
