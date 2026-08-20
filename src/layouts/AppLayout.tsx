import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import ImportPanel from '@/features/import/ImportPanel'
import DataSourceSwitcher from '@/components/DataSourceSwitcher'
import AuthorBanner from '@/components/AuthorBanner'
import '@/layouts/AppLayout.css'

/**
 * 侧边导航项：路径与中文名称。
 * end 仅对根路径生效，避免其他路径命中所有链接。
 */
interface NavItem {
  to: string
  label: string
  end?: boolean
  mobileHidden?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '仪表盘', end: true },
  { to: '/activities', label: '骑行记录' },
  { to: '/statistics', label: '统计' },
  { to: '/calendar', label: '日历' },
  { to: '/heatmap', label: '热力图', mobileHidden: true },
  { to: '/routes-map', label: '路线图', mobileHidden: true },
  { to: '/year-review', label: '年度回顾' },
  { to: '/segments', label: '赛段' },
  { to: '/training-plan', label: '训练计划' },
  { to: '/performance', label: '表现趋势' },
  { to: '/settings', label: '设置' },
]

/**
 * 应用布局：桌面端左侧固定侧边栏 + 右侧主内容区；
 * 移动端（≤768px）侧边栏改为可滑出的抽屉：顶栏汉堡按钮开合 + 半透明遮罩，
 * 默认收起不占空间，图标/导入/导航全部收进抽屉。
 * 移动端热力图/路线图导航项隐藏（大屏地图功能不适合小屏，CSS 控制）。
 * 含「跳转到主内容」skip link（a11y：键盘用户免逐项目录导航）。
 */
function AppLayout() {
  // 抽屉开合状态（仅移动端生效：导航项点击/Escape/点击遮罩时关闭）
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Escape 关闭抽屉（a11y：键盘可退出全屏遮罩）
  useEffect(() => {
    if (!drawerOpen) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [drawerOpen])

  const closeDrawer = () => setDrawerOpen(false)

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

      <aside
        id="app-nav"
        className={
          'app-layout__sidebar' + (drawerOpen ? ' app-layout__sidebar--open' : '')
        }
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
        <DataSourceSwitcher />
        <nav className="app-layout__nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              data-mobile-hidden={item.mobileHidden ? true : undefined}
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
          <span className="app-layout__version">v{__APP_VERSION__}</span>
        </div>
      </aside>
      <main id="main-content" className="app-layout__content" tabIndex={-1}>
        <AuthorBanner />
        <Outlet />
      </main>
    </div>
  )
}

export default AppLayout