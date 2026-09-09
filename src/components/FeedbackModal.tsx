/**
 * 反馈弹窗（纯飞书表单方案）。
 *
 * 弹窗展示飞书多维表表单的二维码与公开填写链接，
 * 用户扫码或点击按钮即可填写，无需 GitHub 账户。
 * 遵循站点 modal 约定：overlay + role=dialog + aria-modal，Esc / 点击遮罩关闭。
 */
import { useEffect, useRef } from 'react'
import { FEEDBACK_FORM_URL, FEEDBACK_QR_PATH } from '@/config'

/**
 * 反馈弹窗属性。
 */
interface FeedbackModalProps {
  /** 关闭回调 */
  onClose: () => void
}

/**
 * 反馈弹窗。
 *
 * @param props 组件参数
 */
function FeedbackModal({ onClose }: FeedbackModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  // Esc 关闭 + 打开即聚焦关闭按钮（便于键盘用户）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function openForm() {
    window.open(FEEDBACK_FORM_URL, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="feedback-overlay" onClick={onClose}>
      <div
        className="feedback-modal feedback-modal--compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="feedback-modal__head">
          <h2 id="feedback-title" className="feedback-modal__title">
            意见反馈
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="feedback-modal__close"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="feedback-form-view">
          <p className="feedback-form-view__desc">
            扫码填写，或点击下方按钮在浏览器中打开飞书表单。
            <br />
            无需登录 GitHub，提交后我们会统一整理。
          </p>

          <div className="feedback-qr">
            <img
              src={FEEDBACK_QR_PATH}
              alt="飞书反馈表单二维码"
              className="feedback-qr__img"
              width={200}
              height={200}
            />
            <span className="feedback-qr__hint">手机扫码填写</span>
          </div>

          <div className="feedback-actions feedback-actions--center">
            <button type="button" className="feedback-btn feedback-btn--primary" onClick={openForm}>
              打开飞书表单
            </button>
            <button type="button" className="feedback-btn feedback-btn--ghost" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FeedbackModal
