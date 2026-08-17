import { NavLink, Outlet } from 'react-router-dom'
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
  { to: '/settings', label: '设置' },
]

/**
 * 应用布局：左侧固定侧边栏 + 右侧主内容区。
 */
function AppLayout() {
  return (
    <div className="app-layout">
      <aside className="app-layout__sidebar">
        <div className="app-layout__brand">骑行数据</div>
        <nav className="app-layout__nav">
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
      <main className="app-layout__content">
        <Outlet />
      </main>
    </div>
  )
}

export default AppLayout
