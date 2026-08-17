/**
 * 统计页面（规格 §28）。
 *
 * 展示十个统计指标——骑行次数、总距离、总时间、总爬升、平均单次距离、
 * 平均速度、最长骑行、单次最大爬升、最快速度、最高功率，
 * 支持本周/本月/今年/过去 12 个月/全部/自定义六种时间范围。
 *
 * 数据来自活动仓库 listAllSummaries（全量拉取后内存聚合），
 * 由 buildStatistics 纯函数计算，范围切换只重算不重查。
 * 空数据时展示导入引导文案，范围内无活动时提示切换范围。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '@/storage/db'
import { DexieActivityRepository, type ActivitySummary } from '@/storage/repositories/activityRepository'
import { useImportStore } from '@/stores/importStore'
import {
  buildStatistics,
  resolveRange,
  RANGE_LABELS,
  type RangeKey,
  type StatisticsMetrics,
} from '@/features/statistics/statistics'
import RangeSelector from '@/features/statistics/RangeSelector'
import StatisticCards from '@/features/statistics/StatisticCards'
import '@/pages/StatisticsPage.css'

/** 活动仓库单例（测试可 mock @/storage/db 注入独立数据库） */
const repository = new DexieActivityRepository(db)

/**
 * 生成自定义范围默认值：本月 1 号至今天（本地时区 YYYY-MM-DD）。
 *
 * @param now 参考时间（默认当前时间）
 * @returns 起止日期
 */
function defaultCustomRange(now: Date = new Date()): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
    end: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  }
}

/**
 * 统计页面。
 */
function StatisticsPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('week')
  const [customRange, setCustomRange] = useState(defaultCustomRange)
  const [summaries, setSummaries] = useState<ActivitySummary[] | null>(null)
  const [error, setError] = useState(false)
  // 订阅导入结果：数据导入完成后自动刷新统计（规格 §8）
  const importSummary = useImportStore((s) => s.summary)

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
        console.error('Failed to load statistics summaries', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = reload()
    return cancel
  }, [reload, importSummary])

  // 范围或数据变化时重算指标（加载完成前用空列表占位，范围切换不触发重新查询）
  const metrics = useMemo<StatisticsMetrics>(
    () => buildStatistics(summaries ?? [], resolveRange(rangeKey, new Date(), customRange)),
    [summaries, rangeKey, customRange],
  )

  if (error) {
    return (
      <>
        <h1>统计</h1>
        <p className="statistics__message">统计加载失败，请稍后重试。</p>
      </>
    )
  }

  if (summaries == null) {
    return (
      <>
        <h1>统计</h1>
        <p className="statistics__message">统计加载中…</p>
      </>
    )
  }

  if (summaries.length === 0) {
    return (
      <>
        <h1>统计</h1>
        <p className="statistics__message">
          欢迎使用！点击左侧「同步骑行数据」导入你的 FIT 骑行文件。
        </p>
      </>
    )
  }

  return (
    <>
      <h1>统计</h1>
      <RangeSelector
        value={rangeKey}
        onChange={setRangeKey}
        customStart={customRange.start}
        customEnd={customRange.end}
        onCustomChange={(start, end) => setCustomRange({ start, end })}
      />
      {metrics.count === 0 ? (
        <p className="statistics__message">该时间范围内暂无骑行记录，请切换时间范围。</p>
      ) : (
        <StatisticCards title={RANGE_LABELS[rangeKey]} metrics={metrics} />
      )}
    </>
  )
}

export default StatisticsPage
