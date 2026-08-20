import { lazy, Suspense, type ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { ROUTES } from '@/app/router'
import AppLayout from '@/layouts/AppLayout'
import ActivitiesPage from '@/pages/ActivitiesPage'
import DashboardPage from '@/pages/DashboardPage'

// 路由级代码分割（性能优化）：重依赖页面按需加载，
// Leaflet 只在详情/热力图 chunk、Recharts 按需进入各页面 chunk，
// 首屏只下载布局 + 仪表盘 + 列表
const ActivityDetailPage = lazy(() => import('@/pages/ActivityDetailPage'))
const CalendarPage = lazy(() => import('@/pages/CalendarPage'))
const HeatmapPage = lazy(() => import('@/pages/HeatmapPage'))
const SegmentsPage = lazy(() => import('@/pages/SegmentsPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
const StatisticsPage = lazy(() => import('@/pages/StatisticsPage'))
const YearReviewPage = lazy(() => import('@/pages/YearReviewPage'))
const RoutesMapPage = lazy(() => import('@/pages/RoutesMapPage'))
const TrainingPlanPage = lazy(() => import('@/pages/TrainingPlanPage'))

/**
 * 懒加载页面容器：chunk 下载期间显示轻量占位。
 *
 * @param props 子元素（懒加载页面组件）
 */
function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p>页面加载中…</p>}>{children}</Suspense>
}

/**
 * 应用根组件，仅包含路由表。
 * BrowserRouter 由 main.tsx 挂载，便于测试时用 MemoryRouter 包裹。
 */
function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path={ROUTES[0]} element={<DashboardPage />} />
        <Route path={ROUTES[1]} element={<ActivitiesPage />} />
        <Route path={ROUTES[2]} element={<LazyPage><ActivityDetailPage /></LazyPage>} />
        <Route path={ROUTES[3]} element={<LazyPage><StatisticsPage /></LazyPage>} />
        <Route path={ROUTES[4]} element={<LazyPage><CalendarPage /></LazyPage>} />
        <Route path={ROUTES[5]} element={<LazyPage><SettingsPage /></LazyPage>} />
        <Route path={ROUTES[6]} element={<LazyPage><HeatmapPage /></LazyPage>} />
        <Route path={ROUTES[7]} element={<LazyPage><YearReviewPage /></LazyPage>} />
        <Route path={ROUTES[8]} element={<LazyPage><SegmentsPage /></LazyPage>} />
        <Route path={ROUTES[9]} element={<LazyPage><RoutesMapPage /></LazyPage>} />
        <Route path={ROUTES[10]} element={<LazyPage><TrainingPlanPage /></LazyPage>} />
      </Route>
    </Routes>
  )
}

export default App
