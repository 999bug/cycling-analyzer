/**
 * 批量修正运动类型弹窗（列表页）。
 *
 * 背景：旧版 GPX 解析对缺失 `<type>` 默认 cycling，导致导入的跑步/散步被
 * 计入骑行口径（骑行里程虚高）。本弹窗把检测出的可疑记录逐条列出，
 * 由用户确认后批量改写类型——**绝不静默修改**：提案来自速度特征推断，
 * 存在灰区，必须让用户看到依据并自行拍板。
 *
 * 三个刻意的设计选择：
 * - **影响预览置顶**：用户第一眼要知道「改完我的骑行里程会变成多少」，
 *   而不是先看一长串类型名；
 * - **逐条露出判定依据**：来自权威元数据的类型与速度特征推测可信度相差
 *   悬殊，藏起来就成了黑箱；
 * - **灰区默认不勾选**（10~20 km/h 的城市通勤与快跑生理上完全重叠）。
 *
 * 写操作永远只进本地库（Dexie），作者快照源由父组件置灰入口。
 */
import { useMemo, useState } from 'react'
import { db } from '@/storage/db'
import {
  DexieActivityRepository,
  type ActivitySummary,
} from '@/storage/repositories/activityRepository'
import { ACTIVITY_TYPE_LABELS, activityTypeLabel, type ActivityType } from '@/types/activityType'
import {
  defaultSelectedIds,
  isGreySuspect,
  summarizeTypeFixImpact,
  type TypeSuspect,
} from '@/features/activity/suspectTypes'
import {
  convertDistance,
  formatSpeedByUnit,
  type DistanceUnit,
} from '@/features/settings/settings'
import './batch-activity-type.css'

/** 本地库仓库（类型修正等写操作只进本地库，与批量重命名口径一致） */
const localRepository = new DexieActivityRepository(db)

/** 弹窗内的时间格式化（仅取日期部分，列表页已有 formatDate 但此处避免耦合工具函数签名） */
const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
})

/** 筛选分组键：全部 / 某个建议类型 / 灰区 */
type FilterKey = 'all' | 'grey' | `type:${ActivityType}`

/**
 * 批量修正运动类型弹窗属性。
 */
interface BatchActivityTypeDialogProps {
  /** 待复核候选（detectTypeSuspects 输出） */
  suspects: TypeSuspect[]

  /** 全量活动摘要（影响预览需要看到骑行口径总量） */
  allSummaries: ActivitySummary[]

  /** 本地库仓库（测试注入；缺省模块级单例） */
  writeRepository?: Pick<DexieActivityRepository, 'updateActivityType'>

  /** 距离显示单位（缺省公里） */
  distanceUnit?: DistanceUnit

  /** 关闭弹窗回调 */
  onClose: () => void

  /** 应用完成回调（父组件刷新列表） */
  onApplied: (count: number) => void
}

/**
 * 批量修正运动类型弹窗。
 */
function BatchActivityTypeDialog({
  suspects,
  allSummaries,
  writeRepository = localRepository,
  distanceUnit = 'km',
  onClose,
  onApplied,
}: BatchActivityTypeDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => defaultSelectedIds(suspects))
  const [filter, setFilter] = useState<FilterKey>('all')
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  /** 影响预览：勾选变化时实时重算 */
  const impact = useMemo(
    () => summarizeTypeFixImpact(allSummaries, suspects, selectedIds),
    [allSummaries, suspects, selectedIds],
  )

  /** 分组统计（chip 计数） */
  const counts = useMemo(() => {
    const byType = new Map<ActivityType, number>()
    let grey = 0
    for (const suspect of suspects) {
      if (isGreySuspect(suspect)) {
        grey += 1
      }
      byType.set(suspect.suggestedType, (byType.get(suspect.suggestedType) ?? 0) + 1)
    }
    return { byType, grey }
  }, [suspects])

  const visible = useMemo(
    () =>
      suspects.filter((suspect) => {
        if (filter === 'all') {
          return true
        }
        if (filter === 'grey') {
          return isGreySuspect(suspect)
        }
        return `type:${suspect.suggestedType}` === filter
      }),
    [suspects, filter],
  )

  const selectedVisibleCount = visible.filter((s) => selectedIds.has(s.summary.id)).length
  const canApply = selectedIds.size > 0 && !applying

  /**
   * 切换单条勾选。
   *
   * @param id 活动 ID
   * @param checked 目标状态
   */
  function toggle(id: string, checked: boolean) {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (checked) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  /** 应用勾选项：逐条改写类型（只进本地库） */
  async function apply() {
    if (!canApply) {
      return
    }
    setApplying(true)
    let done = 0
    try {
      for (const suspect of suspects) {
        if (!selectedIds.has(suspect.summary.id)) {
          continue
        }
        await writeRepository.updateActivityType(suspect.summary.id, suspect.suggestedType)
        done += 1
      }
      setResult(`已修正 ${done} 条活动的运动类型`)
      onApplied(done)
    } catch (error) {
      console.error('Failed to update activity types', error)
      setResult(`修正中断，已成功 ${done} 条，请重试`)
    } finally {
      setApplying(false)
    }
  }

  const movedOutDistance = impact.beforeDistance - impact.afterDistance

  return (
    <div className="batch-type-overlay" onClick={onClose}>
      <div
        className="batch-type"
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-type-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="batch-type__header">
          <div>
            <h2 className="batch-type__title" id="batch-type-title">
              批量修正运动类型
            </h2>
            <p className="batch-type__subtitle">
              检测到 {suspects.length} 条活动的运动类型可能不准确，确认后才会写入
            </p>
          </div>
          <button type="button" className="batch-type__close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="batch-type__metrics">
          <div className="batch-type__metric">
            <span className="batch-type__metric-label">骑行总里程</span>
            <span className="batch-type__metric-value">
              {Math.round(convertDistance(impact.afterDistance, distanceUnit))} km
            </span>
            <span className="batch-type__metric-delta">
              修正前 {Math.round(convertDistance(impact.beforeDistance, distanceUnit))} km，
              {movedOutDistance > 0 ? `减少 ${Math.round(convertDistance(movedOutDistance, distanceUnit))}` : '不变'}
            </span>
          </div>
          <div className="batch-type__metric">
            <span className="batch-type__metric-label">骑行次数</span>
            <span className="batch-type__metric-value">{impact.afterCount}</span>
            <span className="batch-type__metric-delta">
              修正前 {impact.beforeCount}，
              {impact.beforeCount > impact.afterCount
                ? `减少 ${impact.beforeCount - impact.afterCount}`
                : '不变'}
            </span>
          </div>
          <div className="batch-type__metric">
            <span className="batch-type__metric-label">待修正</span>
            <span className="batch-type__metric-value">{suspects.length}</span>
            <span className="batch-type__metric-delta">已勾选 {selectedIds.size} 条</span>
          </div>
        </div>

        <div className="batch-type__chips">
          <button
            type="button"
            className={
              filter === 'all' ? 'batch-type__chip batch-type__chip--active' : 'batch-type__chip'
            }
            onClick={() => setFilter('all')}
          >
            全部 {suspects.length}
          </button>
          {[...counts.byType.entries()].map(([type, count]) => (
            <button
              key={type}
              type="button"
              className={
                filter === `type:${type}`
                  ? 'batch-type__chip batch-type__chip--active'
                  : 'batch-type__chip'
              }
              onClick={() => setFilter(`type:${type}`)}
            >
              建议{ACTIVITY_TYPE_LABELS[type]} {count}
            </button>
          ))}
          {counts.grey > 0 && (
            <button
              type="button"
              className={
                filter === 'grey'
                  ? 'batch-type__chip batch-type__chip--active'
                  : 'batch-type__chip'
              }
              onClick={() => setFilter('grey')}
            >
              灰区 {counts.grey}
            </button>
          )}
        </div>

        <div className="batch-type__table">
          <div className="batch-type__row batch-type__row--head">
            <span />
            <span>活动</span>
            <span className="batch-type__num">距离</span>
            <span className="batch-type__num">均速</span>
            <span>类型变更</span>
            <span>判定依据</span>
          </div>
          {visible.map((suspect) => (
            <SuspectRow
              key={suspect.summary.id}
              suspect={suspect}
              checked={selectedIds.has(suspect.summary.id)}
              distanceUnit={distanceUnit}
              onToggle={toggle}
            />
          ))}
          {visible.length === 0 && <div className="batch-type__empty">该分组下没有记录</div>}
        </div>

        {result !== null && <div className="batch-type__result">{result}</div>}

        <div className="batch-type__actions">
          <p className="batch-type__note">
            {counts.grey > 0
              ? `灰区 ${counts.grey} 条默认不勾选：10~20 km/h 的城市通勤与快跑速度重叠，需你自行判断`
              : '逐条依据已列出，请确认后再应用'}
            {selectedVisibleCount > 0 && filter !== 'all' ? `（当前分组已勾选 ${selectedVisibleCount} 条）` : ''}
          </p>
          <div className="batch-type__buttons">
            <button type="button" className="batch-type__button" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="batch-type__button batch-type__button--primary"
              disabled={!canApply}
              onClick={() => void apply()}
            >
              {applying ? '应用中…' : `应用勾选项（${selectedIds.size}）`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 单条候选行。
 */
function SuspectRow({
  suspect,
  checked,
  distanceUnit,
  onToggle,
}: {
  suspect: TypeSuspect
  checked: boolean
  distanceUnit: DistanceUnit
  onToggle: (id: string, checked: boolean) => void
}) {
  const { summary } = suspect
  const grey = isGreySuspect(suspect)
  // 归一化后取中文标签：库里可能存有各平台原始写法（road_biking / 骑行）
  const currentLabel = activityTypeLabel(summary.activityType)

  return (
    <label className="batch-type__row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(summary.id, event.target.checked)}
      />
      <span className="batch-type__name" title={summary.name ?? summary.fileName}>
        {summary.name ?? summary.fileName}
        <span className="batch-type__date">
          {DATE_FORMATTER.format(new Date(summary.startTime))}
        </span>
      </span>
      <span className="batch-type__num">
        {convertDistance(summary.distance, distanceUnit).toFixed(1)} km
      </span>
      <span className="batch-type__num">
        {formatSpeedByUnit(summary.avgSpeed ?? null, distanceUnit)}
      </span>
      <span className="batch-type__change">
        {currentLabel} →{' '}
        <span
          className={
            grey ? 'batch-type__badge batch-type__badge--grey' : 'batch-type__badge'
          }
        >
          {ACTIVITY_TYPE_LABELS[suspect.suggestedType]}
          {grey ? '？' : ''}
        </span>
      </span>
      <span className={grey ? 'batch-type__basis batch-type__basis--grey' : 'batch-type__basis'}>
        {grey ? `灰区，请确认（${suspect.basis}）` : suspect.basis}
      </span>
    </label>
  )
}

export default BatchActivityTypeDialog
