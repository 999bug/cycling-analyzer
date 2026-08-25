/**
 * Strava 赛段导入纯函数模块。
 *
 * 通过 Strava API v3 拉取认证用户的收藏赛段（starred）或按地图范围探索赛段，
 * 映射为本项目的 SegmentEntity（起终点圆 + stravaId 标记），
 * 复用现有 segmentMatching 起终点圆匹配引擎自动计算成绩榜。
 *
 * Token 说明：Strava access token 6 小时过期，纯前端无法安全自动刷新
 * （需 client secret），由用户在页面手动粘贴 token（存 localStorage，过期需重取）。
 *
 * GPX 导入说明：Strava 赛段页免费提供「导出 GPX」（无需订阅/API 应用），
 * parseSegmentGpx 在浏览器解析 GPX 轨迹点，首末点作为起终点圆参与匹配。
 */

/** Strava 收藏赛段 API 响应（仅本项目使用的字段） */
export interface StravaSegmentSummary {
  id: number
  name: string
  distance?: number
  start_latlng?: [number, number] | null
  end_latlng?: [number, number] | null
}

/** 分页包装响应 */
interface PagedResponse<T> {
  data: T[]
  page?: unknown
  per_page?: unknown
  total_page?: unknown
  total_size?: unknown
}

const STRAVA_API_BASE = 'https://www.strava.com/api/v3'

/** 默认最大拉取页数 */
const DEFAULT_MAX_PAGES = 10

/** explore 端点单次最多返回 10 个，无需分页参数 */
const EXPLORE_PAGE_SIZE = 30

/**
 * 地图探索范围（Strava bounds 格式：南西角/东北角经纬度）。
 */
export interface ExploreBounds {
  /** 南西角纬度 */
  south: number

  /** 南西角经度 */
  west: number

  /** 东北角纬度 */
  north: number

  /** 东北角经度 */
  east: number
}

/**
 * 从活动逐点记录推算地图探索 bounds。
 *
 * 仅使用带 GPS 的点；无 GPS 点时返回 undefined（调用方禁用「按活动探索」）。
 *
 * @param records 活动逐点数据
 * @returns explore 用 bounds，无有效 GPS 时 undefined
 */
export function trackBounds(records: readonly { latitude?: number; longitude?: number }[]): ExploreBounds | undefined {
  let minLat = Number.POSITIVE_INFINITY
  let minLng = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  for (const record of records) {
    const { latitude, longitude } = record
    if (latitude === undefined || longitude === undefined) {
      continue
    }
    if (latitude < minLat) {
      minLat = latitude
    }
    if (longitude < minLng) {
      minLng = longitude
    }
    if (latitude > maxLat) {
      maxLat = latitude
    }
    if (longitude > maxLng) {
      maxLng = longitude
    }
  }
  if (!Number.isFinite(minLat)) {
    return undefined
  }
  return { south: minLat, west: minLng, north: maxLat, east: maxLng }
}

/**
 * 发起 Strava API GET 请求并解析 JSON。
 *
 * @param path API 路径（含查询串）
 * @param token 认证 access token
 * @returns 解析后的 JSON
 */
async function stravaGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${STRAVA_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`Strava API ${response.status}: ${response.statusText}`)
  }
  return (await response.json()) as T
}

/**
 * 把 Strava 赛段摘要映射为本地 SegmentEntity 字段（不含自增 id）。
 *
 * 缺起终点坐标的赛段跳过（返回 null），无法参与起终点圆匹配。
 *
 * @param segment Strava 赛段摘要
 * @param sourceActivityId 占位来源标记（固定 'strava'）
 * @returns 本地赛段字段，缺坐标时 null
 */
export function mapStravaSegment(
  segment: StravaSegmentSummary,
  sourceActivityId = 'strava',
): Omit<import('@/storage/db').SegmentEntity, 'id'> | null {
  const start = segment.start_latlng
  const end = segment.end_latlng
  // start_latlng/end_latlng 是 [lat, lng]，缺失或空数组视为不可匹配，直接丢弃
  if (!start || !end || start.length < 2 || end.length < 2) {
    return null
  }
  return {
    name: segment.name,
    startLatitude: start[0],
    startLongitude: start[1],
    endLatitude: end[0],
    endLongitude: end[1],
    sourceActivityId,
    createdAt: new Date().toISOString(),
    stravaId: segment.id,
  } satisfies import('@/storage/db').SegmentEntity
}

/**
 * 拉取认证用户的收藏赛段（分页直到取完或达上限）。
 *
 * @param token Strava access token
 * @param options.maxPages 最大页数（默认 10 页 × 30 条）
 * @returns 收藏赛段列表（含缺坐标项，由映射阶段过滤）
 */
export async function fetchStarredSegments(
  token: string,
  options: { maxPages?: number } = {},
): Promise<StravaSegmentSummary[]> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
  const all: StravaSegmentSummary[] = []
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await stravaGet<PagedResponse<StravaSegmentSummary>>(
      `/segments/starred?per_page=${EXPLORE_PAGE_SIZE}&page=${page}`,
      token,
    )
    all.push(...response.data)
    // 返回不足一整页说明已到最后一页
    if (response.data.length < EXPLORE_PAGE_SIZE) {
      break
    }
  }
  return all
}

/**
 * 按地图范围探索赛段（单次最多返回 10 个）。
 *
 * @param token Strava access token
 * @param bounds 探索范围
 * @param activityType 活动类型（默认 riding）
 * @returns 探索到的赛段列表
 */
export async function fetchExploreSegments(
  token: string,
  bounds: ExploreBounds,
  activityType: 'riding' | 'running' = 'riding',
): Promise<StravaSegmentSummary[]> {
  const query =
    `bounds=${bounds.south},${bounds.west},${bounds.north},${bounds.east}` +
    `&activity_type=${activityType}`
  const response = await stravaGet<{ segments: StravaSegmentSummary[] }>(
    `/segments/explore?${query}`,
    token,
  )
  return response.segments ?? []
}

/**
 * 按 stravaId 去重：过滤掉已存在的赛段。
 *
 * 本地手建赛段无 stravaId 不参与去重；同 stravaId 只保留先出现的。
 *
 * @param existing 已有赛段列表
 * @param incoming 待导入列表
 * @returns incoming 中未入库的部分
 */
export function filterNewSegments<T extends { stravaId?: number }>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const seen = new Set<number>()
  for (const segment of existing) {
    if (segment.stravaId !== undefined) {
      seen.add(segment.stravaId)
    }
  }
  return incoming.filter((segment) => {
    if (segment.stravaId === undefined || seen.has(segment.stravaId)) {
      return false
    }
    seen.add(segment.stravaId)
    return true
  })
}

// ---------------------------------------------------------------------------
// GPX 文件导入（免费路径：Strava 赛段页导出 GPX，无需订阅/API 应用）
// ---------------------------------------------------------------------------

/**
 * 解析 Strava 导出的赛段 GPX 文件为本地赛段字段（不含自增 id）。
 *
 * 取全部 trkpt 经纬度，首点 = 起点圆心、末点 = 终点圆心，
 * 复用 segmentMatching 200m 起终点圆匹配引擎自动计算成绩榜。
 *
 * @param xmlText GPX 文件文本内容
 * @param fileName 文件名（名称兜底：trk/name → metadata/name → 文件名去 .gpx）
 * @returns 本地赛段字段；无有效轨迹点时 null
 * @throws Error XML 解析失败时抛出
 */
export function parseSegmentGpx(
  xmlText: string,
  fileName: string,
): (Omit<import('@/storage/db').SegmentEntity, 'id'> & { durationSeconds?: number }) | null {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid GPX file')
  }
  // 遍历全部 trkpt（Strava 导出通常单 track，但兼容多 track/多 segment 拼接）
  const points = Array.from(doc.querySelectorAll('trkpt'))
    .map((pt) => ({
      lat: Number.parseFloat(pt.getAttribute('lat') ?? ''),
      lng: Number.parseFloat(pt.getAttribute('lon') ?? ''),
      time: readPointTime(pt),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  if (points.length === 0) {
    return null
  }
  // 轨迹时长 = 首末点时间差（疑似完整骑行判定用，无时间不判）
  const timed = points.filter((p) => p.time !== undefined)
  const durationSeconds =
    timed.length >= 2 ? timed[timed.length - 1]!.time! - timed[0]!.time! : undefined
  const first = points[0]
  const last = points[points.length - 1]
  // 名称兜底链：track 名 → 元数据名 → 文件名去 .gpx 后缀
  const name =
    doc.querySelector('trk > name')?.textContent?.trim() ||
    doc.querySelector('metadata > name')?.textContent?.trim() ||
    fileName.replace(/\.gpx$/i, '')
  // durationSeconds 仅用于导入提示（疑似完整骑行），不属于 SegmentEntity 字段
  const entity: Omit<import('@/storage/db').SegmentEntity, 'id'> = {
    name,
    startLatitude: first.lat,
    startLongitude: first.lng,
    endLatitude: last.lat,
    endLongitude: last.lng,
    sourceActivityId: 'strava',
    createdAt: new Date().toISOString(),
    trackPoints: points.map((p) => [p.lat, p.lng] as [number, number]),
  }
  return { ...entity, durationSeconds }
}

/**
 * 读取 trkpt 的 <time> 子元素时间为 Unix 秒（缺失或不可解析返回 undefined）。
 *
 * 遍历直接子元素而非 getElementsByTagName(NS)：后者对每个节点做子树搜索，
 * 万点级文件下累计开销显著；GPX schema 保证 time 为 trkpt 直接子元素。
 */
function readPointTime(node: Element): number | undefined {
  for (const child of node.children) {
    if (child.localName !== 'time') {
      continue
    }
    const raw = child.textContent?.trim()
    if (!raw) {
      return undefined
    }
    const millis = Date.parse(raw)
    return Number.isFinite(millis) ? Math.floor(millis / 1000) : undefined
  }
  return undefined
}

/**
 * GPX 赛段去重 key：名称 + 起终点坐标（5 位小数 ≈ 1m 精度）。
 *
 * GPX 无 stravaId，不能用 filterNewSegments（其对无 ID 项一律丢弃）。
 */
function gpxSegmentKey(name: string, lat: number, lng: number): string {
  return `${name}|${lat.toFixed(5)},${lng.toFixed(5)}`
}

/**
 * 过滤 GPX 导入中的重复赛段：按「名称 + 起终点坐标」比对已入库项。
 *
 * @param existing 已有赛段列表
 * @param incoming 待导入赛段列表
 * @returns incoming 中未入库的部分（incoming 内部同名同起终点也只保留一个）
 */
export function filterNewGpxSegments<T extends {
  name: string
  startLatitude: number
  startLongitude: number
  endLatitude: number
  endLongitude: number
}>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const seen = new Set<string>()
  for (const s of existing) {
    seen.add(gpxSegmentKey(s.name, s.startLatitude, s.startLongitude))
  }
  return incoming.filter((s) => {
    const key = gpxSegmentKey(s.name, s.startLatitude, s.startLongitude)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
