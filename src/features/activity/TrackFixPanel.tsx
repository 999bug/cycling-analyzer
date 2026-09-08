/**
 * 轨迹纠偏面板（详情页地图工具条入口）。
 *
 * 解决国内运动 App（行者 / Keep / 咕咚等）导出的 GPX 坐标系为 GCJ-02 / BD-09，
 * 被本站按 WGS-84 处理后整体偏移数百米的问题。
 *
 * 交互模型：
 * - UI 上选「从哪个软件导出的」（用户认知），内部映射到坐标系（下拉项标注默认系）；
 * - 选择即时预览：父级把预览参数下发给 ActivityMap，主轨迹实时重绘、
 *   灰虚线为纠偏前位置，肉眼确认再保存；
 * - 四向 ±10m 微调兜底来源未知 / 非标准偏移的场景；
 * - 保存只改标记（coordinateSystem / sourceApp / trackOffset），逐点原始坐标不动，
 *   因此任意次来回切换都严格还原、零误差累积。
 */
import { useEffect, useRef, useState } from 'react'
import type { CoordinateSystem } from '@/geo/coordinateSystem'
import type { TrackOffset } from '@/types/activity'
import {
  COORDINATE_SYSTEM_LABELS,
  groupSourcesBySystem,
  sourceProfileById,
} from '@/geo/sourceProfiles'

/** 单次微调步长（米） */
const OFFSET_STEP_M = 10

/** 微调量显示上限（米），防误触狂点后难以回退（可用「重置」一键归零） */
const OFFSET_LIMIT_M = 500

/** 纠偏预览参数（父级下发给 ActivityMap 渲染主轨迹与对比线） */
export interface TrackFixPreview {
  coordinateSystem: CoordinateSystem
  sourceApp?: string
  trackOffset?: TrackOffset
}

/** 纠偏面板 props */
export interface TrackFixPanelProps {
  /** 已保存的原始来源（详情页 activity.sourceApp） */
  sourceApp?: string

  /** 已保存的坐标系（缺省 wgs84，即未标记的历史数据） */
  coordinateSystem: CoordinateSystem

  /** 已保存的手动微调量 */
  trackOffset?: TrackOffset

  /** 选择 / 微调变化时上报预览参数（父级须传稳定引用，如 useCallback） */
  onPreviewChange: (preview: TrackFixPreview) => void

  /** 保存纠偏结果（父级负责落库 + 刷新活动摘要状态） */
  onSave: (patch: {
    coordinateSystem: CoordinateSystem
    sourceApp?: string
    trackOffset?: TrackOffset
  }) => Promise<void>

  /** 关闭面板（父级负责清除预览状态） */
  onClose: () => void
}

/**
 * 轨迹纠偏面板。
 */
export default function TrackFixPanel({
  sourceApp,
  coordinateSystem,
  trackOffset,
  onPreviewChange,
  onSave,
  onClose,
}: TrackFixPanelProps) {
  // 当前选中的来源（默认为已保存来源对应的画像）
  const [selectedId, setSelectedId] = useState<string>(() => sourceProfileById(sourceApp).id)
  // 手动微调净值（米）
  const [offset, setOffset] = useState<TrackOffset>({
    northMeters: trackOffset?.northMeters ?? 0,
    eastMeters: trackOffset?.eastMeters ?? 0,
  })
  const [saving, setSaving] = useState(false)

  const selectedProfile = sourceProfileById(selectedId === 'unknown' ? undefined : selectedId)

  // 预览回调经 ref 转发：效果只依赖用户可感知的选择/微调，父级回调引用变化不重复上报
  const previewCbRef = useRef(onPreviewChange)
  useEffect(() => {
    previewCbRef.current = onPreviewChange
  }, [onPreviewChange])

  // 选择 / 微调即时生效到地图预览：选中画像的坐标系 + 当前微调量
  useEffect(() => {
    const hasOffset = offset.northMeters !== 0 || offset.eastMeters !== 0
    previewCbRef.current({
      coordinateSystem: selectedProfile.coordinateSystem,
      sourceApp: selectedProfile.id === 'unknown' ? undefined : selectedProfile.id,
      trackOffset: hasOffset ? { ...offset } : undefined,
    })
    // selectedProfile 由 selectedId 派生，无需单列依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, offset])

  /** 微调一个方向（dir 带 ±号），钳位在 ±OFFSET_LIMIT_M */
  function nudge(dir: 1 | -1, axis: 'northMeters' | 'eastMeters') {
    setOffset((prev) => {
      const next = Math.max(-OFFSET_LIMIT_M, Math.min(OFFSET_LIMIT_M, prev[axis] + dir * OFFSET_STEP_M))
      return { ...prev, [axis]: next }
    })
  }

  /** 保存：坐标系 + 来源 + 微调一次落库 */
  async function handleSave() {
    if (saving) {
      return
    }
    setSaving(true)
    try {
      const hasOffset = offset.northMeters !== 0 || offset.eastMeters !== 0
      await onSave({
        coordinateSystem: selectedProfile.coordinateSystem,
        sourceApp: selectedProfile.id === 'unknown' ? undefined : selectedProfile.id,
        trackOffset: hasOffset ? { ...offset } : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  const groups = groupSourcesBySystem()
  const offsetDirty = offset.northMeters !== 0 || offset.eastMeters !== 0
  const systemChanged = selectedProfile.id === 'unknown'
    ? coordinateSystem !== 'wgs84'
    : selectedProfile.coordinateSystem !== coordinateSystem

  return (
    <div className="track-fix-panel" role="dialog" aria-label="轨迹纠偏">
      <div className="track-fix-panel__header">
        <h3>轨迹纠偏</h3>
        <button type="button" className="track-fix-panel__close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>

      <label className="track-fix-panel__field">
        <span>数据来自哪个 App？</span>
        <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="unknown">未知来源（按 GPS 真值处理）</option>
          {groups.map((group) => (
            <optgroup key={group.system} label={COORDINATE_SYSTEM_LABELS[group.system]}>
              {group.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label} · 默认 {profile.coordinateSystem.toUpperCase()}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="track-fix-panel__hint">
        {systemChanged ? '选择后地图立即预览，确认轨迹压在路面上再保存' : '与当前设置一致，无需纠偏'}
      </p>

      <div className="track-fix-panel__offset">
        <span className="track-fix-panel__offset-label">手动微调（{OFFSET_STEP_M} 米/次）</span>
        <div className="track-fix-panel__offset-pad">
          <button type="button" onClick={() => nudge(1, 'northMeters')} title={`向北 ${OFFSET_STEP_M}m`}>↑</button>
          <div className="track-fix-panel__offset-mid">
            <button type="button" onClick={() => nudge(-1, 'eastMeters')} title={`向西 ${OFFSET_STEP_M}m`}>←</button>
            <button type="button" onClick={() => nudge(1, 'eastMeters')} title={`向东 ${OFFSET_STEP_M}m`}>→</button>
          </div>
          <button type="button" onClick={() => nudge(-1, 'northMeters')} title={`向南 ${OFFSET_STEP_M}m`}>↓</button>
        </div>
        <div className="track-fix-panel__offset-info">
          <span>N {offset.northMeters >= 0 ? '+' : ''}{offset.northMeters}</span>
          <span>E {offset.eastMeters >= 0 ? '+' : ''}{offset.eastMeters}</span>
          <button
            type="button"
            className="track-fix-panel__reset"
            onClick={() => setOffset({ northMeters: 0, eastMeters: 0 })}
            disabled={!offsetDirty}
          >
            重置
          </button>
        </div>
      </div>

      <div className="track-fix-panel__actions">
        <button type="button" onClick={onClose}>取消</button>
        <button type="button" className="track-fix-panel__save" onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '保存纠偏'}
        </button>
      </div>
    </div>
  )
}
