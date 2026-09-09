# 反馈窗口 · 飞书表单接入说明

反馈窗口目前采用**纯飞书多维表表单**方案：

- 用户点击右下角悬浮按钮 → 弹窗展示飞书表单二维码 + 「打开飞书表单」按钮。
- 扫码或点击按钮即可进入公开表单填写，**无需 GitHub 账户**。
- 反馈自动汇总到飞书多维表后台，定期整理进 GitHub Issues。

## 当前配置

| 配置项 | 当前值 | 说明 |
| --- | --- | --- |
| 表单链接 | `https://my.feishu.cn/share/base/form/shrcnbhhExuS6XWrvMbWcsHDlEh` | 飞书多维表「客户需求收集表」公开填写链接 |
| 二维码 | `public/feedback-form-qr.png` | 弹窗中展示的二维码图片 |

修改位置：

- 表单链接：`src/config.ts` 中的 `FEEDBACK_FORM_URL`
- 二维码：替换 `public/feedback-form-qr.png` 文件

## 飞书后台整理建议

1. 在飞书多维表中查看新增记录。
2. 把有效反馈转建为 `999bug/cycling-analyzer` 的 GitHub Issue（按需打 `bug` / `enhancement` / `feedback` label）。
3. 也可使用飞书「自动化流程」或脚本，把表单数据同步到 GitHub Issues。
