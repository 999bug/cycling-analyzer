/**
 * 批量删除确认弹窗（列表页，规格外增强）。
 *
 * 勾选骑行记录后批量删除；弹窗顶部提供脏数据判定阈值输入
 * （距离 < N km 或时长 < N 分钟，默认 5km/10min，仅本次弹窗生效），
 * 低于阈值的记录以警告样式逐条列出，提示用户确认是否确实要删除。
 * 写操作永远只进本地库（Dexie），作者快照源由父组件隐藏勾选入口。
 */
import { useMemo, useState } from 'react'
import { db } from '@/storage/db'
import {
  DexieActivityRepository,
  type ActivitySummary,
} from '@/storage/repositories/activityRepository'
import { formatDuration } from '@/utils/format'
import './delete-activities.css'

/** 本地库仓库（删除等写操作永远只进本地库） */
const localRepository = new DexieActivityRepository(db)

/** 脏数据判定默认阈值：距离 5 km、时长 10 分钟 */
const DEFAULT_DIRTY_DISTANCE_KM = 5
const DEFAULT_DIRTY_DURATION_MINUTES = 10

/** 批量删除确认弹窗属性 */
interface DeleteActivitiesDialogProps {
  /** 待删除活动列表（勾选的活动摘要） */
  items: ActivitySummary[]

  /** 本地库仓库（测试注入；缺省模块级单例） */
  writeRepository?: Pick<DexieActivityRepository, 'deleteActivities'>

  /** 关闭弹窗回调 */
  onClose: () => void

  /** 全部删除完成后的回调（父组件清空勾选并刷新列表） */
  onDeleted: (count: number) => void
}

/** 待删除条目视图（含脏数据判定） */
interface DeleteItemView {
  id: string
  title: string
  startTime: string
  distanceKm: string
  durationText: string
  isDirty: boolean
  dirtyReason: string
}

/**
 * 批量删除确认弹窗。
 */
function DeleteActivitiesDialog({
  items,
  writeRepository = localRepository,
  onClose,
  onDeleted,
}: DeleteActivitiesDialogProps) {
  const [distanceThreshold, setDistanceThreshold] = useState(String(DEFAULT_DIRTY_DISTANCE_KM))
  const [durationThreshold, setDurationThreshold] = useState(String(DEFAULT_DIRTY_DURATION_MINUTES))
  const [deleting, setDeleting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const thresholdKm = Number(distanceThreshold)
  const thresholdMinutes = Number(durationThreshold)
  const canConfirm = !deleting && Number.isFinite(thresholdKm) && Number.isFinite(thresholdMinutes)

  // 实时判定：阈值输入变化即重算疑似脏数据列表
  const itemViews = useMemo<DeleteItemView[]>(() => {
    return items.map((item) => {
      const distanceKm = item.distance / 1000
      const durationMinutes = item.duration / 60
      const dirtyByDistance =
        Number.isFinite(thresholdKm) && distanceKm < thresholdKm
      const dirtyByDuration =
        Number.isFinite(thresholdMinutes) && durationMinutes < thresholdMinutes
      const reasons: string[] = []
      if (dirtyByDistance) {
        reasons.push(`距离 ${distanceKm.toFixed(1)} km < ${thresholdKm} km`)
      }
      if (dirtyByDuration) {
        reasons.push(`时长 ${formatDuration(item.duration)} < ${thresholdMinutes} 分钟`)
      }
      return {
        id: item.id,
        title: item.name ?? item.fileName,
        startTime: item.startTime.slice(0, 10),
        distanceKm: distanceKm.toFixed(1),
        durationText: formatDuration(item.duration),
        isDirty: reasons.length > 0,
        dirtyReason: reasons.join('，'),
      }
    })
  }, [items, thresholdKm, thresholdMinutes])

  const dirtyItems = itemViews.filter((item) => item.isDirty)
  const normalItems = itemViews.filter((item) => !item.isDirty)

  /**
   * 单事务批量删除（性能关键）。
   *
   * 旧实现逐条 await deleteActivity：每条独立事务 + 二级索引 delete() 走
   * Dexie modify 回退逐条反序列化记录体，勾选数十条时 UI 卡死。
   * 改为一次 deleteActivities(ids)：单事务 + primaryKeys/bulkDelete。
   */
  async function handleConfirm() {
    setDeleting(true)
    setResult(null)
    try {
      await writeRepository.deleteActivities(itemViews.map((item) => item.id))
      setDeleting(false)
      onDeleted(itemViews.length)
    } catch (err: unknown) {
      // 单事务原子性：任一条失败全部回滚，无部分删除状态
      setDeleting(false)
      console.error('Failed to batch delete activities', err)
      setResult(`删除失败：${items.length} 条均未删除（详情见控制台日志）`)
    }
  }

  return (
    <div
      className="delete-activities__overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !deleting) {
          onClose()
        }
      }}
    >
      <div role="dialog" aria-label="确认删除" className="delete-activities">
        <div className="delete-activities__header">
          <h2 className="delete-activities__title">确认删除</h2>
          <button
            type="button"
            className="delete-activities__close"
            aria-label="关闭"
            disabled={deleting}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <p className="delete-activities__summary">即将删除 {items.length} 条骑行记录：</p>

        <div className="delete-activities__threshold">
          <span>脏数据判定阈值：距离小于</span>
          <input
            aria-label="脏数据距离阈值"
            type="number"
            min={0}
            step="0.5"
            value={distanceThreshold}
            disabled={deleting}
            onChange={(event) => setDistanceThreshold(event.target.value)}
          />
          <span>km 或时长小于</span>
          <input
            aria-label="脏数据时长阈值"
            type="number"
            min={0}
            step="1"
            value={durationThreshold}
            disabled={deleting}
            onChange={(event) => setDurationThreshold(event.target.value)}
          />
          <span>分钟</span>
        </div>

        {dirtyItems.length > 0 && (
          <div className="delete-activities__warn">
            <p className="delete-activities__warn-title">
              ⚠ 以下 {dirtyItems.length} 条记录低于阈值，疑似脏数据，请确认是否确实要删除：
            </p>
            <ul className="delete-activities__list">
              {dirtyItems.map((item) => (
                <li key={item.id} className="delete-activities__item delete-activities__item--dirty">
                  <span>
                    {item.title}（{item.startTime}）
                  </span>
                  <span className="delete-activities__reason">{item.dirtyReason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ul className="delete-activities__list">
          {normalItems.map((item) => (
            <li key={item.id} className="delete-activities__item">
              <span>
                {item.title}（{item.startTime}）
              </span>
              <span>
                {item.distanceKm} km / {item.durationText}
              </span>
            </li>
          ))}
        </ul>

        {result !== null && <p className="delete-activities__result">{result}</p>}
        <p className="delete-activities__hint">删除后不可恢复（本地 IndexedDB 数据）。</p>

        <div className="delete-activities__actions">
          <button type="button" className="delete-activities__button" disabled={deleting} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="delete-activities__button delete-activities__button--danger"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  )
}

export default DeleteActivitiesDialog
