/**
 * 训练计划页面（功能队列 1：训练计划生成）。
 *
 * 基于周期化训练理论生成目标赛事前的逐周训练计划：输入目标赛事日期、
 * 每周可投入时长与当前体能（CTL，优先从训练状态自动读取），输出每周
 * 计划卡片（阶段/目标 TSS/骑行次数/时长/训练重点）。纯计算无写操作。
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { buildTrainingPlan, type TrainingPhase, type TrainingPlanWeek } from '@/features/training/plan'
import { buildDailyTss, buildTrainingStatus } from '@/features/analysis/trainingStatus'
import { getEffectiveProfile } from '@/features/settings/effectiveProfile'
import { backfillNormalizedPower } from '@/features/analysis/backfillNormalizedPower'
import { useActivityRepository } from '@/hooks/useActivityRepository'
import { useDataSourceStore, selectEffectiveSource } from '@/stores/dataSourceStore'
import { getActivityRepository } from '@/storage/sourceActivityRepository'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import '@/pages/TrainingPlanPage.css'

/** 默认每周可训练时长（小时） */
const DEFAULT_WEEKLY_HOURS = 6

/** 默认目标赛事筹备期（周） */
const DEFAULT_PLAN_WEEKS = 12

/** 阶段配色（Strava 风格：基础蓝 → 强化橙 → 减量灰 → 巅峰绿） */
const PHASE_COLORS: Record<TrainingPhase, string> = {
  base: '#3b82f6',
  build: '#f59e0b',
  taper: '#6b7280',
  peak: '#22c55e',
}

/**
 * 训练计划页面。
 */
function TrainingPlanPage() {
  const [weeklyHours, setWeeklyHours] = useState(String(DEFAULT_WEEKLY_HOURS))
  const [eventDate, setEventDate] = useState('')
  const [ctlInput, setCtlInput] = useState('')
  const [ctlLoading, setCtlLoading] = useState(true)
  const [plan, setPlan] = useState<TrainingPlanWeek[] | null>(null)
  // 订阅导入结果：数据导入完成后刷新 CTL
  const repository = useActivityRepository()
  const source = useDataSourceStore(selectEffectiveSource)

  // 加载当前体能（CTL）：需 FTP 配置；作者源直接读快照摘要
  const loadCtl = useCallback(() => {
    let cancelled = false
    void (async () => {
      setCtlLoading(true)
      try {
        const profile = await getEffectiveProfile(source)
        const ftp = profile.ftp
        if (cancelled) {
          return
        }
        if (ftp === undefined || ftp <= 0) {
          setCtlLoading(false)
          return
        }
        if (source === 'local') {
          await backfillNormalizedPower(getActivityRepository('local') as DexieActivityRepository)
        }
        const summaries = await repository.listAllSummaries()
        if (cancelled) {
          return
        }
        const status = buildTrainingStatus(buildDailyTss(summaries, ftp))
        const current = status.length > 0 ? status[status.length - 1].ctl : undefined
        if (current !== undefined) {
          setCtlInput(String(Math.round(current)))
        }
      } catch (err: unknown) {
        console.error('Failed to load current CTL', err)
      } finally {
        if (!cancelled) {
          setCtlLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repository, source])

  useEffect(() => {
    const cancel = loadCtl()
    return cancel
  }, [loadCtl])

  // 默认目标日期：起始 + 12 周（次日为起始，避免当天跨度 0 周）
  const defaultEventDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + DEFAULT_PLAN_WEEKS * 7 + 1)
    const month = `${d.getMonth() + 1}`.padStart(2, '0')
    const day = `${d.getDate()}`.padStart(2, '0')
    return `${d.getFullYear()}-${month}-${day}`
  }, [])

  /**
   * 提交表单生成计划。
   */
  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    const today = new Date()
    const todayKey = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`
    const weeks = buildTrainingPlan({
      startDate: todayKey,
      eventDate,
      weeklyHours: Number(weeklyHours),
      currentCtl: Number(ctlInput),
    })
    setPlan(weeks)
  }

  return (
    <div className="training-plan">
      <h1 className="training-plan__title">训练计划</h1>
      <p className="training-plan__subtitle">
        设定目标赛事与每周可投入时间，按周期化训练原则（基础期 → 强化期 → 减量期 →
        巅峰期）生成逐周计划。
      </p>

      <form className="training-plan__form" onSubmit={handleSubmit}>
        <label className="training-plan__field">
          <span className="training-plan__label">目标赛事日期</span>
          <input
            type="date"
            className="training-plan__input"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            required
            min={defaultEventDate}
          />
        </label>
        <label className="training-plan__field">
          <span className="training-plan__label">每周可投入时长（小时）</span>
          <input
            type="number"
            className="training-plan__input"
            value={weeklyHours}
            min={1}
            max={20}
            step={0.5}
            onChange={(e) => setWeeklyHours(e.target.value)}
            required
          />
        </label>
        <label className="training-plan__field">
          <span className="training-plan__label">当前体能（CTL）</span>
          <input
            type="number"
            className="training-plan__input"
            value={ctlInput}
            min={0}
            step={1}
            onChange={(e) => setCtlInput(e.target.value)}
            required
            placeholder={ctlLoading ? '读取中…' : '未配置 FTP 时可手动填写'}
          />
        </label>
        <button type="submit" className="training-plan__submit">
          生成训练计划
        </button>
      </form>

      {plan !== null && plan.length === 0 && (
        <p className="training-plan__message">目标日期需晚于今天，请重新选择。</p>
      )}

      {plan !== null && plan.length > 0 && (
        <ul className="training-plan__weeks">
          {plan.map((week) => (
            <li key={week.weekIndex} className="training-plan__week">
              <span
                className="training-plan__phase"
                style={{ backgroundColor: PHASE_COLORS[week.phase] }}
              >
                {week.phaseLabel}
              </span>
              <span className="training-plan__week-meta">
                <span className="training-plan__week-head">
                  <span className="training-plan__week-index">第 {week.weekIndex} 周</span>
                  <span className="training-plan__week-date">{week.weekStart}</span>
                </span>
                <span className="training-plan__week-stats">
                  {week.targetTss} TSS · {week.rideCount} 次 · 约 {week.hours} 小时
                </span>
                <span className="training-plan__week-focus">{week.focus}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default TrainingPlanPage