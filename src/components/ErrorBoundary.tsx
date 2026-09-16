/**
 * 错误边界（React class 组件——唯一例外）。
 *
 * 两级粒度：
 * - `variant="page"`（默认）：全屏降级卡，兜底整站白屏（典型场景：PWA autoUpdate
 *   后旧标签持有的 chunk hash 失效，lazy() 动态 import 抛错）。恢复路径是整页刷新。
 * - `variant="section"`：**区块内联**降级，不遮挡页面其余部分。用于路由内容区、
 *   地图 / 图表等独立区块——此前只有最外层一个边界，单个图表报错会把整页
 *   降级成「页面出错了 + 重新加载」，用户连侧边栏都点不了，代价远大于错误本身。
 *
 * 注意：以下场景**不会被**本边界捕获（React 已知行为）：
 * - 异步事件回调（setTimeout / event handler）—— 需各自 try/catch；
 *   全局兜底由 `installErrorLogging` 的 window error / unhandledrejection 监听负责
 * - Suspense lazy 抛错若发生在 ErrorBoundary **外层**则捕获不到
 * - 服务端渲染错误
 *
 * `getDerivedStateFromError` + `componentDidCatch` 配合：前者更新
 * state 触发降级 UI 重渲，后者挂日志（默认 console.error，英文）。
 */
import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'
import { reloadPage } from '@/utils/navigation'
import { logError } from '@/features/logging/errorLog'
import './ErrorBoundary.css'

/** 降级范围 */
export type ErrorBoundaryVariant =
  /** 全屏（默认）：兜底整站白屏，恢复手段是整页刷新 */
  | 'page'
  /** 区块内联：保留页面其余部分可用，恢复手段是先重试再刷新 */
  | 'section'

interface ErrorBoundaryProps {
  children: ReactNode

  /** 降级范围（缺省 page，保持既有行为不变） */
  variant?: ErrorBoundaryVariant

  /** 降级标题（缺省按 variant 取默认文案） */
  title?: string

  /** 降级说明（缺省按 variant 取默认文案） */
  description?: string

  /**
   * 出错区块名（如 `route:/heatmap`、`地图`）。
   * 只进本地错误日志用于定位，**严禁**塞入轨迹点 / 文件名等用户数据。
   */
  scope?: string
}

interface ErrorBoundaryState {
  error: Error | null

  /** 重试计数：作为子树 key，重试时强制重挂载（而非复用可能已损坏的组件实例） */
  resetKey: number
}

/** 各 variant 的默认文案 */
const DEFAULT_TEXT: Record<ErrorBoundaryVariant, { title: string; description: string }> = {
  page: {
    title: '页面出错了',
    description: '应用遇到意外错误。请点击下方按钮重新加载页面继续使用。',
  },
  section: {
    title: '这部分内容加载失败',
    description: '页面其余部分仍可正常使用。可以先重试，仍失败再刷新页面。',
  },
}

/**
 * React class 组件（项目内唯一）：getDerivedStateFromError + componentDidCatch
 * 是 React 官方推荐写法；hooks 拿不到错误对象。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null, resetKey: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 英文日志便于日志聚合检索；堆栈信息由浏览器自动附在 Error 上
    console.error('ErrorBoundary caught an error', error, info.componentStack)
    // 同步落库：控制台一关就查不到，留档供「更多 → 错误日志」查看与导出。
    // meta 只带组件栈与区块名，不含任何轨迹/文件数据（与 AI 红线同源）
    void logError('error', 'boundary', error, {
      componentStack: info.componentStack,
      scope: this.props.scope,
      variant: this.props.variant ?? 'page',
    })
  }

  /**
   * 降级渲染：错误发生时展示重置入口，避免整站白屏。
   * 重新加载整页是最稳的恢复路径（清掉 React 树 + Service Worker 旧 chunk 缓存）。
   */
  private handleReload = (): void => {
    reloadPage()
  }

  /**
   * 区块级重试：清掉错误态并换 key 重挂载子树。
   * 常用于偶发失败（数据竞态 / 地图瓦片异常），比重启整页代价小得多。
   */
  private handleRetry = (): void => {
    this.setState((prev) => ({ error: null, resetKey: prev.resetKey + 1 }))
  }

  override render(): ReactNode {
    const variant = this.props.variant ?? 'page'
    const text = DEFAULT_TEXT[variant]

    if (this.state.error === null) {
      // key 只在重试后变化：正常情况下子树不重挂载
      return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>
    }

    if (variant === 'section') {
      return (
        <div
          className="error-boundary error-boundary--section"
          role="alert"
          aria-live="polite"
        >
          <div className="error-boundary__card">
            {/* 区块内用 p 而非 h1：一个页面上可能出现多个降级区块，多个 h1 会破坏标题层级 */}
            <p className="error-boundary__title">{this.props.title ?? text.title}</p>
            <p className="error-boundary__message">{this.props.description ?? text.description}</p>
            <div className="error-boundary__actions">
              <button
                type="button"
                className="error-boundary__action"
                onClick={this.handleRetry}
              >
                重试
              </button>
              <button
                type="button"
                className="error-boundary__action error-boundary__action--secondary"
                onClick={this.handleReload}
              >
                刷新页面
              </button>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="error-boundary" role="alert" aria-live="assertive">
        <div className="error-boundary__card">
          <h1 className="error-boundary__title">{this.props.title ?? text.title}</h1>
          <p className="error-boundary__message">{this.props.description ?? text.description}</p>
          <button
            type="button"
            className="error-boundary__action"
            onClick={this.handleReload}
          >
            重新加载
          </button>
        </div>
      </div>
    )
  }
}
