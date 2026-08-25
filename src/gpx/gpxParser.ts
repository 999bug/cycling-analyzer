/**
 * GPX 活动解析：GPX 1.0/1.1 XML → 领域模型 Activity。
 *
 * 与 FIT 解码器平行的第二数据入口（架构边界不变：产出统一领域模型，
 * 汇总指标复用 @/fit/calculator 的 calculateSummary）。
 *
 * 字段映射说明：
 * - trkpt 必带 lat/lon 属性；<ele> 海拔、<time> 时间（ISO 8601）为可选子元素；
 * - TrackPointExtension 扩展（Garmin/Wahoo 常见）：hr 心率、cad 踏频、
 *   atemp 温度、power 功率；Strava 导出的 GPX 仅 lat/lon/ele/time；
 * - GPX 无累计距离与速度字段：距离按相邻 GPS 点 haversine 累加，
 *   速度不伪造（undefined，规格 §25），平均速度由汇总计算得出（距离÷时长）；
 * - <gpx creator> 映射 device.productName（如 StravaGPX / Garmin Connect），
 *   <trk><type> 或 <metadata><type> 映射 activityType，缺失默认 cycling。
 *
 * 运行环境：DOMParser 仅主线程可用（Web Worker 无 DOM），本模块经
 * 动态 import 在主线程按需加载；单文件体量几 MB，解析毫秒级无阻塞风险。
 */
import { calculateSummary } from '@/fit/calculator/calculator'
import type { ParseTaskInput } from '@/fit/worker/parseTask'
import type { Activity, ActivityRecord } from '@/types/activity'

/** 地球半径（米），haversine 距离计算用 */
const EARTH_RADIUS_M = 6371000

/**
 * GPX 轨迹点的中间表示（解析容错：字段缺失为 undefined）。
 */
interface GpxPoint {
  /** 纬度（十进制度） */
  latitude: number

  /** 经度（十进制度） */
  longitude: number

  /** 时间（Unix 秒） */
  timestamp?: number

  /** 海拔（米） */
  altitude?: number

  /** 心率（bpm） */
  heartRate?: number

  /** 踏频（rpm） */
  cadence?: number

  /** 温度（摄氏度） */
  temperature?: number

  /** 功率（W） */
  power?: number
}

/**
 * 解析 GPX 文件字节流并标准化为 Activity（与 parseFitBytes 同签名，可互换注入）。
 *
 * @param input 解析输入（bytes 为已解压的 GPX 文本字节）
 * @returns 领域模型活动（id 随机 UUID）
 * @throws Error XML 解析失败 / 无有效轨迹点 / 无有效时间戳
 */
export function parseGpxActivity(input: ParseTaskInput): Activity {
  const text = new TextDecoder().decode(input.bytes)
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid GPX file')
  }

  const points = collectTrackPoints(doc)
  if (points.length === 0) {
    throw new Error('No track points in GPX file')
  }
  // 时间是逐点数据的时间轴基础：全部缺失时无法构建有意义的记录
  const timed = points.filter((point) => point.timestamp !== undefined)
  if (timed.length === 0) {
    throw new Error('No valid timestamps in GPX file')
  }
  // 防御个别设备导出乱序轨迹：按时间稳定排序，保证距离累加与图表正确
  timed.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))

  const records = buildRecords(timed)
  const summary = calculateSummary(records)
  const first = records[0]
  const last = records[records.length - 1]

  return {
    id: crypto.randomUUID(),
    // GPX 无 FIT fileId 概念，指纹唯一标识源文件内容
    fileId: input.fingerprint,
    fileName: input.fileName,
    fingerprint: input.fingerprint,
    activityType: readActivityType(doc),
    startTime: new Date(first.timestamp * 1000).toISOString(),
    endTime: new Date(last.timestamp * 1000).toISOString(),
    duration: summary.duration,
    elapsedTime: summary.elapsedTime,
    distance: summary.distance,
    elevationGain: summary.elevationGain,
    elevationLoss: summary.elevationLoss,
    calories: summary.calories,
    avgSpeed: summary.avgSpeed,
    maxSpeed: summary.maxSpeed,
    avgHeartRate: summary.avgHeartRate,
    maxHeartRate: summary.maxHeartRate,
    avgCadence: summary.avgCadence,
    maxCadence: summary.maxCadence,
    avgPower: summary.avgPower,
    maxPower: summary.maxPower,
    device: readDeviceCreator(doc),
    // GPX 内部名称（如 Strava 导出的骑行标题）：importer 标题链中优先于文件名兜底
    name: readTrackName(doc),
    records,
  }
}

// ---------------------------------------------------------------------------
// 内部实现
// ---------------------------------------------------------------------------

/**
 * 收集全部轨迹点：遍历所有 trkpt（兼容多 track / 多 trkseg 拼接），
 * 经纬度非法的点直接丢弃。
 *
 * @param doc GPX XML 文档
 * @returns 有效轨迹点列表（时间可能缺失）
 */
function collectTrackPoints(doc: Document): GpxPoint[] {
  const points: GpxPoint[] = []
  // querySelectorAll 返回静态 NodeList：getElementsByTagName 的 live collection
  // 在部分实现对大文件极慢（万点级文件可达百秒），静态快照为线性遍历
  const nodes = doc.querySelectorAll('trkpt')
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!
    const latitude = Number.parseFloat(node.getAttribute('lat') ?? '')
    const longitude = Number.parseFloat(node.getAttribute('lon') ?? '')
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue
    }
    points.push({
      latitude,
      longitude,
      timestamp: readUnixSeconds(node, 'time'),
      altitude: readNumber(node, 'ele'),
      heartRate: readExtensionNumber(node, 'hr'),
      cadence: readExtensionNumber(node, 'cad'),
      temperature: readExtensionNumber(node, 'atemp'),
      power: readExtensionNumber(node, 'power'),
    })
  }
  return points
}

/**
 * 构建逐点记录：时间戳 + haversine 累计距离。
 *
 * 速度/功率等派生字段不伪造：GPX 未提供的即 undefined（规格 §25）。
 *
 * @param points 已按时间排序的轨迹点（均含时间戳）
 * @returns 领域逐点记录
 */
function buildRecords(points: GpxPoint[]): ActivityRecord[] {
  const records: ActivityRecord[] = []
  let cumulativeDistance = 0
  let previous: GpxPoint | undefined

  for (const point of points) {
    if (previous !== undefined) {
      cumulativeDistance += haversine(previous, point)
    }
    previous = point
    records.push({
      timestamp: point.timestamp ?? 0,
      latitude: point.latitude,
      longitude: point.longitude,
      altitude: point.altitude,
      distance: cumulativeDistance,
      heartRate: point.heartRate,
      cadence: point.cadence,
      power: point.power,
      temperature: point.temperature,
    })
  }
  return records
}

/**
 * haversine 球面距离（米）：相邻 GPS 点间距，累计即总距离。
 *
 * @param a 起点
 * @param b 终点
 */
function haversine(a: GpxPoint, b: GpxPoint): number {
  const toRad = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * toRad
  const dLon = (b.longitude - a.longitude) * toRad
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const h = sinLat * sinLat + Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * sinLon * sinLon
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** 读取子元素的有限数值文本（缺失或非数值返回 undefined） */
function readNumber(parent: Element, tagName: string): number | undefined {
  const value = Number.parseFloat(childText(parent, tagName))
  return Number.isFinite(value) ? value : undefined
}

/** 读取扩展字段数值（TrackPointExtension：hr/cad/atemp/power 等） */
function readExtensionNumber(parent: Element, tagName: string): number | undefined {
  const value = Number.parseFloat(childText(parent, tagName))
  return Number.isFinite(value) ? value : undefined
}

/** 读取子元素时间的 Unix 秒表示（缺失或不可解析返回 undefined） */
function readUnixSeconds(parent: Element, tagName: string): number | undefined {
  const raw = childText(parent, tagName)
  if (!raw) {
    return undefined
  }
  const millis = Date.parse(raw)
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : undefined
}

/**
 * 命名空间无关的后代元素文本（按局部名匹配任意层级）。
 *
 * 用于 trkpt 子树内的 ele/time 与 extensions > TrackPointExtension > gpxtpx:*：
 * 必须按局部名匹配——getElementsByTagName 匹配的是限定名，带前缀的
 * <gpxtpx:hr> 用 'hr' 查不到；GPX schema 保证 trkpt 子树内同名标签唯一。
 *
 * 手写先序遍历而非 getElementsByTagNameNS：后者每次调用都做全子树搜索，
 * 万点级文件下每节点 ×4 字段的累计开销显著；本遍历每节点只走一次。
 */
function childText(parent: Element, tagName: string): string {
  // 迭代栈避免递归开销：extensions 子树最深仅 2 层（extensions > TrackPointExtension > hr）
  const stack: Element[] = [parent]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const child of current.children) {
      if (child.nodeType !== 1) {
        continue
      }
      if (child.localName === tagName) {
        return child.textContent?.trim() ?? ''
      }
      if (child.children.length > 0) {
        stack.push(child)
      }
    }
  }
  return ''
}

/**
 * 读取活动类型：<trk><type> 优先，回退 <metadata><type>；
 * trim + 小写规范化，缺失默认 cycling（本站为骑行数据分析场景）。
 */
function readActivityType(doc: Document): string {
  const type =
    doc.getElementsByTagName('type')[0]?.textContent?.trim().toLowerCase() ?? ''
  return type.length > 0 ? type : 'cycling'
}

/** 读取 GPX creator 属性映射设备 productName（缺失返回 undefined） */
function readDeviceCreator(doc: Document): { productName?: string } | undefined {
  const creator = doc.documentElement.getAttribute('creator')?.trim()
  return creator ? { productName: creator } : undefined
}

/** 读取轨迹名称（trk > name → metadata > name），缺失返回 undefined */
function readTrackName(doc: Document): string | undefined {
  const name =
    doc.querySelector('trk > name')?.textContent?.trim() ||
    doc.querySelector('metadata > name')?.textContent?.trim() ||
    ''
  return name.length > 0 ? name : undefined
}
