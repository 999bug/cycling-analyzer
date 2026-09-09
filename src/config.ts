/**
 * 反馈窗口全局配置。
 *
 * FEEDBACK_ENDPOINT 为 Cloudflare Worker 公开 URL（不含密钥，可安全提交）。
 * 部署 Worker 后把下方占位地址替换为实际地址（见 feedback-worker/README.md）。
 * 也可用构建期环境变量 VITE_FEEDBACK_ENDPOINT 注入覆盖。
 */

/** 反馈提交端点（Worker URL + /submit） */
export const FEEDBACK_ENDPOINT: string =
  import.meta.env.VITE_FEEDBACK_ENDPOINT ??
  'https://cycling-feedback.YOUR_SUBDOMAIN.workers.dev/submit'

/** 反馈 issue 目标仓库（与 Worker 端保持一致） */
export const FEEDBACK_REPO = '999bug/cycling-analyzer'

/** 反馈类型选项（与 Worker 端 TYPE_LABELS 的 key 保持一致） */
export const FEEDBACK_TYPES = ['Bug 报告', '功能建议', '其他'] as const

/** 反馈类型 */
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]
