/**
 * 视口内懒挂载包装器（性能优化：主包瘦身专项）。
 *
 * 进入视口（rootMargin 200px 预载带，复用 hooks/useInView）前渲染同高度
 * 占位块，不把 children 挂进 React 树——图表类子树（Recharts
 * ResponsiveContainer 测量 + 坐标计算）是首屏渲染开销大头，首屏视口外的
 * 图表推迟到滚动接近时再挂载，显著降低首次渲染工作量。
 *
 * 与 LazySegmentMap 同模式泛化：children 模式零 API 改动，包裹任意子树。
 * jsdom/旧浏览器无 IntersectionObserver 时 useInView 直接返回 true，
 * 退化为立即渲染（测试与既有行为完全兼容）。
 */
import type { ReactNode } from 'react'
import { useInView } from '@/hooks/useInView'

/** 懒挂载 props */
export interface DeferredMountProps {
  /** 进入视口后渲染的内容 */
  children: ReactNode

  /** 占位块高度（px），接近实际内容高度以避免滚动跳动 */
  minHeight: number

  /** 占位块无障碍描述（如所属区块名称） */
  placeholderLabel?: string

  /** 占位块附加类名（默认占位样式 + 调用方定制） */
  className?: string
}

/**
 * 视口内懒挂载包装组件。
 */
export function DeferredMount({
  children,
  minHeight,
  placeholderLabel,
  className = '',
}: DeferredMountProps) {
  const [ref, inView] = useInView()
  if (inView) {
    return <>{children}</>
  }
  return (
    <div
      ref={ref}
      className={`deferred-mount${className ? ` ${className}` : ''}`}
      style={{ minHeight }}
      aria-label={placeholderLabel}
    >
      {/* 视口占位：进入预载带前不挂载子树 */}
    </div>
  )
}
