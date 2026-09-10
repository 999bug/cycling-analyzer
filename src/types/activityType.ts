/**
 * 运动类型归一化：把各数据源五花八门的类型写法收敛为统一枚举。
 *
 * 为什么需要这一层：同一项运动在不同来源里的取值完全不同——
 * - FIT `session.sport`：`cycling` / `running` / `walking`（SDK 已解码为枚举名）
 * - 佳明 GDPR 摘要 JSON：`road_biking` / `mountain_biking` / `gravel_cycling`
 * - 各平台 GPX `<trk><type>`：`Ride` / `biking` / `Running` / 大小写与空格不一
 * - Strava `activities.csv` 活动类型列：中文「骑行 / 跑步 / 步行 / 徒步」
 *
 * 若各处直接比对字面量（如 `=== 'cycling'`），佳明的 `road_biking`、
 * Strava 的「骑行」都会被判为非骑行，表现为用户的骑行数据整体消失。
 *
 * **约定（硬约束）**：判断一个活动是否为骑行，一律调用 `isCyclingType()`，
 * 禁止在业务代码里直接比较 `activity.activityType === 'cycling'`——
 * 库里可能存有历史遗留的原始写法（如 `road_biking`），只有经归一化才可靠。
 */

/**
 * 规范运动类型。
 *
 * 只保留页面语义上需要区分的粒度：骑行是本站分析主体，
 * 跑步/步行/徒步/游泳用于把非骑行数据隔离出去，其余一律归入 `other`。
 */
export type ActivityType = 'cycling' | 'running' | 'walking' | 'hiking' | 'swimming' | 'other'

/** 规范运动类型的中文标签（UI 展示统一取此处，未收录写法回退「其他」） */
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  cycling: '骑行',
  running: '跑步',
  walking: '步行',
  hiking: '徒步',
  swimming: '游泳',
  other: '其他',
}

/**
 * 类型别名表：键为「规范化后的写法」（小写、空格与短横线转下划线）。
 *
 * 覆盖 9 个支持平台的实际取值。新增平台时在此补充，
 * 不要在业务代码里散落字符判断。
 */
const TYPE_ALIASES: Record<string, ActivityType> = {
  // —— 骑行 ——
  cycling: 'cycling',
  cycle: 'cycling',
  bike: 'cycling',
  biking: 'cycling',
  bicycle: 'cycling',
  ride: 'cycling',
  road_biking: 'cycling',
  roadbiking: 'cycling',
  road_cycling: 'cycling',
  mountain_biking: 'cycling',
  mountainbiking: 'cycling',
  mtb: 'cycling',
  gravel_cycling: 'cycling',
  gravel_bike: 'cycling',
  gravel_ride: 'cycling',
  cyclocross: 'cycling',
  track_cycling: 'cycling',
  downhill_cycling: 'cycling',
  downhill_biking: 'cycling',
  bmx: 'cycling',
  virtual_ride: 'cycling',
  virtualride: 'cycling',
  indoor_cycling: 'cycling',
  indoorcycling: 'cycling',
  velomobile: 'cycling',
  handcycling: 'cycling',
  e_bike: 'cycling',
  ebike: 'cycling',
  e_bike_ride: 'cycling',
  ebikeride: 'cycling',
  electric_bike: 'cycling',

  // —— 跑步 ——
  running: 'running',
  run: 'running',
  jog: 'running',
  jogging: 'running',
  road_running: 'running',
  trail_running: 'running',
  trailrun: 'running',
  track_running: 'running',
  street_running: 'running',
  treadmill_running: 'running',
  indoor_running: 'running',
  virtual_run: 'running',
  virtualrun: 'running',

  // —— 步行 ——
  walking: 'walking',
  walk: 'walking',
  casual_walking: 'walking',
  speed_walking: 'walking',
  nordic_walking: 'walking',
  treadmill_walking: 'walking',
  indoor_walking: 'walking',
  strolling: 'walking',

  // —— 徒步 ——
  hiking: 'hiking',
  hike: 'hiking',
  mountaineering: 'hiking',
  trekking: 'hiking',
  rucking: 'hiking',
  snowshoeing: 'hiking',

  // —— 游泳 ——
  swimming: 'swimming',
  swim: 'swimming',
  lap_swimming: 'swimming',
  open_water_swimming: 'swimming',
  pool_swimming: 'swimming',

  // —— 其他（明确知晓但不做区分的类型）——
  generic: 'other',
  training: 'other',
  fitness_equipment: 'other',
  transition: 'other',
  multisport: 'other',
  other: 'other',
  unknown: 'other',
}

/**
 * 关键词兜底：别名表未命中时按子串判断。
 *
 * **顺序敏感**：必须先判骑行（`bik`/`cycl`），否则 `mountain_biking`
 * 会先撞上徒步的 `mount` 关键词。同理「徒步」必须早于步行，
 * 否则会命中「步」字。
 */
const KEYWORD_RULES: readonly { keywords: readonly string[]; type: ActivityType }[] = [
  { keywords: ['cycl', 'bik', '骑行', '单车', '骑车', '自行车'], type: 'cycling' },
  { keywords: ['徒步', '登山', '爬山', 'trek', 'mountaineer', 'hik'], type: 'hiking' },
  { keywords: ['run', 'jog', '跑'], type: 'running' },
  { keywords: ['游泳', '泳', 'swim'], type: 'swimming' },
  { keywords: ['walk', '步', '走', '散步'], type: 'walking' },
]

/**
 * 规范化原始写法：去空白、转小写、空格与短横线统一为下划线。
 *
 * @param raw 原始类型文本
 * @returns 规范化后的写法（空输入返回空串）
 */
function canonicalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/**
 * 尝试识别运动类型：仅当写法确实被收录（别名表或关键词命中）时返回，
 * 未收录或缺失返回 `undefined`。
 *
 * 与 `normalizeActivityType` 的区别在于**保留「认不出」这个信息**——
 * 导入期据此区分两种截然不同的情况：
 * - 认不出但源确实写了类型（如 `rowing`）→ 尊重来源，不臆测；
 * - 源根本没提供类型（如 Strava 导出的 GPX 无 `<type>`）→ 才按速度特征推断。
 *
 * @param raw 原始类型文本（可缺失）
 * @returns 识别出的规范类型；未收录返回 undefined
 */
export function tryNormalizeActivityType(raw: string | undefined): ActivityType | undefined {
  if (!raw) {
    return undefined
  }
  const key = canonicalize(raw)
  if (!key) {
    return undefined
  }
  const alias = TYPE_ALIASES[key]
  if (alias) {
    return alias
  }
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => key.includes(keyword))) {
      return rule.type
    }
  }
  return undefined
}

/**
 * 将任意来源的运动类型写法归一化为统一枚举。
 *
 * 未收录或缺失一律返回 `other`——**不做「默认骑行」的猜测**：
 * 猜错会把跑步计入骑行口径污染统计，而归入 `other` 至多让该条
 * 不出现在骑行分析里，代价小得多。真正的兜底推断（按速度特征）
 * 由导入层在拿到距离/时长后决定，本函数只做「已知写法的翻译」。
 *
 * @param raw 原始类型文本（可缺失）
 * @returns 规范运动类型
 */
export function normalizeActivityType(raw: string | undefined): ActivityType {
  return tryNormalizeActivityType(raw) ?? 'other'
}

/**
 * 判断是否为骑行类型（本站分析主体）。
 *
 * 内部先归一化，因此对库里的历史遗留写法（`road_biking`、`骑行`）同样可靠。
 *
 * @param raw 原始类型文本（可缺失）
 * @returns 是否骑行
 */
export function isCyclingType(raw: string | undefined): boolean {
  return normalizeActivityType(raw) === 'cycling'
}

/**
 * 取运动类型的中文标签（未知写法回退「其他」，不显示原始英文值）。
 *
 * @param raw 原始类型文本（可缺失）
 * @returns 中文标签
 */
export function activityTypeLabel(raw: string | undefined): string {
  return ACTIVITY_TYPE_LABELS[normalizeActivityType(raw)]
}

/** 供筛选下拉等 UI 使用的类型选项（规范枚举 + 中文标签） */
export const ACTIVITY_TYPE_OPTIONS: readonly { value: ActivityType; label: string }[] = (
  Object.keys(ACTIVITY_TYPE_LABELS) as ActivityType[]
).map((value) => ({ value, label: ACTIVITY_TYPE_LABELS[value] }))
