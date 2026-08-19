/**
 * 活动对比（纯函数）。
 *
 * 两个活动摘要生成六项指标对比行：距离/时长/爬升/均速/均心率/均功率，
 * 每行含双方值与差值（后者 - 前者）；缺失字段为 null（不伪造 0）。
 */
import type { Activity } from '@/types/activity'

/** 一行指标对比 */
export interface ComparisonRow {
  /** 指标名 */
  label: string

  /** 活动 A 值（原始单位；缺失 undefined，领域约定） */
  a: number | null | undefined

  /** 活动 B 值（原始单位；缺失 undefined，领域约定） */
  b: number | null | undefined

  /** 差值（b - a；任一方缺失 null） */
  diff: number | null
}

/** 差值计算（任一方缺失返回 null） */
function diffOf(a: number | undefined, b: number | undefined): number | null {
  if (a === undefined || b === undefined) {
    return null
  }
  return b - a
}

/**
 * 生成两个活动的指标对比行。
 *
 * @param a 活动 A（当前活动）
 * @param b 活动 B（对比活动）
 * @returns 指标对比行（顺序固定）
 */
export function compareActivities(a: Activity, b: Activity): ComparisonRow[] {
  const rows: ComparisonRow[] = [
    { label: '距离', a: a.distance, b: b.distance, diff: diffOf(a.distance, b.distance) },
    { label: '运动时长', a: a.duration, b: b.duration, diff: diffOf(a.duration, b.duration) },
    { label: '爬升', a: a.elevationGain, b: b.elevationGain, diff: diffOf(a.elevationGain, b.elevationGain) },
    { label: '平均速度', a: a.avgSpeed, b: b.avgSpeed, diff: diffOf(a.avgSpeed, b.avgSpeed) },
    { label: '平均心率', a: a.avgHeartRate, b: b.avgHeartRate, diff: diffOf(a.avgHeartRate, b.avgHeartRate) },
    { label: '平均功率', a: a.avgPower, b: b.avgPower, diff: diffOf(a.avgPower, b.avgPower) },
  ]
  return rows
}
