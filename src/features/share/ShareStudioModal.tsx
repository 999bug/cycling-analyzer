/**
 * 社媒分享素材弹窗（Share Studio v1）。
 *
 * 从详情页一键打开：选平台（朋友圈/小红书）→ 翻页预览 Canvas 真实出图 →
 * 改模板文案 → 下载 PNG。纯前端绘制，无任何网络请求（隐私承诺）。
 * Esc / 遮罩点击 / 关闭按钮退出。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Activity, ActivityRecord } from '@/types/activity'
import type { DistanceUnit } from '@/features/settings/settings'
import { buildShareData, type ShareCaptions } from '@/features/share/shareData'
import {
  drawShareCard,
  downloadSharePng,
  sharePageCount,
  XHS_PAGE_LABELS,
  type SharePlatform,
} from '@/features/share/shareCanvas'
import { formatDate } from '@/utils/format'
import '@/features/share/shareStudio.css'

/** 弹窗 props */
export interface ShareStudioModalProps {
  /** 活动摘要 */
  activity: Activity

  /** 清洗后的逐点数据（无轨迹可为空数组） */
  records: readonly ActivityRecord[]

  /** 距离显示单位（规格 §27） */
  distanceUnit: DistanceUnit

  /** FTP（W）：洞察强度分档（缺省不参与） */
  ftp?: number

  /** 最大心率（bpm）：洞察强度分档（缺省不参与） */
  maxHeartRate?: number

  /** 关闭回调 */
  onClose: () => void
}

/** 平台选项（v1 两平台；抖音复用竖屏视频导出，另行入口） */
const PLATFORMS: Array<{ id: SharePlatform; label: string; hint: string }> = [
  { id: 'moments', label: '朋友圈', hint: '单图：路线主视觉 + 核心指标' },
  { id: 'xhs', label: '小红书', hint: '4 页套图：封面 + 路线 + 洞察 + 图表' },
]

/** jsdom / 异常环境下 canvas 不可用时的降级标记（模块级探测一次，避免 effect 内 setState） */
const CANVAS_AVAILABLE =
  typeof document !== 'undefined' && document.createElement('canvas').getContext('2d') !== null

/**
 * 社媒分享素材弹窗。
 *
 * @param props 组件参数
 */
function ShareStudioModal({
  activity,
  records,
  distanceUnit,
  ftp,
  maxHeartRate,
  onClose,
}: ShareStudioModalProps) {
  const [platform, setPlatform] = useState<SharePlatform>('moments')
  const [page, setPage] = useState(0)
  // 文案编辑态：与模板分离存储，「恢复默认」时重置回模板值
  const [captions, setCaptions] = useState<Record<string, string>>(() => ({}))
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const data = useMemo(
    () => buildShareData(activity, records, { distanceUnit, ftp, maxHeartRate }),
    [activity, records, distanceUnit, ftp, maxHeartRate],
  )
  const pageCount = sharePageCount(platform)
  const dateKey = formatDate(activity.startTime)

  // 当前平台的文案值：编辑过用编辑值，否则用模板默认
  const captionValue = (key: keyof ShareCaptions) => captions[key] ?? data.captions[key]

  // 预览绘制（数据/平台/页码变化即重绘；canvas 内部分辨率恒 1080×1440×2，CSS 缩放）
  useEffect(() => {
    if (canvasRef.current !== null) {
      drawShareCard(canvasRef.current, data, platform, page)
    }
  }, [data, platform, page])

  // Esc 关闭
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  /** 切平台时页码归零（朋友圈单页，小红书回到封面） */
  function handlePlatformChange(next: SharePlatform) {
    setPlatform(next)
    setPage(0)
  }

  /** 下载当前预览页 */
  function handleDownload() {
    downloadSharePng(data, platform, page, dateKey)
  }

  /** 小红书：依次下载全部 4 页 */
  function handleDownloadAll() {
    for (let index = 0; index < pageCount; index += 1) {
      downloadSharePng(data, platform, index, dateKey)
    }
  }

  /** 复制当前平台文案（clipboard 不可用时 execCommand 兜底） */
  async function handleCopy() {
    const text =
      platform === 'moments'
        ? captionValue('moments')
        : `${captionValue('xhsTitle')}\n\n${captionValue('xhsBody')}`
    try {
      if (navigator.clipboard !== undefined) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        textarea.remove()
      }
      setCopyState('ok')
    } catch {
      setCopyState('fail')
    }
  }

  return (
    <div className="share-studio__overlay" onClick={onClose}>
      <div
        className="share-studio"
        role="dialog"
        aria-modal="true"
        aria-label="分享素材创作"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="share-studio__header">
          <div>
            <h2 className="share-studio__title">分享这次骑行</h2>
            <p className="share-studio__subtitle">{data.title} · {data.dateText}</p>
          </div>
          <button type="button" className="share-studio__close" aria-label="关闭" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M2 2 L14 14 M14 2 L2 14" stroke="currentColor" strokeWidth="2" fill="none" />
            </svg>
          </button>
        </header>

        <div className="share-studio__body">
          <section className="share-studio__preview" aria-label="卡片预览">
            {CANVAS_AVAILABLE ? (
              <div className="share-studio__canvas-frame">
                <canvas ref={canvasRef} className="share-studio__canvas" />
              </div>
            ) : (
              <p className="share-studio__fallback">当前环境不支持画布预览，下载功能不可用</p>
            )}
            {platform === 'xhs' && (
              <div className="share-studio__pager">
                <button
                  type="button"
                  className="share-studio__pager-btn"
                  onClick={() => setPage((current) => Math.max(current - 1, 0))}
                  disabled={page === 0}
                >
                  上一页
                </button>
                <span className="share-studio__pager-label">
                  {page + 1}/{pageCount} · {XHS_PAGE_LABELS[page]}
                </span>
                <button
                  type="button"
                  className="share-studio__pager-btn"
                  onClick={() => setPage((current) => Math.min(current + 1, pageCount - 1))}
                  disabled={page === pageCount - 1}
                >
                  下一页
                </button>
              </div>
            )}
          </section>

          <section className="share-studio__controls">
            <div className="share-studio__platforms">
              {PLATFORMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={
                    item.id === platform
                      ? 'share-studio__platform share-studio__platform--active'
                      : 'share-studio__platform'
                  }
                  onClick={() => handlePlatformChange(item.id)}
                >
                  <span className="share-studio__platform-label">{item.label}</span>
                  <span className="share-studio__platform-hint">{item.hint}</span>
                </button>
              ))}
            </div>

            <div className="share-studio__caption">
              <div className="share-studio__caption-head">
                <span className="share-studio__caption-title">分享文案</span>
                <span className="share-studio__caption-note">文案不进图，发布时粘贴使用</span>
              </div>
              {platform === 'xhs' && (
                <input
                  className="share-studio__caption-input"
                  value={captionValue('xhsTitle')}
                  maxLength={20}
                  aria-label="小红书标题"
                  onChange={(event) =>
                    setCaptions((current) => ({ ...current, xhsTitle: event.target.value }))
                  }
                />
              )}
              <textarea
                className="share-studio__caption-text"
                value={platform === 'moments' ? captionValue('moments') : captionValue('xhsBody')}
                aria-label={platform === 'moments' ? '朋友圈文案' : '小红书正文'}
                rows={platform === 'moments' ? 4 : 8}
                onChange={(event) =>
                  setCaptions((current) => ({
                    ...current,
                    [platform === 'moments' ? 'moments' : 'xhsBody']: event.target.value,
                  }))
                }
              />
              <div className="share-studio__caption-actions">
                <button
                  type="button"
                  className="share-studio__btn share-studio__btn--ghost"
                  onClick={() =>
                    setCaptions((current) => ({
                      ...current,
                      ...(platform === 'moments'
                        ? { moments: data.captions.moments }
                        : { xhsTitle: data.captions.xhsTitle, xhsBody: data.captions.xhsBody }),
                    }))
                  }
                >
                  恢复默认
                </button>
                <button
                  type="button"
                  className="share-studio__btn share-studio__btn--ghost"
                  onClick={() => void handleCopy()}
                >
                  {copyState === 'ok' ? '已复制' : copyState === 'fail' ? '复制失败' : '复制文案'}
                </button>
              </div>
            </div>
          </section>
        </div>

        <footer className="share-studio__footer">
          <span className="share-studio__privacy">图片在本浏览器内绘制，不会上传到任何服务器</span>
          <div className="share-studio__footer-actions">
            {platform === 'xhs' && (
              <button
                type="button"
                className="share-studio__btn share-studio__btn--ghost"
                onClick={handleDownloadAll}
              >
                下载全部 {pageCount} 张
              </button>
            )}
            <button
              type="button"
              className="share-studio__btn share-studio__btn--primary"
              onClick={handleDownload}
              disabled={!CANVAS_AVAILABLE}
            >
              下载图片
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default ShareStudioModal
