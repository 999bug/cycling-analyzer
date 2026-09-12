/**
 * 批量修正运动类型弹窗（列表页）。
 *
 * 背景：旧版 GPX 解析对缺失 `<type>` 默认 cycling，导致导入的跑步/散步被
 * 计入骑行口径（骑行里程虚高）。本弹窗把检测出的可疑记录逐条列出，
 * 由用户确认后批量改写类型——**绝不静默修改**：提案来自速度特征推断，
 * 存在灰区，必须让用户看到依据并自行拍板。
 *
 * 两种范围（顶部切换）：
 * - **可疑记录**（默认）：自动检测输出，逐条露出判定依据、灰区默认不勾选；
 * - **全部记录**：全量摘要，供用户找回检测没覆盖到的记录（如已被误标成
 *   跑步、或速度落在灰区后又想改的记录）——默认不勾选，配搜索与类型筛选。
 *
 * 应用即确认：写入类型的同时标记 `typeConfirmedAt`，类型复核检测此后跳过
 * 该记录（否则灰区记录每次进列表都被重新检出，提示永远消不掉）。
 *
 * 写操作永远只进本地库（Dexie），作者快照源由父组件置灰入口。
 */
import { useMemo, useState } from 'react'
import { db } from '@/storage/db'
import {
  DexieActivityRepository,
  type ActivitySummary,
} from '@/storage/repositories/activityRepository'
import {
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPE_OPTIONS,
  activityTypeLabel,
  normalizeActivityType,
  type ActivityType,
} from '@/types/activityType'
import {
  defaultSelectedIds,
  isGreySuspect,
  summarizeTypeFixImpact,
  toManualSuspects,
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

/** 「全部记录」模式的渲染上限（上千条全渲染会拖慢弹窗，超出靠搜索/筛选收敛） */
const RENDER_LIMIT = 200

/** 筛选分组键：全部 / 某个建议类型 / 灰区 */
type FilterKey = 'all' | 'grey' | `type:${ActivityType}`

/** 候选范围：自动检测的可疑记录 / 全量记录 */
type RangeKey = 'suspects' | 'all'

/**
 * 批量修正运动类型弹窗属性。
 */
interface BatchActivityTypeDialogProps {
  /** 待复核候选（detectTypeSuspects 输出） */
  suspects: TypeSuspect[]

  /** 是否提供「全部记录」范围切换（工具栏入口 true；其他入口可关） */
  allowFullRange?: boolean

  /** 全量活动摘要（影响预览口径 + 「全部记录」范围的数据源） */
  allSummaries: ActivitySummary[]

  /** 本地库仓库（测试注入；缺省模块级单例） */
  writeRepository?: Pick<DexieActivityRepository, 'confirmActivityType'>

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
  allowFullRange = false,
  allSummaries,
  writeRepository = localRepository,
  distanceUnit = 'km',
  onClose,
  onApplied,
}: BatchActivityTypeDialogProps) {
  const [range, setRange] = useState<RangeKey>('suspects')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => defaultSelectedIds(suspects))
  /** 用户手动指定的目标类型（id → 类型），未指定的行用建议类型 */
  const [overrides, setOverrides] = useState<Record<string, ActivityType>>({})
  const [filter, setFilter] = useState<FilterKey>('all')
  /** 「全部记录」范围的关键词（匹配标题/文件名/日期） */
  const [search, setSearch] = useState('')
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  /** 全量候选（「全部记录」范围）：建议类型=当前类型归一化，无灰区语义 */
  const fullEntries = useMemo(() => toManualSuspects(allSummaries), [allSummaries])

  /** 当前范围的候选列表 */
  const entries = range === 'all' ? fullEntries : suspects

  /**
   * 切换范围：勾选与筛选都不跨范围延续（两个范围的语义不同，
   * 沿用旧勾选会让人以为「已经选好了」）。
   *
   * @param next 目标范围
   */
  function switchRange(next: RangeKey) {
    if (next === range) {
      return
    }
    setRange(next)
    setFilter('all')
    setSearch('')
    // 可疑记录默认勾选非灰区；全部记录默认不勾选（避免误点应用把上千条重写）
    setSelectedIds(next === 'all' ? new Set() : defaultSelectedIds(suspects))
  }

  /** 影响预览：勾选变化时实时重算（按手动指定 ?? 建议类型落定） */
  const impact = useMemo(
    () =>
      summarizeTypeFixImpact(allSummaries, entries, selectedIds, new Map(Object.entries(overrides))),
    [allSummaries, entries, selectedIds, overrides],
  )

  /**
   * 取某条候选最终生效的目标类型：手动指定优先，未指定用建议。
   *
   * @param suspect 待复核记录
   * @returns 目标类型
   */
  function chosenType(suspect: TypeSuspect): ActivityType {
    return overrides[suspect.summary.id] ?? suspect.suggestedType
  }

  /**
   * 手动指定某条的目标类型。
   *
   * @param id 活动 ID
   * @param type 目标类型
   */
  function chooseType(id: string, type: ActivityType) {
    setOverrides((previous) => ({ ...previous, [id]: type }))
  }

  /** 关键词过滤（「全部记录」范围）：标题 / 文件名 / 日期 */
  const searched = useMemo(() => {
    if (range !== 'all') {
      return entries
    }
    const keyword = search.trim().toLowerCase()
    if (keyword === '') {
      return entries
    }
    return entries.filter((entry) => {
      const { summary } = entry
      const haystack = [
        summary.name ?? '',
        summary.fileName,
        DATE_FORMATTER.format(new Date(summary.startTime)),
        activityTypeLabel(summary.activityType),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(keyword)
    })
  }, [entries, range, search])

  /** 分组统计（chip 计数）：可疑范围按建议类型 + 灰区；全部范围按当前类型 */
  const counts = useMemo(() => {
    const byType = new Map<ActivityType, number>()
    let grey = 0
    for (const entry of searched) {
      if (isGreySuspect(entry)) {
        grey += 1
      }
      const key =
        range === 'all' ? normalizeActivityType(entry.summary.activityType) : entry.suggestedType
      byType.set(key, (byType.get(key) ?? 0) + 1)
    }
    return { byType, grey }
  }, [searched, range])

  const filtered = useMemo(
    () =>
      searched.filter((entry) => {
        if (filter === 'all') {
          return true
        }
        if (filter === 'grey') {
          return isGreySuspect(entry)
        }
        const key =
          range === 'all' ? normalizeActivityType(entry.summary.activityType) : entry.suggestedType
        return `type:${key}` === filter
      }),
    [searched, filter, range],
  )

  const visible = filtered.slice(0, RENDER_LIMIT)
  const truncated = filtered.length > visible.length

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

  /** 应用勾选项：逐条改写类型并标记已确认（只进本地库） */
  async function apply() {
    if (!canApply) {
      return
    }
    setApplying(true)
    let done = 0
    try {
      for (const entry of entries) {
        if (!selectedIds.has(entry.summary.id)) {
          continue
        }
        // 应用即确认：写入类型的同时打标记，类型复核检测此后不再提示该记录
        await writeRepository.confirmActivityType(entry.summary.id, chosenType(entry))
        done += 1
      }
      setResult(`已修正 ${done} 条活动的运动类型，之后不再提示`)
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
              {range === 'all'
                ? `共 ${entries.length} 条记录，用搜索或类型筛选找到目标，勾选后在「类型变更」下拉中修改`
                : `检测到 ${suspects.length} 条活动的运动类型可能不准确，确认后才会写入；应用后不再提示`}
            </p>
          </div>
          <button type="button" className="batch-type__close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        {allowFullRange && (
          <div className="batch-type__range">
            <button
              type="button"
              className={
                range === 'suspects'
                  ? 'batch-type__range-button batch-type__range-button--active'
                  : 'batch-type__range-button'
              }
              onClick={() => switchRange('suspects')}
            >
              可疑记录 {suspects.length}
            </button>
            <button
              type="button"
              className={
                range === 'all'
                  ? 'batch-type__range-button batch-type__range-button--active'
                  : 'batch-type__range-button'
              }
              onClick={() => switchRange('all')}
            >
              全部记录 {fullEntries.length}
            </button>
          </div>
        )}

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
            <span className="batch-type__metric-value">{entries.length}</span>
            <span className="batch-type__metric-delta">已勾选 {selectedIds.size} 条</span>
          </div>
        </div>

        {range === 'all' && (
          <div className="batch-type__search">
            <input
              type="search"
              className="batch-type__search-input"
              aria-label="搜索记录"
              placeholder="搜索标题 / 文件名 / 日期"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        )}

        <div className="batch-type__chips">
            <button
              type="button"
              className={
                filter === 'all' ? 'batch-type__chip batch-type__chip--active' : 'batch-type__chip'
              }
              onClick={() => setFilter('all')}
            >
              全部 {searched.length}
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
              {range === 'all' ? ACTIVITY_TYPE_LABELS[type] : `建议${ACTIVITY_TYPE_LABELS[type]}`} {count}
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
              chosenType={chosenType(suspect)}
              distanceUnit={distanceUnit}
              onToggle={toggle}
              onChooseType={chooseType}
            />
          ))}
          {visible.length === 0 && <div className="batch-type__empty">该分组下没有记录</div>}
          {truncated && (
            <div className="batch-type__truncated">
              共 {filtered.length} 条，已显示前 {RENDER_LIMIT} 条——请用搜索或类型筛选缩小范围
            </div>
          )}
        </div>

        {result !== null && <div className="batch-type__result">{result}</div>}

        <div className="batch-type__actions">
          <p className="batch-type__note">
            {range === 'all'
              ? '勾选 = 按所选类型写入并标记为已确认（不再提示），取消勾选 = 保持原样'
              : counts.grey > 0
                ? `灰区 ${counts.grey} 条建议保持骑行：10~20 km/h 的城市通勤与快跑速度重叠，确认是骑行也请勾选应用，之后不再提示`
                : '逐条依据已列出，可在「类型变更」下拉中修改目标类型，应用后不再提示'}
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
 *
 * 类型变更列是可编辑下拉：默认取建议类型，用户可手动改成任意规范类型
 * （如把灰区误标的骑行保留为骑行，或把被误改成跑步的记录改回来），
 * 应用时按所选项写入而非只接受/拒绝单一建议。
 */
function SuspectRow({
  suspect,
  checked,
  chosenType,
  distanceUnit,
  onToggle,
  onChooseType,
}: {
  suspect: TypeSuspect
  checked: boolean
  chosenType: ActivityType
  distanceUnit: DistanceUnit
  onToggle: (id: string, checked: boolean) => void
  onChooseType: (id: string, type: ActivityType) => void
}) {
  const { summary } = suspect
  const grey = isGreySuspect(suspect)
  // 归一化后取中文标签：库里可能存有各平台原始写法（road_biking / 骑行）
  const currentLabel = activityTypeLabel(summary.activityType)
  const name = summary.name ?? summary.fileName

  return (
    <label className="batch-type__row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggle(summary.id, event.target.checked)}
      />
      <span className="batch-type__name" title={name}>
        {name}
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
        <select
          className={
            grey ? 'batch-type__select batch-type__select--grey' : 'batch-type__select'
          }
          value={chosenType}
          aria-label={`修改「${name}」的目标类型`}
          onClick={(event) => {
            // 行是 <label> 包裹：不拦截默认行为会把点击转发给勾选框
            event.preventDefault()
            event.stopPropagation()
          }}
          onChange={(event) => onChooseType(summary.id, event.target.value as ActivityType)}
        >
          {ACTIVITY_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </span>
      <span className={grey ? 'batch-type__basis batch-type__basis--grey' : 'batch-type__basis'}>
        {grey ? `灰区，请确认（${suspect.basis}）` : suspect.basis}
      </span>
    </label>
  )
}

export default BatchActivityTypeDialog
