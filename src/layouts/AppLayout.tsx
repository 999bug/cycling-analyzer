import { Link, NavLink, Outlet } from 'react-router-dom'
import ImportPanel from '@/features/import/ImportPanel'
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
  { to: '/year-review', label: '年度回顾' },
  { to: '/segments', label: '赛段' },
  { to: '/settings', label: '设置' },
]

/**
 * 应用布局：左侧固定侧边栏 + 右侧主内容区。
 * 含「跳转到主内容」skip link（a11y：键盘用户免逐项目录导航）。
 */
function AppLayout() {
  return (
    <div className="app-layout">
      <a className="app-layout__skip-link" href="#main-content">
        跳转到主内容
      </a>
      <aside className="app-layout__sidebar">
        <Link className="app-layout__brand" to="/" title="回到仪表盘首页">
          <span className="app-layout__brand-row">
            <img
              className="app-layout__brand-logo"
              src={`${import.meta.env.BASE_URL}ride.png`}
              alt="骑记 logo"
            />
            <span className="app-layout__brand-name">骑记</span>
          </span>
          <span className="app-layout__brand-en">Ride Insight</span>
          <span className="app-layout__brand-tagline">看懂你的每一次骑行</span>
        </Link>
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
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="app-layout__sidebar-footer">
          <ImportPanel />
        </div>
      </aside>
      <main id="main-content" className="app-layout__content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}

export default AppLayout
