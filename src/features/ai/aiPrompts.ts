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

/**
 * 内容面增强提示词（AI 接入 v4）。
 *
 * 三个区块（骑行洞察 / 综合评分 / 赛段点评）默认展示本地确定性结论，
 * 点「AI 解读」后把**本地已算好的结论**喂给模型改写成有温度的叙事——
 * AI 只负责换一种说法，禁止引入任何数据之外的新数字（口径同 v2 硬约束）。
 */

/** 本地结论条目（洞察列表通用结构） */
export interface AiLocalConclusion {
  /** 分类标签 */
  kind: string

  /** 结论标题 */
  title: string

  /** 结论正文 */
  text: string
}

/** 结论列表 → prompt 数据段（每行一条「[分类] 标题：正文」） */
function formatConclusions(conclusions: readonly AiLocalConclusion[]): string {
  return conclusions
    .map((item) => `- [${item.kind}] ${item.title}：${item.text}`)
    .join('\n')
}

/** 富数据原料：本地已算好的确定性聚合指标（喂给 AI 找模式，而非复述结论） */
export interface AiRichFacts {
  /** 分段（按 5km 桶）：均速 / 平均心率 */
  splits: readonly {
    index: number
    distanceKm: number
    avgSpeedKmh: number | undefined
    avgHeartRate: number | undefined
  }[]

  /** 爬坡段（最多取 5 段） */
  climbs: readonly { distanceKm: number; gainM: number; avgGradePercent: number }[]

  /** 近期基线一句话（如「近 5 次骑行平均速度 27.3 km/h」；样本不足时 undefined） */
  recentBaselineText?: string

  /** 本次活动均速（km/h，与基线对比用） */
  activityAvgSpeedKmh?: number
}

/** 把富数据原料格式化成 prompt 数据段 */
function formatRichFacts(rich: AiRichFacts): string {
  const parts: string[] = []
  if (rich.splits.length > 0) {
    const lines = rich.splits
      .map((split) => {
        const speed =
          split.avgSpeedKmh === undefined ? '无数据' : `${split.avgSpeedKmh.toFixed(1)} km/h`
        const hr = split.avgHeartRate === undefined ? '' : `，平均心率 ${Math.round(split.avgHeartRate)} bpm`
        const from = ((split.index - 1) * split.distanceKm).toFixed(0)
        const to = (split.index * split.distanceKm).toFixed(0)
        return `- 第 ${split.index} 段（${from}-${to} km）：均速 ${speed}${hr}`
      })
      .join('\n')
    parts.push(`分段数据：\n${lines}`)
  }
  if (rich.climbs.length > 0) {
    const lines = rich.climbs
      .map((climb) => `- ${climb.distanceKm.toFixed(1)} km 爬升 ${Math.round(climb.gainM)} m，平均坡度 ${climb.avgGradePercent.toFixed(1)}%`)
      .join('\n')
    parts.push(`爬坡段：\n${lines}`)
  }
  if (rich.recentBaselineText !== undefined) {
    parts.push(`近期基线：${rich.recentBaselineText}`)
  }
  return parts.join('\n')
}

/** 改写类提示词的通用硬约束（v5：喂原料、派任务，允许自由推导但禁编数值） */
const NARRATIVE_CONSTRAINTS = [
  '硬性约束：',
  '1. 所有数值必须与「给定数据」一致，禁止编造或修改任何数值；',
  '2. 允许（且鼓励）从数据中推导模式与因果联想，但要把推理依据点明；',
  '3. 至少给出 2 条「本地结论」中没有提到的新观察（由分段/爬坡/基线等原始数据推导）；',
  '4. 不要逐条复述本地结论——本地结论只是背景参考，重点是你自己从数据里发现的东西；',
  '5. 禁止营销话术、浮夸形容词与 emoji；用简体中文口语书写。',
].join('\n')

/** 洞察增强的切入视角（重新生成时轮换，让「换一版」真的换） */
export type AiInsightPerspective = 'pacing' | 'body' | 'history'

/** 视角的中文说明与任务指令 */
const PERSPECTIVE_TASKS: Record<AiInsightPerspective, string> = {
  pacing: '节奏策略：从分段配速与功率变化切入，分析这次骑行的节奏安排得失。',
  body: '身体反应：从心率区间与漂移走势切入，分析心肺与体能在这次骑行中的表现。',
  history: '历史对比：从与近期基线、个人最佳的差异切入，分析当前状态所处的位置。',
}

/** 洞察增强的输出 token 上限（3 段叙事，给思考型模型留余量） */
const INSIGHT_ENHANCE_MAX_TOKENS = 4000

/** 赛段点评的输出 token 上限 */
const SEGMENT_COMMENT_MAX_TOKENS = 2000

/**
 * 骑行洞察增强请求（v5：喂原料、派任务——基于分段/爬坡/基线找模式，
 * 要求至少 2 条本地结论之外的新观察；视角轮换驱动「换一版」差异）。
 *
 * @param activity 活动摘要
 * @param conclusions buildRideInsights 的本地结论（背景参考）
 * @param rich 富数据原料（分段/爬坡/基线）
 * @param perspective 切入视角（重新生成时轮换）
 */
export function buildInsightEnhanceRequest(
  activity: Activity,
  conclusions: readonly AiLocalConclusion[],
  rich: AiRichFacts,
  perspective: AiInsightPerspective = 'pacing',
): AiChatRequest {
  return {
    system: `你是骑行数据解读员。任务：基于给定数据，讲出本地规则结论讲不出来的东西。${NARRATIVE_CONSTRAINTS}
本次切入视角：${PERSPECTIVE_TASKS[perspective]}
输出格式：3 段，段与段之间空一行，每段 1~3 句；每段开头用一个 2~4 字的主题词加冒号（如「节奏：」）。`,
    user: `本地结论（背景参考，不要复述）：\n${formatConclusions(conclusions)}\n\n给定数据：\n${formatRichFacts(rich)}\n\n活动：${activity.name ?? '骑行记录'}`,
    maxTokens: INSIGHT_ENHANCE_MAX_TOKENS,
    temperature: CAPTION_TEMPERATURE,
  }
}

/**
 * 综合评分解读请求（v5：带富数据原料，解释分数构成 + 一个行动建议）。
 *
 * @param overall 综合分（0-100）
 * @param subScores 分项得分（label + score）
 * @param activity 活动摘要
 * @param rich 富数据原料（可选；有则要求解读引用分段/爬坡事实）
 */
export function buildScoreExplainRequest(
  overall: number,
  subScores: readonly { label: string; score: number | undefined }[],
  activity: Activity,
  rich?: AiRichFacts,
): AiChatRequest {
  const dims = subScores
    .map((item) => `${item.label}：${item.score === undefined ? '无数据' : `${Math.round(item.score)}/100`}`)
    .join('\n')
  const richText = rich !== undefined ? `\n\n给定数据：\n${formatRichFacts(rich)}` : ''
  return {
    system: `你是骑行数据解读员，解释一次骑行的综合评分是怎么构成的。${NARRATIVE_CONSTRAINTS}
输出格式：1 段，2~4 句。说明分数高在哪、失分失在哪、这个分数对接下来训练节奏意味着什么（可建议恢复，不做医疗表述）。`,
    user: `综合分：${Math.round(overall)}/100\n分项：\n${dims}${richText}\n\n活动：${activity.name ?? '骑行记录'}`,
    maxTokens: INSIGHT_ENHANCE_MAX_TOKENS,
    temperature: INSIGHT_TEMPERATURE,
  }
}

/** 单条赛段的展示数据（来自 ActivityMatchedSegments 的行数据） */
export interface AiSegmentView {
  /** 赛段名 */
  name: string

  /** 本次用时（秒） */
  durationSeconds: number

  /** 历史最好（秒）；undefined = 首次成绩（新纪录） */
  prSeconds?: number

  /** 含本次的排名（1 起） */
  rank: number

  /** 距离（km） */
  distanceKm: number

  /** 本次均速（m/s；缺失 = undefined） */
  avgSpeed?: number

  /** 本次平均功率（W；缺失 = undefined） */
  avgPower?: number
}

/** 秒 → h:mm:ss / m:ss 口径文本（与赛段页展示一致的数量级） */
function formatDurationClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

/**
 * 赛段点评请求：一段综述 + 每条赛段一句点评。
 *
 * @param views 本次经过的赛段行
 * @param activity 活动摘要
 */
export function buildSegmentsCommentRequest(
  views: readonly AiSegmentView[],
  activityName: string | undefined,
): AiChatRequest {
  const lines = views
    .map((view) => {
      const isNewRecord =
        view.prSeconds === undefined || view.durationSeconds < view.prSeconds
      const pr = isNewRecord
        ? `新纪录（较此前最好快 ${formatDurationClock(Math.abs(view.durationSeconds - (view.prSeconds ?? view.durationSeconds)))}）`
        : `vs 最好 +${formatDurationClock(view.durationSeconds - (view.prSeconds ?? view.durationSeconds))}`
      const extra = [
        view.avgSpeed !== undefined ? `均速 ${(view.avgSpeed * 3.6).toFixed(1)} km/h` : undefined,
        view.avgPower !== undefined ? `平均功率 ${Math.round(view.avgPower)} W` : undefined,
      ]
        .filter(Boolean)
        .join('，')
      return `- ${view.name}（${view.distanceKm.toFixed(1)} km）：本次 ${formatDurationClock(view.durationSeconds)}，${pr}，排名 #${view.rank}${extra.length > 0 ? `，${extra}` : ''}`
    })
    .join('\n')
  return {
    system: `你是骑行赛段解读员。${NARRATIVE_CONSTRAINTS}
输出格式：第一段 1~2 句综述（把几条赛段连起来讲一个故事）；之后每条赛段各一行，格式严格为「赛段名：一句点评」，点评要说清快慢背后的原因或值得注意的点。`,
    user: `本次骑行经过以下赛段（数据来自本地计时）：\n${lines}\n\n活动：${activityName ?? '骑行记录'}`,
    maxTokens: SEGMENT_COMMENT_MAX_TOKENS,
    temperature: CAPTION_TEMPERATURE,
  }
}

/**
 * 赛段推荐命名请求（本地挖掘候选段 → AI 起名）。
 *
 * 数据边界：只上行聚合特征（长度 / 共现次数），不含 GPS 轨迹点。
 * 输出约束：短中文名、只回名称本身——结果仅作为推荐卡名称输入框的预填草稿。
 */
export function buildSegmentNameRequest(stats: {
  distanceKm: number
  hitCount: number
}): AiChatRequest {
  return {
    system: `你是骑行社区的赛段命名助手。根据路段特征起一个简短中文赛段名：6 字以内、无标点、可体现路况或气质（如爬坡、冲刺、河堤）。只输出名称本身，不要解释、不要引号。`,
    user: `路段长度 ${stats.distanceKm.toFixed(2)} km，被不同骑行经过 ${stats.hitCount} 次。请起一个赛段名。`,
    maxTokens: 100,
    temperature: 0.7,
  }
}
