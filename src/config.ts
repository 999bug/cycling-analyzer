/**
 * 反馈窗口全局配置（零后端方案：提交即打开 GitHub 预填 issue 页）。
 *
 * 不依赖任何自建后端：提交时拼出 GitHub 新建 issue 的预填 URL 并打开，
 * 用户登录后点一次「Submit new issue」即创建 Issue。GitHub 在国内可直连。
 */

/** 反馈 issue 目标仓库 */
export const FEEDBACK_REPO = '999bug/cycling-analyzer'

/** 反馈类型选项（与下方 TYPE_LABEL 的 key 保持一致） */
export const FEEDBACK_TYPES = ['Bug 报告', '功能建议', '其他'] as const

/** 反馈类型 */
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]

/** 反馈类型 -> GitHub label（仓库不存在该 label 时 GitHub 自动忽略） */
export const FEEDBACK_TYPE_LABEL: Record<FeedbackType, string> = {
  'Bug 报告': 'bug',
  '功能建议': 'enhancement',
  '其他': 'feedback',
}
