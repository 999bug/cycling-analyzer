/**
 * 训练计划生成（纯函数）。
 *
 * 基于周期化训练理论（基础期 → 强化期 → 减量/巅峰期）与当前训练状态
 * （CTL）生成目标赛事前的逐周训练计划。输出每周：阶段、目标 TSS、骑行
 * 次数、建议时长与训练重点。所有输入校验在入口完成，非法输入返回空数组。
 */

/** 每周训练时长的每小时间接 TSS（中等强度约 60 TSS/小时） */
const TSS_PER_HOUR = 60

/** 强化期峰值 TSS 相对基准的倍率 */
const BUILD_TSS_MULTIPLIER = 1.25

/** 减量期 TSS 相对基准的倍率 */
const TAPER_TSS_MULTIPLIER = 0.6

/** 巅峰期（赛前）TSS 相对基准的倍率 */
const PEAK_TSS_MULTIPLIER = 0.4

/** 每周 TSS 最大环比增量（防训练量骤增） */
const MAX_WEEKLY_TSS_GAIN = 0.15

/** 强化期占剩余周（扣除减量期）的比例 */
const BUILD_PHASE_RATIO = 0.4

/** 起点周 TSS 下限（相对基准） */
const START_TSS_FLOOR_RATIO = 0.6

/** 一周天数 */
const DAYS_PER_WEEK = 7

/** 训练阶段 */
export type TrainingPhase = 'base' | 'build' | 'taper' | 'peak'

/** 训练计划输入 */
export interface TrainingPlanInput {
  /** 计划起始日期（YYYY-MM-DD，通常今天） */
  startDate: string

  /** 目标赛事日期（YYYY-MM-DD，须晚于起始日期） */
  eventDate: string

  /** 每周可投入训练时长（小时，>0） */
  weeklyHours: number

  /** 当前体能（CTL） */
  currentCtl: number
}

/** 一周训练计划 */
export interface TrainingPlanWeek {
  /** 周序号（1 起） */
  weekIndex: number

  /** 该周起始日期（YYYY-MM-DD） */
  weekStart: string

  /** 训练阶段 */
  phase: TrainingPhase

  /** 阶段中文标签 */
  phaseLabel: string

  /** 目标周 TSS */
  targetTss: number

  /** 建议骑行次数 */
  rideCount: number

  /** 建议周训练时长（小时，保留 1 位小数） */
  hours: number

  /** 训练重点描述 */
  focus: string
}

/** 各阶段中文标签 */
const PHASE_LABELS: Record<TrainingPhase, string> = {
  base: '基础期',
  build: '强化期',
  taper: '减量期',
  peak: '巅峰期',
}

/** 各阶段训练重点 */
const PHASE_FOCUS: Record<TrainingPhase, string> = {
  base: '有氧耐力积累，心率 Z2 为主，巩固基本功',
  build: '加入阈值间歇（Z3-Z4），提升乳酸阈值与爬坡能力',
  taper: '减量恢复，保持训练刺激，避免疲劳积累',
  peak: '赛前模拟，调整到最佳状态，充分休息',
}

/** 各阶段骑行次数建议 */
const PHASE_RIDE_COUNTS: Record<TrainingPhase, number> = {
  base: 4,
  build: 5,
  taper: 3,
  peak: 2,
}

/**
 * 将 YYYY-MM-DD 转为本地日期（避开 UTC 解析偏移）。
 *
 * @param date 日期键
 * @returns 本地零点 Date
 */
function toLocalDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * 计算两个日期键之间的周数（向上取整，至少 1 周）。
 *
 * @param start 起始日期
 * @param end 结束日期
 * @returns 周数
 */
function weeksBetween(start: string, end: string): number {
  const diffMs = toLocalDate(end).getTime() - toLocalDate(start).getTime()
  if (diffMs < 0) {
    return 0
  }
  return Math.ceil(diffMs / (DAYS_PER_WEEK * 24 * 3600 * 1000))
}

/**
 * 将日期按周推进。
 *
 * @param date 起始日期键
 * @param weeks 推进周数
 * @returns 推进后的日期键（YYYY-MM-DD）
 */
function addWeeks(date: string, weeks: number): string {
  const d = toLocalDate(date)
  d.setDate(d.getDate() + weeks * DAYS_PER_WEEK)
  const month = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/**
 * 分配各周训练阶段：先定减量期（末尾），再按比例分基础/强化期。
 *
 * @param weekCount 总周数
 * @returns 每周阶段数组（下标 0 起，长度 weekCount）
 */
function assignPhases(weekCount: number): TrainingPhase[] {
  // 减量周数随总周数增长（3 周内 1 周、9 周内 2 周、其余 3 周）
  const taperWeeks = weekCount <= 3 ? 1 : weekCount <= 9 ? 2 : 3
  const remaining = weekCount - taperWeeks
  const buildWeeks = Math.round(remaining * BUILD_PHASE_RATIO)
  const baseWeeks = remaining - buildWeeks

  const phases: TrainingPhase[] = []
  for (let i = 0; i < baseWeeks; i++) {
    phases.push('base')
  }
  for (let i = 0; i < buildWeeks; i++) {
    phases.push('build')
  }
  // 减量期：最后 1 周为巅峰（赛前），其余为减量
  for (let i = 0; i < taperWeeks; i++) {
    phases.push(i === taperWeeks - 1 ? 'peak' : 'taper')
  }
  // 极短计划（全部被减量期占用）时保证至少 1 周基础期
  if (phases.length === weekCount && !phases.includes('base') && weekCount >= 2) {
    phases[0] = 'base'
  }
  return phases
}

/**
 * 计算各周目标 TSS：基础期从维持当前体能水平起步线性升至基准，
 * 强化期升至峰值，减量/巅峰期按比例下调；每周增量受限。
 *
 * @param phases 阶段数组
 * @param weeklyHours 每周可投入时长（小时）
 * @param currentCtl 当前体能
 * @returns 每周目标 TSS
 */
function planTss(phases: TrainingPhase[], weeklyHours: number, currentCtl: number): number[] {
  const baseTss = weeklyHours * TSS_PER_HOUR
  const startTss = Math.min(Math.max(currentCtl * 3, baseTss * START_TSS_FLOOR_RATIO), baseTss)
  const peakTss = baseTss * BUILD_TSS_MULTIPLIER

  const tss: number[] = []
  let previous = startTss
  for (const phase of phases) {
    let target: number
    if (phase === 'base') {
      target = baseTss
    } else if (phase === 'build') {
      target = peakTss
    } else if (phase === 'taper') {
      target = baseTss * TAPER_TSS_MULTIPLIER
    } else {
      target = baseTss * PEAK_TSS_MULTIPLIER
    }
    // 每次上升不超过 15%；下降不受限
    const next = target > previous ? Math.min(target, previous * (1 + MAX_WEEKLY_TSS_GAIN)) : target
    tss.push(Math.round(next))
    previous = next
  }
  return tss
}

/**
 * 计算建议周训练时长（小时）：按目标 TSS 折算，基础期因强度低适当放宽。
 *
 * @param tss 目标周 TSS
 * @param phase 训练阶段
 * @returns 建议时长（小时，保留 1 位小数）
 */
function planHours(tss: number, phase: TrainingPhase): number {
  const base = tss / TSS_PER_HOUR
  // 基础期低强度，需更多时长完成同等 TSS
  const adjusted = phase === 'base' ? base * 1.25 : base
  return Math.round(adjusted * 10) / 10
}

/**
 * 生成目标赛事前的逐周训练计划。
 *
 * @param input 计划输入
 * @returns 每周计划（按时间顺序）；事件日期早于或等于起始日期时返回空数组
 */
export function buildTrainingPlan(input: TrainingPlanInput): TrainingPlanWeek[] {
  const { startDate, eventDate, weeklyHours, currentCtl } = input
  if (weeklyHours <= 0 || currentCtl < 0 || !startDate || !eventDate) {
    return []
  }
  const weekCount = weeksBetween(startDate, eventDate)
  if (weekCount < 1) {
    return []
  }

  const phases = assignPhases(weekCount)
  const tss = planTss(phases, weeklyHours, currentCtl)

  return phases.map((phase, index) => ({
    weekIndex: index + 1,
    weekStart: addWeeks(startDate, index),
    phase,
    phaseLabel: PHASE_LABELS[phase],
    targetTss: tss[index],
    rideCount: PHASE_RIDE_COUNTS[phase],
    hours: planHours(tss[index], phase),
    focus: PHASE_FOCUS[phase],
  }))
}