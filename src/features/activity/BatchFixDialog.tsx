/**
 * 批量轨迹纠偏弹窗（列表页勾选工具条）。
 *
 * 救历史数据用：勾选同一来源（如一批行者导出）的记录后，
 * 选一次来源即对全部勾选记录写入坐标系标记。只改
 * coordinateSystem / sourceApp 标记，逐点原始坐标不动（可逆、零误差累积），
 * 已有的手动微调（trackOffset）保持不变。
 * 写操作永远只进本地库（Dexie），作者快照源由父组件隐藏勾选入口。
 */
import { useMemo, useState } from 'react'
import { db } from '@/storage/db'
import {
  DexieActivityRepository,
  type ActivitySummary,
} from '@/storage/repositories/activityRepository'
import {
  COORDINATE_SYSTEM_LABELS,
  sourceProfileById,
} from '@/geo/sourceProfiles'
import type { CoordinateSystem } from '@/geo/coordinateSystem'
import { formatDate } from '@/utils/format'
import SourceSelect from '@/features/activity/SourceSelect'
import './delete-activities.css'

/** 本地库仓库（纠偏写操作永远只进本地库） */
const localRepository = new DexieActivityRepository(db)

/** 批量纠偏弹窗属性 */
interface BatchFixDialogProps {
  /** 待纠偏活动列表（勾选的活动摘要） */
  items: ActivitySummary[]

  /** 本地库仓库（测试注入；缺省模块级单例） */
  writeRepository?: Pick<DexieActivityRepository, 'updateTrackSystem'>

  /** 关闭弹窗回调 */
  onClose: () => void

  /** 全部纠偏完成后的回调（父组件清空勾选并刷新列表） */
  onFixed: (count: number) => void
}

/**
 * 批量轨迹纠偏弹窗。
 */
function BatchFixDialog({ items, writeRepository = localRepository, onClose, onFixed }: BatchFixDialogProps) {
  // 默认选中：勾选集中出现次数最多的来源（同批导入通常同源，减少一次点击）
  const [selectedId, setSelectedId] = useState(() => dominantSourceId(items))
  const [fixing, setFixing] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const selectedProfile = sourceProfileById(selectedId === 'unknown' ? undefined : selectedId)
  // 勾选集中坐标系会因此次操作发生变化的记录数（提示用户影响面）
  const changedCount = useMemo(
    () => items.filter((item) => (item.coordinateSystem ?? 'wgs84') !== selectedProfile.coordinateSystem).length,
    [items, selectedProfile],
  )

  /** 逐条写入坐标系标记，汇总成功/失败数量（与批量删除弹窗同口径） */
  async function handleConfirm() {
    setFixing(true)
    setResult(null)
    let succeeded = 0
    let failed = 0
    for (const item of items) {
      try {
        await writeRepository.updateTrackSystem(item.id, {
          coordinateSystem: selectedProfile.coordinateSystem,
          sourceApp: selectedProfile.id === 'unknown' ? undefined : selectedProfile.id,
        })
        succeeded += 1
      } catch (err: unknown) {
        failed += 1
        console.error('Failed to fix activity coordinate system', item.id, err)
      }
    }
    setFixing(false)
    if (failed === 0) {
      onFixed(succeeded)
      return
    }
    setResult(`纠偏完成：成功 ${succeeded} 条，失败 ${failed} 条（详情见控制台日志）`)
  }

  return (
    <div
      className="delete-activities__overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !fixing) {
          onClose()
        }
      }}
    >
      <div role="dialog" aria-label="批量轨迹纠偏" className="delete-activities">
        <div className="delete-activities__header">
          <h2 className="delete-activities__title">批量轨迹纠偏</h2>
          <button
            type="button"
            className="delete-activities__close"
            aria-label="关闭"
            disabled={fixing}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <p className="delete-activities__summary">即将对 {items.length} 条骑行记录设置轨迹坐标系：</p>

        <div className="delete-activities__threshold">
          <span>数据来自</span>
          <SourceSelect
            label="批量纠偏数据来源"
            value={selectedId}
            disabled={fixing}
            onChange={setSelectedId}
          />
        </div>

        <p className="delete-activities__hint">
          目标坐标系：{COORDINATE_SYSTEM_LABELS[selectedProfile.coordinateSystem]}
          {changedCount > 0
            ? `，其中 ${changedCount} 条记录的坐标系将发生变化（热力图 / 路线图 / 赛段缓存自动重算）`
            : '，勾选记录均已是该坐标系'}
          。只改标记不改坐标数据，可随时切换回来。
        </p>

        <ul className="delete-activities__list">
          {items.map((item) => {
            const current = item.coordinateSystem ?? 'wgs84'
            const willChange = current !== selectedProfile.coordinateSystem
            return (
              <li key={item.id} className="delete-activities__item">
                <span>
                  {item.name ?? item.fileName}（{formatDate(item.startTime)}）
                </span>
                <span className={willChange ? 'delete-activities__reason' : undefined}>
                  {systemShort(current)} → {systemShort(selectedProfile.coordinateSystem)}
                </span>
              </li>
            )
          })}
        </ul>

        {result !== null && <p className="delete-activities__result">{result}</p>}

        <div className="delete-activities__actions">
          <button type="button" className="delete-activities__button" disabled={fixing} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="delete-activities__button delete-activities__button--danger"
            disabled={fixing}
            onClick={handleConfirm}
          >
            {fixing ? '纠偏中…' : '确认纠偏'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 勾选集中出现次数最多的来源 ID（并列时取最先出现者；无标记视为 unknown） */
function dominantSourceId(items: readonly ActivitySummary[]): string {
  const counts = new Map<string, number>()
  let best = 'unknown'
  let bestCount = 0
  for (const item of items) {
    const id = item.sourceApp ?? 'unknown'
    const next = (counts.get(id) ?? 0) + 1
    counts.set(id, next)
    if (next > bestCount) {
      best = id
      bestCount = next
    }
  }
  return best
}

/** 坐标系短标签（弹窗行内展示用） */
function systemShort(system: CoordinateSystem): string {
  if (system === 'gcj02') {
    return 'GCJ-02'
  }
  if (system === 'bd09') {
    return 'BD-09'
  }
  return 'WGS-84'
}

export default BatchFixDialog
