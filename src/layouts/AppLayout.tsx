import { useCallback, useEffect, useRef, useState } from 'react'
import type { FocusEvent } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import ImportPanel from '@/features/import/ImportPanel'
import DataSourceSwitcher from '@/components/DataSourceSwitcher'
import AuthorBanner from '@/components/AuthorBanner'
import AuthorHiddenNotice from '@/components/AuthorHiddenNotice'
import InstallBanner from '@/components/InstallBanner'
import UpdateBanner from '@/components/UpdateBanner'
import MigrationBanner from '@/components/MigrationBanner'
import FeedbackButton from '@/components/FeedbackButton'
import { switchSidebarMode } from '@/features/settings/sidebar'
import { useUiStore } from '@/stores/uiStore'
import type { SidebarMode } from '@/features/settings/settings'
import '@/layouts/AppLayout.css'

/**
 * 侧边导航项：路径与中文名称。
 * end 仅对根路径生效，避免其他路径命中所有链接。
 */
interface NavItem {
  to: string
  label: string
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '仪表盘', end: true },
  { to: '/activities', label: '骑行记录' },
  { to: '/statistics', label: '统计' },
  { to: '/calendar', label: '日历' },
  { to: '/heatmap', label: '热力图' },
  { to: '/routes-map', label: '路线图' },
  { to: '/year-review', label: '年度回顾' },
  { to: '/segments', label: '赛段' },
  { to: '/training-plan', label: '训练计划' },
  { to: '/performance', label: '表现趋势' },
  { to: '/settings', label: '设置' },
  { to: '/changelog', label: '更新日志' },
]

/** 自动收回：鼠标移出侧边栏后的收起延迟（毫秒），缓冲贴边划过与移向内容区的手抖 */
const SIDEBAR_COLLAPSE_DELAY_MS = 300

/**
 * 应用布局：桌面端左侧固定侧边栏 + 右侧主内容区；
 * 移动端（≤768px）侧边栏改为可滑出的抽屉：顶栏汉堡按钮开合 + 半透明遮罩，
 * 默认收起不占空间，图标/导入/导航全部收进抽屉。
 * 热力图/路线图在移动端同样展示（v2.27.0 起恢复：两页均有窄屏适配，
 * 详情页地图已验证小屏可用，首次进入慢的问题已由扫描缓存持久化解决）。
 * 含「跳转到主内容」skip link（a11y：键盘用户免逐项目录导航）。
 *
 * 桌面端侧边栏行为可配置（设置页「外观」或侧边栏顶部图钉按钮切换）：
 * - 固定（默认）：常驻 220px
 * - 自动收回：鼠标移入滑出展开，移出 300ms 后收起；收起态左侧只留贴边抓条，
 *   品牌 logo 随侧栏一起隐藏。键盘焦点进入侧栏时保持展开，
 *   Escape 立即收起；收起时内层容器加 inert，避免焦点落进不可见区域。
 */
function AppLayout() {
  // 抽屉开合状态（仅移动端生效：导航项点击/Escape/点击遮罩时关闭）
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 侧边栏行为（持久化在 settings 表，运行时镜像在 uiStore）
  const sidebarMode = useUiStore((state) => state.sidebarMode)
  const sidebarHydrated = useUiStore((state) => state.sidebarHydrated)

  // 自动收回模式下是否临时展开（鼠标或焦点位于侧栏内时为 true）
  const [sidebarRevealed, setSidebarRevealed] = useState(false)

  // 收起定时器（鼠标移出后的缓冲期；重复触及时重置）
  const collapseTimerRef = useRef<number | null>(null)

  const autoHide = sidebarMode === 'auto'
  const sidebarCollapsed = autoHide && !sidebarRevealed

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = null
    }
  }, [])

  /** 展开侧边栏（鼠标移入 / 键盘聚焦 / 点击抓条） */
  const revealSidebar = useCallback(() => {
    clearCollapseTimer()
    setSidebarRevealed(true)
  }, [clearCollapseTimer])

  /** 计划收起（延迟执行；期间鼠标移回则取消） */
  const scheduleSidebarCollapse = useCallback(() => {
    clearCollapseTimer()
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null
      setSidebarRevealed(false)
    }, SIDEBAR_COLLAPSE_DELAY_MS)
  }, [clearCollapseTimer])

  // 卸载时清理未触发的定时器
  useEffect(() => clearCollapseTimer, [clearCollapseTimer])

  // Escape 关闭抽屉 / 立即收起侧边栏（a11y：键盘可退出展开的导航）
  useEffect(() => {
    if (!drawerOpen && !autoHide) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false)
        setSidebarRevealed(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [drawerOpen, autoHide])

  const closeDrawer = () => setDrawerOpen(false)

  /** 焦点仍在侧栏内时保持展开，焦点移出后按延迟收起 */
  const handleSidebarBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null
    if (next !== null && event.currentTarget.contains(next)) {
      return
    }
    scheduleSidebarCollapse()
  }

  /** 切换侧边栏行为（图钉按钮；与设置页下拉共用同一条持久化路径） */
  const handleToggleSidebarMode = () => {
    const next: SidebarMode = sidebarMode === 'fixed' ? 'auto' : 'fixed'
    switchSidebarMode(next).catch((error: unknown) => {
      console.error('Failed to switch sidebar mode', error)
    })
  }

  const sidebarClassName = [
    'app-layout__sidebar',
    drawerOpen ? 'app-layout__sidebar--open' : '',
    sidebarCollapsed ? 'app-layout__sidebar--collapsed' : '',
    // 启动读取未完成前禁用宽度过渡，避免「先展开再收起」的闪动
    sidebarHydrated ? '' : 'app-layout__sidebar--instant',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="app-layout">
      <a className="app-layout__skip-link" href="#main-content">
        跳转到主内容
      </a>

      {/* 顶栏（移动端可见）：汉堡按钮 + 品牌 */}
      <header className="app-layout__topbar">
        <button
          type="button"
          className="app-layout__menu-button"
          aria-label="打开菜单"
          aria-expanded={drawerOpen}
          aria-controls="app-nav"
          onClick={() => setDrawerOpen((open) => !open)}
        >
          <span className="app-layout__menu-icon" aria-hidden="true" />
        </button>
        <Link className="app-layout__topbar-brand" to="/" title="回到仪表盘首页">
          <img
            className="app-layout__topbar-logo"
            src={`${import.meta.env.BASE_URL}qileme.png`}
            alt="骑了么 logo"
          />
        </Link>
      </header>

      {/* 抽屉遮罩（移动端展开时覆盖主内容） */}
      {drawerOpen && (
        <div
          className="app-layout__scrim"
          aria-hidden="true"
          onClick={closeDrawer}
        />
      )}

      {/* 自动收回模式的贴边抓条（仅收起态渲染；移动端由样式隐藏） */}
      {sidebarCollapsed && (
        <button
          type="button"
          className="app-layout__sidebar-handle"
          aria-label="展开侧边栏"
          aria-controls="app-nav"
          aria-expanded={false}
          onClick={revealSidebar}
          onMouseEnter={revealSidebar}
          onFocus={revealSidebar}
        />
      )}

      {/* 悬停/焦点事件始终绑定：固定模式下不影响渲染（收起判定只看模式与展开态），
          「自动收回」模式下则保证从设置页或图钉切过来时，鼠标仍在侧栏内即保持展开 */}
      <aside
        id="app-nav"
        className={sidebarClassName}
        onMouseEnter={revealSidebar}
        onMouseLeave={scheduleSidebarCollapse}
        onFocus={revealSidebar}
        onBlur={handleSidebarBlur}
      >
        {/* 内层固定宽度：收起时由外层裁剪，内容不重排；收起后 inert 挡住键盘焦点 */}
        <div
          className="app-layout__sidebar-inner"
          inert={sidebarCollapsed || undefined}
        >
          <Link
            className="app-layout__brand app-layout__brand--drawer"
            to="/"
            title="回到仪表盘首页"
            onClick={closeDrawer}
          >
            <img
              className="app-layout__brand-logo"
              src={`${import.meta.env.BASE_URL}qileme.png`}
              alt="骑了么 logo"
            />
          </Link>
          {/* 侧边栏行为切换：图钉高亮 = 固定常驻，带斜杠 = 自动收回 */}
          <button
            type="button"
            className={
              'app-layout__pin' + (sidebarMode === 'fixed' ? ' app-layout__pin--pinned' : '')
            }
            aria-pressed={sidebarMode === 'fixed'}
            aria-label={
              sidebarMode === 'fixed'
                ? '侧边栏固定常驻，点击改为自动收回'
                : '侧边栏自动收回，点击改为固定常驻'
            }
            title={
              sidebarMode === 'fixed'
                ? '侧边栏：固定常驻（点击改为自动收回）'
                : '侧边栏：自动收回（点击改为固定常驻）'
            }
            onClick={handleToggleSidebarMode}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="5" r="3.1" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M8 8.1v5.4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              {sidebarMode !== 'fixed' && (
                <path
                  d="M2.6 2.6l10.8 10.8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
          <DataSourceSwitcher />
          <nav className="app-layout__nav" aria-label="主导航">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  isActive
                    ? 'app-layout__nav-item app-layout__nav-item--active'
                    : 'app-layout__nav-item'
                }
                onClick={closeDrawer}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="app-layout__sidebar-footer">
            <ImportPanel />
            <div className="app-layout__footer-row">
              <Link className="app-layout__version" to="/changelog" title="查看更新日志">v{__APP_VERSION__}</Link>
              <Link className="app-layout__credits-link" to="/acknowledgments" title="感谢参与测试与使用的骑友">
                鸣谢
              </Link>
            </div>
          </div>
        </div>
      </aside>
      <main id="main-content" className="app-layout__content" tabIndex={-1}>
        <AuthorBanner />
        <AuthorHiddenNotice />
        <Outlet />
      </main>
      {/* PWA 安装引导横幅（可安装且非冷却期时展示；fixed 定位不受内容区影响） */}
      <InstallBanner />
      {/* 本地数据迁移进度条（v5 存储升级，后台分批执行，完成后自动刷新） */}
      <MigrationBanner />
      {/* 新版本更新提示条（新 SW 预缓存就绪时展示；z-index 60 高于抽屉） */}
      <UpdateBanner />
      {/* 全站反馈入口：右下角常驻悬浮按钮，点击弹出反馈窗口 */}
      <FeedbackButton />
    </div>
  )
}

export default AppLayout
