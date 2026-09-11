/**
 * 真实界面分享卡：套图页清单（分享素材 v2）。
 *
 * 标签与极简手绘套图同源（`XHS_PAGE_LABELS`），避免两套样式的分页器文案
 * 与下载文件名各写一份而对不上。
 */
import { XHS_PAGE_LABELS } from '@/features/share/shareCanvas'

/** 页标识（与极简手绘套图同序） */
export const SHARE_STAGE_PAGE_IDS = ['cover', 'route', 'insights', 'charts'] as const

/** 页标识类型 */
export type ShareStagePageId = (typeof SHARE_STAGE_PAGE_IDS)[number]

/** 套图页清单（顺序即分页器顺序） */
export const SHARE_STAGE_PAGES: ReadonlyArray<{ id: ShareStagePageId; label: string }> =
  SHARE_STAGE_PAGE_IDS.map((id, index) => ({ id, label: XHS_PAGE_LABELS[index] ?? '' }))
