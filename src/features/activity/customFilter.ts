/**
 * 自定义筛选纯函数（列表页，规格外增强）。
 *
 * 条件模型：字段 + 操作符（大于/等于/小于/介于）+ 数值（日期字段为 ISO 日期）。
 * store 持久化规范化后的条件（数值字段为 number、日期为 YYYY-MM-DD 字符串），
 * 输入框原始串只在构建时解析；查询转换输出仓库 ActivityListOptions 的 min/max 边界。
 * 纯函数无 React 依赖，Vitest 单测覆盖。
 */

/** 可筛选字段（与领域模型字段一致，数值单位与仓库口径：距离米/时长秒/速度 m/s） */
export type CustomFilterField =
  | 'distance'
  | 'elevationGain'
  | 'duration'
  | 'avgSpeed'
  | 'avgHeartRate'
  | 'avgPower'
  | 'startTime'

/** 比较操作符（between = 闭区间，含边界） */
export type CustomFilterOp = 'gt' | 'eq' | 'lt' | 'between'

/** 规范化后的筛选条件（value 恒为 string：数值字段为十进制串、日期为 YYYY-MM-DD） */
export interface CustomFilterCondition {
  field: CustomFilterField
  op: CustomFilterOp
  value: string

  /** 介于的上限（仅 op = between） */
  value2?: string
}

/** 字段元数据：显示名、单位、是否日期字段 */
export interface CustomFilterFieldMeta {
  label: string

  /** 单位后缀（日期字段为空串）；用于条件文案与输入框占位 */
  unit: string

  /** 日期字段（输入用 date input，条件按日期字符串区间比较） */
  isDate?: boolean
}

/** 字段元数据表（key 顺序即下拉选项顺序） */
export const CUSTOM_FILTER_FIELDS: Record<CustomFilterField, CustomFilterFieldMeta> = {
  distance: { label: '距离', unit: 'km' },
  elevationGain: { label: '爬升', unit: 'm' },
  duration: { label: '时长', unit: '分钟' },
  avgSpeed: { label: '平均速度', unit: 'km/h' },
  avgHeartRate: { label: '平均心率', unit: 'bpm' },
  avgPower: { label: '平均功率', unit: 'W' },
  startTime: { label: '日期', unit: '', isDate: true },
}

/** 操作符显示名 */
export const CUSTOM_FILTER_OPS: Record<CustomFilterOp, string> = {
  gt: '大于',
  eq: '等于',
  lt: '小于',
  between: '介于',
}

/** 条件解析失败原因（UI 直接展示） */
export type CustomFilterParseError =
  | 'empty'
  | 'invalid-number'
  | 'invalid-order'
  | 'missing-value2'

/**
 * 字段数值换算到领域单位（米/秒/m/s）：
 * 距离 km → 米；时长分钟 → 秒；速度 km/h → m/s；其余原值直传。
 */
function toDomainValue(field: CustomFilterField, value: number): number {
  switch (field) {
    case 'distance':
      return Math.round(value * 1000)
    case 'duration':
      return Math.round(value * 60)
    case 'avgSpeed':
      return value / 3.6
    default:
      return value
  }
}

/**
 * 解析并规范化一条筛选条件输入。
 *
 * @param field 字段
 * @param op 操作符
 * @param value 输入框原始串（数值或日期）
 * @param value2 介于的上限原始串（仅 between 需要）
 * @returns 成功返回规范化条件，失败返回错误原因
 */
export function parseCustomFilterCondition(
  field: CustomFilterField,
  op: CustomFilterOp,
  value: string,
  value2: string,
): { ok: true; condition: CustomFilterCondition } | { ok: false; error: CustomFilterParseError } {
  const trimmed = value.trim()
  if (trimmed === '') {
    return { ok: false, error: 'empty' }
  }
  const isDate = CUSTOM_FILTER_FIELDS[field].isDate === true

  if (isDate) {
    // 日期字段：YYYY-MM-DD 字符串直存，between 校验先后
    if (op === 'between') {
      const trimmed2 = value2.trim()
      if (trimmed2 === '') {
        return { ok: false, error: 'missing-value2' }
      }
      if (trimmed > trimmed2) {
        return { ok: false, error: 'invalid-order' }
      }
      return { ok: true, condition: { field, op, value: trimmed, value2: trimmed2 } }
    }
    return { ok: true, condition: { field, op, value: trimmed } }
  }

  const number = Number(trimmed)
  if (!Number.isFinite(number) || number < 0) {
    return { ok: false, error: 'invalid-number' }
  }
  if (op === 'between') {
    const trimmed2 = value2.trim()
    if (trimmed2 === '') {
      return { ok: false, error: 'missing-value2' }
    }
    const number2 = Number(trimmed2)
    if (!Number.isFinite(number2) || number2 < 0) {
      return { ok: false, error: 'invalid-number' }
    }
    if (number > number2) {
      return { ok: false, error: 'invalid-order' }
    }
    return {
      ok: true,
      condition: { field, op, value: String(number), value2: String(number2) },
    }
  }
  return { ok: true, condition: { field, op, value: String(number) } }
}

/** 条件 → 人类可读文案（如「平均速度 25 ~ 40 km/h」），也用作预设默认名 */
export function describeCondition(condition: CustomFilterCondition): string {
  const meta = CUSTOM_FILTER_FIELDS[condition.field]
  if (condition.op === 'between') {
    return `${meta.label} ${condition.value} ~ ${condition.value2}${meta.unit === '' ? '' : ` ${meta.unit}`}`
  }
  return `${meta.label} ${CUSTOM_FILTER_OPS[condition.op]} ${condition.value}${meta.unit === '' ? '' : ` ${meta.unit}`}`
}

/** 默认预设名：条件文案用「且」连接，超长截断（用户保存时可手动修改） */
export function defaultPresetName(conditions: readonly CustomFilterCondition[]): string {
  const text = conditions.map(describeCondition).join(' 且 ')
  return text.length > 24 ? `${text.slice(0, 24)}…` : text
}

/**
 * 条件列表 → 仓库查询边界（min/max per 字段）。
 * 多条件 AND 语义：同字段的下界取最大、上界取最小（与既有 min/max 选项自然叠加）。
 * 日期 between 转为 startTimeFrom/startTimeTo（按 YYYY-MM-DD 前缀比较）。
 */
export interface CustomFilterBounds {
  minDistance?: number
  maxDistance?: number
  minElevationGain?: number
  maxElevationGain?: number
  minDuration?: number
  maxDuration?: number
  minAvgSpeed?: number
  maxAvgSpeed?: number
  minAvgHeartRate?: number
  maxAvgHeartRate?: number
  minAvgPower?: number
  maxAvgPower?: number
  startTimeFrom?: string
  startTimeTo?: string
}

/** 收紧下界（取更大者） */
function tightenMin(current: number | undefined, next: number): number {
  return current === undefined ? next : Math.max(current, next)
}

/** 收紧上界（取更小者） */
function tightenMax(current: number | undefined, next: number): number {
  return current === undefined ? next : Math.min(current, next)
}

/**
 * 将规范化条件列表换算为领域单位边界。
 *
 * @param conditions 条件列表（空列表返回空对象）
 */
export function conditionsToBounds(
  conditions: readonly CustomFilterCondition[],
): CustomFilterBounds {
  const bounds: CustomFilterBounds = {}
  // 数值键的赋值视图（与日期字符串键分开，保证类型安全）
  const numericBounds = bounds as Record<NumericBoundKey, number | undefined>
  for (const condition of conditions) {
    const isDate = CUSTOM_FILTER_FIELDS[condition.field].isDate === true
    if (isDate) {
      // 日期：单值条件视为当日（前缀相等即当天任意时刻），between 为日期区间
      if (condition.op === 'gt') {
        bounds.startTimeFrom = nextDay(condition.value)
      } else if (condition.op === 'lt') {
        bounds.startTimeTo = prevDay(condition.value)
      } else if (condition.op === 'eq') {
        bounds.startTimeFrom = tighterFrom(bounds.startTimeFrom, condition.value)
        bounds.startTimeTo = tighterTo(bounds.startTimeTo, condition.value)
      } else {
        bounds.startTimeFrom = tighterFrom(bounds.startTimeFrom, condition.value)
        bounds.startTimeTo = tighterTo(bounds.startTimeTo, condition.value2 ?? condition.value)
      }
      continue
    }
    const raw = Number(condition.value)
    if (!Number.isFinite(raw)) {
      continue
    }
    const domain = toDomainValue(condition.field, raw)
    // 介于的上界用 value2 独立换算（与下界同字段同单位规则）
    const domain2 =
      condition.op === 'between' ? toDomainValue(condition.field, Number(condition.value2)) : undefined
    // 日期字段已在上方单独处理，此处仅数值字段（键表不含 startTime）
    if (condition.field === 'startTime') {
      continue
    }
    const keys = FIELD_BOUNDS_KEYS[condition.field]
    if (condition.op === 'gt' || condition.op === 'eq' || condition.op === 'between') {
      numericBounds[keys.min] = tightenMin(numericBounds[keys.min], domain)
    }
    if (condition.op === 'lt' || condition.op === 'eq' || condition.op === 'between') {
      numericBounds[keys.max] = tightenMax(numericBounds[keys.max], condition.op === 'between' ? domain2! : domain)
    }
  }
  return bounds
}

/** 数值边界键（不含日期字符串键，保证赋值类型安全） */
type NumericBoundKey =
  | 'minDistance'
  | 'maxDistance'
  | 'minElevationGain'
  | 'maxElevationGain'
  | 'minDuration'
  | 'maxDuration'
  | 'minAvgSpeed'
  | 'maxAvgSpeed'
  | 'minAvgHeartRate'
  | 'maxAvgHeartRate'
  | 'minAvgPower'
  | 'maxAvgPower'

/** 数值字段 → 上下界键名映射（日期字段单独处理，不在此表） */
const FIELD_BOUNDS_KEYS: Record<
  Exclude<CustomFilterField, 'startTime'>,
  { min: NumericBoundKey; max: NumericBoundKey }
> = {
  distance: { min: 'minDistance', max: 'maxDistance' },
  elevationGain: { min: 'minElevationGain', max: 'maxElevationGain' },
  duration: { min: 'minDuration', max: 'maxDuration' },
  avgSpeed: { min: 'minAvgSpeed', max: 'maxAvgSpeed' },
  avgHeartRate: { min: 'minAvgHeartRate', max: 'maxAvgHeartRate' },
  avgPower: { min: 'minAvgPower', max: 'maxAvgPower' },
}

/** 取更晚的日期下界（字符串字典序即时间序） */
function tighterFrom(current: string | undefined, next: string): string {
  return current === undefined ? next : current > next ? current : next
}

/** 取更早的日期上界 */
function tighterTo(current: string | undefined, next: string): string {
  return current === undefined ? next : current < next ? current : next
}

/** 次日日期（大于该日的日期串前缀即次日 00:00 起）：'2026-08-31' → '2026-08-32' 会溢出，改用 Date 计算 */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** 前一日日期 */
function prevDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
