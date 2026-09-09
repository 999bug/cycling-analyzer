/**
 * 数据来源选择下拉（轨迹纠偏共享组件）。
 *
 * 面板（单条纠偏）与批量纠偏弹窗共用：按坐标系 optgroup 分组，
 * 每项标注「App 名 · 默认坐标系」，用户无需理解坐标系概念。
 * 首项为「未知来源」（按 WGS-84 GPS 真值处理）。
 */
import { COORDINATE_SYSTEM_LABELS, groupSourcesBySystem } from '@/geo/sourceProfiles'

/** 来源下拉属性 */
export interface SourceSelectProps {
  /** 当前选中来源 ID（'unknown'、来源画像 ID，或提供 autoOption 时的 'auto'） */
  value: string

  /** 选择变化回调（值 = 来源 ID 或 'auto'） */
  onChange: (id: string) => void

  /** 无障碍标签（label 文本） */
  label: string

  /** 禁用（批量操作进行中） */
  disabled?: boolean

  /** 提供时在首位追加「自动识别」选项（值为 'auto'），文案即选项文字 */
  autoOption?: string
}

/**
 * 数据来源选择下拉。
 */
export default function SourceSelect({ value, onChange, label, disabled = false, autoOption }: SourceSelectProps) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {autoOption !== undefined && <option value="auto">{autoOption}</option>}
      <option value="unknown">未知来源（按 GPS 真值处理）</option>
      {groupSourcesBySystem().map((group) => (
        <optgroup key={group.system} label={COORDINATE_SYSTEM_LABELS[group.system]}>
          {group.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label} · 默认 {profile.coordinateSystem.toUpperCase()}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
