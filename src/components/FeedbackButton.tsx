/**
 * 反馈入口：右下角常驻悬浮按钮，点击打开反馈弹窗。
 *
 * 全站常驻（挂于 AppLayout），复用站点 CSS 变量，深浅主题自适应。
 * 按钮与弹窗各自独立成文件，便于测试与复用。
 */
import { useState } from 'react'
import FeedbackModal from './FeedbackModal'
import '@/components/feedback.css'

/**
 * 反馈悬浮按钮 + 弹窗容器。
 */
function FeedbackButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="feedback-fab"
        aria-label="提交反馈"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
        </svg>
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  )
}

export default FeedbackButton
