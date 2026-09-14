/**
 * AI 诊断日志（本地排查用，环形缓冲）。
 *
 * 记录每次 AI 调用的**脱敏元数据**：时间 / 功能标签 / 模型 / 服务商域名 /
 * 结果 / 耗时 / 失败原因（客户端已有的中文错误文案）。刻意不记录：
 * prompt 正文、API Key、任何轨迹或用户数据——日志文件本身可安全查看。
 *
 * 存储：独立 localStorage 键（与 AI 配置同理不进 Dexie settings 表，
 * 不随「导出数据」JSON 备份走）；环形上限 200 条，超出淘汰最旧；
 * 读写失败（隐私模式 / 配额满）静默降级为内存态，不影响主功能。
 */
const STORAGE_KEY = 'cycling-ai-debug-log'
const MAX_ENTRIES = 200

/** 单条日志（字段全部脱敏元数据，不含提示词与密钥） */
export interface AiDebugEntry {
  /** 时间戳（Unix 毫秒） */
  ts: number

  /** 功能标签（segment-name / share-caption / insight-enhance …） */
  feature: string

  /** 模型名 */
  model: string

  /** 服务商域名（不含路径与 Key） */
  host: string

  /** 结果 */
  status: 'ok' | 'error'

  /** 耗时（毫秒） */
  durationMs: number

  /** 失败原因（客户端翻译后的中文文案；成功时缺省） */
  detail?: string

  /** 流式输出字数（流式调用有值；成功时展示用） */
  outputChars?: number
}

/** 内存镜像（读失败时的兜底，写路径主用 localStorage） */
let memoryLog: AiDebugEntry[] | null = null

function readLog(): AiDebugEntry[] {
  if (memoryLog !== null) {
    return memoryLog
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw === null ? [] : (JSON.parse(raw) as AiDebugEntry[])
    memoryLog = Array.isArray(parsed) ? parsed.filter((entry) => typeof entry?.ts === 'number') : []
  } catch {
    memoryLog = []
  }
  return memoryLog
}

function writeLog(entries: AiDebugEntry[]): void {
  memoryLog = entries
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // 隐私模式 / 配额满：保留内存态即可，日志不能影响主功能
  }
}

/**
 * 记录一条 AI 调用日志（环形淘汰最旧，写入即持久化）。
 *
 * @param entry 日志内容（调用方负责脱敏：只传元数据，勿传提示词）
 */
export function logAiDebug(entry: AiDebugEntry): void {
  const entries = readLog()
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }
  writeLog(entries)
}

/**
 * 读取全部日志（时间升序，UI 自行倒序展示）。
 */
export function listAiDebugLog(): AiDebugEntry[] {
  return [...readLog()]
}

/**
 * 清空日志（设置页「清空」按钮，调用方自行二次确认）。
 */
export function clearAiDebugLog(): void {
  writeLog([])
}

/**
 * 从 baseUrl 提取服务商域名（脱敏：不含路径、Key、查询串）。
 *
 * @param baseUrl AI 接口地址
 * @returns 域名（如 api.deepseek.com）；解析失败返回 'unknown'
 */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return 'unknown'
  }
}
