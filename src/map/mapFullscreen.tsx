/**
 * 地图全屏查看与缩放控件定位（详情页/热力图共用）。
 *
 * - FullscreenSync：MapContainer 子组件，监听 fullscreenchange，
 *   进出全屏后调用 map.invalidateSize() 重算地图尺寸（容器尺寸变了瓦片才不错位）。
 * - ZoomControlBottomRight：MapContainer 子组件，把 + / - 缩放控件统一移到右下角。
 * - MapFullscreenButton：MapContainer 兄弟节点，放在相对定位包裹层内，
 *   点击对包裹层调用 Fullscreen API（原生全屏，无新依赖）。
 */
import { useEffect, useState, type RefObject } from 'react'
import { useMap } from 'react-leaflet'
import '@/map/mapFullscreen.css'

/**
 * 全屏切换后同步地图尺寸。
 * MapContainer 的子组件才能访问 map 实例（react-leaflet context）。
 */
export function FullscreenSync() {
  const map = useMap()
  useEffect(() => {
    const onFullscreenChange = () => {
      map.invalidateSize()
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [map])
  return null
}

/**
 * 容器尺寸变化后同步地图尺寸（ResizeObserver）。
 *
 * 地图容器改为 flex 自适应高度（铺满布局）后，首帧 flex 计算、窗口缩放、
 * 列表展开等都会改变容器尺寸，Leaflet 需 invalidateSize 重算瓦片布局。
 */
export function ResizeSync({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  const map = useMap()
  useEffect(() => {
    const element = targetRef.current
    if (element === null || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => {
      map.invalidateSize()
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [map, targetRef])
  return null
}

/**
 * 缩放控件移到右下角（react-leaflet 的 zoomControl 属性仅支持开关，定位需操作 map 实例）。
 */
export function ZoomControlBottomRight() {
  const map = useMap()
  useEffect(() => {
    map.zoomControl.setPosition('bottomright')
  }, [map])
  return null
}

/**
 * 全屏按钮 props。
 */
export interface MapFullscreenButtonProps {
  /** 全屏目标容器（相对定位包裹层） */
  targetRef: RefObject<HTMLDivElement | null>
}

/**
 * 全屏查看按钮：悬浮于地图右上角，点击切换包裹层全屏。
 * 全屏状态监听 fullscreenchange 同步（Esc 退出也能正确还原按钮图标）。
 *
 * @param props 组件参数
 */
export function MapFullscreenButton({ targetRef }: MapFullscreenButtonProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)

  // 全屏状态以 document.fullscreenElement 为准（用户按 Esc 退出时按钮同步还原）
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === targetRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [targetRef])

  const toggleFullscreen = () => {
    if (isFullscreen) {
      void document.exitFullscreen()
      return
    }
    void targetRef.current?.requestFullscreen()
  }

  return (
    <button
      type="button"
      className="map-fullscreen-button"
      aria-label={isFullscreen ? '退出全屏' : '全屏查看'}
      title={isFullscreen ? '退出全屏' : '全屏查看'}
      onClick={toggleFullscreen}
    >
      {isFullscreen ? '✕' : '⛶'}
    </button>
  )
}
