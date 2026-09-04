/**
 * 全局错误边界（React class 组件——唯一例外）。
 *
 * 用途：捕获子组件渲染期 / 生命周期 / 构造函数抛出的同步错误，
 * 防止单页崩溃导致整站白屏（典型场景：PWA autoUpdate 后旧标签持有的
 * chunk hash 失效，lazy() 动态 import 抛错）。
 *
 * 注意：以下场景**不会被**本边界捕获（React 已知行为）：
 * - 异步事件回调（setTimeout / event handler）—— 需各自 try/catch
 * - Suspense lazy 抛错若发生在 ErrorBoundary **外层**则捕获不到；
 *   本组件包在 Routes 外层恰好覆盖此场景
 * - 服务端渲染错误
 *
 * `getDerivedStateFromError` + `componentDidCatch` 配合：前者更新
 * state 触发降级 UI 重渲，后者挂日志（默认 console.error，英文）。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import './ErrorBoundary.css'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * React class 组件（项目内唯一）：getDerivedStateFromError + componentDidCatch
 * 是 React 官方推荐写法；hooks 拿不到错误对象。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 英文日志便于日志聚合检索；堆栈信息由浏览器自动附在 Error 上
    console.error('ErrorBoundary caught an error', error, info.componentStack)
  }

  /**
   * 降级渲染：错误发生时展示重置入口，避免整站白屏。
   * 重新加载整页是最稳的恢复路径（清掉 React 树 + Service Worker 旧 chunk 缓存）。
   */
  private handleReload = (): void => {
    window.location.reload()
  }

  override render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children
    }
    return (
      <div className="error-boundary" role="alert" aria-live="assertive">
        <div className="error-boundary__card">
          <h1 className="error-boundary__title">页面出错了</h1>
          <p className="error-boundary__message">
            应用遇到意外错误。请点击下方按钮重新加载页面继续使用。
          </p>
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
