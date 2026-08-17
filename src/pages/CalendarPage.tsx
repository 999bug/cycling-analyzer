/**
 * 骑行日历页面（规格 §29）。
 *
 * 以 GitHub Contribution Graph 风格按年展示每日骑行强度：
 * 每周一列（周日起始）、每天一行，颜色按当日总距离分 5 档；
 * 鼠标移入格子显示原生 title 聚合详情，点击有骑行的格子展开
 * 当日活动面板（活动列表链接跳详情页）。
 * 数据来自活动仓库 listAllSummaries，由 buildCalendarData 纯函数聚合，
 * 空数据时展示导入引导文案。
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { db } from '@/storage/db'
import {
  DexieActivityRepository,
  type ActivitySummary,
} from '@/storage/repositories/activityRepository'
import CalendarHeatmap from '@/features/calendar/CalendarHeatmap'
import { buildCalendarData, localDateKey, type CalendarData } from '@/features/calendar/calendarData'
import { formatDuration } from '@/utils/format'
import { formatDistanceByUnit } from '@/features/settings/settings'
import { useImportStore } from '@/stores/importStore'
import { useUnits } from '@/hooks/useUnits'

/** 活动仓库单例（测试可 mock @/storage/db 注入独立数据库） */
const repository = new DexieActivityRepository(db)

/**
 * 骑行日历页面。
 */
function CalendarPage() {
  const [summaries, setSummaries] = useState<ActivitySummary[] | null>(null)
  const [error, setError] = useState(false)
  // 默认展示当前年份，可前后切换
  const [year, setYear] = useState(() => new Date().getFullYear())
  // 选中日期的活动面板（null = 收起）
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  // 订阅导入结果：数据导入完成后自动刷新日历（规格 §8）
  const importSummary = useImportStore((s) => s.summary)
  // 距离显示单位（规格 §27，格子 tooltip 与面板）
  const { distance: distanceUnit } = useUnits()

  const reload = useCallback(() => {
    let cancelled = false
    repository
      .listAllSummaries()
      .then((all) => {
        if (!cancelled) {
          setSummaries(all)
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

  const data: CalendarData | null = summaries === null ? null : buildCalendarData(summaries)
  // 当日活动（面板展示）：按本地日期键过滤，开始时间升序
  const selectedActivities =
    selectedDate === null || summaries === null
      ? []
      : summaries
          .filter((summary) => localDateKey(new Date(summary.startTime)) === selectedDate)
          .sort((a, b) => a.startTime.localeCompare(b.startTime))

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
      <CalendarHeatmap
        data={data}
        year={year}
        onYearChange={(nextYear) => {
          setYear(nextYear)
          setSelectedDate(null)
        }}
        distanceUnit={distanceUnit}
        onDaySelect={setSelectedDate}
        selectedDate={selectedDate}
      />
      {selectedDate !== null && (
        <section aria-label="当日骑行" className="calendar-day-panel">
          <div className="calendar-day-panel__header">
            <span className="calendar-day-panel__title">{selectedDate} 骑行</span>
            <button
              aria-label="关闭当日面板"
              className="calendar-day-panel__close"
              onClick={() => setSelectedDate(null)}
              type="button"
            >
              ×
            </button>
          </div>
          <div className="calendar-day-panel__list">
            {selectedActivities.map((activity) => (
              <Link
                key={activity.id}
                className="calendar-day-panel__item"
                to={`/activities/${activity.id}`}
              >
                <span className="calendar-day-panel__name">
                  {activity.name ?? activity.fileName}
                </span>
                <span className="calendar-day-panel__meta">
                  {formatDistanceByUnit(activity.distance, distanceUnit)} ·{' '}
                  {formatDuration(activity.duration)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

export default CalendarPage
