/**
 * 真实界面分享卡（分享素材 v2 一期：朋友圈单图 1080×1440）。
 *
 * 与极简手绘卡片（`shareCanvas.ts`）并列的第二条出图链路：整张卡就是站内真实界面——
 * 真实底图与真实轨迹（复用 `ActivityMap` 静态视图）、真实指标卡排版（沿用站内
 * stat-card 结构与主题令牌）、真实品牌 logo；图上标题与文案由弹窗侧栏实时编辑，
 * 编辑结果直接反映到预览（也就是成片），无需「出图后再定位」。
 *
 * 出图由 `shareStageCapture.captureShareStagePng` 完成：快照目标是本卡根节点，
 * 预览缩放挂在弹窗的舞台插槽上（不在本组件内），故出图时不存在缩放残留。
 */
import type { Activity, RoutePoint } from '@/types/activity'
import type { ShareData } from '@/features/share/shareData'
import ShareStageShell from '@/features/share/ShareStageShell'
import { StageMetricCards } from '@/features/share/ShareStageMetricCards'
import ActivityMap from '@/map/ActivityMap'
import '@/features/share/shareStage.css'

/** 真实界面分享卡 props */
export interface ShareStageCardProps {
  /** 活动摘要（车型、坐标系、轨迹微调等） */
  activity: Activity

  /** 分享素材数据（指标 / 日期 / 骑行类型 / 自动标题） */
  data: ShareData

  /** 已抽稀轨迹（与详情页同源，`simplifyRoute` 产出） */
  routePoints: RoutePoint[]

  /** 图上标题（默认活动名，弹窗可改） */
  titleText: string

  /** 图上文案（默认朋友圈文案首行，弹窗可改；空串则整段省略） */
  scriptText: string
}

/**
 * 真实界面分享卡。
 *
 * @param props 组件参数
 */
function ShareStageCard({ activity, data, routePoints, titleText, scriptText }: ShareStageCardProps) {
  const subText = data.headlineLines.filter((line) => line.length > 0).join(' · ')

  return (
    <ShareStageShell
      page="moments"
      kicker={data.kicker}
      dateText={data.dateText}
      bikeName={activity.bikeName}
    >
      <h1 className="share-stage__title">{titleText}</h1>
      {subText.length > 0 && <p className="share-stage__sub">{subText}</p>}

      <div className="share-stage__map">
        {/* 静态视图：隐藏全屏/缩放/底图模式等交互控件，禁用地图交互，撑满本区块 */}
        <ActivityMap
          points={routePoints}
          staticView
          mapMode="normal"
          coordinateSystem={activity.coordinateSystem}
          trackOffset={activity.trackOffset}
        />
      </div>

      <StageMetricCards metrics={data.metrics} columns={4} />

      {scriptText.length > 0 && <p className="share-stage__script">{scriptText}</p>}
    </ShareStageShell>
  )
}

export default ShareStageCard
