/**
 * 回放视频导出选项面板（方案 B：点击按钮先出面板，再按所选参数生成）。
 *
 * 分五组：比例 / 时长 / 底图 / 字幕 / 操作，默认 9:16 竖屏 + 30 秒 + 跟随当前底图 + 双字幕都开。
 * 字幕文案可改：打开时预填「按当前活动自动生成」的文案，用户改过的内容会记住，
 * 清空输入框即恢复自动生成（存储里记空串，见 videoExportSettings.ts）。
 * 选项的数据模型与本地记忆见 `videoExportSettings.ts`（本文件只导出组件）。
 *
 * 只负责收集选项并回调父组件，不直接触发导出——录制期间父组件要显示进度并禁用重复点击。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ASPECT_OPTIONS,
  CAPTION_TEXT_MAX_LENGTH,
  DURATION_OPTIONS,
  MAP_MODE_OPTIONS,
  loadVideoExportSettings,
  storeVideoExportSettings,
  type VideoCaptionData,
  type VideoExportSettings,
} from '@/features/activity/videoExportSettings'
import { buildVideoCaptionTexts, resolveVideoDuration } from '@/features/activity/trackVideoExport'
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

  /** 上一次导出的结果提示（如「录制已中断」）；无提示时不渲染 */
  notice?: string

  /** 字幕自动文案的数据源（活动真实数据，供输入框预填与「留空即自动」） */
  captionData?: VideoCaptionData

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
function VideoExportDialog({
  exporting,
  progressLabel,
  notice,
  captionData,
  onClose,
  onConfirm,
}: VideoExportDialogProps) {
  const [settings, setSettings] = useState<VideoExportSettings>(loadVideoExportSettings)
  const confirmRef = useRef<HTMLButtonElement>(null)

  // 自动文案：按当前活动数据 + 当前时长档位推导（倍速行里含时长换算，故随时长变化）
  const durationSeconds = resolveVideoDuration(settings.duration, captionData?.distanceMeters)
  const autoTexts = useMemo(() => {
    const texts = buildVideoCaptionTexts({
      distanceMeters: captionData?.distanceMeters,
      elevationGainMeters: captionData?.elevationGainMeters,
      movingSeconds: captionData?.movingSeconds,
      videoSeconds: durationSeconds,
      showHook: true,
      showDataLine: true,
    })
    return {
      hook: (texts.hook ?? []).join('\n'),
      dataLine: (texts.dataLine ?? []).join('\n'),
    }
  }, [
    captionData?.distanceMeters,
    captionData?.elevationGainMeters,
    captionData?.movingSeconds,
    durationSeconds,
  ])

  /**
   * 字幕输入框的「编辑态」：undefined = 未改过（值跟随自动文案），string = 用户输入/记忆的值。
   *
   * 用「派生值 + 可空编辑态」而不是 effect 同步：既避免级联渲染（项目约定），
   * 又让清空输入框（''）不会回弹成自动文案，用户能顺畅从零重写。
   */
  const [hookEdit, setHookEdit] = useState<string | undefined>(
    settings.hookText === '' ? undefined : settings.hookText,
  )
  const [dataLineEdit, setDataLineEdit] = useState<string | undefined>(
    settings.dataLineText === '' ? undefined : settings.dataLineText,
  )
  const hookText = hookEdit ?? autoTexts.hook
  const dataLineText = dataLineEdit ?? autoTexts.dataLine

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

  /**
   * 生成：先记忆选项再回调（取消不会污染记忆）。
   *
   * 自定义文案与「自动文案」完全一致时按空串存储（= 没自定义）——否则换个活动后
   * 会把上个活动的里程数字带过去，用户会看到串味的文案。
   */
  function handleConfirm() {
    const next: VideoExportSettings = {
      ...settings,
      hookText: hookEdit === undefined || hookText === autoTexts.hook ? '' : hookText,
      dataLineText:
        dataLineEdit === undefined || dataLineText === autoTexts.dataLine ? '' : dataLineText,
    }
    storeVideoExportSettings(next)
    onConfirm(next)
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

            {settings.hook && (
              <div className="video-export__caption">
                <label className="video-export__caption-label" htmlFor="video-export-hook-text">
                  钩子文案（前 4 秒，每行一条）
                </label>
                <textarea
                  id="video-export-hook-text"
                  className="video-export__textarea"
                  rows={2}
                  maxLength={CAPTION_TEXT_MAX_LENGTH}
                  placeholder="留空则不显示开头钩子"
                  value={hookText}
                  onChange={(event) => setHookEdit(event.target.value)}
                />
                {hookEdit !== undefined && (
                  <button
                    type="button"
                    className="video-export__reset"
                    onClick={() => setHookEdit(undefined)}
                  >
                    恢复默认文案
                  </button>
                )}
              </div>
            )}

            {settings.dataLine && (
              <div className="video-export__caption">
                <label className="video-export__caption-label" htmlFor="video-export-data-text">
                  数据行文案（全程显示，每行一条）
                </label>
                <textarea
                  id="video-export-data-text"
                  className="video-export__textarea"
                  rows={2}
                  maxLength={CAPTION_TEXT_MAX_LENGTH}
                  placeholder="留空则不显示数据行"
                  value={dataLineText}
                  onChange={(event) => setDataLineEdit(event.target.value)}
                />
                {dataLineEdit !== undefined && (
                  <button
                    type="button"
                    className="video-export__reset"
                    onClick={() => setDataLineEdit(undefined)}
                  >
                    恢复默认文案
                  </button>
                )}
              </div>
            )}
          </fieldset>

          <p className="video-export__hint">
            <strong>接下来会先弹出一个说明页</strong>，讲清楚怎么授权；点其中的「开始录制」后，
            浏览器会再弹出共享窗口——请选择<strong>「当前标签页」</strong>，录制才能取到真实地图画面
            （含真实控件与回放控制栏），观感与录屏一致。也可以直接选「不用授权，改用内置绘制」。
          </p>
        </div>

        <div className="video-export__footer">
          {exporting && (
            <span className="video-export__progress" role="status">
              {progressLabel ?? '录制中…'}
            </span>
          )}
          {!exporting && notice !== undefined && (
            <span className="video-export__notice" role="status">
              {notice}
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
