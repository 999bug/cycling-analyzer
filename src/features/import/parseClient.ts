/**
 * 主线程侧 worker 解析客户端（规格 §23）。
 *
 * createWorkerParser 为每次调用创建独立 worker（一批导入一个 worker，
 * 逐文件复用；失败即销毁，避免跨批次残留状态）。
 * worker 通过结构化克隆收发 ArrayBuffer 与 Activity，解析失败时
 * worker 内已分类错误文案，主线程以 Error 抛出。
 */
import type { Activity } from '@/types/activity'
import type { ParseFileFn, ParseRequest, ParseResponse } from '@/fit/worker/parseTask'

/**
 * 创建基于 Web Worker 的单文件解析函数。
 *
 * @returns 解析函数（worker 加载失败时 Promise 拒绝）
 */
export function createWorkerParser(): ParseFileFn {
  const worker = new Worker(new URL('../../fit/worker/parseWorker.ts', import.meta.url), {
    type: 'module',
  })
  const pending = new Map<number, (response: ParseResponse) => void>()
  let nextId = 1

  worker.onmessage = (event: MessageEvent<ParseResponse>) => {
    const response = event.data
    const resolve = pending.get(response.id)
    if (resolve) {
      pending.delete(response.id)
      resolve(response)
    }
  }

  // worker 加载或运行失败：拒绝所有未决请求，避免 Promise 悬挂
  worker.onerror = () => {
    const errorMessage = 'FIT parse worker failed'
    for (const resolve of pending.values()) {
      resolve({ id: 0, ok: false, errorMessage })
    }
    pending.clear()
  }

  return (input) =>
    new Promise<Activity>((resolvePromise, rejectPromise) => {
      const id = nextId++
      pending.set(id, (response) => {
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
        pending.delete(id)
        rejectPromise(error instanceof Error ? error : new Error(String(error)))
      }
    })
}
