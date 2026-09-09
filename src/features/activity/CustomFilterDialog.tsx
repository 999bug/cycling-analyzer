/**
 * 自定义筛选弹窗（列表页工具栏「自定义筛选」按钮打开）。
 *
 * 参考用户提供的「过滤条件」弹窗交互：
 * - 列表视图：已保存筛选预设表格（勾选多选 / 名称 / 说明 / 操作：修改、删除），
 *   底部操作：新建、删除、刷新；右侧「应用」将勾选预设的条件并集写入当前筛选
 *   （多条件 AND 语义，与既有自定义条件口径一致）。
 * - 编辑视图（新建 / 修改）：名称输入 + 条件行列表（字段 / 比较 / 值 / 介于上限），
 *   可逐行删除、追加；保存时逐行校验（复用 customFilter 纯函数解析）。
 *
 * 说明列自动按条件生成文案（describeCondition），不单独存储。
 */
import { useState } from 'react'
import {
  CUSTOM_FILTER_FIELDS,
  CUSTOM_FILTER_OPS,
  defaultPresetName,
  describeCondition,
  parseCustomFilterCondition,
  type CustomFilterCondition,
  type CustomFilterField,
  type CustomFilterOp,
} from '@/features/activity/customFilter'

/** 条件行编辑态（输入框原始字符串，保存时统一解析校验） */
interface DraftRow {
  field: CustomFilterField
  op: CustomFilterOp
  value: string
  value2: string
}

/** 新建空条件行（默认字段=距离、条件=大于） */
function emptyRow(): DraftRow {
  return { field: 'distance', op: 'gt', value: '', value2: '' }
}

/** 条件 → 编辑态行（修改预设时回显） */
function toDraftRow(condition: CustomFilterCondition): DraftRow {
  return {
    field: condition.field,
    op: condition.op,
    value: condition.value,
    value2: condition.value2 ?? '',
  }
}

/** 行解析错误 → 用户提示文案 */
const PARSE_ERROR_TEXT: Record<string, string> = {
  empty: '请输入筛选数值或选择日期',
  'invalid-number': '请输入有效数值（非负数字）',
  'invalid-order': '区间下限不能大于上限（或起始日期晚于结束日期）',
  'missing-value2': '介于需要输入区间上限（或结束日期）',
}

interface CustomFilterDialogProps {
  /** 已保存筛选预设（名字 → 条件列表） */
  presets: Record<string, CustomFilterCondition[]>

  /** 多选套用：勾选预设名列表（父组件取条件并集写入当前筛选并关闭弹窗） */
  onApply: (names: string[]) => void

  /** 保存预设（新建或修改；同名覆盖由父组件确认） */
  onSavePreset: (name: string, conditions: CustomFilterCondition[]) => void

  /** 批量删除预设 */
  onDeletePresets: (names: string[]) => void

  /** 关闭弹窗 */
  onClose: () => void
}

/**
 * 自定义筛选弹窗。
 */
function CustomFilterDialog({
  presets,
  onApply,
  onSavePreset,
  onDeletePresets,
  onClose,
}: CustomFilterDialogProps) {
  /** 视图模式：list = 预设列表，edit = 新建/修改表单 */
  const [mode, setMode] = useState<'list' | 'edit'>('list')
  /** 勾选的预设名（多选套用 / 批量删除） */
  const [checkedNames, setCheckedNames] = useState<Set<string>>(new Set())
  /** 编辑中的预设名（null = 新建） */
  const [editingName, setEditingName] = useState<string | null>(null)
  /** 预设名输入 */
  const [nameInput, setNameInput] = useState('')
  /** 条件行草稿 */
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()])
  /** 错误提示（列表视图删除/应用校验 + 编辑视图行解析） */
  const [error, setError] = useState<string | null>(null)

  const names = Object.keys(presets)

  /** 勾选/取消一个预设 */
  function toggleChecked(name: string, checked: boolean) {
    setCheckedNames((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(name)
      } else {
        next.delete(name)
      }
      return next
    })
  }

  /** 打开新建视图 */
  function openCreate() {
    setEditingName(null)
    setNameInput('')
    setRows([emptyRow()])
    setError(null)
    setMode('edit')
  }

  /** 打开修改视图（回显预设名与条件） */
  function openEdit(name: string) {
    const conditions = presets[name]
    if (conditions === undefined) {
      return
    }
    setEditingName(name)
    setNameInput(name)
    setRows(conditions.length > 0 ? conditions.map(toDraftRow) : [emptyRow()])
    setError(null)
    setMode('edit')
  }

  /** 修改单行字段（切字段清空数值，避免跨字段残留） */
  function updateRow(index: number, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  /** 保存：逐行解析校验 → 上抛 → 回列表视图 */
  function handleSave() {
    const name = nameInput.trim()
    if (name === '') {
      setError('请输入名称')
      return
    }
    const conditions: CustomFilterCondition[] = []
    for (const row of rows) {
      const result = parseCustomFilterCondition(row.field, row.op, row.value, row.value2)
      if (!result.ok) {
        setError(PARSE_ERROR_TEXT[result.error] ?? '输入无效')
        return
      }
      conditions.push(result.condition)
    }
    // 同名覆盖确认：新建撞名，或修改时改名撞了其他预设名
    if (presets[name] !== undefined && name !== editingName && !window.confirm(`预设「${name}」已存在，覆盖它？`)) {
      return
    }
    // 修改时改名：删除旧名预设（改名保存语义，与原面板行为一致）
    if (editingName !== null && editingName !== name) {
      onDeletePresets([editingName])
    }
    onSavePreset(name, conditions)
    setError(null)
    setMode('list')
  }

  /** 批量删除勾选预设（确认后上抛） */
  function handleDeleteChecked() {
    if (checkedNames.size === 0) {
      setError('请先勾选要删除的预设')
      return
    }
    const target = [...checkedNames].filter((name) => presets[name] !== undefined)
    if (target.length === 0) {
      setError('勾选的预设不存在，请点击「刷新」后重试')
      return
    }
    if (!window.confirm(`删除选中的 ${target.length} 个预设？（不影响当前生效的筛选条件）`)) {
      return
    }
    onDeletePresets(target)
    setCheckedNames(new Set())
    setError(null)
  }

  /** 应用勾选预设（条件并集写入当前筛选） */
  function handleApply() {
    if (checkedNames.size === 0) {
      setError('请先勾选要应用的预设')
      return
    }
    onApply([...checkedNames].filter((name) => presets[name] !== undefined))
  }

  const isDate = (field: CustomFilterField) => CUSTOM_FILTER_FIELDS[field].isDate === true

  return (
    <div className="delete-activities__overlay" onClick={onClose}>
      {/* 阻止冒泡：点击弹窗主体不关闭 */}
      <div
        className="filter-dialog"
        role="dialog"
        aria-label="过滤条件"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="delete-activities__header">
          <h2 className="delete-activities__title">过滤条件</h2>
          <button type="button" className="delete-activities__close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        {mode === 'list' ? (
          <>
            <div className="filter-dialog__table-wrap">
              <table className="filter-dialog__table">
                <thead>
                  <tr>
                    <th className="filter-dialog__check">
                      <input
                        type="checkbox"
                        aria-label="全选预设"
                        checked={names.length > 0 && checkedNames.size === names.length}
                        onChange={(event) =>
                          setCheckedNames(event.target.checked ? new Set(names) : new Set())
                        }
                      />
                    </th>
                    <th>名称</th>
                    <th>说明</th>
                    <th className="filter-dialog__ops">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {names.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="filter-dialog__empty">
                        还没有筛选预设，点击「新建」创建
                      </td>
                    </tr>
                  ) : (
                    names.map((name) => (
                      <tr key={name}>
                        <td className="filter-dialog__check">
                          <input
                            type="checkbox"
                            aria-label={`选择 ${name}`}
                            checked={checkedNames.has(name)}
                            onChange={(event) => toggleChecked(name, event.target.checked)}
                          />
                        </td>
                        <td>{name}</td>
                        <td className="filter-dialog__desc">
                          {presets[name].map(describeCondition).join(' 且 ')}
                        </td>
                        <td className="filter-dialog__ops">
                          <button type="button" className="filter-dialog__link" onClick={() => openEdit(name)}>
                            修改
                          </button>
                          <button
                            type="button"
                            className="filter-dialog__link filter-dialog__link--danger"
                            onClick={() => {
                              if (window.confirm(`删除预设「${name}」？（不影响当前生效的筛选条件）`)) {
                                onDeletePresets([name])
                                setCheckedNames((prev) => {
                                  const next = new Set(prev)
                                  next.delete(name)
                                  return next
                                })
                              }
                            }}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {error !== null && <p className="custom-filter__error">{error}</p>}
            <div className="filter-dialog__footer">
              <div className="filter-dialog__footer-left">
                <button type="button" className="custom-filter__button custom-filter__button--primary" onClick={openCreate}>
                  新建
                </button>
                <button type="button" className="custom-filter__button" onClick={handleDeleteChecked}>
                  删除
                </button>
                {/* 列表实时来自持久化 store；刷新用于清空本弹窗内的勾选与未保存操作 */}
                <button
                  type="button"
                  className="custom-filter__button"
                  onClick={() => {
                    setCheckedNames(new Set())
                    setError(null)
                  }}
                >
                  刷新
                </button>
              </div>
              <div className="filter-dialog__footer-right">
                <button type="button" className="filter-dialog__apply" onClick={handleApply}>
                  应用{checkedNames.size > 0 ? `（${checkedNames.size}）` : ''}
                </button>
                <button type="button" className="delete-activities__button" onClick={onClose}>
                  关闭
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="filter-dialog__edit">
              <label className="filter-dialog__name-row" htmlFor="filter-dialog-name">
                <span className="filter-dialog__required">*名称</span>
                <input
                  id="filter-dialog-name"
                  className="activity-filters__input"
                  type="text"
                  value={nameInput}
                  placeholder={defaultPresetName(rows.map((row) => ({ field: row.field, op: row.op, value: row.value, value2: row.value2 || undefined })))}
                  onChange={(event) => setNameInput(event.target.value)}
                />
              </label>
              <div className="filter-dialog__rows">
                <div className="filter-dialog__rows-header">
                  <span>条件列</span>
                  <span>比较</span>
                  <span>值</span>
                  <span>
                    操作
                    <button
                      type="button"
                      className="filter-dialog__link"
                      onClick={() => setRows((prev) => [...prev, emptyRow()])}
                    >
                      添加
                    </button>
                  </span>
                </div>
                {rows.map((row, index) => (
                  <div key={index} className="filter-dialog__row">
                    <select
                      aria-label={`条件列 ${index + 1}`}
                      className="custom-filter__select"
                      value={row.field}
                      onChange={(event) =>
                        updateRow(index, { field: event.target.value as CustomFilterField, value: '', value2: '' })
                      }
                    >
                      {(Object.keys(CUSTOM_FILTER_FIELDS) as CustomFilterField[]).map((key) => {
                        const meta = CUSTOM_FILTER_FIELDS[key]
                        return (
                          <option key={key} value={key}>
                            {meta.label}
                            {meta.unit === '' ? '' : ` (${meta.unit})`}
                          </option>
                        )
                      })}
                    </select>
                    <select
                      aria-label={`比较 ${index + 1}`}
                      className="custom-filter__select custom-filter__select--op"
                      value={row.op}
                      onChange={(event) => updateRow(index, { op: event.target.value as CustomFilterOp })}
                    >
                      {(Object.keys(CUSTOM_FILTER_OPS) as CustomFilterOp[]).map((key) => (
                        <option key={key} value={key}>
                          {CUSTOM_FILTER_OPS[key]}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`值 ${index + 1}`}
                      className="custom-filter__input"
                      type={isDate(row.field) ? 'date' : 'number'}
                      min={isDate(row.field) ? undefined : 0}
                      value={row.value}
                      onChange={(event) => updateRow(index, { value: event.target.value })}
                    />
                    {row.op === 'between' && (
                      <input
                        aria-label={`至 ${index + 1}`}
                        className="custom-filter__input"
                        type={isDate(row.field) ? 'date' : 'number'}
                        min={isDate(row.field) ? undefined : 0}
                        value={row.value2}
                        onChange={(event) => updateRow(index, { value2: event.target.value })}
                      />
                    )}
                    <button
                      type="button"
                      className="filter-dialog__link filter-dialog__link--danger"
                      disabled={rows.length <= 1}
                      onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
              <p className="filter-dialog__and-hint">
                <span className="filter-dialog__and-dot" />
                多个条件同时满足（AND）
              </p>
            </div>
            {error !== null && <p className="custom-filter__error">{error}</p>}
            <div className="filter-dialog__footer filter-dialog__footer--edit">
              <button type="button" className="delete-activities__button" onClick={() => setMode('list')}>
                取消
              </button>
              <button type="button" className="filter-dialog__apply" onClick={handleSave}>
                保存
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default CustomFilterDialog
