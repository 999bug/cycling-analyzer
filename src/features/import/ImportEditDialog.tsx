/**
 * 单文件导入编辑框（标题/说明/个人备注）。
 *
 * 选择单个 FIT 文件后弹出：预填文件名兜底标题，用户可修改标题、
 * 填写说明（Strava 描述等价物）与个人备注，确认后按编辑值导入。
 */
import { useState } from 'react'

/**
 * 编辑后的导入元数据。
 */
export interface ImportDraft {
  /** 活动标题（可为空，空串表示不指定） */
  title: string

  /** 活动说明（可为空） */
  description: string

  /** 个人备注（可为空） */
  note: string
}

/**
 * 单文件导入编辑框属性。
 */
interface ImportEditDialogProps {
  /** 源文件名（展示用） */
  fileName: string

  /** 预填标题（文件名兜底提取结果，可为空串） */
  defaultTitle: string

  /** 确认回调（提交编辑后的元数据） */
  onConfirm: (draft: ImportDraft) => void

  /** 取消回调 */
  onCancel: () => void
}

/**
 * 单文件导入编辑框。
 */
function ImportEditDialog({ fileName, defaultTitle, onConfirm, onCancel }: ImportEditDialogProps) {
  const [title, setTitle] = useState(defaultTitle)
  const [description, setDescription] = useState('')
  const [note, setNote] = useState('')

  return (
    <div className="import-edit" role="group" aria-label="导入活动信息">
      <div className="import-edit__head">
        <p className="import-edit__title">导入活动信息</p>
        <p className="import-edit__file">{fileName}</p>
      </div>
      <label className="import-edit__field">
        <span className="import-edit__label">标题</span>
        <input
          className="import-edit__input"
          value={title}
          placeholder="留空则按文件名还原"
          aria-label="活动标题"
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="import-edit__field">
        <span className="import-edit__label">说明</span>
        <textarea
          className="import-edit__textarea"
          value={description}
          placeholder="活动说明（可选）"
          aria-label="活动说明"
          rows={2}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="import-edit__field">
        <span className="import-edit__label">个人备注</span>
        <textarea
          className="import-edit__textarea"
          value={note}
          placeholder="仅自己可见的备注（可选）"
          aria-label="个人备注"
          rows={2}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="import-edit__actions">
        <button
          type="button"
          className="import-edit__confirm"
          onClick={() => onConfirm({ title, description, note })}
        >
          确认导入
        </button>
        <button type="button" className="import-edit__cancel" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  )
}

export default ImportEditDialog