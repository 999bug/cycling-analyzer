/**
 * 批量重命名弹窗（列表页，规格外增强）。
 *
 * 背景：行者等平台工具导出的记录标题为固定文件名（如 20260824_063012.fit），
 * 逐条手改繁琐。本弹窗按命名模板对**当前筛选命中的全部活动**批量改名。
 *
 * - 模板变量：{日期}（YYYY-MM-DD）、{类型}、{距离}（km，取整）、
 *   {爬升}（m，取整，缺失显示 —）、{序号}（按当前列表顺序两位编号）
 * - 实时预览新旧名称对照；模板空白时禁止应用
 * - 写操作永远只进本地库（Dexie），作者快照源由父组件置灰入口
 */
import { useMemo, useState } from 'react'
import { db } from '@/storage/db'
import {
  DexieActivityRepository,
  type ActivitySummary,
} from '@/storage/repositories/activityRepository'
import {
  DEFAULT_RENAME_TEMPLATE,
  TEMPLATE_VARIABLES,
  renderRenameTemplate,
} from '@/features/activity/batchRename'
import './batch-rename.css'

/** 本地库仓库（重命名等写操作永远只进本地库，与详情页口径一致） */
const localRepository = new DexieActivityRepository(db)

/** 批量重命名弹窗属性 */
interface BatchRenameDialogProps {
  /** 待重命名活动列表（当前筛选命中的全部记录） */
  items: ActivitySummary[]

  /** 本地库仓库（测试注入；缺省模块级单例） */
  writeRepository?: Pick<DexieActivityRepository, 'updateName'>

  /** 关闭弹窗回调 */
  onClose: () => void

  /** 全部应用完成后的回调（父组件刷新列表） */
  onRenamed: (count: number) => void
}

/**
 * 批量重命名弹窗。
 */
function BatchRenameDialog({ items, writeRepository = localRepository, onClose, onRenamed }: BatchRenameDialogProps) {
  const [template, setTemplate] = useState(DEFAULT_RENAME_TEMPLATE)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const trimmed = template.trim()
  const canApply = trimmed !== '' && !applying

  // 实时预览：新旧名称对照（旧名缺省回退文件名）
  const previews = useMemo(
    () =>
      items.map((item, index) => ({
        id: item.id,
        oldName: item.name ?? item.fileName,
        newName: renderRenameTemplate(trimmed, item, index),
      })),
    [items, trimmed],
  )

  /** 追加模板变量到模板末尾 */
  function handleAppendVariable(token: string) {
    setTemplate((prev) => prev + token)
  }

  /** 逐条写入新名称，汇总成功/失败数量 */
  async function handleApply() {
    setApplying(true)
    setResult(null)
    let succeeded = 0
    let failed = 0
    for (const preview of previews) {
      try {
        await writeRepository.updateName(preview.id, preview.newName)
        succeeded += 1
      } catch (err: unknown) {
        failed += 1
        console.error('Failed to rename activity', preview.id, err)
      }
    }
    setApplying(false)
    if (failed === 0) {
      onRenamed(succeeded)
      return
    }
    setResult(`完成：成功 ${succeeded} 条，失败 ${failed} 条`)
  }

  return (
    <div className="batch-rename-overlay" onClick={onClose}>
      <div
        className="batch-rename"
        role="dialog"
        aria-label="批量重命名"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="batch-rename__header">
          <h2 className="batch-rename__title">批量重命名（{items.length} 条）</h2>
          <button
            type="button"
            className="batch-rename__close"
            aria-label="关闭"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="batch-rename__section">
          <div className="batch-rename__hint">命名模板，可用变量：</div>
          <div className="batch-rename__chips">
            {TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v.token}
                type="button"
                className="batch-rename__chip"
                onClick={() => handleAppendVariable(v.token)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <input
            className="batch-rename__template"
            aria-label="命名模板"
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
          />
        </div>

        <div className="batch-rename__section">
          <div className="batch-rename__hint">实时预览（旧名 → 新名）：</div>
          <div className="batch-rename__preview">
            {previews.map((p) => (
              <div key={p.id} className="batch-rename__preview-row">
                <span className="batch-rename__preview-new">{p.newName || '（空）'}</span>
                <span className="batch-rename__preview-old">{p.oldName}</span>
              </div>
            ))}
          </div>
        </div>

        {result !== null && <div className="batch-rename__result">{result}</div>}

        <div className="batch-rename__actions">
          <button type="button" className="batch-rename__button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="batch-rename__button batch-rename__button--primary"
            disabled={!canApply}
            onClick={handleApply}
          >
            {applying ? '应用中…' : '应用到全部'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default BatchRenameDialog
