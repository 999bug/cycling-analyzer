import { lazy, Suspense, type ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { ROUTES } from '@/app/router'
import { ErrorBoundary } from '@/components/ErrorBoundary'
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
const SegmentDetailPage = lazy(() => import('@/pages/SegmentDetailPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
const StatisticsPage = lazy(() => import('@/pages/StatisticsPage'))
const YearReviewPage = lazy(() => import('@/pages/YearReviewPage'))
const RoutesMapPage = lazy(() => import('@/pages/RoutesMapPage'))
const TrainingPlanPage = lazy(() => import('@/pages/TrainingPlanPage'))
const PerformancePage = lazy(() => import('@/pages/PerformancePage'))
const ChangelogPage = lazy(() => import('@/pages/ChangelogPage'))
const AcknowledgmentsPage = lazy(() => import('@/pages/AcknowledgmentsPage'))

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
    <ErrorBoundary>
      <Routes>
      <Route element={<AppLayout />}>
          {/* 路径一律用具名常量（ROUTES.xxx）：下标引用会在插入新路由时整体错位 */}
        <Route path={ROUTES.home} element={<DashboardPage />} />
        <Route path={ROUTES.activities} element={<ActivitiesPage />} />
        <Route path={ROUTES.activityDetail} element={<LazyPage><ActivityDetailPage /></LazyPage>} />
        <Route path={ROUTES.statistics} element={<LazyPage><StatisticsPage /></LazyPage>} />
        <Route path={ROUTES.calendar} element={<LazyPage><CalendarPage /></LazyPage>} />
        <Route path={ROUTES.settings} element={<LazyPage><SettingsPage /></LazyPage>} />
        <Route path={ROUTES.heatmap} element={<LazyPage><HeatmapPage /></LazyPage>} />
        <Route path={ROUTES.yearReview} element={<LazyPage><YearReviewPage /></LazyPage>} />
        <Route path={ROUTES.segments} element={<LazyPage><SegmentsPage /></LazyPage>} />
        <Route path={ROUTES.segmentDetail} element={<LazyPage><SegmentDetailPage /></LazyPage>} />
        <Route path={ROUTES.routesMap} element={<LazyPage><RoutesMapPage /></LazyPage>} />
        <Route path={ROUTES.trainingPlan} element={<LazyPage><TrainingPlanPage /></LazyPage>} />
        <Route path={ROUTES.performance} element={<LazyPage><PerformancePage /></LazyPage>} />
        <Route path={ROUTES.changelog} element={<LazyPage><ChangelogPage /></LazyPage>} />
        <Route path={ROUTES.acknowledgments} element={<LazyPage><AcknowledgmentsPage /></LazyPage>} />
      </Route>
    </Routes>
    </ErrorBoundary>
  )
}

export default App
