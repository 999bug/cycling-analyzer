/**
 * AI 供应商预设库（AI 接入 v2，照 cc-switch 形态扩充）。
 *
 * 结构（原型评审定稿，2026-09-14）：
 * - AI_COMMON_TEMPLATES：8 张常用模板卡（置顶展示，覆盖绝大多数场景）
 * - AI_PRESET_LIBRARY：完整预设库（60 条），来源 cc-switch 开源仓库
 *   （MIT License，github.com/farion1231/cc-switch 的 codexProviderPresets.ts，
 *   抽取其 OpenAI 兼容端点并剔除 Claude Code 专属 OAuth 卡、订阅计划专属
 *   变体与纯 anthropic-messages 协议端点）；设置页「更多供应商」按分类 +
 *   搜索使用。端点可用性以接入实测为准，供应商侧调整时在此表同步。
 * - 全部走 OpenAI 兼容 chat/completions（一个 adapter 通吃）；个别厂商
 *   需要附加请求头（如 Claude 的 anthropic-dangerous-direct-browser-access），
 *   由 preset.extraHeaders 描述，aiClient 请求时合并。
 */

/** 预设条目通用类型（常用模板与预设库共用） */
export interface AiVendorPreset {
  /** 标识（vendorId，配置里只存它） */
  id: string

  /** 展示名 */
  name: string

  /** OpenAI 兼容接口根地址（custom 为空串，由用户填写） */
  baseUrl: string

  /** 预设模型（常用模板有默认列表；库内条目由「获取模型列表」填充） */
  models: readonly string[]

  /** 预设分类（常用模板不展示分类） */
  category?: AiVendorCategory

  /** 分类一句话说明（模板卡用） */
  desc?: string

  /** 请求需附加的 HTTP 头（如 Claude 浏览器直连专用头） */
  extraHeaders?: Record<string, string>
}

/** 预设库分类 */
export type AiVendorCategory = 'official' | 'aggregator' | 'relay'

/** 中文分类名（设置页分类 chips） */
export const AI_VENDOR_CATEGORY_LABELS: Record<AiVendorCategory, string> = {
  official: '官方厂商',
  aggregator: '聚合平台',
  relay: '中转站',
}

/** 常用模板卡（置顶，顺序即展示顺序） */
export const AI_COMMON_TEMPLATES: readonly AiVendorPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    desc: '官方 API · OpenAI 兼容',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    desc: 'glm-4-flash 免费',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.5-air', 'glm-4-flash', 'glm-4.5'],
  },
  {
    id: 'kimi',
    name: 'Kimi（月之暗面）',
    desc: 'OpenAI 兼容接口',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-8k', 'moonshot-v1-32k'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    desc: '一个 Key 用多家模型',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['deepseek/deepseek-chat-v3.1', 'openai/gpt-4o-mini'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    desc: 'GPT 系列 · 官方 API',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'],
  },
  {
    id: 'anthropic',
    name: 'Claude（Anthropic）',
    desc: '浏览器直连需专用请求头（已内置）',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-haiku-4.5', 'claude-sonnet-4.5'],
    extraHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' },
  },
  {
    id: 'qwen',
    name: '通义千问',
    desc: '阿里云百炼 · OpenAI 兼容模式',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-flash', 'qwen-plus', 'qwen-max'],
  },
  {
    id: 'custom',
    name: '自定义 / 中转',
    desc: '任意 OpenAI 兼容接口',
    baseUrl: '',
    models: [],
  },
]

/** 预设库条目快捷构造（库内条目不带默认模型列表） */
function preset(id: string, name: string, category: AiVendorCategory, baseUrl: string, extraHeaders?: Record<string, string>): AiVendorPreset {
  return { id, name, baseUrl, models: [], category, extraHeaders }
}

/** 完整预设库（60 条；常用模板外的部分，分类供搜索过滤） */
export const AI_PRESET_LIBRARY: readonly AiVendorPreset[] = [
  preset('deepseek', 'DeepSeek', 'official', 'https://api.deepseek.com/v1'),
  preset('zhipu', '智谱 GLM', 'official', 'https://open.bigmodel.cn/api/paas/v4'),
  preset('zhipu-intl', '智谱 GLM（国际 z.ai）', 'official', 'https://api.z.ai/api/v1'),
  preset('kimi', 'Kimi（月之暗面）', 'official', 'https://api.moonshot.cn/v1'),
  preset('kimi-coding', 'Kimi Coding 开放平台', 'official', 'https://api.kimi.com/coding/v1'),
  preset('qwen', '通义千问（阿里百炼）', 'official', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
  preset('qwen-intl', '通义千问（国际）', 'official', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
  preset('siliconflow', '硅基流动 SiliconFlow', 'official', 'https://api.siliconflow.cn/v1'),
  preset('siliconflow-intl', '硅基流动（国际）', 'official', 'https://api.siliconflow.com/v1'),
  preset('minimax', 'MiniMax', 'official', 'https://api.minimaxi.com/v1'),
  preset('minimax-intl', 'MiniMax（国际）', 'official', 'https://api.minimax.io/v1'),
  preset('stepfun', '阶跃星辰 StepFun', 'official', 'https://api.stepfun.com/v1'),
  preset('ark', '火山方舟（豆包）', 'official', 'https://ark.cn-beijing.volces.com/api/v3'),
  preset('hunyuan', '腾讯混元 TokenHub', 'official', 'https://tokenhub.tencentmaas.com/v1'),
  preset('qianfan', '百度千帆', 'official', 'https://qianfan.baidubce.com/v2'),
  preset('mimo', '小米 MiMo', 'official', 'https://api.xiaomimimo.com/v1'),
  preset('longcat', '美团 LongCat', 'official', 'https://api.longcat.chat/openai/v1'),
  preset('modelscope', '魔搭 ModelScope', 'official', 'https://api-inference.modelscope.cn/v1'),
  preset('xai', 'xAI（Grok）', 'official', 'https://api.x.ai/v1'),
  preset('openai', 'OpenAI', 'official', 'https://api.openai.com/v1'),
  preset('anthropic', 'Claude（Anthropic）', 'official', 'https://api.anthropic.com/v1', {
    'anthropic-dangerous-direct-browser-access': 'true',
  }),
  preset('nvidia', 'NVIDIA NIM', 'official', 'https://integrate.api.nvidia.com/v1'),
  preset('novita', 'Novita AI', 'official', 'https://api.novita.ai/openai/v1'),
  preset('openrouter', 'OpenRouter', 'aggregator', 'https://openrouter.ai/api/v1'),
  preset('dmxapi', 'DMXAPI', 'aggregator', 'https://www.dmxapi.cn/v1'),
  preset('aihubmix', 'AiHubMix', 'aggregator', 'https://aihubmix.com/v1'),
  preset('cherryin', 'CherryIn', 'aggregator', 'https://open.cherryin.net/v1'),
  preset('jiekou', '接口站 Jiekou', 'aggregator', 'https://api.jiekou.ai/openai/v1'),
  preset('ppio', 'PPIO 派欧云', 'aggregator', 'https://api.ppio.com/openai/v1'),
  preset('compshare', '算力互联 Compshare', 'aggregator', 'https://api.modelverse.cn/v1'),
  preset('packycode', 'PackyCode', 'relay', 'https://www.packyapi.ai/v1'),
  preset('zetaapi', 'ZetaAPI', 'relay', 'https://api.zetaapi.ai/v1'),
  preset('aicodemirror', 'AICodeMirror', 'relay', 'https://api.aicodemirror.ai/api/codex/backend-api/codex'),
  preset('patewayai', 'PatewayAI', 'relay', 'https://api.pateway.ai/v1'),
  preset('fenno', 'Fenno.ai', 'relay', 'https://api.fenno.ai'),
  preset('runapi', 'RunAPI', 'relay', 'https://runapi.host/v1'),
  preset('shengsuanyun', '盛随语音', 'relay', 'https://router.shengsuanyun.com/api/v1'),
  preset('aigocode', 'AIGoCode', 'relay', 'https://api.aigocode.app'),
  preset('qiniu', '七牛 AI 网关', 'relay', 'https://api.qnaigc.com/bypass/openai/v1'),
  preset('aicoding', 'AICoding', 'relay', 'https://api.aicoding.inc'),
  preset('subrouter', 'SubRouter', 'relay', 'https://subrouter.ai/v1'),
  preset('code9527', '9527Code', 'relay', 'https://9527.codes/v1'),
  preset('code0', 'Code0', 'relay', 'https://code0.ai/v1'),
  preset('teamorouter', 'TeamoRouter', 'relay', 'https://api.teamorouter.cn/v1'),
  preset('claudecn', 'ClaudeCN', 'relay', 'https://claudecn.top/v1'),
  preset('ccsub', 'CCSub', 'relay', 'https://www.ccsub.net/v1'),
  preset('sssaicode', 'SSSAiCode', 'relay', 'https://node-hk.sssaicodeapi.com/api/v1'),
  preset('soleapi', 'SoleAPI', 'relay', 'https://soleapi.com/v1'),
  preset('micu', 'Micu API', 'relay', 'https://www.micuapi.ai/v1'),
  preset('rightcode', 'RightCode', 'relay', 'https://www.rightapi.ai/codex/v1'),
  preset('etok', 'ETok', 'relay', 'https://api.etok.ai/v1'),
  preset('cubence', 'Cubence', 'relay', 'https://api.cubence.com/v1'),
  preset('crazyrouter', 'CrazyRouter', 'relay', 'https://cn.crazyrouter.com/v1'),
  preset('a6api', 'A6API', 'relay', 'https://api.a6api.com/v1'),
  preset('therouter', 'TheRouter', 'relay', 'https://api.therouter.ai/v1'),
  preset('aicodewith', 'AICodeWith', 'relay', 'https://api.aicodewith.ai/chatgpt/v1'),
  preset('relaxycode', 'RelaxYCode', 'relay', 'https://www.relaxycode.com/v1'),
  preset('xycai', 'XYC', 'relay', 'https://apicdn.xycai.us/v1'),
  preset('amux', 'AMUX', 'relay', 'https://api.amux.ai/v1'),
]

/** 自定义模板的固定 vendorId（唯一一个不在预设库里的模板） */
export const CUSTOM_VENDOR_ID = 'custom'

/**
 * 按 vendorId 查预设（常用模板 + 预设库合并查找）。
 *
 * @param vendorId 供应商标识
 */
export function getAiVendor(vendorId: string | null | undefined): AiVendorPreset | undefined {
  if (vendorId === null || vendorId === undefined) {
    return undefined
  }
  return (
    AI_COMMON_TEMPLATES.find((vendor) => vendor.id === vendorId) ??
    AI_PRESET_LIBRARY.find((vendor) => vendor.id === vendorId)
  )
}
