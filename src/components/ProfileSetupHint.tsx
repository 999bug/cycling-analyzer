/**
 * 训练配置缺失提示条。
 *
 * 规格 §26 要求「无配置不伪造计算」，于是依赖 FTP / 最大心率的区块在配置缺失时
 * 返回空结果。空结果必须配上说明，否则用户只看到区块凭空消失、无从下手——
 * 本组件统一承担「缺什么 + 去哪设置」的引导口径。
 *
 * 作者数据源强制读快照 profile（`features/settings/effectiveProfile`），
 * 此时让用户改本地设置属于无效指引，故作者源只说明原因、不给跳转链接。
 */
import { Link } from 'react-router-dom'
import type { DataSource } from '@/stores/dataSourceStore'
import '@/components/ProfileSetupHint.css'

/** 依赖训练配置的字段 */
export type ProfileField = 'ftp' | 'maxHeartRate'

/**
 * 本地源提示文案：缺什么 + 因此看不到什么（中英混排的空格按文案固定，不用拼接）。
 */
const HINT_TEXTS: Readonly<Record<ProfileField, string>> = {
  ftp: '未设置 FTP，功率区间与 IF/TSS 无法计算。',
  maxHeartRate: '未设置最大心率，心率区间无法计算。',
}

/**
 * 作者源提示文案：profile 来自快照，改本地设置不会生效，故只说明原因。
 */
const AUTHOR_HINT_TEXTS: Readonly<Record<ProfileField, string>> = {
  ftp: '作者数据未提供 FTP，功率区间与 IF/TSS 无法计算。',
  maxHeartRate: '作者数据未提供最大心率，心率区间无法计算。',
}

/** 设置页「个人信息」区块锚点（SettingsPage 按 URL hash 选中区块） */
const PROFILE_SETTINGS_PATH = '/settings#settings-profile'

interface ProfileSetupHintProps {
  /** 缺失的训练配置字段 */
  field: ProfileField

  /** 当前数据源（作者源的 profile 来自快照，改本地设置无效） */
  source: DataSource
}

/**
 * 训练配置缺失提示条。
 *
 * @param props 组件参数
 */
function ProfileSetupHint({ field, source }: ProfileSetupHintProps) {
  // 整句文案（而非 JSX 插值）：保证是一个连续文本节点，便于阅读与测试断言
  if (source === 'author') {
    return (
      <p className="profile-setup-hint" role="status">
        {AUTHOR_HINT_TEXTS[field]}
      </p>
    )
  }
  return (
    <p className="profile-setup-hint" role="status">
      {HINT_TEXTS[field]}
      <Link className="profile-setup-hint__link" to={PROFILE_SETTINGS_PATH}>
        去「更多 → 个人信息」填写
      </Link>
    </p>
  )
}

export default ProfileSetupHint
