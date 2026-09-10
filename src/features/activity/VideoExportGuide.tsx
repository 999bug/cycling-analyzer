/**
 * 录制前引导层：在真正触发屏幕共享授权前，先让用户明白「接下来会发生什么」。
 *
 * 背景：屏幕共享是浏览器的权限弹窗，若用户没留意页面上那句小字说明，
 * 会完全摸不着头脑、甚至误以为页面卡死。所以这里用一整屏说清楚：
 *   1. 即将弹出「共享当前标签页」的授权窗口，选它才能录到真实地图画面；
 *   2. 录制期间会全屏黑底 + 居中竖屏画框自动播放，别切换标签页；
 *   3. 两个明确选择：「开始录制」（走真实页面）或「不用授权，改用内置绘制」。
 *
 * 只做引导与派发，不碰录制本身（录制逻辑在 ActivityDetailPage 的 handleExportVideo）。
 */
import './videoExportGuide.css'

/**
 * 引导层属性。
 */
interface VideoExportGuideProps {
  /** 当前环境是否支持屏幕共享（不支持时主按钮不可用，只留内置绘制） */
  canCapture: boolean

  /** 是否正在录制（期间只展示进度，不响应操作） */
  exporting: boolean

  /** 录制进度文案（录制中显示） */
  progressLabel?: string

  /** 关闭回调（取消） */
  onClose: () => void

  /** 「开始录制」回调（走真实页面录制） */
  onRecord: () => void

  /** 「不用授权，改用内置绘制」回调 */
  onBuiltin: () => void
}

/**
 * 录制前引导层（全屏遮罩 + 居中说明卡）。
 *
 * @param props 组件参数
 */
function VideoExportGuide({
  canCapture,
  exporting,
  progressLabel,
  onClose,
  onRecord,
  onBuiltin,
}: VideoExportGuideProps) {
  return (
    <div
      className="video-export-guide-overlay"
      onClick={exporting ? undefined : onClose}
      data-testid="video-export-guide"
    >
      <div
        className="video-export-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="video-export-guide-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="video-export-guide__head">
          <h2 id="video-export-guide-title" className="video-export-guide__title">
            准备生成回放视频
          </h2>
          {!exporting && (
            <button
              type="button"
              className="video-export-guide__close"
              aria-label="关闭"
              onClick={onClose}
            >
              ×
            </button>
          )}
        </div>

        {exporting ? (
          <div className="video-export-guide__progress" role="status">
            <span className="video-export-guide__dot" aria-hidden="true" />
            {progressLabel ?? '录制中…'}
            <p className="video-export-guide__progress-tip">
              正在录制，请保持当前标签页在前台，不要切换或最小化。
            </p>
          </div>
        ) : (
          <>
            <ol className="video-export-guide__steps">
              <li>点「开始录制」后，浏览器顶部会弹出授权窗口，请选择「当前标签页」。</li>
              <li>随后页面会全屏黑底、居中竖屏画框自动播放你的轨迹，全程无需手动操作。</li>
              <li>录完自动下载成片；中途可点浏览器提示条上的「停止共享」立即结束。</li>
            </ol>

            <div className="video-export-guide__actions">
              <button
                type="button"
                className="video-export-guide__btn video-export-guide__btn--primary"
                onClick={onRecord}
                disabled={!canCapture}
                title={
                  canCapture
                    ? '授权共享当前标签页，录制真实地图画面'
                    : '当前浏览器不支持屏幕共享，请改用内置绘制'
                }
              >
                开始录制
              </button>
              <button
                type="button"
                className="video-export-guide__btn video-export-guide__btn--ghost"
                onClick={onBuiltin}
              >
                不用授权，改用内置绘制
              </button>
            </div>

            {!canCapture && (
              <p className="video-export-guide__warning">
                当前浏览器不支持屏幕共享，将自动改用内置绘制方式（画不出真实地图控件，但无需授权）。
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default VideoExportGuide
