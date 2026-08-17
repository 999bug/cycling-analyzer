/**
 * 骑行日历页面（规格 §29）。
 *
 * 以 GitHub Contribution Graph 风格按年展示每日骑行强度：
 * 每周一行（周日起始），每日一格，颜色按当日总距离分 5 档；
 * 鼠标移入格子显示当日聚合详情（原生 title 提示）。
 * 数据来自活动仓库 listAllSummaries，由 buildCalendarData 纯函数聚合，
 * 空数据时展示导入引导文案。
 */
import { useCallback, useEffect, useState } from 'react'
import { db } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import CalendarHeatmap from '@/features/calendar/CalendarHeatmap'
import { buildCalendarData, type CalendarData } from '@/features/calendar/calendarData'
import { useImportStore } from '@/stores/importStore'

/** 活动仓库单例（测试可 mock @/storage/db 注入独立数据库） */
const repository = new DexieActivityRepository(db)

/**
 * 骑行日历页面。
 */
function CalendarPage() {
  const [data, setData] = useState<CalendarData | null>(null)
  const [error, setError] = useState(false)
  // 默认展示当前年份，可前后切换
  const [year, setYear] = useState(() => new Date().getFullYear())
  // 订阅导入结果：数据导入完成后自动刷新日历（规格 §8）
  const importSummary = useImportStore((s) => s.summary)

  const reload = useCallback(() => {
    let cancelled = false
    repository
      .listAllSummaries()
      .then((summaries) => {
        if (!cancelled) {
          setData(buildCalendarData(summaries))
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(true)
        }
        console.error('Failed to load calendar data', err)
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
        <h1>日历</h1>
        <p className="calendar-page__message">日历加载失败，请稍后重试。</p>
      </>
    )
  }

  if (data === null) {
    return (
      <>
        <h1>日历</h1>
        <p className="calendar-page__message">日历加载中…</p>
      </>
    )
  }

  if (data.size === 0) {
    return (
      <>
        <h1>日历</h1>
        <p className="calendar-page__message">
          欢迎使用！点击左侧「同步骑行数据」导入你的 FIT 骑行文件。
        </p>
      </>
    )
  }

  return (
    <>
      <h1>日历</h1>
      <CalendarHeatmap data={data} year={year} onYearChange={setYear} />
    </>
  )
}

export default CalendarPage
