/**
 * 回放视频导出选项面板（方案 B：点击按钮先出面板，再按所选参数生成）。
 *
 * 分五组：比例 / 时长 / 底图 / 字幕 / 操作，默认 9:16 竖屏 + 30 秒 + 跟随当前底图 + 双字幕都开。
 * 选项的数据模型与本地记忆见 `videoExportSettings.ts`（本文件只导出组件）。
 *
 * 只负责收集选项并回调父组件，不直接触发导出——录制期间父组件要显示进度并禁用重复点击。
 */
import { useEffect, useRef, useState } from 'react'
import {
  ASPECT_OPTIONS,
  DURATION_OPTIONS,
  MAP_MODE_OPTIONS,
  loadVideoExportSettings,
  storeVideoExportSettings,
  type VideoExportSettings,
} from '@/features/activity/videoExportSettings'
import './videoExportDialog.css'

/** 选中态追加的修饰类名 */
const ACTIVE_CLASS = 'video-export__option video-export__option--active'

/** 未选中态的类名 */
const IDLE_CLASS = 'video-export__option'

/**
 * 导出选项面板属性。
 */
interface VideoExportDialogProps {
  /** 是否正在录制（期间禁用一切交互，仅展示进度） */
  exporting: boolean

  /** 录制进度文案（如「录制中 4/30 秒」） */
  progressLabel?: string

  /** 关闭回调（取消 / 遮罩 / Esc） */
  onClose: () => void

  /** 点击「生成」回调（携带当前选项） */
  onConfirm: (settings: VideoExportSettings) => void
}

/**
 * 导出选项面板（弹窗，遵循站点 modal 约定：overlay + role=dialog + aria-modal，Esc / 遮罩关闭）。
 *
 * @param props 组件参数
 */
function VideoExportDialog({ exporting, progressLabel, onClose, onConfirm }: VideoExportDialogProps) {
  const [settings, setSettings] = useState<VideoExportSettings>(loadVideoExportSettings)
  const confirmRef = useRef<HTMLButtonElement>(null)

  // Esc 关闭（录制中不响应，避免半截文件）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, exporting])

  // 打开即聚焦「生成」按钮（键盘用户少按一次 Tab）
  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  /** 合并更新单项选项 */
  function update(patch: Partial<VideoExportSettings>) {
    setSettings((previous) => ({ ...previous, ...patch }))
  }

  /** 生成：先记忆选项再回调（取消不会污染记忆） */
  function handleConfirm() {
    storeVideoExportSettings(settings)
    onConfirm(settings)
  }

  return (
    <div
      className="video-export-overlay"
      onClick={exporting ? undefined : onClose}
      data-testid="video-export-overlay"
    >
      <div
        className="video-export"
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-export-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="video-export__head">
          <div>
            <h2 id="video-export-title" className="video-export__title">
              导出回放视频
            </h2>
            <p className="video-export__subtitle">
              真实地图底图逐帧录制，含已走轨迹高亮、实时数据牌与中文字幕
            </p>
          </div>
          <button
            type="button"
            className="video-export__close"
            aria-label="关闭导出面板"
            onClick={onClose}
            disabled={exporting}
          >
            ×
          </button>
        </div>

        <div className="video-export__body">
          <fieldset className="video-export__group" disabled={exporting}>
            <legend className="video-export__legend">比例</legend>
            <div className="video-export__options">
              {ASPECT_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={settings.aspectRatio === option.value ? ACTIVE_CLASS : IDLE_CLASS}
                >
                  <input
                    type="radio"
                    name="video-export-aspect"
                    value={option.value}
                    checked={settings.aspectRatio === option.value}
                    onChange={() => update({ aspectRatio: option.value })}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="video-export__group" disabled={exporting}>
            <legend className="video-export__legend">时长</legend>
            <div className="video-export__options">
              {DURATION_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={settings.duration === option.value ? ACTIVE_CLASS : IDLE_CLASS}
                >
                  <input
                    type="radio"
                    name="video-export-duration"
                    value={option.value}
                    checked={settings.duration === option.value}
                    onChange={() => update({ duration: option.value })}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="video-export__group" disabled={exporting}>
            <legend className="video-export__legend">底图</legend>
            <div className="video-export__options">
              {MAP_MODE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={settings.mapMode === option.value ? ACTIVE_CLASS : IDLE_CLASS}
                >
                  <input
                    type="radio"
                    name="video-export-map-mode"
                    value={option.value}
                    checked={settings.mapMode === option.value}
                    onChange={() => update({ mapMode: option.value })}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="video-export__group" disabled={exporting}>
            <legend className="video-export__legend">字幕</legend>
            <div className="video-export__options">
              <label className={settings.hook ? ACTIVE_CLASS : IDLE_CLASS}>
                <input
                  type="checkbox"
                  checked={settings.hook}
                  onChange={(event) => update({ hook: event.target.checked })}
                />
                <span>开头钩子</span>
              </label>
              <label className={settings.dataLine ? ACTIVE_CLASS : IDLE_CLASS}>
                <input
                  type="checkbox"
                  checked={settings.dataLine}
                  onChange={(event) => update({ dataLine: event.target.checked })}
                />
                <span>数据行</span>
              </label>
            </div>
          </fieldset>
        </div>

        <div className="video-export__footer">
          {exporting && (
            <span className="video-export__progress" role="status">
              {progressLabel ?? '录制中…'}
            </span>
          )}
          <button
            type="button"
            className="video-export__btn video-export__btn--ghost"
            onClick={onClose}
            disabled={exporting}
          >
            取消
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="video-export__btn video-export__btn--primary"
            onClick={handleConfirm}
            disabled={exporting}
          >
            {exporting ? '录制中…' : '生成'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default VideoExportDialog
