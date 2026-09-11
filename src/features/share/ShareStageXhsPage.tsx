/**
 * 小红书套图（真实界面版，分享素材 v2 二期）四页。
 *
 * 与朋友圈单图同一棵 1080×1440 画布，只是主体不同（`ShareStageShell` 提供品牌头与页脚）：
 * - 封面：大字结论句 + 钩子数字 + 3 项指标 + 可编辑文案（第一落点是结论，不是数字）；
 * - 路线：真实底图地图 + 2×2 指标卡 + 可编辑文案；
 * - 洞察：复用站内真实「骑行洞察」区块（`RideInsightsSection`，同一份 rideInsights 输出）；
 * - 图表：复用站内真实「数据曲线」卡片（`MultiMetricChart` 静态视图，隐藏轴切换与指标开关）。
 *
 * 复用站内组件的页只做字号/间距的等比放大（站内组件按卡片尺寸设计，放到 1080 宽画布上
 * 字号会过小），**不改组件结构与配色**——观感与站内一致是这一期的核心目标。
 * 缺失数据一律诚实呈现：无洞察给空态、无曲线给空态（规格 §25）。
 */
import { useMemo } from 'react'
import type { Activity, ActivityRecord, RoutePoint } from '@/types/activity'
import type { DistanceUnit } from '@/features/settings/settings'
import type { ShareData } from '@/features/share/shareData'
import ShareStageShell from '@/features/share/ShareStageShell'
import { StageMetricCards } from '@/features/share/ShareStageMetricCards'
import { pickHookMetric } from '@/features/share/shareStageMetrics'
import type { ShareStagePageId } from '@/features/share/shareStagePages'
import ActivityMap from '@/map/ActivityMap'
import MultiMetricChart from '@/charts/MultiMetricChart'
import RideInsightsSection from '@/features/insights/RideInsightsSection'

/** 小红书套图页 props */
export interface ShareStageXhsPageProps {
  /** 页标识 */
  page: ShareStagePageId

  /** 活动摘要 */
  activity: Activity

  /** 分享素材数据（指标 / 日期 / 标题行 / 洞察） */
  data: ShareData

  /** 已抽稀轨迹（与详情页同源） */
  routePoints: RoutePoint[]

  /** 清洗后的逐点记录（真实图表与洞察区块的数据源） */
  records: readonly ActivityRecord[]

  /** 距离显示单位 */
  distanceUnit: DistanceUnit

  /** FTP（W）：洞察强度分档 */
  ftp?: number

  /** 最大心率（bpm）：洞察强度分档 */
  maxHeartRate?: number

  /** 图上文案（可编辑；空串则整段省略） */
  scriptText: string
}

/**
 * 小红书套图单页。
 *
 * @param props 组件参数
 */
function ShareStageXhsPage(props: ShareStageXhsPageProps) {
  const { page, activity, data } = props

  return (
    <ShareStageShell
      page={page}
      kicker={data.kicker}
      dateText={data.dateText}
      bikeName={activity.bikeName}
    >
      {page === 'cover' && <CoverBody data={data} scriptText={props.scriptText} />}
      {page === 'route' && (
        <RouteBody
          activity={activity}
          data={data}
          routePoints={props.routePoints}
          scriptText={props.scriptText}
        />
      )}
      {page === 'insights' && <InsightsBody {...props} />}
      {page === 'charts' && (
        <ChartsBody records={props.records} scriptText={props.scriptText} />
      )}
    </ShareStageShell>
  )
}

/** 封面主体：结论句 + 钩子数字 + 3 指标 + 文案 */
function CoverBody({ data, scriptText }: { data: ShareData; scriptText: string }) {
  const hook = pickHookMetric(data.metrics)
  // 次要指标：钩子那项换成「均速/时长」等剩余项，取前 3（不足按实际条数，不凑数）
  const secondary = data.metrics.filter((_, index) => index !== hook.index).slice(0, 3)

  return (
    <div className="share-stage__cover">
      <h2 className="share-stage__headline">
        {data.headlineLines.filter((line) => line.length > 0).join(' · ')}
      </h2>

      <div className="share-stage__hook">
        <span className="share-stage__hook-label">{hook.label}</span>
        <span className="share-stage__hook-value">
          {hook.value}
          {hook.unit.length > 0 && hook.value !== '—' && (
            <span className="share-stage__hook-unit">{hook.unit}</span>
          )}
        </span>
      </div>

      <StageMetricCards metrics={secondary} columns={3} />
      {scriptText.length > 0 && <p className="share-stage__script">{scriptText}</p>}
    </div>
  )
}

/** 路线主体：真实地图 + 2×2 指标 + 文案 */
function RouteBody({
  activity,
  data,
  routePoints,
  scriptText,
}: {
  activity: Activity
  data: ShareData
  routePoints: RoutePoint[]
  scriptText: string
}) {
  return (
    <>
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
      <StageMetricCards metrics={data.metrics} columns={2} />
      {scriptText.length > 0 && <p className="share-stage__script">{scriptText}</p>}
    </>
  )
}

/** 洞察主体：站内真实「骑行洞察」区块（空洞察给诚实空态） */
function InsightsBody({
  activity,
  data,
  records,
  distanceUnit,
  ftp,
  maxHeartRate,
}: ShareStageXhsPageProps) {
  // 区块内部按 records 身份做 useMemo：这里缓存一份稳定引用，避免每次渲染都重算洞察
  const stableRecords = useMemo(() => [...records], [records])

  if (data.insights.length === 0) {
    return <p className="share-stage__empty">本次骑行暂无可呈现的洞察数据</p>
  }
  return (
    <div className="share-stage__insights">
      <RideInsightsSection
        activity={activity}
        records={stableRecords}
        options={{ distanceUnit, ftp, maxHeartRate }}
      />
    </div>
  )
}

/** 图表主体：站内真实「数据曲线」卡片（静态视图）+ 文案 */
function ChartsBody({
  records,
  scriptText,
}: {
  records: readonly ActivityRecord[]
  scriptText: string
}) {
  const stableRecords = useMemo(() => [...records], [records])
  const hasCurveData = records.some(
    (record) =>
      record.altitude !== undefined ||
      record.speed !== undefined ||
      record.heartRate !== undefined ||
      record.power !== undefined,
  )

  return (
    <>
      <div className="share-stage__chart">
        {hasCurveData ? (
          <MultiMetricChart records={stableRecords} staticView />
        ) : (
          <p className="share-stage__empty">该活动没有曲线数据</p>
        )}
      </div>
      {scriptText.length > 0 && <p className="share-stage__script">{scriptText}</p>}
    </>
  )
}

export default ShareStageXhsPage
