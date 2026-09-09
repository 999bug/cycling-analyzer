/**
 * 反馈窗口全局配置（纯飞书表单方案）。
 *
 * 用户无 GitHub 账户也能直接扫码或点击链接填写飞书多维表表单，
 * 反馈进入飞书后台后再统一整理到 GitHub Issues。
 */

/** 飞书多维表反馈表单公开填写链接 */
export const FEEDBACK_FORM_URL = 'https://my.feishu.cn/share/base/form/shrcnbhhExuS6XWrvMbWcsHDlEh'

/**
 * 反馈二维码图片路径（位于 public/，构建后可在根路径引用）。
 * 用 BASE_URL 拼接以适配 GitHub Pages 子路径部署（/cycling-analyzer/）：
 * dev 返回 /feedback-form-qr.png，线上返回 /cycling-analyzer/feedback-form-qr.png。
 */
export const FEEDBACK_QR_PATH = `${import.meta.env.BASE_URL}feedback-form-qr.png`
