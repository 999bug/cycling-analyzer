/**
 * 仪表盘页面（规格 §13）。
 *
 * 展示本周/本月/总计四项指标（骑行次数、骑行距离、骑行时间、累计爬升）
 * 与 30/90/365 天距离趋势图，底部为训练状态区块（CTL/ATL/TSB，规格 §39）。
 * 数据来自活动仓库 listAllSummaries，
 * 由 buildDashboardData 纯函数聚合，空数据时展示导入引导文案。
 */
import { useCallback, useEffect, useState } from 'react'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { buildDashboardData, type DashboardData } from '@/features/dashboard/statistics'
import StatCards from '@/features/dashboard/StatCards'
import TrendChart from '@/features/dashboard/TrendChart'
import TrainingStatusSection from '@/features/dashboard/TrainingStatusSection'
import { useImportStore } from '@/stores/importStore'
import '@/pages/DashboardPage.css'

/** 活动仓库单例（测试可 mock @/storage/db 注入独立数据库） */
const repository = new DexieActivityRepository(db)

/**
 * 仪表盘页面。
 */
function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState(false)
  // 订阅导入结果：数据导入完成后自动刷新统计（规格 §8）
  const importSummary = useImportStore((s) => s.summary)

  const reload = useCallback(() => {
    let cancelled = false
    repository
      .listAllSummaries()
      .then((summaries) => {
        if (!cancelled) {
          setData(buildDashboardData(summaries))
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(true)
        }
        console.error('Failed to load dashboard statistics', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = reload()
    return cancel
  }, [reload, importSummary])

  if (error) {
    return (
      <>
        <h1>仪表盘</h1>
        <p className="dashboard__message">统计加载失败，请稍后重试。</p>
      </>
    )
  }

  if (!data) {
    return (
      <>
        <h1>仪表盘</h1>
        <p className="dashboard__message">统计加载中…</p>
      </>
    )
  }

  if (!data.hasData) {
    return (
      <>
        <h1>仪表盘</h1>
        <p className="dashboard__message">
          欢迎使用！点击左侧「同步骑行数据」导入你的 FIT 骑行文件。
        </p>
      </>
    )
  }

  return (
    <>
      <h1>仪表盘</h1>
      <div className="dashboard__stats">
        <StatCards title="本周" summary={data.week} />
        <StatCards title="本月" summary={data.month} />
        <StatCards title="总计" summary={data.total} />
      </div>
      <TrendChart trends={data.trends} />
      <TrainingStatusSection />
    </>
  )
}

export default DashboardPage
