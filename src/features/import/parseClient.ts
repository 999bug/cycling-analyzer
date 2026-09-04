/**
 * 主线程侧 worker 解析客户端（规格 §23）。
 *
 * createWorkerParser 为每次调用创建独立 worker（一批导入一个 worker，
 * 逐文件复用）。worker 通过结构化克隆收发 ArrayBuffer 与 Activity，
 * 解析失败时 worker 内已分类错误文案，主线程以 Error 抛出。
 *
 * 资源生命周期：
 * - 单文件解析超时（默认 60s）主动 `terminate()` + 拒绝 Promise，
 *   避免 worker OOM/崩溃后主线程 await 永久挂起、UI 进度条卡死
 * - 返回对象含 `dispose()`，importer 批次结束调用清理 worker，
 *   避免随应用生命周期长期驻留（含完整 fitsdk，~384KB）
 */
import type { Activity } from '@/types/activity'
import type { ParseFileFn, ParseRequest, ParseResponse } from '@/fit/worker/parseTask'

/** 单文件解析超时（覆盖绝大多数 Wahoo/Garmin 设备 5Hz×5h 记录） */
const PARSE_TIMEOUT_MS = 60_000

/**
 * worker 解析器句柄。parse 是与 ParseFileFn 兼容的解析函数，
 * dispose 终止 worker 并清理未决请求。
 */
export interface WorkerParserHandle {
  parse: ParseFileFn
  dispose: () => void
}

/**
 * 创建基于 Web Worker 的单文件解析器句柄。
 *
 * @returns 解析句柄（含 dispose；worker 加载失败时 parse 立即拒绝）
 */
export function createWorkerParser(): WorkerParserHandle {
  const worker = new Worker(new URL('../../fit/worker/parseWorker.ts', import.meta.url), {
    type: 'module',
  })
  const pending = new Map<number, (response: ParseResponse) => void>()
  let nextId = 1
  let disposed = false

  /** 拒绝所有未决请求并清理 worker（OOM/超时/dispose 共用） */
  function rejectAll(error: Error): void {
    for (const resolve of pending.values()) {
      resolve({ id: 0, ok: false, errorMessage: error.message })
    }
    pending.clear()
    if (!disposed) {
      disposed = true
      worker.terminate()
    }
  }

  worker.onmessage = (event: MessageEvent<ParseResponse>) => {
    const response = event.data
    const resolve = pending.get(response.id)
    if (resolve) {
      pending.delete(response.id)
      resolve(response)
    }
  }

  // worker 加载或运行失败：拒绝所有未决请求并销毁，避免悬挂 + 泄漏
  worker.onerror = () => {
    rejectAll(new Error('FIT parse worker failed'))
  }

  const parse: ParseFileFn = (input) =>
    new Promise<Activity>((resolvePromise, rejectPromise) => {
      if (disposed) {
        rejectPromise(new Error('Worker parser already disposed'))
        return
      }
      const id = nextId++
      // 超时竞态：超时主动 terminate 并拒绝本请求
      const timeoutHandle = setTimeout(() => {
        const reject = pending.get(id)
        if (reject) {
          pending.delete(id)
          rejectAll(new Error(`FIT parse timeout after ${PARSE_TIMEOUT_MS}ms`))
        }
      }, PARSE_TIMEOUT_MS)
      pending.set(id, (response) => {
        clearTimeout(timeoutHandle)
        if (response.ok) {
          resolvePromise(response.activity)
        } else {
          rejectPromise(new Error(response.errorMessage))
        }
      })
      try {
        worker.postMessage({
          id,
          fileName: input.fileName,
          bytes: input.bytes,
          fingerprint: input.fingerprint,
        } satisfies ParseRequest)
      } catch (error) {
        clearTimeout(timeoutHandle)
        pending.delete(id)
        rejectPromise(error instanceof Error ? error : new Error(String(error)))
      }
    })

  return {
    parse,
    dispose() {
      if (disposed) {
        return
      }
      // 拒绝所有未决但不再销毁 worker（正常批次结束，
      // dispose 是协作式释放，不应误伤尚在飞行中的请求）
      // 但为简化语义：dispose 等价于「本批次结束」，未完成的请求一并拒绝
      rejectAll(new Error('Worker parser disposed'))
    },
  }
}
