/**
 * 社媒分享素材数据层（纯函数，规格外延伸功能）。
 *
 * 输入活动摘要 + 清洗后的逐点数据，产出分享卡与文案所需的全部数据：
 * 路线归一化坐标、海拔剖面（含爬坡分级）、每 5 km 分段配速、指标与文案模板。
 *
 * 口径约束：
 * - 缺失字段 = undefined ≠ 0，一律呈现 '—'（规格 §25），不伪造数据
 * - 文案中的每个数字都必须可由活动数据复算（严禁编造统计）
 * - 分段均速 = 距离/时间（与 fit/calculator 口径一致），长记录缺口不计入时间
 */
import type { Activity, ActivityRecord } from '@/types/activity'
import { buildRideSummary } from '@/features/insights/rideSummary'
import { buildRideInsights } from '@/features/insights/rideInsights'
import type { DistanceUnit } from '@/features/settings/settings'
import { formatDate } from '@/utils/format'

/** 海拔剖面采样点数上限（控制 canvas 绘制与爬坡判定开销） */
const ELEVATION_SAMPLE_COUNT = 120

/** 爬坡段判定：相邻采样点坡度超过该值（%）计入爬坡 */
const CLIMB_GRADE_PERCENT = 3

/** 爬坡段合并：两段间隔小于该距离（km）时合并为一段 */
const CLIMB_MERGE_GAP_KM = 1

/** 爬坡分级阈值（米 / %）——与站内「爬坡与分段分析」语义对齐的简化口径 */
const CLIMB_HC_GAIN_M = 700
const CLIMB_CAT1_GAIN_M = 400
const CLIMB_CAT1_ALT_GAIN_M = 250
const CLIMB_CAT1_GRADE_PCT = 6
const CLIMB_CAT2_GAIN_M = 180
const CLIMB_CAT2_GRADE_PCT = 5

/** 分段配速的记录缺口阈值（秒）：相邻点间隔超过该值不计入段内时间 */
const SPLIT_GAP_SECONDS = 60

/** 分段长度（km） */
const SPLIT_KM = 5

/** 城市纬度下 cos(30°~45°) 范围，经度缩放下限保护（避免除零/极端纬度） */
const LON_SCALE_MIN = 0.5

/** 路线点数上限：超出时等距抽样（canvas 描边无需全量点） */
const ROUTE_POINT_LIMIT = 1500

/**
 * 归一化路线点（0..1，等比缩放，含纵横比信息）。
 */
export interface ShareRoutePoint {
  x: number
  y: number
}

/** 单条分享指标（label 已含单位；value 为等宽字体的短值） */
export interface ShareMetric {
  label: string
  value: string
}

/** 海拔剖面采样点 */
export interface ShareElevationPoint {
  /** 里程（km） */
  km: number
  /** 海拔（m） */
  altitude: number
}

/** 爬坡段（简化分级口径：3级/2级/1级/HC） */
export interface ShareClimbSegment {
  startKm: number
  endKm: number
  /** 段内累计爬升（m） */
  gainM: number
  /** 段内平均坡度（%） */
  gradePct: number
  /** 等级标签（HC/1级/2级/3级） */
  label: string
}

/** 分段配速（每 5 km） */
export interface ShareSplit {
  /** 段起点里程（km） */
  startKm: number
  /** 段实际长度（km，末段不足 5 km 时小于 5） */
  lengthKm: number
  /** 段均速（km/h，距离/时间口径） */
  speedKmh: number
}

/** 海拔剖面聚合数据 */
export interface ShareElevation {
  points: ShareElevationPoint[]
  /** 最高海拔（m） */
  max: number
  /** 最低海拔（m） */
  min: number
  /** 累计爬升（m，取活动摘要口径，缺失时由采样序列推算） */
  gainM: number
  climbs: ShareClimbSegment[]
}

/** 分段配速聚合数据 */
export interface ShareSplits {
  items: ShareSplit[]
  /** 全程均速（km/h，距离/时间口径；与活动摘要 avgSpeed 同源） */
  avgKmh: number
  /** 总里程（km） */
  totalKm: number
}

/** 三平台文案模板（均为真实数据拼装，用户可在弹窗中改） */
export interface ShareCaptions {
  moments: string
  xhsTitle: string
  xhsBody: string
}

/** 分享素材完整数据 */
export interface ShareData {
  /** 卡片标题（活动名或「M月D日 骑行」） */
  title: string
  /** 日期行（如「2026 年 9 月 6 日」） */
  dateText: string
  /** 眉标（骑行类型 + 质量短语，如「爬坡 · 表现良好」） */
  kicker: string
  /** 两行大标题（真实数据；第二行可能为空串） */
  headlineLines: [string, string]
  /** 4 项指标（缺失值 '—'） */
  metrics: ShareMetric[]
  /** 车型角标（缺失时 undefined，卡面整行省略） */
  bikeName?: string
  /** 路线（无坐标轨迹时为空数组） */
  route: ShareRoutePoint[]
  /** 路线实际跨度（km，比例尺换算用） */
  routeSpanKm?: { widthKm: number; heightKm: number }
  elevation?: ShareElevation
  splits?: ShareSplits
  /** 洞察至多 3 条（优先正面/中性，同为真实数据） */
  insights: Array<{ kind: string; title: string; text: string }>
  captions: ShareCaptions
}

/** 计算参数 */
export interface ShareDataOptions {
  /** 距离显示单位（默认 km，规格 §27） */
  distanceUnit?: DistanceUnit
  /** FTP（W）：洞察强度分档 */
  ftp?: number
  /** 最大心率（bpm）：洞察强度分档 */
  maxHeartRate?: number
}

/**
 * 构建分享素材数据（纯函数）。
 *
 * @param activity 活动摘要
 * @param records 清洗后的逐点数据（调用方传 cleanedRecords.cleaned）
 * @param options 单位与训练配置
 */
export function buildShareData(
  activity: Activity,
  records: readonly ActivityRecord[],
  options: ShareDataOptions = {},
): ShareData {
  const unit = options.distanceUnit ?? 'km'
  const startDate = new Date(activity.startTime)
  const validDate = !Number.isNaN(startDate.getTime())
  const dateText = validDate
    ? `${startDate.getFullYear()} 年 ${startDate.getMonth() + 1} 月 ${startDate.getDate()} 日`
    : '—'
  const title =
    activity.name && activity.name.trim().length > 0
      ? activity.name.trim()
      : validDate
        ? `${startDate.getMonth() + 1} 月 ${startDate.getDate()} 日 骑行`
        : '骑行记录'

  // 眉标：复用详情页同源的骑行类型推断（不另造口径）
  const summary = buildRideSummary(activity, {
    ftp: options.ftp,
    maxHeartRate: options.maxHeartRate,
    distanceUnit: unit,
  })
  const kicker = [summary?.rideType, summary?.qualityPhrase].filter(Boolean).join(' · ')

  // 两行大标题：距离一行、爬升/时长一行（全部来自真实数据，无则降级）
  const headlineLines = buildHeadlineLines(activity, unit)

  const metrics: ShareMetric[] = [
    { label: `距离 (${unit})`, value: metricDistance(activity.distance, unit) },
    { label: '时长 (h:mm)', value: metricDuration(activity.duration) },
    { label: '爬升 (m)', value: metricCount(activity.elevationGain) },
    { label: `均速 (${unit === 'mi' ? 'mph' : 'km/h'})`, value: metricSpeed(activity.avgSpeed, unit) },
  ]

  const route = buildRoute(records)
  const routeSpanKm = buildRouteSpanKm(records)
  const elevation = buildElevation(activity, records)
  const splits = buildSplits(activity, records)
  const insights = buildInsightSelection(activity, records, options)

  return {
    title,
    dateText,
    kicker,
    headlineLines,
    metrics,
    bikeName: activity.bikeName,
    route,
    routeSpanKm,
    elevation,
    splits,
    insights,
    captions: buildCaptions(activity, dateText, summary?.rideType ?? '骑行', unit),
  }
}

/** 两行大标题：优先「距离 + 爬升」，缺爬升用「时长」，全缺用日期句 */
function buildHeadlineLines(activity: Activity, unit: DistanceUnit): [string, string] {
  const distanceLine =
    activity.distance !== undefined && activity.distance > 0
      ? `${formatMetricNumber(unit === 'mi' ? activity.distance / 1609.344 : activity.distance / 1000, 1)} ${unit === 'mi' ? 'mi' : 'km'}`
      : undefined
  const climbLine =
    activity.elevationGain !== undefined && activity.elevationGain > 0
      ? `爬升 ${Math.round(activity.elevationGain)} 米`
      : undefined
  const durationClock = activity.duration > 0 ? clockText(activity.duration) : undefined

  if (distanceLine !== undefined) {
    return [`${distanceLine}骑行`, climbLine ?? durationClock ?? '']
  }
  if (durationClock !== undefined) {
    return [`${durationClock} 骑行`, climbLine ?? '']
  }
  return ['骑行记录', formatDate(activity.startTime)]
}

/** 指标：距离（等宽短值；缺失 '—'） */
function metricDistance(meters: number | undefined, unit: DistanceUnit): string {
  if (meters === undefined || !Number.isFinite(meters) || meters <= 0) {
    return '—'
  }
  const value = unit === 'mi' ? meters / 1609.344 : meters / 1000
  return formatMetricNumber(value, 1)
}

/** 指标：时长（h:mm 短格式，适配窄指标列；缺失 '—'） */
function metricDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '—'
  }
  return clockText(seconds)
}

/** 指标：整数计数（爬升等；缺失/为 0 语义上无数据时 '—'） */
function metricCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return '—'
  }
  return String(Math.round(value))
}

/** 指标：速度（km/h 或 mph；缺失 '—'） */
function metricSpeed(mps: number | undefined, unit: DistanceUnit): string {
  if (mps === undefined || !Number.isFinite(mps) || mps <= 0) {
    return '—'
  }
  return formatMetricNumber(unit === 'mi' ? mps * 2.2369363 : mps * 3.6, 1)
}

/** 等宽数字格式化：最多 n 位小数，去掉尾随 0 */
function formatMetricNumber(value: number, digits: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  return value.toFixed(digits).replace(/\.?0+$/, '')
}

/** 时长 → h:mm（小时不补零） */
function clockText(seconds: number): string {
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  return `${hours}:${String(minutes).padStart(2, '0')}`
}

/**
 * 路线归一化：取带坐标的点 → 等比缩放到 0..1（经度按纬度余弦修正，
 * 使形状与真实地面比例一致）→ 超限时等距抽样。
 */
function buildRoute(records: readonly ActivityRecord[]): ShareRoutePoint[] {
  const points = records.filter(
    (record): record is ActivityRecord & { latitude: number; longitude: number } =>
      record.latitude !== undefined && record.longitude !== undefined,
  )
  if (points.length < 2) {
    return []
  }
  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity
  for (const point of points) {
    minLat = Math.min(minLat, point.latitude)
    maxLat = Math.max(maxLat, point.latitude)
    minLon = Math.min(minLon, point.longitude)
    maxLon = Math.max(maxLon, point.longitude)
  }
  // 经度按中纬度余弦压缩，保证归一化后形状不横向拉伸
  const lonScale = Math.max(Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180), LON_SCALE_MIN)
  const width = Math.max((maxLon - minLon) * lonScale, Number.EPSILON)
  const height = Math.max(maxLat - minLat, Number.EPSILON)
  const scale = Math.max(width, height)

  const normalized = points.map((point) => ({
    x: ((point.longitude - minLon) * lonScale) / scale,
    y: 1 - (point.latitude - minLat) / scale, // canvas y 向下，纬度取反
  }))
  if (normalized.length <= ROUTE_POINT_LIMIT) {
    return normalized
  }
  const step = normalized.length / ROUTE_POINT_LIMIT
  const sampled: ShareRoutePoint[] = []
  for (let i = 0; i < ROUTE_POINT_LIMIT; i += 1) {
    sampled.push(normalized[Math.floor(i * step)])
  }
  // 末点必须保留（起终点标记依赖）
  sampled[sampled.length - 1] = normalized[normalized.length - 1]
  return sampled
}

/** 路线实际跨度（km），供卡片比例尺换算（无坐标轨迹时 undefined） */
function buildRouteSpanKm(records: readonly ActivityRecord[]): ShareData['routeSpanKm'] {
  const points = records.filter(
    (record): record is ActivityRecord & { latitude: number; longitude: number } =>
      record.latitude !== undefined && record.longitude !== undefined,
  )
  if (points.length < 2) {
    return undefined
  }
  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity
  for (const point of points) {
    minLat = Math.min(minLat, point.latitude)
    maxLat = Math.max(maxLat, point.latitude)
    minLon = Math.min(minLon, point.longitude)
    maxLon = Math.max(maxLon, point.longitude)
  }
  const midLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180
  const kmPerDegLat = 111.32
  const kmPerDegLon = 111.32 * Math.cos(midLatRad)
  return {
    widthKm: (maxLon - minLon) * kmPerDegLon,
    heightKm: (maxLat - minLat) * kmPerDegLat,
  }
}

/**
 * 海拔剖面：从逐点 altitude/distance 采样至多 120 点，
 * 累计爬升优先取活动摘要口径（与全站统计一致），缺失时由采样序列推算。
 */
function buildElevation(activity: Activity, records: readonly ActivityRecord[]): ShareElevation | undefined {
  const withAltitude = records.filter(
    (record): record is ActivityRecord & { altitude: number; distance: number } =>
      record.altitude !== undefined && record.distance !== undefined,
  )
  if (withAltitude.length < 2) {
    return undefined
  }

  // 等距抽样（按索引），保留末点
  const step = Math.max(withAltitude.length / ELEVATION_SAMPLE_COUNT, 1)
  const points: ShareElevationPoint[] = []
  let lastIndex = -1
  for (let i = 0; i < withAltitude.length; i += 1) {
    if (i === 0 || i === withAltitude.length - 1 || i - lastIndex >= step) {
      points.push({
        km: withAltitude[i].distance / 1000,
        altitude: withAltitude[i].altitude,
      })
      lastIndex = i
    }
  }
  if (points.length < 2) {
    return undefined
  }

  // 采样序列推算爬升（分级标注用真实坡度），展示口径仍以摘要为准
  let sampledGain = 0
  for (let i = 1; i < points.length; i += 1) {
    const delta = points[i].altitude - points[i - 1].altitude
    if (delta > 0) {
      sampledGain += delta
    }
  }
  const gainM = activity.elevationGain ?? sampledGain

  return {
    points,
    max: Math.max(...points.map((point) => point.altitude)),
    min: Math.min(...points.map((point) => point.altitude)),
    gainM: Math.round(gainM),
    climbs: buildClimbSegments(points),
  }
}

/** 爬坡段：相邻采样坡度 >3% 连段（间隔 <1km 合并），按爬升/坡度分 3级/2级/1级/HC */
function buildClimbSegments(points: readonly ShareElevationPoint[]): ShareClimbSegment[] {
  const raw: ShareClimbSegment[] = []
  let start = -1
  let gain = 0
  let climbDist = 0
  for (let i = 1; i < points.length; i += 1) {
    const distKm = points[i].km - points[i - 1].km
    const delta = points[i].altitude - points[i - 1].altitude
    const gradePct = distKm > 0 ? (delta / 1000 / distKm) * 100 : 0
    if (gradePct > CLIMB_GRADE_PERCENT) {
      if (start < 0) {
        start = i - 1
        gain = 0
        climbDist = 0
      }
      gain += delta
      climbDist += distKm
    } else if (start >= 0) {
      raw.push(makeSegment(points, start, i - 1, gain, climbDist))
      start = -1
    }
  }
  if (start >= 0) {
    raw.push(makeSegment(points, start, points.length - 1, gain, climbDist))
  }

  // 间隔过近的段合并（同一次长爬坡中间的缓坡台地）
  const merged: ShareClimbSegment[] = []
  for (const segment of raw) {
    const previous = merged[merged.length - 1]
    if (previous !== undefined && segment.startKm - previous.endKm < CLIMB_MERGE_GAP_KM) {
      previous.endKm = segment.endKm
      previous.gainM += segment.gainM
      previous.gradePct = (previous.gainM / 1000 / (previous.endKm - previous.startKm)) * 100
    } else {
      merged.push({ ...segment })
    }
  }
  return merged
}

/** 构造单个爬坡段并分级（口径见 CLIMB_* 常量，注释注明为简化实现） */
function makeSegment(
  points: readonly ShareElevationPoint[],
  startIndex: number,
  endIndex: number,
  gain: number,
  climbDist: number,
): ShareClimbSegment {
  const startKm = points[startIndex].km
  const endKm = points[endIndex].km
  const gradePct = climbDist > 0 ? (gain / 1000 / climbDist) * 100 : 0
  let label = '3级'
  if (gain >= CLIMB_HC_GAIN_M) {
    label = 'HC'
  } else if (gain >= CLIMB_CAT1_GAIN_M || (gain >= CLIMB_CAT1_ALT_GAIN_M && gradePct >= CLIMB_CAT1_GRADE_PCT)) {
    label = '1级'
  } else if (gain >= CLIMB_CAT2_GAIN_M || gradePct >= CLIMB_CAT2_GRADE_PCT) {
    label = '2级'
  }
  return { startKm, endKm, gainM: Math.round(gain), gradePct, label }
}

/**
 * 分段配速：每 5 km 一段（末段按实际里程），段速 = 段距离 / 段内时间。
 * 时间按「相邻点间隔 ≤60s 才累计」口径（与详情页运动时间判定同源思想）：
 * 长缺口（停车/丢记录）期间的时间不计入任何段，缺口覆盖的距离也不计速
 * （无法拆分时间，强行归段会拉低段速——不伪造）。
 */
function buildSplits(activity: Activity, records: readonly ActivityRecord[]): ShareSplits | undefined {
  const totalKm = activity.distance !== undefined && activity.distance > 0 ? activity.distance / 1000 : undefined
  const withDistance = records.filter(
    (record): record is ActivityRecord & { distance: number; timestamp: number } =>
      record.distance !== undefined && record.timestamp !== undefined,
  )
  if (totalKm === undefined || withDistance.length < 2) {
    return undefined
  }

  const items: ShareSplit[] = []
  let segmentIndex = 0
  let segStartDist: number | undefined
  let segTime = 0
  let lastTime: number | undefined
  let lastDist: number | undefined

  /** 结算当前段（endDist 为段终点累计距离，米；时间用已累计的 segTime） */
  const closeSegment = (endDist: number) => {
    if (segStartDist === undefined) {
      return
    }
    const lengthKm = (endDist - segStartDist) / 1000
    if (lengthKm > 0.05 && segTime > 0) {
      items.push({
        startKm: segStartDist / 1000,
        lengthKm,
        speedKmh: lengthKm / (segTime / 3600),
      })
    }
  }

  for (const record of withDistance) {
    const dist = record.distance
    const time = record.timestamp
    if (segStartDist === undefined) {
      segStartDist = dist
      segTime = 0
      lastTime = time
      lastDist = dist
      continue
    }
    const dt = time - (lastTime ?? time)
    if (dt > SPLIT_GAP_SECONDS) {
      // 长缺口：缺口前进度结算成段，从当前点重新起表（缺口段不计速）
      closeSegment(lastDist ?? dist)
      segmentIndex = Math.floor(dist / 1000 / SPLIT_KM)
      segStartDist = dist
      segTime = 0
    } else {
      // 跨越 5 km 边界：按前后两点线性插值边界时间，精确截段
      const currentKm = dist / 1000
      let remainingDt = dt
      let crossed = false
      while ((segmentIndex + 1) * SPLIT_KM <= currentKm) {
        crossed = true
        const boundaryKm = (segmentIndex + 1) * SPLIT_KM
        const prevKm = (lastDist ?? dist) / 1000
        const spanKm = currentKm - prevKm
        const ratio = spanKm > 0 ? (boundaryKm - prevKm) / spanKm : 1
        segTime += remainingDt * ratio
        closeSegment(boundaryKm * 1000)
        remainingDt *= 1 - ratio
        segStartDist = boundaryKm * 1000
        segmentIndex += 1
      }
      segTime = crossed ? remainingDt : segTime + remainingDt
    }
    lastTime = time
    lastDist = dist
  }
  // 末段（不足 5 km 的真实长度，绝不画成整段）
  closeSegment(lastDist ?? 0)

  if (items.length === 0) {
    return undefined
  }
  const avgKmh =
    activity.avgSpeed !== undefined && activity.avgSpeed > 0
      ? activity.avgSpeed * 3.6
      : totalKm / (activity.duration > 0 ? activity.duration / 3600 : 1)
  return { items, avgKmh, totalKm }
}

/** 洞察挑选：buildRideInsights 全量结果中取 3 条（positive > info > negative） */
function buildInsightSelection(
  activity: Activity,
  records: readonly ActivityRecord[],
  options: ShareDataOptions,
): ShareData['insights'] {
  const all = buildRideInsights(activity, records, {
    ftp: options.ftp,
    maxHeartRate: options.maxHeartRate,
    distanceUnit: options.distanceUnit,
  })
  const rank = (kind: string) => (kind === 'positive' ? 0 : kind === 'info' ? 1 : 2)
  return [...all]
    .sort((a, b) => rank(a.kind) - rank(b.kind))
    .slice(0, 3)
    .map((insight) => ({ kind: insight.kind, title: insight.title, text: insight.text }))
}

/** 三平台文案模板（数字全部来自活动摘要，可复算） */
function buildCaptions(
  activity: Activity,
  dateText: string,
  rideType: string,
  unit: DistanceUnit,
): ShareCaptions {
  const kmText =
    activity.distance !== undefined && activity.distance > 0
      ? `${formatMetricNumber(unit === 'mi' ? activity.distance / 1609.344 : activity.distance / 1000, 1)}${unit === 'mi' ? ' mi' : ' 公里'}`
      : undefined
  const elevText =
    activity.elevationGain !== undefined && activity.elevationGain > 0
      ? `爬升 ${Math.round(activity.elevationGain)} 米`
      : undefined
  const durationText = activity.duration > 0 ? `时长 ${clockText(activity.duration)}` : undefined

  // 朋友圈：两三行口语，前 30 字给重点（日期去掉年份更口语）
  const shortDate = dateText === '—' ? undefined : dateText.replace(/^\d+ 年 /, '')
  const momentsParts = [shortDate, kmText ? `骑了 ${kmText}` : undefined, elevText].filter(Boolean)
  const moments = `${momentsParts.join('，')}。${durationText ? `\n${durationText}，慢慢骑，别停。` : ''}`

  // 小红书标题：≤20 字，必含数字
  const xhsTitle = kmText
    ? truncate(`${kmText.replace(' 公里', 'km')}骑行｜${rideType}`, 20)
    : truncate(`${rideType}骑行记录`, 20)

  // 小红书正文：钩子 + 数据事实 + 感受位（留白给用户写）+ 固定标签
  const perKmClimb =
    activity.elevationGain !== undefined &&
    activity.elevationGain > 0 &&
    activity.distance !== undefined &&
    activity.distance > 0
      ? formatMetricNumber(activity.elevationGain / (activity.distance / 1000), 1)
      : undefined
  const xhsBody = [
    kmText ? `今天骑了 ${kmText}${elevText ? `，${elevText}` : ''}。` : '今天完成一次骑行。',
    perKmClimb !== undefined ? `平均每公里爬 ${perKmClimb} m，属于${rideType}强度。` : undefined,
    '（在这里写两句今天的感受）',
    '',
    '#骑行 #骑行日常 #公路车 #骑行记录 #骑车看风景',
  ]
    .filter((line) => line !== undefined)
    .join('\n')

  return { moments, xhsTitle, xhsBody }
}

/** 标题截断（超出加省略号） */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
