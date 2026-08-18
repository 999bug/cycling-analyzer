/**
 * 活动详情页（规格 §15/§16/§17/§25/§26/§32）。
 *
 * 布局：标题区（名称/类型/开始时间/删除按钮）→ 指标卡（距离/运动时长/总时长/爬升/累计下降等 12 项）→
 * 轨迹着色切换 + 轨迹地图 → 六个图表（速度/踏频/海拔/功率/功率曲线/速度+心率组合）→
 * 训练区间区块（心率统计/折线图 + 心率/功率区间分布 + IF/TSS + 计算方式说明）。
 * 数据源：activityRepository.getById（摘要）+ getRecords（逐点），
 * 逐点数据按需加载，不参与列表查询。
 * 训练分析在渲染层调用纯函数（records ≤ 万级，性能可接受），
 * 依赖用户配置的 FTP/最大心率（规格 §26：无配置不伪造计算）。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { ActivityRecord } from '@/types/activity'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import { db } from '@/storage/db'
import { sourceActivityRepository } from '@/storage/sourceActivityRepository'
import { selectEffectiveSource, useDataSourceStore } from '@/stores/dataSourceStore'
import {
  formatDate,
  formatDuration,
  formatElevation,
} from '@/utils/format'
import {
  formatDistanceByUnit,
  formatSpeedByUnit,
  getSettings,
  type DistanceUnit,
  type SettingsData,
  type TimeFormat,
} from '@/features/settings/settings'
import { calculateNormalizedPower } from '@/features/analysis/normalizedPower'
import { calculateIntensityFactor, calculateTss } from '@/features/analysis/intensity'
import { buildGpx, buildGpxFileName, downloadGpx } from '@/features/activity/gpxExport'
import SplitsSection from '@/features/activity/SplitsSection'
import TrainingEffectSection from '@/features/activity/TrainingEffectSection'
import AchievementsSection from '@/features/activity/AchievementsSection'
import { detectAchievements } from '@/features/activity/achievements'
import { DexieSegmentRepository } from '@/storage/repositories/segmentRepository'
import { downsampleRecords } from '@/charts/downsample'
import {
  calculateHeartRateZones,
  calculatePowerZones,
  type ZoneDistribution,
} from '@/features/analysis/zones'
import type { ColoringMode } from '@/map/routeColoring'
import { simplifyRoute } from '@/map/simplify'
import ActivityMap from '@/map/ActivityMap'
import ColoringLegend from '@/map/ColoringLegend'
import SpeedChart from '@/charts/SpeedChart'
import HeartRateChart from '@/charts/HeartRateChart'
import CadenceChart from '@/charts/CadenceChart'
import ElevationChart from '@/charts/ElevationChart'
import PowerChart from '@/charts/PowerChart'
import PowerCurveChart from '@/charts/PowerCurveChart'
import CombinedChart from '@/charts/CombinedChart'
import '@/pages/ActivityDetailPage.css'

/** 当前数据源的活动仓库（门面按有效源分发，读取走这里） */
const repository = sourceActivityRepository

/** 本地库仓库（删除/重命名等写操作永远只进本地库） */
const localRepository = new DexieActivityRepository(db)

/** 赛段仓库单例（「设为赛段」创建入口） */
const segmentRepository = new DexieSegmentRepository(db)

/** 轨迹抽稀阈值（米）：GPS 噪声级，保留骑行路线形状 */
const SIMPLIFY_TOLERANCE_METERS = 5

/** 无标题活动的默认名称 */
/** 默认活动名：日期 + 骑行（规格 §31） */

/** 删除确认文案 */
const DELETE_CONFIRM_TEXT = '确定删除这次骑行？删除后将从本地数据库中移除'

/** 无 FTP/最大心率配置时训练区间区块的引导文案（规格 §26 不伪造计算） */
const ZONES_GUIDE_TEXT = '在设置中配置 FTP 与最大心率后可查看区间分析'

/** 轨迹着色模式选项（规格 §16） */
const COLORING_OPTIONS: ReadonlyArray<{ mode: 'none' | ColoringMode; label: string }> = [
  { mode: 'none', label: '默认' },
  { mode: 'speed', label: '速度' },
  { mode: 'heartRate', label: '心率' },
  { mode: 'power', label: '功率' },
  { mode: 'altitude', label: '海拔' },
]

/** 心率区间名称（Z1-Z5，经典 5 区间） */
const HEART_RATE_ZONE_NAMES: readonly string[] = ['恢复区', '耐力区', '有氧区', '阈值区', '无氧区']

/** 功率区间名称（Z1-Z5，按 FTP 百分比） */
const POWER_ZONE_NAMES: readonly string[] = ['恢复', '耐力', '有氧', '阈值', '冲刺']

/** 区间分布条颜色（低区 → 高区，与轨迹色阶一致） */
const ZONE_COLORS: readonly string[] = ['#4f8cff', '#34c759', '#ffd60a', '#ff9f0a', '#ff453a']

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
/**
 * 本地时区时间格式 'YYYY-MM-DD HH:mm'（24h）或 'YYYY-MM-DD h:mm AM/PM'（12h）。
 *
 * @param iso ISO 8601 时间字符串
 * @param timeFormat 时间格式（缺省 24 小时制，规格 §27）
 * @returns 本地时区展示字符串，无效输入返回占位符
 */
function formatDateTime(iso: string, timeFormat: TimeFormat = '24h'): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  if (timeFormat === '12h') {
    const hours24 = date.getHours()
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
    const meridiem = hours24 < 12 ? 'AM' : 'PM'
    return `${datePart} ${hours12}:${pad(date.getMinutes())} ${meridiem}`
  }
  return `${datePart} ${pad(date.getHours())}:${pad(date.getMinutes())}`
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
 * 组装指标卡（规格 §15；距离/速度按显示单位换算，规格 §27）。
 * 时长区分运动时长（计时）与总时长（含暂停），爬升/下降成对展示。
 *
 * @param activity 活动摘要
 * @param distanceUnit 距离显示单位
 * @returns 指标卡列表
 */
function buildMetrics(activity: ActivitySummary, distanceUnit: DistanceUnit): MetricItem[] {
  return [
    { label: '距离', value: formatDistanceByUnit(activity.distance, distanceUnit) },
    { label: '运动时长', value: formatDuration(activity.duration) },
    { label: '总时长', value: formatDuration(activity.elapsedTime) },
    { label: '爬升', value: formatElevation(activity.elevationGain) },
    // 下降用无符号整数米（「累计下降」标签已表方向，formatElevation 的 + 号会误导）
    { label: '累计下降', value: displayNumber(activity.elevationLoss, 'm') },
    { label: '平均速度', value: formatSpeedByUnit(activity.avgSpeed, distanceUnit) },
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
  // 已完成加载的「数据源:活动ID」键：与当前键比对派生 loading/ready 状态，
  // 避免在 effect 内同步 setState 触发级联渲染；切源后旧源数据不外漏
  const [loadedKey, setLoadedKey] = useState<string>()
  // 加载出错的键（切换活动或数据源后自动恢复）
  const [errorKey, setErrorKey] = useState<string>()
  const [deleting, setDeleting] = useState(false)
  // 重命名编辑态（规格 §31）：editing=编辑中，nameInput=输入值，saving=保存中
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [saving, setSaving] = useState(false)
  // 用户设置（FTP/最大心率等，训练分析依赖；undefined = 尚未加载完成）
  const [settings, setSettings] = useState<SettingsData>()
  // 历史活动摘要（成就检测输入；undefined = 尚未加载完成）
  const [history, setHistory] = useState<ActivitySummary[]>()
  // 轨迹着色模式（规格 §16，默认单色）
  const [coloring, setColoring] = useState<'none' | ColoringMode>('none')
  // 当前数据源（切换后重新加载；只读模式控制见渲染分支）
  const source = useDataSourceStore(selectEffectiveSource)
  // 当前加载键：数据源 + 活动 ID（切源视作换了活动）
  const loadKey = `${source}:${id}`

  // 加载摘要与逐点数据（切换活动 ID 或数据源时重新加载，旧请求通过 cancelled 丢弃）
  useEffect(() => {
    if (id === undefined) {
      return
    }
    const key = `${source}:${id}`
    let cancelled = false
    repository
      .getById(id)
      .then((summary) => {
        if (cancelled) {
          return
        }
        if (summary === undefined) {
          // 当前源不存在该活动：清空旧状态，避免渲染上一个源/活动的数据
          setActivity(undefined)
          setRecords([])
          setLoadedKey(key)
          return
        }
        setActivity(summary)
        return repository.getRecords(id).then((list) => {
          if (!cancelled) {
            setRecords(list)
            setLoadedKey(key)
          }
        })
      })
      .catch(() => {
        if (!cancelled) {
          setErrorKey(key)
        }
      })
    return () => {
      cancelled = true
    }
  }, [id, source])

  // 加载用户设置（FTP/最大心率等，训练分析依赖；组件挂载时读取一次）
  useEffect(() => {
    let cancelled = false
    getSettings().then((data) => {
      if (!cancelled) {
        setSettings(data)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 加载历史活动摘要（成就检测输入；失败不阻断详情页，成就栏仅静默缺席）
  useEffect(() => {
    if (activity === undefined) {
      return
    }
    let cancelled = false
    repository
      .listAllSummaries()
      .then((summaries) => {
        if (!cancelled) {
          setHistory(summaries)
        }
      })
      .catch((err: unknown) => {
        console.error('Failed to load activity history', err)
      })
    return () => {
      cancelled = true
    }
  }, [activity])

  // 轨迹抽稀：逐点数据变化时重算（详情页仅此一处消费 records 全量）
  const routePoints = useMemo(
    () => simplifyRoute(records, SIMPLIFY_TOLERANCE_METERS),
    [records],
  )

  // 图表渲染抽稀（性能优化）：万级逐点等距降到 1000 内，SVG 节点数可控；
  // NP/区间/功率曲线/地图/GPX 等计算与导出仍用完整 records
  const chartRecords = useMemo(() => downsampleRecords(records), [records])

  // 训练分析（渲染层调用纯函数，规格 §26）：标准化功率 + 区间分布 + IF/TSS
  const normalizedPower = useMemo(() => calculateNormalizedPower(records), [records])
  const hasPowerData = useMemo(
    () => records.some((record) => record.power !== undefined),
    [records],
  )
  const hasHeartRateData = useMemo(
    () => records.some((record) => record.heartRate !== undefined),
    [records],
  )
  // 最小心率：摘要模型无此字段，从逐点记录取（缺失不计，全无数据为 undefined）
  const minHeartRate = useMemo(() => {
    let min = Infinity
    for (const record of records) {
      if (record.heartRate !== undefined && record.heartRate < min) {
        min = record.heartRate
      }
    }
    return min === Infinity ? undefined : min
  }, [records])

  // 用户配置（设置未加载完成时为 undefined）：IF/TSS/区间分布均依赖它们
  const ftp = settings?.profile.ftp
  const maxHeartRate = settings?.profile.maxHeartRate

  // 强度因子（IF）：FTP 存在且可算出 NP 时才有意义
  const intensityFactor = useMemo(() => {
    if (normalizedPower === undefined || ftp === undefined) {
      return undefined
    }
    return calculateIntensityFactor(normalizedPower, ftp)
  }, [normalizedPower, ftp])

  // 训练压力分数（TSS）：基于骑行计时时长与 IF
  const tss = useMemo(() => {
    if (activity === undefined || intensityFactor === undefined || ftp === undefined) {
      return undefined
    }
    return calculateTss(activity.duration, intensityFactor, ftp)
  }, [activity, intensityFactor, ftp])

  // 区间分布：对应配置缺失时函数返回 null（无依据不显示，规格 §26）
  const heartRateZones = useMemo(
    () => calculateHeartRateZones(records, maxHeartRate),
    [records, maxHeartRate],
  )
  const powerZones = useMemo(() => calculatePowerZones(records, ftp), [records, ftp])

  // 成就检测：与开始时间更早的历史活动比较纪录（首次骑行/无刷新为空数组）
  const achievements = useMemo(
    () => (activity === undefined ? [] : detectAchievements(activity, history ?? [])),
    [activity, history],
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
      await localRepository.deleteActivity(activity.id)
      navigate('/activities')
    } catch {
      setDeleting(false)
    }
  }

  // 是否存在可导出的轨迹点（无坐标活动禁用导出，规格 §25 不伪造）
  const hasTrack = useMemo(
    () =>
      records.some((record) => record.latitude !== undefined && record.longitude !== undefined),
    [records],
  )

  /**
   * 导出 GPX：完整逐点轨迹 → GPX 1.1 文件下载（后续工作项：导出 GPX）。
   */
  function handleExportGpx() {
    if (activity === undefined) {
      return
    }
    const trackName = activity.name || `${formatDate(activity.startTime)} 骑行`
    const gpx = buildGpx(trackName, records)
    if (gpx === undefined) {
      return
    }
    downloadGpx(buildGpxFileName(activity.fileName), gpx)
  }

  /**
   * 设为赛段（后续工作项：完整 Segment）：以本骑行首尾坐标点创建
   * 起终点圆赛段，名称取活动标题，创建后跳转赛段页查看成绩榜。
   */
  function handleCreateSegment() {
    if (activity === undefined || !hasTrack) {
      return
    }
    const coordPoints = records.filter(
      (record) => record.latitude !== undefined && record.longitude !== undefined,
    )
    const first = coordPoints[0]
    const last = coordPoints[coordPoints.length - 1]
    segmentRepository
      .addSegment({
        name: activity.name || `${formatDate(activity.startTime)} 骑行`,
        startLatitude: first.latitude ?? 0,
        startLongitude: first.longitude ?? 0,
        endLatitude: last.latitude ?? 0,
        endLongitude: last.longitude ?? 0,
        sourceActivityId: activity.id,
        createdAt: new Date().toISOString(),
      })
      .then(() => navigate('/segments'))
      .catch((err: unknown) => {
        console.error('Failed to create segment', err)
      })
  }

  /**
   * 进入重命名编辑态：输入框预填当前自定义名。
   */
  function handleStartRename() {    setNameInput(activity?.name ?? '')
    setEditing(true)
  }

  /**
   * 保存重命名（规格 §31）：trim 后落库；空名视为清除自定义名，
   * 恢复「日期 骑行」兜底名（存储空串，展示按 falsy 兜底）。
   */
  async function handleSaveName() {
    if (activity === undefined || saving) {
      return
    }
    const trimmed = nameInput.trim()
    setSaving(true)
    try {
      await localRepository.updateName(activity.id, trimmed)
      setActivity({ ...activity, name: trimmed === '' ? undefined : trimmed })
      setEditing(false)
    } catch (err: unknown) {
      console.error('Failed to rename activity', err)
    } finally {
      setSaving(false)
    }
  }

  // 提示态：缺 ID / 出错 / 加载中 / 不存在
  if (id === undefined || errorKey === loadKey) {
    return <DetailNotice state="error" />
  }
  if (loadedKey !== loadKey) {
    return <DetailNotice state="loading" />
  }
  if (activity === undefined) {
    return <DetailNotice state="notFound" />
  }

  const typeLabel = ACTIVITY_TYPE_LABELS[activity.activityType] ?? activity.activityType
  // 单位偏好（设置未加载完成时回退默认公制，规格 §27）
  const distanceUnit = settings?.units.distance ?? 'km'
  const timeFormat = settings?.units.timeFormat ?? '24h'
  // 指标卡：基础 10 卡（运动时长/总时长/累计下降等）+ 标准化功率（无功率数据/样本不足时显示 '—'）
  const metrics = [
    ...buildMetrics(activity, distanceUnit),
    { label: '标准化功率', value: displayNumber(normalizedPower, 'W') },
  ]

  return (
    <div className="activity-detail">
      <header className="activity-detail__header">
        <div>
          {editing ? (
            <div className="activity-detail__rename">
              <input
                className="activity-detail__rename-input"
                value={nameInput}
                placeholder={`${formatDate(activity.startTime)} 骑行`}
                aria-label="活动名称"
                autoFocus
                onChange={(event) => setNameInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleSaveName()
                  }
                  if (event.key === 'Escape') {
                    setEditing(false)
                  }
                }}
              />
              <button
                type="button"
                className="activity-detail__rename-save"
                onClick={() => void handleSaveName()}
                disabled={saving}
              >
                {saving ? '保存中…' : '保存'}
              </button>
              <button
                type="button"
                className="activity-detail__rename-cancel"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                取消
              </button>
            </div>
          ) : (
            <h1 className="activity-detail__title">
              {activity.name || `${formatDate(activity.startTime)} 骑行`}
              <button
                type="button"
                className="activity-detail__rename-trigger"
                aria-label="重命名"
                onClick={handleStartRename}
              >
                重命名
              </button>
            </h1>
          )}
          <div className="activity-detail__meta">
            <span className="activity-detail__type">{typeLabel}</span>
            <time className="activity-detail__time">{formatDateTime(activity.startTime, timeFormat)}</time>
          </div>
        </div>
        <div className="activity-detail__actions">
          <button
            type="button"
            className="activity-detail__export"
            onClick={handleExportGpx}
            disabled={!hasTrack}
            title={hasTrack ? undefined : '该活动无轨迹坐标，无法导出'}
          >
            导出 GPX
          </button>
          <button
            type="button"
            className="activity-detail__export"
            onClick={handleCreateSegment}
            disabled={!hasTrack}
            title={hasTrack ? '以本骑行起终点创建赛段' : '该活动无轨迹坐标，无法创建赛段'}
          >
            设为赛段
          </button>
          <button
            type="button"
            className="activity-detail__delete"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? '删除中…' : '删除活动'}
          </button>
        </div>
      </header>

      <section className="activity-detail__stats" aria-label="活动指标">
        {metrics.map((metric) => (
          <div key={metric.label} className="activity-detail__stat-card">
            <div className="activity-detail__stat-value">{metric.value}</div>
            <div className="activity-detail__stat-label">{metric.label}</div>
          </div>
        ))}
      </section>

      <AchievementsSection achievements={achievements} distanceUnit={distanceUnit} />

      <section className="activity-detail__map">
        <div className="activity-detail__coloring" role="group" aria-label="轨迹着色">
          {COLORING_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              className={
                coloring === option.mode
                  ? 'activity-detail__coloring-btn activity-detail__coloring-btn--active'
                  : 'activity-detail__coloring-btn'
              }
              aria-pressed={coloring === option.mode}
              onClick={() => setColoring(option.mode)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {coloring !== 'none' && (
          <ColoringLegend mode={coloring} points={routePoints} distanceUnit={distanceUnit} />
        )}
        <ActivityMap points={routePoints} coloring={coloring} />
      </section>

      <section className="activity-detail__charts" aria-label="活动图表">
        <SpeedChart records={chartRecords} />
        <CadenceChart records={chartRecords} />
        <ElevationChart records={chartRecords} />
        <PowerChart records={chartRecords} />
        <PowerCurveChart records={records} />
        <CombinedChart mode="speedHeartRate" records={chartRecords} />
      </section>

      <SplitsSection records={records} distanceUnit={distanceUnit} />

      <TrainingEffectSection
        aerobic={activity.aerobicTrainingEffect}
        anaerobic={activity.anaerobicTrainingEffect}
      />

      <TrainingZonesSection
        heartRateZones={heartRateZones}
        powerZones={powerZones}
        hasHeartRateData={hasHeartRateData}
        hasPowerData={hasPowerData}
        intensityFactor={intensityFactor}
        tss={tss}
        avgHeartRate={activity.avgHeartRate}
        maxHeartRate={activity.maxHeartRate}
        minHeartRate={minHeartRate}
        heartRateRecords={chartRecords}
      />
    </div>
  )
}

/**
 * 训练区间区块 props。
 */
interface TrainingZonesSectionProps {
  /** 心率区间分布（null = 最大心率未配置） */
  heartRateZones: ZoneDistribution[] | null

  /** 功率区间分布（null = FTP 未配置） */
  powerZones: ZoneDistribution[] | null

  /** 逐点数据是否含心率 */
  hasHeartRateData: boolean

  /** 逐点数据是否含功率 */
  hasPowerData: boolean

  /** 强度因子（FTP 缺失或 NP 不可算时为 undefined） */
  intensityFactor: number | undefined

  /** 训练压力分数（同上） */
  tss: number | undefined

  /** 平均心率（摘要字段，缺失为 undefined） */
  avgHeartRate: number | undefined

  /** 最大心率（摘要字段，缺失为 undefined） */
  maxHeartRate: number | undefined

  /** 最小心率（逐点计算，缺失为 undefined） */
  minHeartRate: number | undefined

  /** 心率折线图数据（抽稀后逐点记录） */
  heartRateRecords: ActivityRecord[]
}

/**
 * 训练区间区块（规格 §26）：心率统计（平均/最大/最小）+ 心率折线图 +
 * 心率/功率区间分布条 + IF/TSS + 计算方式说明。
 * 仅当对应配置存在且数据含该指标时显示区间；无任何可显示内容时
 * 展示引导文案（无依据不伪造计算）。
 *
 * @param props 组件参数
 */
function TrainingZonesSection({
  heartRateZones,
  powerZones,
  hasHeartRateData,
  hasPowerData,
  intensityFactor,
  tss,
  avgHeartRate,
  maxHeartRate,
  minHeartRate,
  heartRateRecords,
}: TrainingZonesSectionProps) {
  const showHeartRate = heartRateZones !== null && hasHeartRateData
  const showPower = powerZones !== null && hasPowerData

  // 心率统计行：摘要平均/最大 + 逐点最小，缺失显示 '—'
  const heartRateStats: ReadonlyArray<{ label: string; value: number | undefined }> = [
    { label: '平均心率', value: avgHeartRate },
    { label: '最大心率', value: maxHeartRate },
    { label: '最小心率', value: minHeartRate },
  ]

  // 区间/指标均无可显示内容（配置缺失或数据无对应指标）时显示引导文案
  const metrics =
    intensityFactor !== undefined && tss !== undefined ? (
      <div className="activity-detail__zones-metrics">
        <span>强度因子（IF）{intensityFactor.toFixed(2)}</span>
        <span>训练压力分数（TSS）{Math.round(tss)}</span>
      </div>
    ) : null

  return (
    <section className="activity-detail__zones" aria-label="训练区间">
      <h2 className="activity-detail__zones-title">训练区间</h2>
      {hasHeartRateData && (
        <div className="activity-detail__hr-analysis">
          <div className="activity-detail__hr-stats">
            {heartRateStats.map((stat) => (
              <span key={stat.label}>
                {stat.label} {stat.value === undefined ? '—' : `${Math.round(stat.value)} bpm`}
              </span>
            ))}
          </div>
          <HeartRateChart records={heartRateRecords} />
        </div>
      )}
      {showHeartRate || showPower || metrics !== null ? (
        <>
          {showHeartRate && heartRateZones !== null && (
            <ZoneGroup title="心率区间" zones={heartRateZones} names={HEART_RATE_ZONE_NAMES} />
          )}
          {showPower && powerZones !== null && (
            <ZoneGroup title="功率区间" zones={powerZones} names={POWER_ZONE_NAMES} />
          )}
          {metrics}
        </>
      ) : (
        <p className="activity-detail__zones-guide">{ZONES_GUIDE_TEXT}</p>
      )}
      <details className="activity-detail__zones-help">
        <summary>计算方式说明</summary>
        <ul>
          <li>心率区间：按最大心率百分比划分（&lt;60% / 60-70% / 70-80% / 80-90% / ≥90%），按逐点时间间隔累计各区时长</li>
          <li>功率区间：按 FTP 百分比划分（&lt;55% / 55-75% / 75-90% / 90-105% / ≥105%）</li>
          <li>标准化功率（NP）：30 秒滑动平均的四次方均值再开四次方，反映体感强度而非简单平均</li>
          <li>强度因子（IF）= NP ÷ FTP</li>
          <li>训练压力分数（TSS）= 时长（秒）× IF² × 100 ÷ 3600，以 IF=1 骑行 1 小时为 100 分</li>
        </ul>
      </details>
    </section>
  )
}

/**
 * 单个指标（心率/功率）的区间分布组：标题 + 5 行分布条。
 * 每行显示区间名、时长与占比，条宽按 percent 渲染。
 *
 * @param title 分组标题
 * @param zones 5 个区间分布（按 1-5 顺序）
 * @param names 区间名称（Z1-Z5）
 */
function ZoneGroup({
  title,
  zones,
  names,
}: {
  title: string
  zones: ZoneDistribution[]
  names: readonly string[]
}) {
  return (
    <div className="activity-detail__zone-group">
      <h3 className="activity-detail__zone-group-title">{title}</h3>
      {zones.map((entry) => (
        <div key={entry.zone} className="zone-row">
          <span className="zone-row__label">
            Z{entry.zone} {names[entry.zone - 1]}
          </span>
          <div className="zone-row__bar">
            <div
              className="zone-row__bar-fill"
              style={{
                width: `${Math.min(100, entry.percent)}%`,
                backgroundColor: ZONE_COLORS[entry.zone - 1],
              }}
            />
          </div>
          <span className="zone-row__time">{formatDuration(entry.seconds)}</span>
          <span className="zone-row__percent">{Math.round(entry.percent)}%</span>
        </div>
      ))}
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
