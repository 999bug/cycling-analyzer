/**
 * 运动类型兜底推断：当数据源未提供任何类型信息时，按速度特征推测。
 *
 * **只在最后一级使用**。判据优先级（前三级远高于本模块）：
 * 1. Strava `activities.csv`「活动类型」列（权威，且必然存在）
 * 2. FIT `session.sport`（设备原生）
 * 3. GPX `<trk><type>`（部分平台会写）
 * 4. 本模块的速度特征推断（覆盖「只有 lat/lon/ele/time 的 GPX」，
 *    典型如 Strava 导出的 GPX——实测确认不含 `<type>`）
 *
 * 推理方向的不对称性（本模块设计的核心依据）：
 * - **快是封闭的**：人类跑步速度有硬上界（马拉松世界纪录约 21.0 km/h，
 *   竞走约 13.5 km/h），因此「均速 ≥ 20 km/h」可可靠排除跑步/步行；
 * - **慢是开放的**：骑行可以很慢（共享单车通勤 10~13、带娃骑 8~10、
 *   山地爬坡为主 9~12、折叠车 12~15），因此**低速不能用来判定非骑行**。
 *
 * 由此得出两条硬规则：
 * - 速度只能**单向**使用——高速判骑行可靠，低速判非骑行不可靠；
 * - 落进重叠区时**保守判骑行**。把真骑行判成非骑行，用户会看到自己的
 *   里程凭空消失（表现为「数据丢了」的严重故障）；把跑步留在骑行里
 *   只是统计偏大，且会在待复核清单里被提示。代价完全不对称。
 */
import { tryNormalizeActivityType, type ActivityType } from '@/types/activityType'

/**
 * 判定置信度。
 *
 * - `high`：判据明确，可直接采纳（导入时自动写入）
 * - `medium`：判据较可信但存在误判可能（导入时采纳，并在结果中告知用户）
 * - `grey`：骑行与跑步的重叠区，**不得自动写入**，只能列出来请用户确认
 */
export type TypeConfidence = 'high' | 'medium' | 'grey'

/** 判定所依据的量化特征（供 UI 拼装「判定依据」文案，不在此处拼中文） */
export interface TypeInferenceEvidence {
  /** 判定所用平均速度（km/h）；无法得出时为 undefined */
  avgSpeedKmh?: number

  /** 活动距离（km）；无法得出时为 undefined */
  distanceKm?: number

  /** 是否因缺少距离或时长而完全无法判定 */
  insufficient?: boolean
}

/** 推断结果 */
export interface TypeInference {
  /** 建议的规范运动类型 */
  type: ActivityType

  /** 判定置信度 */
  confidence: TypeConfidence

  /** 判定依据的量化特征 */
  evidence: TypeInferenceEvidence
}

/** 步行速度上界（km/h）：散步 3~5、快走 5.5~7；竞走属竞技小众，不纳入 */
export const WALKING_MAX_SPEED_KMH = 7

/** 跑步速度上界（km/h）：慢跑 7~10；再慢即与步行重叠，不单独判跑步 */
export const RUNNING_MAX_SPEED_KMH = 10

/** 跑步距离上界（km）：超过此距离更可能是长途骑行（超马极罕见） */
export const RUNNING_MAX_DISTANCE_KM = 20

/** 骑行速度下界（km/h）：马拉松世界纪录约 21.0，跑步不可能达到此均速 */
export const CYCLING_MIN_SPEED_KMH = 20

/** 骑行距离下界（km）：跑步到此距离已是超马级别，骑行则很常见 */
export const CYCLING_MIN_DISTANCE_KM = 50

/** 推断输入（与 Activity 的距离/时长/平均速度字段同构，可直接传活动对象） */
export interface TypeInferenceInput {
  /** 距离（米） */
  distance: number

  /** 计时时长（秒） */
  duration: number

  /** 平均速度（m/s）；有值时优先使用，保证与页面显示口径一致 */
  avgSpeed?: number
}

/**
 * 按速度特征推断运动类型。
 *
 * @param input 距离/时长/平均速度
 * @returns 推断结果（含置信度与依据）
 */
export function inferActivityType(input: TypeInferenceInput): TypeInference {
  const avgSpeedKmh = resolveAvgSpeedKmh(input)
  const distanceKm = input.distance > 0 ? input.distance / 1000 : undefined

  if (avgSpeedKmh === undefined || distanceKm === undefined) {
    // 缺距离或时长：无从推断。保守保留骑行——判成非骑行会让数据消失，代价不可接受
    return { type: 'cycling', confidence: 'grey', evidence: { insufficient: true } }
  }

  const evidence: TypeInferenceEvidence = { avgSpeedKmh, distanceKm }

  if (avgSpeedKmh <= WALKING_MAX_SPEED_KMH) {
    return { type: 'walking', confidence: 'high', evidence }
  }
  if (avgSpeedKmh <= RUNNING_MAX_SPEED_KMH && distanceKm <= RUNNING_MAX_DISTANCE_KM) {
    return { type: 'running', confidence: 'medium', evidence }
  }
  // 距离门限兜住「长途慢骑」：100km / 9km/h 的负重骑会被距离判回骑行
  if (avgSpeedKmh >= CYCLING_MIN_SPEED_KMH || distanceKm >= CYCLING_MIN_DISTANCE_KM) {
    return { type: 'cycling', confidence: 'high', evidence }
  }
  // 10~20 km/h 且不足 50km：城市通勤骑与快跑生理上完全重叠，无法自动判定。
  // type 仅表示「若必须二选一时的倾向」，**消费方不得把 grey 的 type 直接写库**：
  // - 导入链路 resolveActivityType 把 grey 改回 cycling（保守判骑行）；
  // - 复核链路 detectTypeSuspects 把 grey 的建议保持为当前类型（骑行），
  //   仅列出请用户拍板。曾把均速 18.9 km/h 的真骑行「建议」成跑步，教训在先
  return { type: 'running', confidence: 'grey', evidence }
}

/**
 * 是否值得列为「待复核」候选。
 *
 * 只提示被推断为**非骑行**的活动——骑行是本站默认值，
 * 把骑行也列出来会让清单被大量误报淹没。数据不足（推断结果仍为骑行）
 * 同样不提示。
 *
 * @param result 推断结果
 * @returns 是否需要提示用户复核
 */
export function isTypeSuspect(result: TypeInference): boolean {
  return result.type !== 'cycling'
}

/**
 * 定稿活动类型：归一化优先，缺失才按速度特征兜底。
 *
 * 导入与作者快照构建共用同一实现——两条链路口径必须一致，
 * 否则同一份 FIT 在本地库与快照里会得到不同类型。
 *
 * 三种情形处理完全不同：
 * - **源提供了可识别的类型**（CSV「骑行」/ FIT `cycling` / GPX `ride`）→ 归一化为规范枚举；
 * - **源写了类型但本站认不出**（如 `rowing`）→ 归入 `other`，尊重来源、不臆测为骑行；
 * - **源完全没提供类型**（如 Strava 导出的 GPX 不含 `<type>`）→ 按速度特征推断；
 *   其中落在骑行/跑步重叠区（grey）的保守判为骑行，绝不把未知判成非骑行
 *   ——判错会让用户的骑行里程凭空消失，代价远高于统计偏大。
 *
 * @param input 原始类型文本 + 距离/时长/平均速度
 * @returns 归一化后的运动类型
 */
export function resolveActivityType(
  input: { activityType: string } & TypeInferenceInput,
): ActivityType {
  const declared = tryNormalizeActivityType(input.activityType)
  if (declared !== undefined) {
    return declared
  }
  if (input.activityType.trim() !== '') {
    return 'other'
  }
  const inferred = inferActivityType(input)
  return inferred.confidence === 'grey' ? 'cycling' : inferred.type
}

/**
 * 拼装「判定依据」文案（供复核弹窗逐条展示）。
 *
 * 依据必须露出来：来自 CSV 的权威类型与来自速度特征的推测可信度相差悬殊，
 * 用户要能自己判断该不该采纳，否则弹窗就成了黑箱。
 *
 * @param result 推断结果
 * @returns 中文依据文案
 */
export function describeTypeInference(result: TypeInference): string {
  const { evidence } = result
  if (evidence.insufficient === true) {
    return '缺少距离或时长，无法判定'
  }
  const parts: string[] = []
  if (evidence.avgSpeedKmh !== undefined) {
    parts.push(`均速 ${formatOneDecimal(evidence.avgSpeedKmh)} km/h`)
  }
  if (evidence.distanceKm !== undefined) {
    parts.push(`距离 ${formatOneDecimal(evidence.distanceKm)} km`)
  }
  const base = parts.join('、')
  return result.confidence === 'grey' ? `${base}，落在骑行与跑步的重叠区` : base
}

/**
 * 保留一位小数的数字文案（去掉无意义的 .0）。
 *
 * @param value 原始数值
 * @returns 展示用文本
 */
function formatOneDecimal(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/**
 * 解析用于判定的平均速度（km/h）。
 *
 * 优先取入库的 `avgSpeed`：它与列表页显示的均速同源，
 * 若另起口径重算，会出现「列表显示 13 km/h 却被判成步行」的困惑。
 * 仅在字段缺失时回退为「距离 ÷ 计时时长」。
 *
 * @param input 推断输入
 * @returns 平均速度（km/h）；无法得出时为 undefined
 */
function resolveAvgSpeedKmh(input: TypeInferenceInput): number | undefined {
  if (input.avgSpeed !== undefined && input.avgSpeed > 0) {
    return input.avgSpeed * 3.6
  }
  if (input.distance > 0 && input.duration > 0) {
    return (input.distance / input.duration) * 3.6
  }
  return undefined
}
