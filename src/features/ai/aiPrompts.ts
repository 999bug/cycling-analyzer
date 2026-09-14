/**
 * AI 提示词与上行数据构建（AI 接入 v1）。
 *
 * 上行数据边界（硬约束）：payload 只含活动摘要的聚合指标（距离/爬升/功率等
 * 汇总数字与本地结论），**绝不含 GPS 轨迹点、逐点心率/功率等原始序列**——
 * 本模块是唯一的数据组装处，调用方不得自行追加字段。
 *
 * 数字口径：全部复用站内既有格式化（formatDistanceByUnit 等）与本地结论
 * （buildRideSummary 的类型推断），AI 只负责把给定事实说成人话，
 * 严禁编造数据（与 shareData 的文案口径同源）。
 */
import type { Activity } from '@/types/activity'
import { buildRideSummary } from '@/features/insights/rideSummary'
import { formatDistanceByUnit, formatSpeedByUnit, type DistanceUnit } from '@/features/settings/settings'
import { formatDurationText } from '@/utils/format'

/** 文案平台（与 Share Studio 现有两平台对齐；抖音走竖屏视频导出另行入口） */
export type AiCaptionPlatform = 'moments' | 'xhs'

/** 活动上下文（详情页/分享弹窗已算好的训练配置） */
export interface AiActivityContext {
  /** FTP（W）：强度结论依据 */
  ftp?: number

  /** 最大心率（bpm）：强度结论依据 */
  maxHeartRate?: number

  /** 距离显示单位（默认 km，规格 §27） */
  distanceUnit?: DistanceUnit
}

/** 文案生成请求（交给 chatComplete） */
export interface AiChatRequest {
  system: string
  user: string
  maxTokens: number
  temperature: number
}

/** 文案生成结果（xhs 拆标题/正文，moments 只有正文） */
export interface AiCaptionResult {
  /** 标题（仅 xhs） */
  title?: string

  /** 正文 */
  body: string
}

/** 文案生成的输出 token 上限（小红书含标题与标签；思考型模型需留出 reasoning 余量） */
const CAPTION_MAX_TOKENS = 800

/** 解读生成的输出 token 上限（2 句以内，给足余量） */
const INSIGHT_MAX_TOKENS = 400

/** 文案采样温度（求口语自然） */
const CAPTION_TEMPERATURE = 0.7

/** 解读采样温度（结论严谨优先） */
const INSIGHT_TEMPERATURE = 0.5

/** 所有任务共用的硬性约束（Anti-Slop：不编造、不吹嘘、无表情符号） */
const COMMON_CONSTRAINTS = [
  '硬性约束：',
  '1. 只允许使用给定数据中出现过的数字与结论，禁止编造、推算或补全任何数据；',
  '2. 禁止营销话术、浮夸形容词与情绪绑架式表达；',
  '3. 禁止使用任何 emoji 与颜文字；',
  '4. 用简体中文口语书写。',
].join('\n')

/**
 * 构建上行数据 payload（聚合指标 only；测试断言不含任何轨迹字段）。
 *
 * @param activity 活动摘要
 * @param context 训练配置上下文
 * @returns 键 → 展示值（字符串/数字；缺失字段不出现在结果里）
 */
export function buildAiMetricsPayload(
  activity: Activity,
  context: AiActivityContext = {},
): Record<string, string | number> {
  const unit = context.distanceUnit ?? 'km'
  const payload: Record<string, string | number> = {}

  const title = activity.name?.trim()
  if (title !== undefined && title.length > 0) {
    payload['活动名称'] = title
  }
  const date = activity.startTime.slice(0, 10)
  if (date.length === 10) {
    payload['日期'] = date
  }
  const summary = buildRideSummary(activity, {
    ftp: context.ftp,
    maxHeartRate: context.maxHeartRate,
    distanceUnit: unit,
  })
  if (summary !== undefined) {
    payload['骑行类型（本地结论）'] = summary.rideType
    payload['数据摘要（本地生成）'] = summary.headline
  }
  if (activity.distance !== undefined && activity.distance > 0) {
    payload['距离'] = formatDistanceByUnit(activity.distance, unit)
  }
  if (activity.duration > 0) {
    payload['时长'] = formatDurationText(activity.duration)
  }
  if (activity.elevationGain !== undefined && activity.elevationGain > 0) {
    payload['累计爬升'] = `${Math.round(activity.elevationGain)} 米`
  }
  if (activity.avgSpeed !== undefined && activity.avgSpeed > 0) {
    payload['均速'] = formatSpeedByUnit(activity.avgSpeed, unit)
  }
  const power = activity.normalizedPower ?? activity.avgPower
  if (power !== undefined && power > 0) {
    payload[power === activity.normalizedPower ? '标准化功率' : '平均功率'] = `${Math.round(power)} W`
  }
  if (activity.avgHeartRate !== undefined && activity.avgHeartRate > 0) {
    payload['平均心率'] = `${Math.round(activity.avgHeartRate)} bpm`
  }
  if (context.ftp !== undefined && context.ftp > 0) {
    payload['FTP'] = `${Math.round(context.ftp)} W`
  }
  return payload
}

/**
 * payload → prompt 里的数据段（每行一条「键：值」）。
 *
 * @param payload buildAiMetricsPayload 的结果
 */
export function formatMetricsForPrompt(payload: Record<string, string | number>): string {
  return Object.entries(payload)
    .map(([key, value]) => `${key}：${String(value)}`)
    .join('\n')
}

/**
 * 构建发布文案生成请求。
 *
 * @param activity 活动摘要
 * @param platform 目标平台
 * @param context 训练配置上下文
 */
export function buildCaptionRequest(
  activity: Activity,
  platform: AiCaptionPlatform,
  context: AiActivityContext = {},
): AiChatRequest {
  const dataText = formatMetricsForPrompt(buildAiMetricsPayload(activity, context))
  if (platform === 'xhs') {
    return {
      system: `你是骑行记录网站的社媒文案助手，为小红书写发布文案。${COMMON_CONSTRAINTS}
输出格式（严格遵守，共两部分，用空行分隔）：
第一行：标题，不超过 20 个字，必须包含数据里的一个数字，末尾不加标点；
空行之后：正文，3 到 6 行短句，最后附 3 到 5 个话题标签（# 开头，空格分隔）。`,
      user: `请根据这次骑行的真实数据写小红书发布文案。\n\n${dataText}`,
      maxTokens: CAPTION_MAX_TOKENS,
      temperature: CAPTION_TEMPERATURE,
    }
  }
  return {
    system: `你是骑行记录网站的社媒文案助手，为微信朋友圈写发布文案。${COMMON_CONSTRAINTS}
输出格式：只输出文案本体，2 到 4 行，第一行给出重点，不加标题、不加任何前缀说明。`,
    user: `请根据这次骑行的真实数据写朋友圈文案。\n\n${dataText}`,
    maxTokens: CAPTION_MAX_TOKENS,
    temperature: CAPTION_TEMPERATURE,
  }
}

/**
 * 构建 AI 解读请求（详情页一句话总结区的展开解读）。
 *
 * @param activity 活动摘要
 * @param context 训练配置上下文
 */
export function buildInsightRequest(activity: Activity, context: AiActivityContext = {}): AiChatRequest {
  const dataText = formatMetricsForPrompt(buildAiMetricsPayload(activity, context))
  return {
    system: `你是骑行数据分析助手，向骑手解释一次训练的含义。${COMMON_CONSTRAINTS}
输出格式：只输出解读本体，不超过 2 句，说明这次骑行的强度与类型含义；不提供医疗或训练计划建议。`,
    user: `以下是本地已算好的本次骑行数据与结论，请解释这次训练：\n\n${dataText}`,
    maxTokens: INSIGHT_MAX_TOKENS,
    temperature: INSIGHT_TEMPERATURE,
  }
}

/** 剥掉模型偶尔包上的 markdown 代码围栏 */
function stripCodeFence(text: string): string {
  const fenced = text.match(/^```(?:\w+)?\n([\s\S]*?)\n?```$/)
  return fenced !== null ? fenced[1].trim() : text.trim()
}

/** 剥掉「标题：」「文案：」一类前缀（模型不守格式时的兜底） */
function stripLabelPrefix(line: string): string {
  return line.replace(/^(标题|正文|文案|内容)\s*[：:]\s*/, '')
}

/**
 * 解析文案模型输出。
 *
 * @param platform 目标平台
 * @param text 模型输出原文
 * @returns xhs 拆出标题（首行）与正文；moments 整段即正文
 */
export function parseCaptionResponse(platform: AiCaptionPlatform, text: string): AiCaptionResult {
  const cleaned = stripCodeFence(text)
  if (platform === 'moments') {
    return { body: stripLabelPrefix(cleaned) }
  }
  const lines = cleaned.split('\n')
  const firstLine = stripLabelPrefix(lines[0]?.trim() ?? '')
  const restBody = lines.slice(1).join('\n').trim()
  // 模型只回了一段话（没分标题/正文）：整体作正文，标题缺省（不硬拆）
  if (restBody.length === 0) {
    return { title: undefined, body: firstLine }
  }
  return {
    title: firstLine.length > 0 ? firstLine.slice(0, 20) : undefined,
    body: restBody,
  }
}
