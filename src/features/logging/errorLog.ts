/**
 * 运行时错误日志（本地留存，便于事后定位）。
 *
 * 背景：错误此前只打印到控制台，用户报障时无从查证（关掉调试台就没有痕迹）。
 * 本模块把「操作中报的错」落到 IndexedDB（error_logs 表，DB v7），
 * 用户可在「更多 → 错误日志」查看、导出、清空。
 *
 * 采集口径：
 * - 全局安装（installErrorLogging，main.tsx 调用）：console.error、
 *   window error、未处理的 Promise 拒绝；
 * - React 错误边界（ErrorBoundary）与业务代码主动调用 logError。
 *
 * 三条自保约束（日志系统不能反过来制造问题）：
 * 1. 写库失败一律静默，绝不 console.error（否则与全局采集形成递归）；
 * 2. 同一来源 + 同一消息的连续重复在 2 秒窗口内只记一条（瓦片失败等会刷屏）；
 * 3. 总量上限 500 条，超出淘汰最旧的（避免长期累积占满配额）。
 */
import { db, type CyclingDatabase, type ErrorLogEntity } from '@/storage/db'

/** 日志级别 */
export type ErrorLogLevel = 'error' | 'warn'

/** 日志条目（入库实体，读取时 id 必有值） */
export type ErrorLogEntry = ErrorLogEntity & { id: number }

/** 留存上限（条）：超出后淘汰最旧的一条 */
export const ERROR_LOG_MAX_ENTRIES = 500

/** 连续重复去重窗口（毫秒） */
const DEDUPE_WINDOW_MS = 2000

/** 单字段最大字符数（消息/堆栈/上下文分别截断，防超大对象入库） */
const MAX_MESSAGE_CHARS = 2000
const MAX_STACK_CHARS = 4000
const MAX_CONTEXT_CHARS = 2000

/** 写入进行中标记：日志自身的失败不再触发新日志（防递归） */
let writing = false

/** 上一条日志的（来源+消息）与写入时刻，用于连续重复去重 */
let lastKey = ''
let lastAt = 0

/**
 * 把任意抛出物收敛为消息与堆栈。
 *
 * @param error Error / 字符串 / 任意对象
 */
function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack }
  }
  if (typeof error === 'string') {
    return { message: error }
  }
  try {
    return { message: JSON.stringify(error) ?? String(error) }
  } catch {
    return { message: String(error) }
  }
}

/**
 * 附加上下文转可入库字符串（序列化失败退化为 String）。
 *
 * @param context 任意可序列化对象
 */
function stringifyContext(context: unknown): string | undefined {
  if (context === undefined) {
    return undefined
  }
  try {
    const text = JSON.stringify(context)
    return text === undefined ? String(context) : text
  } catch {
    return String(context)
  }
}

/** 按上限截断文本 */
function truncate(text: string | undefined, max: number): string | undefined {
  if (text === undefined) {
    return undefined
  }
  return text.length > max ? `${text.slice(0, max)}…（已截断）` : text
}

/**
 * 记录一条错误日志（fire-and-forget，调用方无需 await）。
 *
 * 失败静默：日志写不进去（数据库被锁/配额满/隐私模式）不能影响业务流程，
 * 也不再打印（避免与全局 console.error 采集形成递归）。
 *
 * @param level 级别
 * @param source 来源标识（如 'import' / 'console' / 'window'）
 * @param error 错误对象或消息
 * @param context 附加上下文（可选，需可序列化）
 * @param database 数据库实例（测试注入；缺省全局单例）
 */
export async function logError(
  level: ErrorLogLevel,
  source: string,
  error: unknown,
  context?: unknown,
  database: CyclingDatabase = db,
): Promise<void> {
  if (writing) {
    return
  }
  const { message, stack } = describeError(error)
  const key = `${source}|${message}`
  const now = Date.now()
  if (key === lastKey && now - lastAt < DEDUPE_WINDOW_MS) {
    return
  }
  lastKey = key
  lastAt = now

  const entry: ErrorLogEntity = {
    createdAt: new Date(now).toISOString(),
    level,
    source,
    message: truncate(message, MAX_MESSAGE_CHARS) ?? '未知错误',
    stack: truncate(stack, MAX_STACK_CHARS),
    context: truncate(stringifyContext(context), MAX_CONTEXT_CHARS),
    path: typeof window === 'undefined' ? undefined : window.location.pathname,
    appVersion: __APP_VERSION__,
  }

  writing = true
  try {
    await database.error_logs.add(entry)
    const count = await database.error_logs.count()
    if (count > ERROR_LOG_MAX_ENTRIES) {
      // 淘汰最旧的：按自增主键升序删掉超出的部分
      const overflow = count - ERROR_LOG_MAX_ENTRIES
      const oldest = await database.error_logs.orderBy('id').limit(overflow).primaryKeys()
      await database.error_logs.bulkDelete(oldest)
    }
  } catch {
    // 静默：见文件头自保约束 1
  } finally {
    writing = false
  }
}

/**
 * 读取最近的错误日志（倒序：最新在前）。
 *
 * @param limit 条数上限
 * @param database 数据库实例（测试注入；缺省全局单例）
 */
export async function listErrorLogs(
  limit: number = 100,
  database: CyclingDatabase = db,
): Promise<ErrorLogEntry[]> {
  try {
    const rows = await database.error_logs.orderBy('id').reverse().limit(limit).toArray()
    return rows.filter((row): row is ErrorLogEntry => row.id !== undefined)
  } catch {
    return []
  }
}

/**
 * 清空全部错误日志。
 *
 * @param database 数据库实例（测试注入；缺省全局单例）
 */
export async function clearErrorLogs(database: CyclingDatabase = db): Promise<void> {
  try {
    await database.error_logs.clear()
  } catch {
    // 静默：清空失败不影响后续使用
  }
}

/**
 * 导出日志为 JSON 文本（供用户下载或粘贴给开发者）。
 *
 * @param database 数据库实例（测试注入；缺省全局单例）
 */
export async function exportErrorLogs(database: CyclingDatabase = db): Promise<string> {
  const entries = await listErrorLogs(ERROR_LOG_MAX_ENTRIES, database)
  return JSON.stringify(
    { app: 'cycling-analyzer', version: 1, exportedAt: new Date().toISOString(), entries },
    null,
    2,
  )
}

/**
 * 安装全局错误采集（console.error / window error / unhandledrejection）。
 *
 * 只在应用入口调用一次；测试可调用并取返回值卸载，避免污染其它用例。
 *
 * @returns 卸载函数（恢复原 console.error 并移除监听）
 */
export function installErrorLogging(): () => void {
  // 保存原引用（不 bind：卸载时原样还原，行为与安装前完全一致）
  const original = console.error
  console.error = (...args: unknown[]) => {
    original.apply(console, args)
    void logError('error', 'console', args[0], args.length > 1 ? { args: args.slice(1) } : undefined)
  }

  const onError = (event: ErrorEvent) => {
    void logError('error', 'window', event.error ?? event.message, {
      filename: event.filename,
      lineno: event.lineno,
    })
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    void logError('error', 'promise', event.reason)
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  return () => {
    console.error = original
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
