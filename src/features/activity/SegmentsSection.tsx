/**
 * 爬坡与分段分析区块（合并爬坡分析 + 分段分析）。
 *
 * 海拔剖面改用 Recharts ComposedChart 渲染（对齐「海拔」卡片交互）：
 * 距离/海拔坐标轴 + 网格 + Brush 缩放；剖面线按坡度分档连续着色
 * （Strava 坡度洞察风格：下坡蓝/平路绿/缓坡黄/中坡橙/陡坡红，每档一条 Line），
 * 底下叠加平路/爬坡 ReferenceArea 色带（悬停段高亮），爬坡段在峰值处打
 * ReferenceDot UCI 级别徽章；分段详情（距离区间/爬升/坡度/速度/功率/心率）
 * 全部收进 Recharts Tooltip 悬浮卡，鼠标滑过即示，下方仅保留坡度色阶图例
 * 与相邻爬坡对比洞察。
 *
 * 悬浮联动：悬停剖面高亮所在分段色带，并上报时间戳（共享时间轴联动地图/图表）。
 *
 * 性能（悬停卡顿修复）：整棵图表拆成 memo 化的 SegmentProfileChart 子树
 * （props 全稳定），mousemove 期间只更新 recharts 内部 Tooltip，不重渲染子树；
 * 自悬停（hoverTimestamp 与本图最近上报值一致）时跳过外部参考线——
 * Tooltip 光标已指示位置，参考线冗余。剖面点数在 segmentsProfile 里封顶。
 * 无爬坡时区块不渲染。
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import {
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CategoricalChartFunc } from 'recharts/types/chart/types'
import { buildClimbs, type UciCategory } from '@/features/activity/climbs'
import {
  buildSegments,
  climbInsights,
  type RideSegment,
} from '@/features/activity/segments'
import {
  buildSegmentProfile,
  GRADE_BANDS,
  type SegmentProfile,
  type SegmentProfilePoint,
} from '@/features/activity/segmentsProfile'
import { formatAxisDistance, formatValue } from '@/charts/axis'
import { findNearestByTimestamp, activeTooltipIndexToNumber, TIMELINE_CURSOR_COLOR, TIMELINE_CURSOR_DASH } from '@/charts/timeline'
import { formatDistanceByUnit, formatSpeedByUnit, type DistanceUnit } from '@/features/settings/settings'
import type { ActivityRecord } from '@/types/activity'
import { SEGMENT_BAND_COLORS as BAND_COLORS } from '@/theme/colors'
import '@/features/activity/segmentsSection.css'

/** UCI 级别色板（Strava 风格：4 级蓝 → HC 紫） */
const LEVEL_COLORS: Record<UciCategory, string> = {
  4: '#3b82f6',
  3: '#22c55e',
  2: '#f59e0b',
  1: '#ef4444',
  HC: '#a855f7',
}

/** 坐标轴文字颜色 */
const AXIS_TICK_COLOR = 'var(--text-secondary)'

/** 网格线颜色 */
const GRID_COLOR = 'var(--border)'

/** 分段色带填充色（平路蓝 / 爬坡橙；悬停段加深） */
const BAND_FILL = {
  flat: 'rgba(59, 130, 246, 0.14)',
  climb: 'rgba(249, 115, 22, 0.22)',
} as const

const BAND_FILL_ACTIVE = {
  flat: 'rgba(59, 130, 246, 0.30)',
  climb: 'rgba(249, 115, 22, 0.42)',
} as const

/** UCI 徽章圆点半径（像素） */
const BADGE_RADIUS = 11

/**
 * 爬坡与分段分析区块 props。
 */
export interface SegmentsSectionProps {
  /** 逐点记录（含海拔/距离/速度/功率/心率） */
  records: ActivityRecord[]

  /** 距离显示单位（距离/速度随偏好换算） */
  distanceUnit: DistanceUnit

  /** 共享时间轴：外部悬停时间戳（Unix 秒）；命中时渲染参考线 */
  hoverTimestamp?: number

  /** 悬停回调：鼠标滑过剖面时上报所在点时间戳（Unix 秒）；移出时传 undefined */
  onHover?: (timestamp: number | undefined) => void
}

/** 级别显示名 */
function levelLabel(level: UciCategory): string {
  return level === 'HC' ? 'HC' : `${level} 级`
}

/** Recharts Tooltip 传入项（payload 内层为图表数据行） */
interface TooltipEntry {
  payload?: SegmentProfilePoint
}

/** 自定义 Tooltip 组件 props（segments/distanceUnit 经 content 元素透传） */
interface SegmentTooltipProps {
  active?: boolean
  payload?: ReadonlyArray<TooltipEntry>
  segments: readonly RideSegment[]
  distanceUnit: DistanceUnit
}

/**
 * 分段详情悬浮卡（Recharts Tooltip 自定义内容）。
 *
 * @param props 组件参数
 */
function SegmentTooltipContent({ active, payload, segments, distanceUnit }: SegmentTooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || point === undefined) {
    return null
  }
  const segment = segments[point.segmentIndex]
  if (segment === undefined) {
    return null
  }

  // 数据行：区间/长度为通用行，爬坡段补爬升与坡度，末尾是三项强度指标
  const rows: Array<[string, string]> = [
    [
      '区间',
      `${formatDistanceByUnit(segment.startDistanceMeters, distanceUnit)} – ${formatDistanceByUnit(
        segment.endDistanceMeters,
        distanceUnit,
      )}`,
    ],
    ['长度', formatDistanceByUnit(segment.distanceMeters, distanceUnit)],
  ]
  if (segment.type === 'climb') {
    rows.push(['爬升', `${Math.round(segment.elevationGain)} m`])
    rows.push(['坡度', `${segment.avgGradePercent.toFixed(1)}%`])
  }
  rows.push(['此处海拔', `${Math.round(point.altitude)} m`])
  rows.push(['此处坡度', `${point.grade.toFixed(1)}%`])
  rows.push([
    '速度',
    segment.avgSpeedMps === undefined ? '—' : formatSpeedByUnit(segment.avgSpeedMps, distanceUnit),
  ])
  rows.push(['功率', segment.avgPowerW !== undefined ? `${Math.round(segment.avgPowerW)} W` : '—'])
  rows.push([
    '心率',
    segment.avgHeartRateBpm !== undefined ? `${Math.round(segment.avgHeartRateBpm)} bpm` : '—',
  ])

  return (
    <div className="segments-section__tooltip" data-testid="segment-tooltip">
      <p className="segments-section__tooltip-title">
        <i className={`segments-section__tooltip-type segments-section__tooltip-type--${segment.type}`} />
        {segment.label}
      </p>
      <dl>
        {rows.map(([label, value]) => (
          <div className="segments-section__tooltip-row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** 剖面图子树 props（全部稳定引用：数据经 useMemo、回调经 useCallback） */
interface SegmentProfileChartProps {
  /** 剖面数据（points 供 ComposedChart，badges 供 ReferenceDot） */
  profile: SegmentProfile

  /** 平路/爬坡连续分段（ReferenceArea 色带 + Tooltip 详情） */
  segments: readonly RideSegment[]

  /** 距离显示单位 */
  distanceUnit: DistanceUnit

  /** 悬停分段下标（undefined = 未悬停；色带高亮用） */
  hoverIndex: number | undefined

  /** 外部共享时间轴光标 x（米）；本图自悬停时为 undefined */
  cursorX: number | undefined

  /** 悬停上报：滑过剖面时上报所在点时间戳（Unix 秒）；移出时传 undefined */
  onHover: (timestamp: number | undefined) => void

  /** 悬停分段下标变化（跨过分段边界时触发；同值时上层 setState 自动跳过） */
  onHoverIndexChange: (index: number | undefined) => void
}

/**
 * 剖面图子树（memo 化）：mousemove 期间 recharts 只更新内部 Tooltip，
 * 本子树因 props 全稳定而不重渲染——悬停流畅的关键。
 *
 * @param props 组件参数
 */
const SegmentProfileChart = memo(function SegmentProfileChart({
  profile,
  segments,
  distanceUnit,
  hoverIndex,
  cursorX,
  onHover,
  onHoverIndexChange,
}: SegmentProfileChartProps) {
  // 图表鼠标移动：Tooltip 命中剖面点 → 高亮所属分段色带 + 上报时间戳（共享时间轴）
  const handleChartMove: CategoricalChartFunc = (state) => {
    const index = activeTooltipIndexToNumber(state.activeTooltipIndex)
    const point = index !== undefined ? profile.points[index] : undefined
    onHoverIndexChange(point?.segmentIndex)
    onHover(point?.timestamp)
  }

  // 移出图表：清除分段高亮并通知上层
  const handleChartLeave = () => {
    onHoverIndexChange(undefined)
    onHover(undefined)
  }

  return (
    <div
      className="segments-section__chart"
      role="img"
      aria-label="海拔剖面图，按坡度着色标注平路与爬坡分段，鼠标悬停显示分段详情"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={profile.points}
          margin={{ top: 16, right: 8, bottom: 0, left: 0 }}
          onMouseMove={handleChartMove}
          onMouseLeave={handleChartLeave}
        >
          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="x"
            type="number"
            domain={['auto', 'auto']}
            tickCount={6}
            tickFormatter={formatAxisDistance}
            tick={{ fill: AXIS_TICK_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
          />
          <YAxis
            width={44}
            domain={['auto', 'auto']}
            tickFormatter={(value: number) => formatValue(value, 'm', false)}
            tick={{ fill: AXIS_TICK_COLOR, fontSize: 11 }}
            stroke={GRID_COLOR}
          />

          {/* 平路/爬坡分段色带（悬停段加深 + 虚线描边） */}
          {segments.map((segment, index) => (
            <ReferenceArea
              key={index}
              x1={segment.startDistanceMeters}
              x2={segment.endDistanceMeters}
              fill={hoverIndex === index ? BAND_FILL_ACTIVE[segment.type] : BAND_FILL[segment.type]}
              stroke={hoverIndex === index ? 'var(--text-secondary)' : 'none'}
              strokeDasharray="4 3"
              ifOverflow="extendDomain"
            />
          ))}

          {/* 坡度分档着色折线（每档一条 Line，边界点双档衔接） */}
          {GRADE_BANDS.map((band, bandIndex) => (
            <Line
              key={band.label}
              type="linear"
              dataKey={`alt${bandIndex}`}
              name={band.label}
              stroke={band.color}
              strokeWidth={2.2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
              activeDot={false}
            />
          ))}

          {/* 外部共享时间轴光标（本图自悬停时由 Tooltip 光标指示，不渲染） */}
          {cursorX !== undefined && (
            <ReferenceLine
              x={cursorX}
              stroke={TIMELINE_CURSOR_COLOR}
              strokeDasharray={TIMELINE_CURSOR_DASH}
              ifOverflow="discard"
            />
          )}

          {/* UCI 级别徽章（爬坡段峰值处圆点 + 白字级别） */}
          {profile.badges.map((badge) => (
            <ReferenceDot
              key={badge.segmentIndex}
              x={badge.x}
              y={badge.y}
              r={BADGE_RADIUS}
              fill={LEVEL_COLORS[badge.level]}
              stroke="none"
              ifOverflow="discard"
              label={{
                value: levelLabel(badge.level),
                position: 'center',
                fill: '#ffffff',
                fontSize: 10,
                fontWeight: 700,
              }}
            />
          ))}

          <Tooltip
            content={<SegmentTooltipContent segments={segments} distanceUnit={distanceUnit} />}
            cursor={{ stroke: 'var(--text-secondary)', strokeDasharray: '3 3' }}
            isAnimationActive={false}
          />
          <Brush dataKey="x" height={22} travellerWidth={8} stroke={GRID_COLOR} fill="transparent" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
})

/**
 * 爬坡与分段分析区块组件。
 *
 * @param props 组件参数
 */
function SegmentsSection({
  records,
  distanceUnit,
  hoverTimestamp,
  onHover,
}: SegmentsSectionProps) {
  // 悬停分段下标（undefined = 未悬停；色带高亮用）
  const [hoverIndex, setHoverIndex] = useState<number>()

  // 最近一次由本图上报的悬停时间戳（区分「自己悬停」与「外部联动」）
  const lastReportedTimestampRef = useRef<number | undefined>(undefined)

  // 分段 + 洞察 + 剖面数据
  const { climbs, segments, insights, profile, climbCount, flatCount } = useMemo(() => {
    const climbs = buildClimbs(records)
    const segments = buildSegments(records, climbs)
    const insights = climbInsights(segments)
    const climbCount = segments.filter((segment) => segment.type === 'climb').length
    const flatCount = segments.filter((segment) => segment.type === 'flat').length
    return {
      climbs,
      segments,
      insights,
      profile: buildSegmentProfile(records, segments),
      climbCount,
      flatCount,
    }
  }, [records])

  // 本图悬停上报：记录时间戳后转发上层（共享时间轴）
  const handleChartHover = useCallback(
    (timestamp: number | undefined) => {
      lastReportedTimestampRef.current = timestamp
      onHover?.(timestamp)
    },
    [onHover],
  )

  // 外部共享时间轴光标：仅在悬停来自其他图表/地图时渲染。
  // 自悬停（hoverTimestamp 与本图最近上报值一致）时跳过——Tooltip 光标已在指示
  // 位置，参考线冗余；跳过后 memo 化的图表子树在 mousemove 期间完全免于重渲染
  const cursorPoint =
    profile !== null &&
    hoverTimestamp !== undefined &&
    // ref 在事件处理器里先于触发本渲染的 setState 写入，渲染期读取安全
    // （最坏情况仅光标显隐一帧误差），故豁免 react-hooks/refs
    // eslint-disable-next-line react-hooks/refs -- 自悬停判定需渲染期对比最近上报值
    hoverTimestamp !== lastReportedTimestampRef.current
      ? findNearestByTimestamp(profile.points, hoverTimestamp)
      : undefined

  // 无爬坡时区块不渲染（纯平路骑行无爬坡/分段分析）
  if (climbs.length === 0 || segments.length === 0) {
    return null
  }

  return (
    <section className="segments-section" aria-label="爬坡与分段分析">
      <h2 className="segments-section__title">爬坡与分段分析</h2>
      <p className="segments-section__summary">
        共 {climbCount} 段爬坡、{flatCount} 段平路（连续爬升 ≥ 30 米且平均坡度 ≥ 1.5% 记为爬坡；悬停剖面查看分段详情，拖动下方滑块可缩放）
      </p>

      {profile !== null && (
        <SegmentProfileChart
          profile={profile}
          segments={segments}
          distanceUnit={distanceUnit}
          hoverIndex={hoverIndex}
          cursorX={cursorPoint?.x}
          onHover={handleChartHover}
          onHoverIndexChange={setHoverIndex}
        />
      )}

      {/* 坡度色阶图例 */}
      <div className="segments-section__legend" role="img" aria-label="坡度色阶图例">
        {GRADE_BANDS.map((band) => (
          <span key={band.label} className="segments-section__legend-item">
            <i className="segments-section__legend-swatch" style={{ backgroundColor: band.color }} />
            {band.label}
          </span>
        ))}
        <span className="segments-section__legend-item">
          <i className="segments-section__legend-swatch segments-section__legend-swatch--band" style={{ backgroundColor: BAND_COLORS.flat }} />
          平路段
        </span>
        <span className="segments-section__legend-item">
          <i className="segments-section__legend-swatch segments-section__legend-swatch--band" style={{ backgroundColor: BAND_COLORS.climb }} />
          爬坡段
        </span>
      </div>

      {insights.length > 0 && (
        <ul className="segment-insights" aria-label="相邻爬坡对比洞察">
          {insights.map((insight, index) => (
            <li key={index} className="segment-insights__item">
              {insight.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default SegmentsSection
