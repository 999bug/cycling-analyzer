/**
 * 作者赛段导出（作者工作流）。
 *
 * 作者在本地模式用「设为赛段」创建赛段后，可在赛段页一键导出
 * author-data/segments.json 格式文件：放入仓库 author-data/ 目录并 push，
 * CI 构建快照时透传 + 预计算成绩榜，线上作者源即可展示。
 */
import type { SegmentEntity } from '@/storage/db'

/**
 * 导出作者赛段定义 JSON 字符串。
 *
 * @param segments 本地赛段列表
 * @returns 格式化 JSON 文本（可直接存为 author-data/segments.json）
 */
export function buildAuthorSegmentsJson(segments: readonly SegmentEntity[]): string {
  const definitions = segments.map((segment) => ({
    name: segment.name,
    startLatitude: segment.startLatitude,
    startLongitude: segment.startLongitude,
    endLatitude: segment.endLatitude,
    endLongitude: segment.endLongitude,
    sourceActivityId: segment.sourceActivityId,
    createdAt: segment.createdAt,
  }))
  return JSON.stringify(definitions, null, 2)
}

/**
 * 触发浏览器下载赛段定义 JSON。
 *
 * @param segments 本地赛段列表
 * @param fileName 下载文件名
 */
export function downloadAuthorSegments(
  segments: readonly SegmentEntity[],
  fileName = 'segments.json',
): void {
  const blob = new Blob([buildAuthorSegmentsJson(segments)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
