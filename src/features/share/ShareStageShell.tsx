/**
 * 真实界面分享卡外框（分享素材 v2）。
 *
 * 1080×1440 固定画布 + 品牌头（真实 logo + 骑行类型徽标 + 日期）+ 页脚（隐私承诺 + 车型/品牌），
 * 页面主体由 children 提供（朋友圈单图与小红书四页共用这一层，保证页与页之间不跳版）。
 *
 * 颜色一律取 index.css 语义令牌：成图跟随站点当前主题。
 * 预览缩放不写在这里（挂在弹窗侧的插槽 transform 上，见 shareStageCapture 的说明）。
 */
import type { ReactNode } from 'react'
import '@/features/share/shareStage.css'

/** 分享卡外框 props */
export interface ShareStageShellProps {
  /** 骑行类型 · 质量短语（空串时整块省略） */
  kicker: string

  /** 日期行（如「2026 年 9 月 6 日」） */
  dateText: string

  /** 页脚右侧文案（车型；缺省品牌名） */
  bikeName?: string

  /** 页面标识（渲染为 data-page，便于出图定位与测试断言） */
  page: string

  /** 页面主体 */
  children: ReactNode
}

/**
 * 真实界面分享卡外框。
 *
 * @param props 组件参数
 */
function ShareStageShell({ kicker, dateText, bikeName, page, children }: ShareStageShellProps) {
  return (
    <div className="share-stage" data-page={page}>
      <header className="share-stage__head">
        <div className="share-stage__brand">
          <img
            className="share-stage__logo"
            src={`${import.meta.env.BASE_URL}qileme.png`}
            alt="骑了么 logo"
          />
          {kicker.length > 0 && <span className="share-stage__kicker">{kicker}</span>}
        </div>
        <time className="share-stage__date">{dateText}</time>
      </header>

      <div className="share-stage__body">{children}</div>

      <footer className="share-stage__foot">
        <span>本地解析 · 数据不出浏览器</span>
        <span>{bikeName ?? '骑了么'}</span>
      </footer>
    </div>
  )
}

export default ShareStageShell
