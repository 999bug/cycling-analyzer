/**
 * 地图全屏查看与缩放控件定位（详情页/热力图共用）。
 *
 * - FullscreenSync：MapContainer 子组件，监听 fullscreenchange，
 *   进出全屏后调用 map.invalidateSize() 重算地图尺寸（容器尺寸变了瓦片才不错位）。
 * - ZoomControlBottomRight：MapContainer 子组件，把 + / - 缩放控件统一移到右下角。
 * - MapFullscreenButton：MapContainer 兄弟节点，放在相对定位包裹层内，点击切换包裹层全屏。
 *
 * 全屏分两路（2026-09-11）：
 * - 浏览器标签页 → 原生 Fullscreen API（requestFullscreen）；
 * - PWA 独立窗口（standalone）→ 伪全屏（fixed 覆盖层）。Android Chromium
 *   独立窗口里运行时调用 requestFullscreen 存在整页卡死的已知 bug 族
 *   （系统栏与全屏状态互相冲突，crbug 1232956 / 1415037 等），而手机浏览器
 *   标签页内完全正常，故独立窗口绕开原生 API；原生 API 缺失（iPhone Safari
 *   不支持元素全屏）或调用被拒时同样降级伪全屏。
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useMap } from 'react-leaflet'
import { isStandaloneDisplay } from '@/features/pwa/install'
import { enterPseudoFullscreen, exitPseudoFullscreen } from '@/map/pseudoFullscreen'
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

// ---------- 伪全屏（PWA 独立窗口降级方案，helpers 见 pseudoFullscreen.ts） ----------

/** 伪全屏压入的 history state 标记：Android 返回手势按此识别并退出全屏 */
const PSEUDO_FULLSCREEN_HISTORY_STATE = { cyclingMapPseudoFullscreen: true }

/**
 * 布局稳定后广播一次窗口 resize：Leaflet 默认监听 window resize 并
 * invalidateSize（trackResize），伪全屏切换改变容器尺寸后瓦片才重排。
 * 双 rAF 等待覆盖层完成布局，避免全屏过渡期内连环同步重排（移动端重绘大轨迹集易掉帧）。
 */
function notifyResizeAfterLayout(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'))
    })
  })
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
 * 全屏状态同步：原生路监听 fullscreenchange（Esc 退出也能还原图标）；
 * 伪全屏路以本组件状态为准，并监听 popstate 让 Android 返回手势退出。
 *
 * @param props 组件参数
 */
export function MapFullscreenButton({ targetRef }: MapFullscreenButtonProps) {
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false)
  const [isPseudo, setIsPseudo] = useState(false)
  // 进入伪全屏时记住的包裹层：卸载兜底摘类用（unmount 时 targetRef.current 可能已被 React 置空）
  const pseudoWrapperRef = useRef<HTMLElement | null>(null)

  // 原生全屏状态以 document.fullscreenElement 为准（用户按 Esc 退出时按钮同步还原）
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsNativeFullscreen(document.fullscreenElement === targetRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [targetRef])

  // 伪全屏监听 popstate：Android 返回手势/返回键退出全屏（进入时压入的栈帧随之弹出）
  useEffect(() => {
    if (!isPseudo) {
      return undefined
    }
    const onPopState = () => {
      const wrapper = pseudoWrapperRef.current
      if (wrapper !== null) {
        exitPseudoFullscreen(wrapper)
      }
      pseudoWrapperRef.current = null
      setIsPseudo(false)
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [isPseudo])

  // 卸载兜底：伪全屏态下组件被卸载（路由跳转等）时摘掉覆盖类，避免整页卡在覆盖层
  useEffect(
    () => () => {
      const wrapper = pseudoWrapperRef.current
      if (wrapper !== null) {
        exitPseudoFullscreen(wrapper)
      }
    },
    [],
  )

  /** 进入伪全屏并压入 history 栈帧（返回手势可退出），布局稳定后通知地图重算 */
  const enterPseudo = (wrapper: HTMLElement) => {
    enterPseudoFullscreen(wrapper)
    pseudoWrapperRef.current = wrapper
    setIsPseudo(true)
    history.pushState(PSEUDO_FULLSCREEN_HISTORY_STATE, '')
    notifyResizeAfterLayout()
  }

  const toggleFullscreen = () => {
    const wrapper = targetRef.current
    if (wrapper === null) {
      return
    }

    if (isPseudo) {
      // 按钮退出伪全屏：本地先摘类（popstate 兜底重摘也幂等），再回退进入时压入的栈帧
      exitPseudoFullscreen(wrapper)
      pseudoWrapperRef.current = null
      setIsPseudo(false)
      notifyResizeAfterLayout()
      const state = history.state as Record<string, unknown> | null
      if (state !== null && state?.cyclingMapPseudoFullscreen === true) {
        history.back()
      }
      return
    }

    if (isNativeFullscreen) {
      document.exitFullscreen?.()
      return
    }

    // 独立窗口 PWA 或原生 API 不可用 → 伪全屏（绕开 Chromium standalone 全屏卡死 bug 族）
    if (isStandaloneDisplay() || typeof wrapper.requestFullscreen !== 'function') {
      enterPseudo(wrapper)
      return
    }

    wrapper.requestFullscreen().catch(() => {
      // 原生全屏被拒（权限/时序等）→ 降级伪全屏兜底
      enterPseudo(wrapper)
    })
  }

  const active = isNativeFullscreen || isPseudo

  return (
    <button
      type="button"
      className="map-fullscreen-button"
      aria-label={active ? '退出全屏' : '全屏查看'}
      title={active ? '退出全屏' : '全屏查看'}
      onClick={toggleFullscreen}
    >
      {active ? '✕' : '⛶'}
    </button>
  )
}
