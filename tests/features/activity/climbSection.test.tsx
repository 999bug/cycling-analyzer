/**
 * 爬坡分析区块测试：有爬坡渲染表格（距离/爬升/坡度），无爬坡不渲染。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ClimbSection from '@/features/activity/ClimbSection'
import type { ActivityRecord } from '@/types/activity'

/** 构造逐点记录（海拔持续爬升） */
function makeClimbRecords(): ActivityRecord[] {
  return Array.from({ length: 11 }, (_, index) => ({
    timestamp: index * 10,
    altitude: 100 + index * 4, // 100m 距离爬 40m（40m 总爬升）
    distance: index * 100,
  }))
}

/** 构造平路记录 */
function makeFlatRecords(): ActivityRecord[] {
  return Array.from({ length: 3 }, (_, index) => ({
    timestamp: index * 10,
    altitude: 100,
    distance: index * 100,
  }))
}

describe('爬坡分析区块', () => {
  it('有爬坡时渲染表格（段数/距离/爬升/坡度）', () => {
    render(<ClimbSection records={makeClimbRecords()} distanceUnit="km" />)

    expect(screen.getByText('爬坡分析')).toBeInTheDocument()
    expect(screen.getByText(/共 1 段爬坡/)).toBeInTheDocument()
    expect(screen.getByText('40 m')).toBeInTheDocument() // 爬升
    // 均匀爬升时平均坡度 = 最大坡度 = 4.0%（两列各一处）
    expect(screen.getAllByText('4.0%')).toHaveLength(2)
  })

  it('无爬坡时不渲染区块', () => {
    render(<ClimbSection records={makeFlatRecords()} distanceUnit="km" />)

    expect(screen.queryByText('爬坡分析')).toBeNull()
  })
})
