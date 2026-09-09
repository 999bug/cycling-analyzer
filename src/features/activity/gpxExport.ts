/**
 * GPX 导出（规格 §25）。
 *
 * 将单活动轨迹导出为 GPX 1.1 标准格式，便于跨平台分享。
 * 纯函数构造 XML，DOM 下载单独封装便于测试。
 * 无坐标逐点的活动不可导出（返回 undefined，不伪造轨迹，规格 §25）。
 *
 * 坐标系：落库逐点恒为导入时的原始坐标（来源 App 的坐标系），
 * 导出时统一经 projection 出口换算 —— 默认 WGS-84（国际标准，Strava/Garmin），
 * 可选 GCJ-02（国内平台高德/百度地图直接导入不偏移）。
 */
import type { CoordinateSystem } from '@/geo/coordinateSystem'
import { projectPoint } from '@/geo/projection'
import type { ActivityRecord, TrackOffset } from '@/types/activity'

/** 坐标小数位数（约 1cm 精度，GPX 惯例） */
const COORDINATE_DECIMALS = 7

/** 海拔小数位数 */
const ELE_DECIMALS = 1

/** GPX 导出坐标系选项 */
export interface GpxExportOptions {
  /** 源坐标系（活动落库标记；缺省 wgs84） */
  from?: CoordinateSystem

  /** 目标坐标系（缺省 wgs84 国际标准；gcj02 供国内平台） */
  to?: CoordinateSystem

  /** 手动微调量（与地图显示一致；缺省不叠加） */
  trackOffset?: TrackOffset
}

/**
 * XML 特殊字符转义（活动名可能含 & < > 等）。
 *
 * @param text 原始文本
 * @returns 转义后文本
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 判断投影是否为恒等变换（同坐标系且无微调）：避免逐点白白分配对象。
 *
 * @param options 导出坐标系选项
 * @returns 恒等时为 true
 */
function isIdentityProjection(options: GpxExportOptions): boolean {
  const from = options.from ?? 'wgs84'
  const to = options.to ?? 'wgs84'
  const noOffset =
    (options.trackOffset?.northMeters ?? 0) === 0 && (options.trackOffset?.eastMeters ?? 0) === 0
  return from === to && noOffset
}

/**
 * 逐点 → <trkpt> 行：时间恒有（timestamp 必填），海拔缺失时省略 <ele>。
 * 坐标先经投影出口换算到目标坐标系（恒等变换时直接使用原始值）。
 *
 * @param record 含坐标的逐点记录
 * @param options 导出坐标系选项
 * @returns trkpt XML 行
 */
function buildTrackPoint(record: ActivityRecord, options: GpxExportOptions): string {
  let lat = record.latitude
  let lng = record.longitude
  if (lat !== undefined && lng !== undefined && !isIdentityProjection(options)) {
    const projected = projectPoint(
      { latitude: lat, longitude: lng },
      {
        from: options.from,
        to: options.to ?? 'wgs84',
        northMeters: options.trackOffset?.northMeters,
        eastMeters: options.trackOffset?.eastMeters,
      },
    )
    lat = projected.latitude
    lng = projected.longitude
  }
  const latStr = (lat ?? 0).toFixed(COORDINATE_DECIMALS)
  const lngStr = (lng ?? 0).toFixed(COORDINATE_DECIMALS)
  const ele =
    record.altitude === undefined ? '' : `<ele>${record.altitude.toFixed(ELE_DECIMALS)}</ele>`
  return `      <trkpt lat="${latStr}" lon="${lngStr}">${ele}<time>${new Date(record.timestamp * 1000).toISOString()}</time></trkpt>`
}

/**
 * 构造 GPX 1.1 文档。
 *
 * @param name 轨迹名称（活动标题）
 * @param records 完整逐点数据（原始坐标，活动落库坐标系）
 * @param options 导出坐标系选项（缺省 WGS-84 原样输出，向后兼容既有调用）
 * @returns GPX XML 字符串；无任何坐标点时返回 undefined
 */
export function buildGpx(
  name: string,
  records: readonly ActivityRecord[],
  options: GpxExportOptions = {},
): string | undefined {
  const trackPoints = records.filter(
    (record) => record.latitude !== undefined && record.longitude !== undefined,
  )
  if (trackPoints.length === 0) {
    return undefined
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="cycling-analyzer" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <trk>',
    `    <name>${escapeXml(name)}</name>`,
    '    <trkseg>',
    ...trackPoints.map((record) => buildTrackPoint(record, options)),
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n')
}

/**
 * 由源文件名派生 GPX 文件名：去掉 .fit / .fit.gz 后缀后追加 .gpx。
 *
 * @param fileName 源 FIT 文件名（如 ride.fit.gz）
 * @returns GPX 文件名（如 ride.gpx）
 */
export function buildGpxFileName(fileName: string): string {
  const base = fileName.replace(/\.fit(\.gz)?$/i, '')
  return `${base}.gpx`
}

/**
 * 触发浏览器下载（DOM 副作用，页面层调用）。
 *
 * @param fileName 下载文件名
 * @param content 文件内容
 */
export function downloadGpx(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
