/**
 * 反馈弹窗：收集类型/标题/描述/联系方式，提交到 Cloudflare Worker 创建 GitHub Issue。
 *
 * 状态机：form -> loading -> success | error。
 * - 成功：展示新 Issue 编号与查看链接。
 * - 失败：展示错误原因，并提供「在 GitHub 手动新建 Issue」预填链接作为兜底。
 *
 * 遵循站点 modal 约定：overlay + role=dialog + aria-modal，Esc / 点击遮罩关闭。
 */
import { useEffect, useRef, useState } from 'react'
import { FEEDBACK_ENDPOINT, FEEDBACK_REPO, FEEDBACK_TYPES, type FeedbackType } from '@/config'

/** 提交状态 */
type SubmitStatus = 'form' | 'loading' | 'success' | 'error'

/** Worker 成功返回结构 */
interface SubmitResult {
  issueUrl: string
  issueNumber: number
}

/**
 * 构造 GitHub 手动新建 issue 的预填链接（兜底用）。
 */
function buildManualUrl(type: string, title: string, description: string): string {
  const url = new URL(`https://github.com/${FEEDBACK_REPO}/issues/new`)
  url.searchParams.set('title', `[反馈] ${title}`)
  url.searchParams.set('body', `${description}\n\n---\n类型：${type}\n版本：${__APP_VERSION__}`)
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
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
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

  async function handleSubmit() {
    if (!canSubmit || status === 'loading') {
      return
    }
    setStatus('loading')
    setErrorMsg('')
    const payload = {
      type,
      title: title.trim(),
      description: description.trim(),
      contact: contact.trim(),
      version: __APP_VERSION__,
      ua: navigator.userAgent,
    }
    try {
      const res = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        issueUrl?: string
        issueNumber?: number
        error?: string
      }
      if (res.ok && data.ok) {
        setResult({ issueUrl: data.issueUrl ?? '', issueNumber: data.issueNumber ?? 0 })
        setStatus('success')
      } else {
        setErrorMsg(typeof data.error === 'string' ? data.error : '提交失败，请稍后重试')
        setStatus('error')
      }
    } catch {
      setErrorMsg('网络异常，未能连接到反馈服务')
      setStatus('error')
    }
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

        {status === 'form' || status === 'loading' ? (
          <div className="feedback-form">
            <label className="feedback-field">
              <span className="feedback-label">类型</span>
              <select
                className="feedback-input"
                value={type}
                disabled={status === 'loading'}
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
                disabled={status === 'loading'}
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
                disabled={status === 'loading'}
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
                disabled={status === 'loading'}
                onChange={(event) => setContact(event.target.value)}
              />
            </label>

            <p className="feedback-hint">反馈会直接提交到 GitHub Issues，帮助我们改进骑了么。</p>

            <div className="feedback-actions">
              <button
                type="button"
                className="feedback-btn feedback-btn--ghost"
                onClick={onClose}
                disabled={status === 'loading'}
              >
                取消
              </button>
              <button
                type="button"
                className="feedback-btn feedback-btn--primary"
                onClick={handleSubmit}
                disabled={!canSubmit || status === 'loading'}
              >
                {status === 'loading' ? '提交中…' : '提交反馈'}
              </button>
            </div>
          </div>
        ) : status === 'success' ? (
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
            <h3 className="feedback-result__title">感谢反馈！</h3>
            <p className="feedback-result__desc">
              已为你创建 GitHub Issue #{result?.issueNumber}，我们会尽快处理。
            </p>
            <div className="feedback-actions feedback-actions--center">
              {result?.issueUrl ? (
                <a
                  className="feedback-btn feedback-btn--primary"
                  href={result.issueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看 Issue #{result.issueNumber}
                </a>
              ) : null}
              <button type="button" className="feedback-btn feedback-btn--ghost" onClick={onClose}>
                关闭
              </button>
            </div>
          </div>
        ) : (
          <div className="feedback-result">
            <svg
              className="feedback-result__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--danger)"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M12 3l9 16H3z" strokeLinejoin="round" />
              <path d="M12 10v4M12 17h.01" strokeLinecap="round" />
            </svg>
            <h3 className="feedback-result__title">提交失败</h3>
            <p className="feedback-result__desc">{errorMsg}。你也可以手动提交：</p>
            <div className="feedback-actions feedback-actions--center">
              <a
                className="feedback-btn feedback-btn--primary"
                href={buildManualUrl(type, title, description)}
                target="_blank"
                rel="noopener noreferrer"
              >
                在 GitHub 新建 Issue
              </a>
              <button
                type="button"
                className="feedback-btn feedback-btn--ghost"
                onClick={() => setStatus('form')}
              >
                返回修改
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default FeedbackModal
