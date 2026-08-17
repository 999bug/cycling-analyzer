import { Route, Routes } from 'react-router-dom'
import { ROUTES } from '@/app/router'
import AppLayout from '@/layouts/AppLayout'
import ActivitiesPage from '@/pages/ActivitiesPage'
import ActivityDetailPage from '@/pages/ActivityDetailPage'
import CalendarPage from '@/pages/CalendarPage'
import DashboardPage from '@/pages/DashboardPage'
import SettingsPage from '@/pages/SettingsPage'
import StatisticsPage from '@/pages/StatisticsPage'

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
        <Route path={ROUTES[2]} element={<ActivityDetailPage />} />
        <Route path={ROUTES[3]} element={<StatisticsPage />} />
        <Route path={ROUTES[4]} element={<CalendarPage />} />
        <Route path={ROUTES[5]} element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}

export default App
