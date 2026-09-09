/**
 * 反馈窗口全局配置（纯飞书表单方案）。
 *
 * 用户无 GitHub 账户也能直接扫码或点击链接填写飞书多维表表单，
 * 反馈进入飞书后台后再统一整理到 GitHub Issues。
 */

/** 飞书多维表反馈表单公开填写链接 */
export const FEEDBACK_FORM_URL = 'https://my.feishu.cn/share/base/form/shrcnbhhExuS6XWrvMbWcsHDlEh'

/** 反馈二维码图片路径（位于 public/，构建后可在根路径引用） */
export const FEEDBACK_QR_PATH = '/feedback-form-qr.png'
