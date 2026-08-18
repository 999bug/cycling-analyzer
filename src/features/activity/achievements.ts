/**
 * 成就检测纯逻辑：本次骑行是否刷新历史纪录。
 *
 * 仅与开始时间严格早于本次的历史活动比较；首次骑行（无历史）不产生成就。
 * 维度字段缺失的处理：本次缺失不参评，历史全部缺失视为无纪录可比（不伪造）。
 */

/** 成就维度取值器（从活动摘要取原始值，缺失为 undefined） */
interface AchievementDimension {
  /** 成就标识 */
  key: string
  /** 展示名（如「最远骑行」） */
  label: string
  /** 从摘要取该维度原始值 */
  pick: (activity: AchievementInput) => number | undefined
}

/** 成就检测的最小输入（ActivitySummary 结构兼容） */
export interface AchievementInput {
  /** 活动 ID（排除自身） */
  id: string
  /** 开始时间（ISO 8601） */
  startTime: string
  /** 距离（米） */
  distance?: number
  /** 运动时长（秒） */
  duration?: number
  /** 累计爬升（米） */
  elevationGain?: number
  /** 平均速度（m/s） */
  avgSpeed?: number
  /** 平均功率（W） */
  avgPower?: number
}

/** 刷新的纪录 */
export interface Achievement {
  /** 成就标识（与维度 key 一致） */
  key: string
  /** 展示名 */
  label: string
  /** 本次值（原始单位：米/秒/m/s/W） */
  value: number
  /** 原纪录（历史最大值） */
  previousBest: number
}

/** 成就维度清单（距离/时长/爬升/均速/平均功率） */
const DIMENSIONS: readonly AchievementDimension[] = [
  { key: 'distance', label: '最远骑行', pick: (a) => a.distance },
  { key: 'duration', label: '最长骑行', pick: (a) => a.duration },
  { key: 'elevationGain', label: '最多爬升', pick: (a) => a.elevationGain },
  { key: 'avgSpeed', label: '最快均速', pick: (a) => a.avgSpeed },
  { key: 'avgPower', label: '最高平均功率', pick: (a) => a.avgPower },
]

/**
 * 检测本次骑行刷新的纪录。
 *
 * @param current 本次骑行
 * @param history 全部历史活动（含本次自身也无所谓，按 startTime+id 过滤）
 * @returns 刷新的纪录列表（无刷新或首次骑行为空数组）
 */
export function detectAchievements(
  current: AchievementInput,
  history: readonly AchievementInput[],
): Achievement[] {
  // 仅保留严格早于本次的历史活动（同刻活动排除自身与并列）
  const previous = history.filter(
    (a) => a.id !== current.id && a.startTime < current.startTime,
  )
  if (previous.length === 0) {
    return []
  }

  const achievements: Achievement[] = []
  for (const dimension of DIMENSIONS) {
    const value = dimension.pick(current)
    if (value === undefined) {
      continue
    }

    const previousValues = previous
      .map(dimension.pick)
      .filter((v): v is number => v !== undefined)
    if (previousValues.length === 0) {
      continue
    }

    const previousBest = Math.max(...previousValues)
    if (value > previousBest) {
      achievements.push({
        key: dimension.key,
        label: dimension.label,
        value,
        previousBest,
      })
    }
  }
  return achievements
}
