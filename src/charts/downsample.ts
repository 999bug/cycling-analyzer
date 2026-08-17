/**
 * 图表渲染抽稀（性能优化，任务 #18）。
 *
 * 万级逐点全量喂给 Recharts 会生成等量 SVG 节点，详情页明显卡顿。
 * 等距抽稀到上限以内（保留首尾点），视觉形状基本无损；
 * 仅用于图表渲染，NP/区间/功率曲线等计算仍用完整数据。
 */

/** 图表渲染抽稀上限（点数） */
export const MAX_CHART_POINTS = 1000

/**
 * 等距抽稀记录序列（保留首尾点；未超上限时返回浅拷贝）。
 *
 * @param records 原始记录
 * @param maxPoints 上限点数（默认 1000）
 * @returns 抽稀后的记录（长度 ≤ maxPoints）
 */
export function downsampleRecords<T>(records: readonly T[], maxPoints: number = MAX_CHART_POINTS): T[] {
  if (records.length <= maxPoints) {
    return [...records]
  }
  const step = (records.length - 1) / (maxPoints - 1)
  const sampled: T[] = []
  for (let index = 0; index < maxPoints; index++) {
    sampled.push(records[Math.round(index * step)])
  }
  return sampled
}
