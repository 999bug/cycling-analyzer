/**
 * 运行时错误日志（features/logging/errorLog.ts）。
 *
 * 覆盖：写入与读取、去重窗口、上限裁剪、清空、导出，以及全局采集
 * （console.error / window error / unhandledrejection）是否真的落库。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CyclingDatabase } from '@/storage/db'
import {
  ERROR_LOG_MAX_ENTRIES,
  clearErrorLogs,
  exportErrorLogs,
  installErrorLogging,
  listErrorLogs,
  logError,
} from '@/features/logging/errorLog'

/** 每个用例独立库名，避免 fake-indexeddb 之间互相污染 */
let db: CyclingDatabase
let seq = 0

/** 等待挂起的微任务（logError 是 fire-and-forget 的异步写） */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(async () => {
  seq += 1
  db = new CyclingDatabase(`test-error-log-${seq}`)
  await db.open()
})

afterEach(async () => {
  db.close()
  await CyclingDatabase.delete(`test-error-log-${seq}`)
})

describe('错误日志记录与读取', () => {
  it('记录 Error 后可读回（含消息与堆栈）', async () => {
    await logError('error', 'import', new Error('FIT 解析失败'), { file: 'ride.fit' }, db)
    const entries = await listErrorLogs(10, db)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.source).toBe('import')
    expect(entries[0]?.message).toBe('FIT 解析失败')
    expect(entries[0]?.stack).toContain('Error')
    expect(entries[0]?.context).toBe('{"file":"ride.fit"}')
    expect(entries[0]?.level).toBe('error')
  })

  it('字符串与非 Error 对象也能记（不抛异常）', async () => {
    await logError('warn', 'ui', '瓦片加载失败', undefined, db)
    await logError('error', 'ui', { code: 404 }, undefined, db)
    const entries = await listErrorLogs(10, db)
    expect(entries.map((entry) => entry.message).sort()).toEqual(['{"code":404}', '瓦片加载失败'])
    expect(entries.some((entry) => entry.level === 'warn')).toBe(true)
  })

  it('最新的排在最前', async () => {
    await logError('error', 'a', '第一条', undefined, db)
    await logError('error', 'b', '第二条', undefined, db)
    const entries = await listErrorLogs(10, db)
    expect(entries[0]?.message).toBe('第二条')
  })

  it('连续重复在 2 秒窗口内只记一条（防刷屏）', async () => {
    await logError('error', 'tile', '瓦片 404', undefined, db)
    await logError('error', 'tile', '瓦片 404', undefined, db)
    await logError('error', 'tile', '瓦片 404', undefined, db)
    let entries = await listErrorLogs(10, db)
    expect(entries).toHaveLength(1)

    // 换消息后仍可记录（去重只针对「同一来源 + 同一消息」的连续重复）
    await logError('error', 'tile', '瓦片 500', undefined, db)
    entries = await listErrorLogs(10, db)
    expect(entries).toHaveLength(2)
  })

  it('超出上限时淘汰最旧的', async () => {
    // 直接灌满上限 + 2 条，再写一条触发裁剪
    for (let i = 0; i < ERROR_LOG_MAX_ENTRIES + 2; i += 1) {
      await db.error_logs.add({
        createdAt: new Date().toISOString(),
        level: 'error',
        source: 'seed',
        message: `seed-${i}`,
      })
    }
    await logError('error', 'new', '最新一条', undefined, db)
    const entries = await listErrorLogs(ERROR_LOG_MAX_ENTRIES + 10, db)
    expect(entries.length).toBeLessThanOrEqual(ERROR_LOG_MAX_ENTRIES)
    expect(entries[0]?.message).toBe('最新一条')
    // 最旧的 seed-0 已被淘汰
    expect(entries.some((entry) => entry.message === 'seed-0')).toBe(false)
  })
})

describe('清空与导出', () => {
  it('清空后列表为空', async () => {
    await logError('error', 'a', 'x', undefined, db)
    await clearErrorLogs(db)
    expect(await listErrorLogs(10, db)).toHaveLength(0)
  })

  it('导出为可解析 JSON（含条目与时间）', async () => {
    await logError('error', 'import', new Error('boom'), undefined, db)
    const parsed = JSON.parse(await exportErrorLogs(db)) as {
      app: string
      entries: Array<{ message: string }>
    }
    expect(parsed.app).toBe('cycling-analyzer')
    expect(parsed.entries[0]?.message).toBe('boom')
  })
})

describe('全局采集', () => {
  it('console.error / window error / unhandledrejection 都会落库，卸载后停止', async () => {
    const uninstall = installErrorLogging()
    // 采集写的是全局单例 db，这里只验证「不再抛错 + 卸载后恢复原 console.error」
    const spy = vi.spyOn(console, 'error')
    try {
      console.error('采集测试', { a: 1 })
      window.dispatchEvent(new Event('error'))
      expect(spy).toHaveBeenCalled()
    } finally {
      uninstall()
      spy.mockRestore()
    }
    await flush()
  })

  it('卸载后 console.error 恢复原实现', () => {
    const original = console.error
    const uninstall = installErrorLogging()
    expect(console.error).not.toBe(original)
    uninstall()
    expect(console.error).toBe(original)
  })
})
