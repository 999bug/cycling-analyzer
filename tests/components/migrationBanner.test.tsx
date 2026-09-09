/**
 * 迁移进度横幅组件测试。
 *
 * 核心回归：runRecordsMigration 返回 'already-done'（此前会话已完成迁移）
 * 时，横幅不得显示「升级完成」也不得触发刷新——2.47.0 曾因此产生
 * 「打开页面→完成→自动刷新→再打开」的无限刷新循环（线上事故）。
 *
 * 刷新经 @/utils/navigation 间接调用（jsdom 的 location.reload 不可 stub），
 * 统一 mock 后断言调用次数。组件启动走 setTimeout(0) 让首屏先渲染，
 * 测试用假定时器先推进一帧再驱动受控桩。
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MigrationBanner from '@/components/MigrationBanner'
import { reloadPage } from '@/utils/navigation'
import type { MigrationProgress } from '@/storage/recordsMigration'

vi.mock('@/utils/navigation', () => ({ reloadPage: vi.fn() }))

/** 构造受控迁移桩：手动触发进度回调并控制最终结果 */
function makeStub() {
  let onProgress: ((progress: MigrationProgress) => void) | undefined
  let resolve!: (outcome: 'done' | 'already-done' | 'busy') => void
  const promise = new Promise<'done' | 'already-done' | 'busy'>((res) => {
    resolve = res
  })
  return {
    runMigration: (cb: (progress: MigrationProgress) => void) => {
      onProgress = cb
      return promise
    },
    emit: (progress: MigrationProgress) => onProgress?.(progress),
    finish: resolve,
  }
}

/** 推进假时钟并让 React 状态更新落定（组件启动与回调都经定时器/微任务） */
async function tick(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(reloadPage).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MigrationBanner', () => {
  it('already-done：不显示横幅、不刷新（无限刷新循环回归用例）', async () => {
    const stub = makeStub()
    render(<MigrationBanner runMigration={stub.runMigration} />)
    await tick() // 触发组件的启动 setTimeout

    stub.finish('already-done')
    await tick()

    expect(screen.queryByRole('status')).toBeNull()
    // 关键断言：延迟刷新窗口（1.5s）过后依然没有刷新
    await tick(3000)
    expect(reloadPage).not.toHaveBeenCalled()
  })

  it('done：显示升级完成并延迟自动刷新一次', async () => {
    const stub = makeStub()
    render(<MigrationBanner runMigration={stub.runMigration} />)
    await tick()

    stub.finish('done')
    await tick()
    expect(screen.getByRole('status')).toHaveTextContent('本地数据升级完成，即将自动刷新')

    await tick(1500)
    expect(reloadPage).toHaveBeenCalledTimes(1)
  })

  it('running：展示进度百分比与计数', async () => {
    const stub = makeStub()
    render(<MigrationBanner runMigration={stub.runMigration} />)
    await tick()

    stub.emit({ migrated: 1, total: 2 })
    await tick()

    expect(screen.getByRole('status')).toHaveTextContent('正在升级本地数据存储')
    expect(screen.getByRole('status')).toHaveTextContent('1 / 2')
    expect(reloadPage).not.toHaveBeenCalled()

    stub.finish('done')
    await tick(2000)
    expect(reloadPage).toHaveBeenCalledTimes(1)
  })

  it('busy：不显示横幅、不刷新，等待对端完成', async () => {
    const stub = makeStub()
    render(<MigrationBanner runMigration={stub.runMigration} />)
    await tick()

    stub.finish('busy')
    await tick()

    expect(screen.queryByRole('status')).toBeNull()
    await tick(3000)
    expect(reloadPage).not.toHaveBeenCalled()
  })
})
