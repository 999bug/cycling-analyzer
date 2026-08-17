/**
 * 活动详情页（规格 §15/§16/§17/§25/§32）。
 *
 * 布局：标题区（名称/类型/开始时间/删除按钮）→ 8 个指标卡 →
 * 轨迹地图 → 四个图表（速度/心率/海拔/功率）。
 * 数据源：activityRepository.getById（摘要）+ getRecords（逐点），
 * 逐点数据按需加载，不参与列表查询。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { ActivityRecord } from '@/types/activity'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { db } from '@/storage/db'
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatElevation,
  formatSpeed,
} from '@/utils/format'
import { simplifyRoute } from '@/map/simplify'
import ActivityMap from '@/map/ActivityMap'
import SpeedChart from '@/charts/SpeedChart'
import HeartRateChart from '@/charts/HeartRateChart'
import ElevationChart from '@/charts/ElevationChart'
import PowerChart from '@/charts/PowerChart'
import '@/pages/ActivityDetailPage.css'

/** 活动仓库单例（页面模块只加载一次） */
const repository = new DexieActivityRepository(db)

/** 轨迹抽稀阈值（米）：GPS 噪声级，保留骑行路线形状 */
const SIMPLIFY_TOLERANCE_METERS = 5

/** 无标题活动的默认名称 */
/** 默认活动名：日期 + 骑行（规格 §31） */

/** 删除确认文案 */
const DELETE_CONFIRM_TEXT = '确定删除这次骑行？删除后将从本地数据库中移除'

/** 加载状态：加载中 / 不存在 / 就绪 / 出错 */
type LoadState = 'loading' | 'notFound' | 'ready' | 'error'

/** 运动类型中文映射（未收录的类型显示原值） */
const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  cycling: '骑行',
  running: '跑步',
}

/**
 * 指标卡数据（缺失显示 '—'，不显示 0）。
 */
interface MetricItem {
  /** 指标名称 */
  label: string

  /** 展示值 */
  value: string
}

/**
 * 本地时区时间格式 'YYYY-MM-DD HH:mm'。
 *
 * @param iso ISO 8601 时间字符串
 * @returns 本地时区展示字符串，无效输入返回占位符
 */
function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 整数数值 + 单位展示（缺失返回占位符）。
 *
 * @param value 数值（可能缺失）
 * @param unit 单位
 * @returns 如 "150 bpm" / "—"
 */
function displayNumber(value: number | undefined, unit: string): string {
  if (value === undefined) {
    return '—'
  }
  return `${Math.round(value)} ${unit}`
}

/**
 * 组装 8 个指标卡（规格 §15）。
 *
 * @param activity 活动摘要
 * @returns 指标卡列表
 */
function buildMetrics(activity: ActivitySummary): MetricItem[] {
  return [
    { label: '距离', value: formatDistance(activity.distance) },
    { label: '时长', value: formatDuration(activity.duration) },
    { label: '爬升', value: formatElevation(activity.elevationGain) },
    { label: '平均速度', value: formatSpeed(activity.avgSpeed) },
    { label: '平均心率', value: displayNumber(activity.avgHeartRate, 'bpm') },
    { label: '平均功率', value: displayNumber(activity.avgPower, 'W') },
    { label: '平均踏频', value: displayNumber(activity.avgCadence, 'rpm') },
    { label: '卡路里', value: displayNumber(activity.calories, '千卡') },
  ]
}

/**
 * 活动详情页面。
 */
function ActivityDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [activity, setActivity] = useState<ActivitySummary>()
  const [records, setRecords] = useState<ActivityRecord[]>([])
  // 已完成加载的活动 ID：与当前路由 ID 比对派生 loading/ready 状态，
  // 避免在 effect 内同步 setState 触发级联渲染
  const [loadedId, setLoadedId] = useState<string>()
  // 加载出错的活动 ID（切换活动后自动恢复）
  const [errorId, setErrorId] = useState<string>()
  const [deleting, setDeleting] = useState(false)

  // 加载摘要与逐点数据（切换活动 ID 时重新加载，旧请求通过 cancelled 丢弃）
  useEffect(() => {
    if (id === undefined) {
      return
    }
    let cancelled = false
    repository
      .getById(id)
      .then((summary) => {
        if (cancelled) {
          return
        }
        if (summary === undefined) {
          setLoadedId(id)
          return
        }
        setActivity(summary)
        return repository.getRecords(id).then((list) => {
          if (!cancelled) {
            setRecords(list)
            setLoadedId(id)
          }
        })
      })
      .catch(() => {
        if (!cancelled) {
          setErrorId(id)
        }
      })
    return () => {
      cancelled = true
    }
  }, [id])

  // 轨迹抽稀：逐点数据变化时重算（详情页仅此一处消费 records 全量）
  const routePoints = useMemo(
    () => simplifyRoute(records, SIMPLIFY_TOLERANCE_METERS),
    [records],
  )

  /**
   * 删除活动（规格 §32）：确认后删除并跳回列表页。
   */
  async function handleDelete() {
    if (activity === undefined || deleting) {
      return
    }
    const confirmed = window.confirm(DELETE_CONFIRM_TEXT)
    if (!confirmed) {
      return
    }
    setDeleting(true)
    try {
      await repository.deleteActivity(activity.id)
      navigate('/activities')
    } catch {
      setDeleting(false)
    }
  }

  // 提示态：缺 ID / 出错 / 加载中 / 不存在
  if (id === undefined || errorId === id) {
    return <DetailNotice state="error" />
  }
  if (loadedId !== id) {
    return <DetailNotice state="loading" />
  }
  if (activity === undefined) {
    return <DetailNotice state="notFound" />
  }

  const typeLabel = ACTIVITY_TYPE_LABELS[activity.activityType] ?? activity.activityType
  const metrics = buildMetrics(activity)

  return (
    <div className="activity-detail">
      <header className="activity-detail__header">
        <div>
          <h1 className="activity-detail__title">
            {activity.name ?? `${formatDate(activity.startTime)} 骑行`}
          </h1>
          <div className="activity-detail__meta">
            <span className="activity-detail__type">{typeLabel}</span>
            <time className="activity-detail__time">{formatDateTime(activity.startTime)}</time>
          </div>
        </div>
        <button
          type="button"
          className="activity-detail__delete"
          onClick={handleDelete}
          disabled={deleting}
        >
          {deleting ? '删除中…' : '删除活动'}
        </button>
      </header>

      <section className="activity-detail__stats" aria-label="活动指标">
        {metrics.map((metric) => (
          <div key={metric.label} className="activity-detail__stat-card">
            <div className="activity-detail__stat-value">{metric.value}</div>
            <div className="activity-detail__stat-label">{metric.label}</div>
          </div>
        ))}
      </section>

      <section className="activity-detail__map">
        <ActivityMap points={routePoints} />
      </section>

      <section className="activity-detail__charts" aria-label="活动图表">
        <SpeedChart records={records} />
        <HeartRateChart records={records} />
        <ElevationChart records={records} />
        <PowerChart records={records} />
      </section>
    </div>
  )
}

/**
 * 提示态视图（加载中 / 不存在 / 出错）。
 *
 * @param state 加载状态
 */
function DetailNotice({ state }: { state: LoadState }) {
  const message =
    state === 'loading'
      ? '加载中…'
      : state === 'notFound'
        ? '活动不存在或已删除'
        : '加载失败，请刷新重试'
  return <div className="activity-detail__notice">{message}</div>
}

export default ActivityDetailPage
