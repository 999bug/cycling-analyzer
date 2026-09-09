/**
 * 反馈弹窗（零后端方案）：收集类型/标题/描述/联系方式，提交即打开 GitHub 预填 issue 页。
 *
 * 用户登录 GitHub 后点一次「Submit new issue」即创建 Issue——无需自建后端，国内可直连。
 * 类型自动带入对应 label；弹窗被浏览器拦截时仍提供链接兜底。
 *
 * 遵循站点 modal 约定：overlay + role=dialog + aria-modal，Esc / 点击遮罩关闭。
 */
import { useEffect, useRef, useState } from 'react'
import { FEEDBACK_REPO, FEEDBACK_TYPE_LABEL, FEEDBACK_TYPES, type FeedbackType } from '@/config'

/** 提交状态：填写中 / 已打开提交页 */
type SubmitStatus = 'form' | 'done'

/**
 * 构造 GitHub 新建 issue 的预填 URL（标题/正文/标签均已填好）。
 */
function buildIssueUrl(type: FeedbackType, title: string, description: string, contact: string): string {
  const url = new URL(`https://github.com/${FEEDBACK_REPO}/issues/new`)
  url.searchParams.set('title', `[反馈] ${title}`)
  const lines = [description, '', '---', `类型：${type}`, `版本：${__APP_VERSION__}`]
  if (contact) lines.push(`联系方式：${contact}`)
  url.searchParams.set('body', lines.join('\n'))
  url.searchParams.set('labels', FEEDBACK_TYPE_LABEL[type])
  return url.toString()
}

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
  const [type, setType] = useState<FeedbackType>('Bug 报告')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [contact, setContact] = useState('')
  const [status, setStatus] = useState<SubmitStatus>('form')
  const [issueUrl, setIssueUrl] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  // Esc 关闭 + 打开即聚焦标题
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    titleRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const canSubmit = title.trim().length > 0 && description.trim().length > 0

  function handleSubmit() {
    if (!canSubmit) {
      return
    }
    const url = buildIssueUrl(type, title.trim(), description.trim(), contact.trim())
    setIssueUrl(url)
    // 打开预填的 GitHub 新建 issue 页（弹窗被拦截时仍提供链接兜底）
    window.open(url, '_blank', 'noopener,noreferrer')
    setStatus('done')
  }

  return (
    <div className="feedback-overlay" onClick={onClose}>
      <div
        className="feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="feedback-modal__head">
          <h2 id="feedback-title" className="feedback-modal__title">
            意见反馈
          </h2>
          <button type="button" className="feedback-modal__close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        {status === 'form' ? (
          <div className="feedback-form">
            <label className="feedback-field">
              <span className="feedback-label">类型</span>
              <select
                className="feedback-input"
                value={type}
                onChange={(event) => setType(event.target.value as FeedbackType)}
              >
                {FEEDBACK_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label className="feedback-field">
              <span className="feedback-label">标题</span>
              <input
                ref={titleRef}
                className="feedback-input"
                value={title}
                placeholder="一句话概括"
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <label className="feedback-field">
              <span className="feedback-label">详细描述</span>
              <textarea
                className="feedback-input feedback-textarea"
                value={description}
                placeholder="详细描述问题或建议（可附截图链接）"
                maxLength={2000}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>

            <label className="feedback-field">
              <span className="feedback-label">联系方式（选填）</span>
              <input
                className="feedback-input"
                value={contact}
                placeholder="邮箱或其他联系方式（选填）"
                maxLength={200}
                onChange={(event) => setContact(event.target.value)}
              />
            </label>

            <p className="feedback-hint">
              提交会打开 GitHub Issues 新建页（需登录 GitHub 账号），帮助我们改进骑了么。
            </p>

            <div className="feedback-actions">
              <button type="button" className="feedback-btn feedback-btn--ghost" onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="feedback-btn feedback-btn--primary"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                提交反馈
              </button>
            </div>
          </div>
        ) : (
          <div className="feedback-result">
            <svg
              className="feedback-result__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--success)"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h3 className="feedback-result__title">已打开 GitHub 提交页</h3>
            <p className="feedback-result__desc">
              登录 GitHub 后点一次「Submit new issue」即可创建 Issue（类型标签已自动带入）。
              若未自动打开，请点击下方链接。
            </p>
            <div className="feedback-actions feedback-actions--center">
              <a
                className="feedback-btn feedback-btn--primary"
                href={issueUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                前往 GitHub 提交
              </a>
              <button type="button" className="feedback-btn feedback-btn--ghost" onClick={onClose}>
                关闭
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default FeedbackModal
