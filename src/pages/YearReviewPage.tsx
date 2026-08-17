/**
 * 年度回顾页面（后续工作项：年度回顾）。
 *
 * 按自然年回顾骑行：年份切换（仅有数据的年份）→ 年度十项指标卡
 * （复用 buildStatistics 自定义范围）→ 月度距离柱状图。
 * 数据来自活动仓库 listAllSummaries，订阅 importStore 导入后自动刷新。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '@/storage/db'
import {
  DexieActivityRepository,
  type ActivitySummary,
} from '@/storage/repositories/activityRepository'
import { buildStatistics, resolveRange } from '@/features/statistics/statistics'
import StatisticCards from '@/features/statistics/StatisticCards'
import MonthlyDistanceChart from '@/features/yearReview/MonthlyDistanceChart'
import { buildMonthlyDistances, extractYears, yearRange } from '@/features/yearReview/yearReview'
import { useImportStore } from '@/stores/importStore'
import { useUnits } from '@/hooks/useUnits'
import '@/pages/YearReviewPage.css'

/** 活动仓库单例（测试可 mock @/storage/db 注入独立数据库） */
const repository = new DexieActivityRepository(db)

/**
 * 年度回顾页面。
 */
function YearReviewPage() {
  const [summaries, setSummaries] = useState<ActivitySummary[] | null>(null)
  const [error, setError] = useState(false)
  // 选中年份（null = 未选择，数据就绪后取最新年份）
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  // 订阅导入结果：数据导入完成后自动刷新（规格 §8）
  const importSummary = useImportStore((s) => s.summary)
  // 距离显示单位（规格 §27）
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
        console.error('Failed to load year review summaries', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = reload()
    return cancel
  }, [reload, importSummary])

  // 有数据的年份（降序）
  const years = useMemo(() => extractYears(summaries ?? []), [summaries])
  // 当前年份：优先用户选择，否则最新年份
  const currentYear = selectedYear ?? years[0]

  // 年度指标：复用统计纯函数（自定义范围 = 整个自然年）
  const metrics = useMemo(() => {
    if (currentYear === undefined) {
      return null
    }
    return buildStatistics(summaries ?? [], resolveRange('custom', new Date(), yearRange(currentYear)))
  }, [summaries, currentYear])

  // 月度距离聚合
  const months = useMemo(
    () => (currentYear === undefined ? [] : buildMonthlyDistances(summaries ?? [], currentYear)),
    [summaries, currentYear],
  )

  if (error) {
    return (
      <>
        <h1>年度回顾</h1>
        <p className="year-review__message">统计加载失败，请稍后重试。</p>
      </>
    )
  }

  if (summaries === null) {
    return (
      <>
        <h1>年度回顾</h1>
        <p className="year-review__message">统计加载中…</p>
      </>
    )
  }

  if (years.length === 0 || metrics === null) {
    return (
      <>
        <h1>年度回顾</h1>
        <p className="year-review__message">
          欢迎使用！点击左侧「同步骑行数据」导入你的 FIT 骑行文件。
        </p>
      </>
    )
  }

  return (
    <>
      <h1>年度回顾</h1>
      <div className="year-review__years" role="radiogroup" aria-label="选择年份">
        {years.map((year) => (
          <label key={year} className="year-review__year">
            <input
              type="radio"
              name="year-review-year"
              checked={year === currentYear}
              onChange={() => setSelectedYear(year)}
            />
            {year} 年
          </label>
        ))}
      </div>
      <StatisticCards title={`${currentYear} 年`} metrics={metrics} distanceUnit={distanceUnit} />
      <section className="year-review__monthly" aria-label="月度距离">
        <h2 className="year-review__monthly-title">月度距离</h2>
        <MonthlyDistanceChart months={months} distanceUnit={distanceUnit} />
      </section>
    </>
  )
}

export default YearReviewPage
