/**
 * 迷你地图懒加载壳（GPX 导入卡死修复）。
 *
 * 视口外渲染同尺寸占位块（复用 .segment-card__map 高度），进入视口
 * （含 rootMargin 200px 预载带）后才挂载真正的 SegmentMiniMap，
 * 批量 GPX 导入几十张卡片时避免同时初始化几十个 Leaflet 实例。
 */
import type { ReactNode } from 'react'
import { useInView } from '@/hooks/useInView'

/** 懒加载地图 props（与 SegmentMiniMap 一致，children = 实际地图组件） */
export interface LazySegmentMapProps {
  /** 进入视口后渲染的地图节点 */
  children: ReactNode

  /** 占位提示文本（无障碍） */
  placeholderLabel?: string
}

/**
 * 懒加载地图包装组件。
 */
export function LazySegmentMap({ children, placeholderLabel }: LazySegmentMapProps) {
  const [ref, inView] = useInView()
  if (inView) {
    return <>{children}</>
  }
  return (
    <div ref={ref} className="segment-card__map segment-card__map--placeholder" aria-label={placeholderLabel}>
      {/* 视口占位：进入视口前不初始化 Leaflet */}
    </div>
  )
}