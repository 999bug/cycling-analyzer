/**
 * 年度分享图弹窗（后续工作项：社交分享）。
 *
 * 预览 canvas 绘制的年度数据卡片，提供 PNG 下载。
 * Esc / 遮罩点击 / 关闭按钮均可退出。
 */
import { useEffect, useMemo, useRef } from 'react'
import type { StatisticsMetrics } from '@/features/statistics/statistics'
import type { MonthlyDistance } from '@/features/yearReview/yearReview'
import type { DistanceUnit } from '@/features/settings/settings'
import {
  buildShareCardModel,
  downloadShareCardPng,
  drawShareCard,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
} from '@/features/yearReview/shareCard'
import '@/features/yearReview/shareCardModal.css'

/**
 * 分享图弹窗 props。
 */
export interface ShareCardModalProps {
  /** 年份 */
  year: number

  /** 年度指标 */
  metrics: StatisticsMetrics

  /** 月度距离（米） */
  months: readonly MonthlyDistance[]

  /** 距离显示单位 */
  distanceUnit: DistanceUnit

  /** 关闭回调 */
  onClose: () => void
}

/**
 * 年度分享图弹窗。
 *
 * @param props 组件参数
 */
function ShareCardModal({ year, metrics, months, distanceUnit, onClose }: ShareCardModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const model = useMemo(
    () => buildShareCardModel(year, metrics, months, distanceUnit),
    [year, metrics, months, distanceUnit],
  )

  useEffect(() => {
    if (canvasRef.current !== null) {
      drawShareCard(canvasRef.current, model)
    }
  }, [model])

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

  return (
    <div className="share-modal__overlay" onClick={onClose}>
      <div
        aria-label="年度分享图"
        aria-modal="true"
        className="share-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <canvas
          aria-label={`${year} 年骑行分享图预览`}
          className="share-modal__canvas"
          ref={canvasRef}
          role="img"
          style={{ aspectRatio: `${SHARE_CARD_WIDTH} / ${SHARE_CARD_HEIGHT}` }}
        />
        <div className="share-modal__actions">
          <button
            autoFocus
            className="share-modal__download"
            onClick={() => {
              if (canvasRef.current !== null) {
                downloadShareCardPng(canvasRef.current, year)
              }
            }}
            type="button"
          >
            下载 PNG
          </button>
          <button className="share-modal__close" onClick={onClose} type="button">
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

export default ShareCardModal
