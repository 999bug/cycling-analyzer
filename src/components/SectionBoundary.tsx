/**
 * 区块级错误边界包装。
 *
 * 目的：把「单个区块报错」的影响面限制在该区块内——地图渲染失败不该让整页
 * 变成错误页，图表数据异常不该让人连侧边栏都点不了。
 *
 * 使用约定：
 * - 路由内容区用 `RouteBoundary`（按 pathname 自动重置，跳走即恢复）
 * - 独立高风险区块（地图 / 图表）用 `SectionBoundary`，scope 用中文区块名
 * - `scope` 只进本地错误日志用于定位，**严禁**传轨迹点/文件名等用户数据
 *   （与 AI 红线同源：数据不出本机）
 */
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'

interface SectionBoundaryProps {
  children: ReactNode

  /** 出错区块名（进本地错误日志用于定位） */
  scope: string

  /** 降级标题（缺省用通用文案） */
  title?: string

  /** 降级说明（缺省用通用文案） */
  description?: string
}

/**
 * 区块级错误边界：降级卡内联在区块位置，页面其余部分保持可用。
 *
 * @param props 区块名、可选文案与子元素
 */
export function SectionBoundary({
  children,
  scope,
  title,
  description,
}: SectionBoundaryProps) {
  return (
    <ErrorBoundary variant="section" scope={scope} title={title} description={description}>
      {children}
    </ErrorBoundary>
  )
}

/**
 * 路由级错误边界。
 *
 * 以 `pathname` 作为 boundary 的 key：路由一变就换新的 boundary 实例，
 * 错误态自动清空。不这么做的话，某个页面报错后即使用户点侧边栏切到别的页面，
 * 内容区依旧停在降级卡上（boundary state 在 Routes 之外不会自己重置）。
 *
 * @param props 子元素（通常包 `<Outlet />`）
 */
export function RouteBoundary({ children }: { children: ReactNode }) {
  const location = useLocation()
  return (
    <SectionBoundary
      key={location.pathname}
      scope={`route:${location.pathname}`}
      title="这个页面出错了"
      description="页面内容渲染失败，左侧导航仍可正常使用。可以先重试，或切换到其他页面。"
    >
      {children}
    </SectionBoundary>
  )
}
