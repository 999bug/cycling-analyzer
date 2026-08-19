/**
 * 降级瓦片层：监听瓦片加载失败，连续失败达阈值后回调上层切换瓦片源。
 *
 * OSM 等默认源在国内直连失败时底图空白；本组件统计 tileerror / tileload，
 * 连续失败（期间无成功）达阈值即触发降级回调，由上层切换 TILE_SOURCES 索引。
 */
import { useEffect, useRef } from 'react'
import { TileLayer, useMap } from 'react-leaflet'
import { FALLBACK_TILE_ERROR_THRESHOLD, TILE_SOURCES } from '@/map/tileSources'

/**
 * 降级瓦片层 props。
 */
export interface FallbackTileLayerProps {
  /** 当前瓦片源索引（TILE_SOURCES 下标） */
  sourceIndex: number

  /** 连续失败达阈值时触发的降级回调（单向，仅触发一次） */
  onFallback: () => void
}

/**
 * 降级瓦片层组件。
 *
 * @param props 组件参数
 */
export function FallbackTileLayer({ sourceIndex, onFallback }: FallbackTileLayerProps) {
  const map = useMap()
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
  return (
    <TileLayer
      key={source.url}
      url={source.url}
      subdomains={source.subdomains}
      attribution={source.attribution}
    />
  )
}
