/**
 * GPX 导出（后续工作项：导出 GPX）。
 *
 * 将单活动轨迹导出为 GPX 1.1 标准格式，便于跨平台分享。
 * 纯函数构造 XML，DOM 下载单独封装便于测试。
 * 无坐标逐点的活动不可导出（返回 undefined，不伪造轨迹，规格 §25）。
 */
import type { ActivityRecord } from '@/types/activity'

/** 坐标小数位数（约 1cm 精度，GPX 惯例） */
const COORDINATE_DECIMALS = 7

/** 海拔小数位数 */
const ELE_DECIMALS = 1

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
 * 逐点 → <trkpt> 行：时间恒有（timestamp 必填），海拔缺失时省略 <ele>。
 *
 * @param record 含坐标的逐点记录
 * @returns trkpt XML 行
 */
function buildTrackPoint(record: ActivityRecord): string {
  const lat = (record.latitude ?? 0).toFixed(COORDINATE_DECIMALS)
  const lng = (record.longitude ?? 0).toFixed(COORDINATE_DECIMALS)
  const ele =
    record.altitude === undefined ? '' : `<ele>${record.altitude.toFixed(ELE_DECIMALS)}</ele>`
  return `      <trkpt lat="${lat}" lon="${lng}">${ele}<time>${new Date(record.timestamp * 1000).toISOString()}</time></trkpt>`
}

/**
 * 构造 GPX 1.1 文档。
 *
 * @param name 轨迹名称（活动标题）
 * @param records 完整逐点数据
 * @returns GPX XML 字符串；无任何坐标点时返回 undefined
 */
export function buildGpx(name: string, records: readonly ActivityRecord[]): string | undefined {
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
    ...trackPoints.map(buildTrackPoint),
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
