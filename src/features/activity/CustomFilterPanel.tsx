/**
 * 自定义筛选面板（列表页，规格外增强）。
 *
 * 两行布局：
 * - 构建行：字段 + 操作符（大于/等于/小于/介于）+ 数值（between 出现第二个输入框）
 *   + 添加条件 + 保存为预设（编辑态：保存修改/另存为新预设/退出编辑）
 * - 预设行：已保存预设下拉（套用即进入编辑）+ 删除选中预设
 *
 * 已生效条件 chips 由父组件（ActivityFilters 主筛选栏）展示在类型下拉右侧；
 * 本组件只负责条件构建与预设管理。预设名默认按条件自动生成，用户可手动修改。
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

/** 解析错误 → 用户提示文案 */
const PARSE_ERROR_TEXT: Record<string, string> = {
  empty: '请输入筛选数值或选择日期',
  'invalid-number': '请输入有效数值（非负数字）',
  'invalid-order': '区间下限不能大于上限（或起始日期晚于结束日期）',
  'missing-value2': '介于需要输入区间上限（或结束日期）',
}

interface CustomFilterPanelProps {
  /** 当前生效条件（chips 由父组件渲染，这里用于默认预设名与编辑回显） */
  conditions: CustomFilterCondition[]

  /** 已保存预设（名字 → 条件列表） */
  presets: Record<string, CustomFilterCondition[]>

  /** 正在编辑的预设名（null = 新建模式） */
  editingPreset: string | null

  /** 添加条件（传入规范化条件；解析校验在本组件完成） */
  onAdd: (condition: CustomFilterCondition) => void

  /** 保存预设（编辑改名时由父组件处理旧名清理） */
  onSavePreset: (name: string, conditions: CustomFilterCondition[]) => void

  /** 另存为新预设（父组件处理同名确认） */
  onSavePresetAs: (name: string, conditions: CustomFilterCondition[]) => void

  /** 删除预设 */
  onDeletePreset: (name: string) => void

  /** 套用预设（父组件会同时进入该预设编辑态） */
  onApplyPreset: (name: string) => void

  /** 退出编辑 */
  onExitEdit: () => void
}

/**
 * 自定义筛选面板。
 */
function CustomFilterPanel({
  conditions,
  presets,
  editingPreset,
  onAdd,
  onSavePreset,
  onSavePresetAs,
  onDeletePreset,
  onApplyPreset,
  onExitEdit,
}: CustomFilterPanelProps) {
  const [field, setField] = useState<CustomFilterField>('distance')
  const [op, setOp] = useState<CustomFilterOp>('gt')
  const [value, setValue] = useState('')
  const [value2, setValue2] = useState('')
  const [error, setError] = useState<string | null>(null)
  // 预设下拉当前选中名（供「删除选中预设」使用）
  const [selectedPreset, setSelectedPreset] = useState('')
  // 预设名输入（保存为预设/编辑态显示，默认按条件自动生成，可手动改）
  const [showNameInput, setShowNameInput] = useState(false)
  const [presetName, setPresetName] = useState('')
  // 名字输入对应的保存模式（save = 覆盖/改名保存，save-as = 另存新预设），与打开入口一致
  const [nameInputMode, setNameInputMode] = useState<'save' | 'save-as'>('save')

  const isDate = CUSTOM_FILTER_FIELDS[field].isDate === true
  const isBetween = op === 'between'

  /** 切换字段：日期字段输入框切 date 类型，清空无效残留 */
  function handleFieldChange(next: CustomFilterField) {
    setField(next)
    setValue('')
    setValue2('')
    setError(null)
  }

  /** 添加条件：解析校验通过后上抛并清空输入 */
  function handleAdd() {
    const result = parseCustomFilterCondition(field, op, value, value2)
    if (!result.ok) {
      setError(PARSE_ERROR_TEXT[result.error] ?? '输入无效')
      return
    }
    setError(null)
    onAdd(result.condition)
    setValue('')
    setValue2('')
  }

  /** 打开预设名输入：新建用条件自动生成的默认名，编辑态预填当前预设名 */
  function handleOpenNameInput(mode: 'save' | 'save-as') {
    setPresetName(mode === 'save' && editingPreset ? editingPreset : defaultPresetName(conditions))
    setNameInputMode(mode)
    setShowNameInput(true)
  }

  /** 确认保存：按打开入口分发（save = 覆盖/改名，save-as = 另存新预设，同名由父组件确认） */
  function handleConfirmSave() {
    const name = presetName.trim()
    if (name === '') {
      setError('请输入预设名称')
      return
    }
    if (conditions.length === 0) {
      setError('当前没有生效的筛选条件')
      return
    }
    setShowNameInput(false)
    setError(null)
    if (nameInputMode === 'save-as') {
      onSavePresetAs(name, conditions)
    } else {
      onSavePreset(name, conditions)
    }
  }

  /** 预设下拉选中即套用（父组件进入编辑态）并记住选中名供删除用 */
  function handlePresetChange(name: string) {
    setSelectedPreset(name)
    if (name !== '') {
      onApplyPreset(name)
    }
  }

  return (
    <div className="custom-filter">
      <div className="custom-filter__builder">
        <span className="custom-filter__label">＋ 自定义筛选</span>
        <label className="custom-filter__field" htmlFor="custom-filter-field">
          字段
          <select
            id="custom-filter-field"
            className="custom-filter__select"
            value={field}
            onChange={(event) => handleFieldChange(event.target.value as CustomFilterField)}
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
        </label>
        <label className="custom-filter__field" htmlFor="custom-filter-op">
          条件
          <select
            id="custom-filter-op"
            className="custom-filter__select custom-filter__select--op"
            value={op}
            onChange={(event) => {
              setOp(event.target.value as CustomFilterOp)
              setError(null)
            }}
          >
            {(Object.keys(CUSTOM_FILTER_OPS) as CustomFilterOp[]).map((key) => (
              <option key={key} value={key}>
                {CUSTOM_FILTER_OPS[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="custom-filter__field" htmlFor="custom-filter-value">
          <span>{isBetween ? (isDate ? '起始日期' : '数值') : isDate ? '日期' : '数值'}</span>
          <input
            id="custom-filter-value"
            className="custom-filter__input"
            type={isDate ? 'date' : 'number'}
            min={isDate ? undefined : 0}
            placeholder={isDate ? '' : '如 25'}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        {isBetween && (
          <label className="custom-filter__field" htmlFor="custom-filter-value2">
            <span>{isDate ? '结束日期' : '至'}</span>
            <input
              id="custom-filter-value2"
              className="custom-filter__input"
              type={isDate ? 'date' : 'number'}
              min={isDate ? undefined : 0}
              placeholder={isDate ? '' : '如 40'}
              value={value2}
              onChange={(event) => setValue2(event.target.value)}
            />
          </label>
        )}
        <button type="button" className="custom-filter__button custom-filter__button--primary" onClick={handleAdd}>
          添加条件
        </button>
        {editingPreset ? (
          <>
            <button
              type="button"
              className="custom-filter__button"
              onClick={() => (showNameInput ? handleConfirmSave() : handleOpenNameInput('save'))}
            >
              保存修改「{editingPreset}」
            </button>
            <button
              type="button"
              className="custom-filter__button"
              onClick={() => (showNameInput ? handleConfirmSave() : handleOpenNameInput('save-as'))}
            >
              另存为新预设
            </button>
            <button type="button" className="custom-filter__button custom-filter__button--ghost" onClick={onExitEdit}>
              退出编辑
            </button>
          </>
        ) : (
          <button
            type="button"
            className="custom-filter__button"
            onClick={() => (showNameInput ? handleConfirmSave() : handleOpenNameInput('save'))}
          >
            保存为预设
          </button>
        )}
        <span className="custom-filter__hint">
          多个条件同时生效（且关系）；选「介于」后输入区间；条件保存为预设后刷新页面仍可用
        </span>
      </div>

      {showNameInput && (
        <div className="custom-filter__builder custom-filter__name-row">
          <label className="custom-filter__field" htmlFor="custom-filter-preset-name">
            预设名称
            <input
              id="custom-filter-preset-name"
              className="custom-filter__input custom-filter__input--name"
              type="text"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="custom-filter__button custom-filter__button--primary"
            onClick={handleConfirmSave}
          >
            保存
          </button>
          <button
            type="button"
            className="custom-filter__button custom-filter__button--ghost"
            onClick={() => setShowNameInput(false)}
          >
            取消
          </button>
        </div>
      )}

      {error !== null && <p className="custom-filter__error">{error}</p>}

      <div className="custom-filter__presets">
        <span className="custom-filter__presets-label">已保存的筛选预设</span>
        <select
          id="custom-filter-preset-select"
          aria-label="选择筛选预设"
          className="custom-filter__select"
          value={selectedPreset}
          onChange={(event) => handlePresetChange(event.target.value)}
        >
          <option value="">— 选择预设快速套用 —</option>
          {Object.keys(presets).map((name) => (
            <option key={name} value={name}>
              {name}（{presets[name].length} 个条件）
            </option>
          ))}
        </select>
        <button
          type="button"
          className="custom-filter__button custom-filter__button--ghost"
          onClick={() => {
            if (selectedPreset === '' || presets[selectedPreset] === undefined) {
              setError('请先在下拉中选择要删除的预设')
              return
            }
            onDeletePreset(selectedPreset)
            setSelectedPreset('')
            setError(null)
          }}
        >
          删除选中预设
        </button>
        <span className="custom-filter__hint">套用预设后可增删条件并保存修改（支持改名或另存）</span>
      </div>

      {editingPreset !== null && (
        <p className="custom-filter__editing">
          正在编辑预设「{editingPreset}」：
          {conditions.length > 0 ? conditions.map(describeCondition).join(' 且 ') : '（无条件，可添加后保存）'}
        </p>
      )}
    </div>
  )
}

export default CustomFilterPanel
