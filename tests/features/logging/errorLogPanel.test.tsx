/**
 * 错误日志面板（features/logging/ErrorLogPanel.tsx）。
 *
 * 验证：加载已有日志并倒序展示、点击展开堆栈与上下文、清空后回到空态。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CyclingDatabase } from '@/storage/db'
import ErrorLogPanel from '@/features/logging/ErrorLogPanel'
import { logError } from '@/features/logging/errorLog'

/** 每个用例独立库名，避免 fake-indexeddb 之间互相污染 */
let db: CyclingDatabase
let seq = 0

beforeEach(async () => {
  seq += 1
  db = new CyclingDatabase(`test-error-log-panel-${seq}`)
  await db.open()
})

afterEach(async () => {
  db.close()
  await CyclingDatabase.delete(`test-error-log-panel-${seq}`)
})

describe('错误日志面板', () => {
  it('无记录时展示空态', async () => {
    render(<ErrorLogPanel db={db} />)
    expect(await screen.findByText(/暂无错误记录/)).toBeInTheDocument()
  })

  it('展示已有日志，点击展开堆栈与上下文', async () => {
    await logError('error', 'import', new Error('FIT 解析失败'), { file: 'ride.fit' }, db)
    render(<ErrorLogPanel db={db} />)

    expect(await screen.findByText('FIT 解析失败')).toBeInTheDocument()
    expect(screen.getByText('import')).toBeInTheDocument()
    // 展开前不显示上下文
    expect(screen.queryByText(/"file":"ride\.fit"/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { expanded: false }))
    expect(await screen.findByText(/"file":"ride\.fit"/)).toBeInTheDocument()
  })

  it('清空后回到空态', async () => {
    await logError('error', 'ui', 'boom', undefined, db)
    render(<ErrorLogPanel db={db} />)
    await screen.findByText('boom')

    await userEvent.click(screen.getByRole('button', { name: '清空' }))
    await waitFor(() => {
      expect(screen.getByText(/暂无错误记录/)).toBeInTheDocument()
    })
  })
})
