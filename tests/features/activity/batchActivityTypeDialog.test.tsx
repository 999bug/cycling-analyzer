/**
 * 批量修正运动类型弹窗测试。
 *
 * 重点验证「不静默修改」这条设计约束：默认勾选只覆盖非灰区，
 * 灰区必须由用户手动勾选后才会写入。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import BatchActivityTypeDialog from '@/features/activity/BatchActivityTypeDialog'
import { detectTypeSuspects, toManualSuspects } from '@/features/activity/suspectTypes'
import type { ActivitySummary } from '@/storage/repositories/activityRepository'

/**
 * 构造最小摘要：由距离（km）与均速（km/h）推演出 duration（秒）。
 *
 * @param id 活动 ID
 * @param activityType 当前记录的类型
 * @param distanceKm 距离（公里）
 * @param speedKmh 平均速度（km/h）
 * @param name 标题
 */
function makeSummary(
  id: string,
  activityType: string,
  distanceKm: number,
  speedKmh: number,
  name: string,
): ActivitySummary {
  const distance = distanceKm * 1000
  const avgSpeed = speedKmh / 3.6
  return {
    id,
    activityType,
    name,
    fileId: `file-${id}`,
    fileName: `${id}.fit`,
    fingerprint: `fp-${id}`,
    startTime: '2026-09-01T10:00:00.000Z',
    endTime: '2026-09-01T11:00:00.000Z',
    distance,
    duration: Math.round(distance / avgSpeed),
    elapsedTime: Math.round(distance / avgSpeed),
    avgSpeed,
  } as ActivitySummary
}

/** 典型数据：1 条步行 + 1 条跑步 + 1 条灰区 + 1 条正常骑行 */
function makeFixtures() {
  const allSummaries = [
    makeSummary('walk', 'cycling', 2.1, 4.3, '午间散步'),
    makeSummary('run', 'cycling', 5.2, 9.8, '早上跑步'),
    makeSummary('grey', 'cycling', 12.4, 13.2, '城市通勤'),
    makeSummary('ride', 'cycling', 40, 25.6, '傍晚骑行'),
  ]
  return { allSummaries, suspects: detectTypeSuspects(allSummaries) }
}

describe('BatchActivityTypeDialog 渲染', () => {
  it('列出候选与判定依据，正常骑行的活动不出现在清单里', () => {
    const { allSummaries, suspects } = makeFixtures()
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ updateActivityType: vi.fn() }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    expect(screen.getByText('午间散步')).toBeInTheDocument()
    expect(screen.getByText('早上跑步')).toBeInTheDocument()
    expect(screen.queryByText('傍晚骑行')).not.toBeInTheDocument()
    // 判定依据必须露出，用户才能自行判断是否采纳
    expect(screen.getByText(/均速 4\.3 km\/h/)).toBeInTheDocument()
    expect(screen.getByText(/重叠区/)).toBeInTheDocument()
  })

  it('灰区默认不勾选，其余默认勾选；按钮文案同步计数', () => {
    const { allSummaries, suspects } = makeFixtures()
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ updateActivityType: vi.fn() }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    const checkedBoxes = screen.getAllByRole('checkbox').filter((el) => (el as HTMLInputElement).checked)
    expect(checkedBoxes).toHaveLength(2)
    expect(screen.getByRole('button', { name: /应用勾选项（2）/ })).toBeInTheDocument()
  })

  it('影响预览给出修正前后的骑行里程与次数', () => {
    const { allSummaries, suspects } = makeFixtures()
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ updateActivityType: vi.fn() }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    // 骑行总里程 59.7km（含被误标的 2.1 + 5.2）→ 修正后 52.4km
    expect(screen.getByText('52 km')).toBeInTheDocument()
    expect(screen.getByText(/修正前 60 km，减少 7/)).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})

describe('BatchActivityTypeDialog 分组筛选', () => {
  it('点 chip 只看对应分组', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeFixtures()
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ updateActivityType: vi.fn() }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /灰区 1/ }))

    expect(screen.getByText('城市通勤')).toBeInTheDocument()
    expect(screen.queryByText('早上跑步')).not.toBeInTheDocument()
  })
})

describe('BatchActivityTypeDialog 应用', () => {
  it('只写入勾选项：灰区未勾选则不被改写', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeFixtures()
    const updateActivityType = vi.fn().mockResolvedValue(undefined)
    const onApplied = vi.fn()
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ updateActivityType }}
        onClose={vi.fn()}
        onApplied={onApplied}
      />,
    )

    await user.click(screen.getByRole('button', { name: /应用勾选项（2）/ }))

    expect(updateActivityType).toHaveBeenCalledTimes(2)
    expect(updateActivityType).toHaveBeenCalledWith('walk', 'walking')
    expect(updateActivityType).toHaveBeenCalledWith('run', 'running')
    // 灰区必须由用户主动勾选
    expect(updateActivityType).not.toHaveBeenCalledWith('grey', expect.anything())
    expect(onApplied).toHaveBeenCalledWith(2)
  })

  it('手动勾选灰区后一并写入（灰区建议保持骑行）', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeFixtures()
    const updateActivityType = vi.fn().mockResolvedValue(undefined)
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ updateActivityType }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    // 第 3 行是灰区的「城市通勤」：建议保持骑行，勾选即按骑行落定
    const greyBox = screen.getAllByRole('checkbox')[2]
    await user.click(greyBox)
    await user.click(screen.getByRole('button', { name: /应用勾选项（3）/ }))

    expect(updateActivityType).toHaveBeenCalledWith('grey', 'cycling')
    expect(updateActivityType).not.toHaveBeenCalledWith('grey', 'running')
  })

  it('下拉手动改类型后按所选项写入（不再局限于单一建议）', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeFixtures()
    const updateActivityType = vi.fn().mockResolvedValue(undefined)
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ updateActivityType }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    // 把「早上跑步」（建议跑步）手动改成骑行再应用
    const runSelect = screen.getByRole('combobox', { name: '修改「早上跑步」的目标类型' })
    await user.selectOptions(runSelect, 'cycling')
    await user.click(screen.getByRole('button', { name: /应用勾选项（2）/ }))

    expect(updateActivityType).toHaveBeenCalledWith('run', 'cycling')
    expect(updateActivityType).toHaveBeenCalledWith('walk', 'walking')
  })

  it('灰区手动改成跑步后应用，按用户所选拍板', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeFixtures()
    const updateActivityType = vi.fn().mockResolvedValue(undefined)
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ updateActivityType }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    const greyBox = screen.getAllByRole('checkbox')[2]
    await user.click(greyBox)
    const greySelect = screen.getByRole('combobox', { name: '修改「城市通勤」的目标类型' })
    await user.selectOptions(greySelect, 'running')
    await user.click(screen.getByRole('button', { name: /应用勾选项（3）/ }))

    expect(updateActivityType).toHaveBeenCalledWith('grey', 'running')
  })

  it('全部取消勾选时应用按钮禁用（不得提交空修改）', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeFixtures()
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ updateActivityType: vi.fn() }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    for (const box of screen.getAllByRole('checkbox')) {
      if ((box as HTMLInputElement).checked) {
        await user.click(box)
      }
    }

    expect(screen.getByRole('button', { name: /应用勾选项（0）/ })).toBeDisabled()
  })
})

describe('BatchActivityTypeDialog 无候选', () => {
  it('空清单给出明确说明而非空白表格', () => {
    render(
      <BatchActivityTypeDialog
        suspects={[]}
        allSummaries={[makeSummary('ride', 'cycling', 40, 25.6, '傍晚骑行')]}
        writeRepository={{ updateActivityType: vi.fn() }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    expect(screen.getByText(/检测到 0 条活动/)).toBeInTheDocument()
    expect(screen.getByText('该分组下没有记录')).toBeInTheDocument()
  })
})

/** 手动模式夹具：1 条被误标跑步 + 1 条正常骑行（模拟用户在列表勾选） */
function makeManualFixtures() {
  const allSummaries = [
    makeSummary('m-run', 'running', 5.2, 9.8, '误标跑步'),
    makeSummary('m-ride', 'cycling', 40, 25.6, '正常骑行'),
  ]
  return { allSummaries, suspects: toManualSuspects(allSummaries) }
}

describe('BatchActivityTypeDialog 手动模式', () => {
  it('渲染勾选记录：标题/副标题为手动口径，下拉默认=当前类型，依据为手动指定', () => {
    const { allSummaries, suspects } = makeManualFixtures()
    render(
      <BatchActivityTypeDialog
        mode="manual"
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ updateActivityType: vi.fn() }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: '批量修改运动类型' })).toBeInTheDocument()
    expect(screen.getByText(/已选择 2 条记录/)).toBeInTheDocument()
    expect(screen.getByText('误标跑步')).toBeInTheDocument()
    expect(screen.getByText('正常骑行')).toBeInTheDocument()
    // 下拉默认 = 归一化后的当前类型
    expect(
      screen.getByRole('combobox', { name: '修改「误标跑步」的目标类型' }),
    ).toHaveValue('running')
    // 依据为手动指定，不带灰区问号
    expect(screen.getAllByText('手动指定（列表勾选）')).toHaveLength(2)
    expect(screen.queryByText(/灰区/)).not.toBeInTheDocument()
  })

  it('手动模式隐藏分组 chips（每行已自带 current→target）', () => {
    const { allSummaries, suspects } = makeManualFixtures()
    render(
      <BatchActivityTypeDialog
        mode="manual"
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ updateActivityType: vi.fn() }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /^全部 / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /建议/ })).not.toBeInTheDocument()
  })

  it('默认全部勾选，按钮计数=N', () => {
    const { allSummaries, suspects } = makeManualFixtures()
    render(
      <BatchActivityTypeDialog
        mode="manual"
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ updateActivityType: vi.fn() }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    const checked = screen.getAllByRole('checkbox').filter((el) => (el as HTMLInputElement).checked)
    expect(checked).toHaveLength(2)
    expect(screen.getByRole('button', { name: /应用勾选项（2）/ })).toBeInTheDocument()
  })

  it('下拉改类型后按所选写入，取消勾选的行跳过', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeManualFixtures()
    const updateActivityType = vi.fn().mockResolvedValue(undefined)
    const onApplied = vi.fn()
    render(
      <BatchActivityTypeDialog
        mode="manual"
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ updateActivityType }}
        onClose={vi.fn()}
        onApplied={onApplied}
      />,
    )

    await user.selectOptions(
      screen.getByRole('combobox', { name: '修改「误标跑步」的目标类型' }),
      'cycling',
    )
    // 取消勾选正常骑行（用户只想改第一条）
    await user.click(screen.getAllByRole('checkbox')[1])
    await user.click(screen.getByRole('button', { name: /应用勾选项（1）/ }))

    expect(updateActivityType).toHaveBeenCalledTimes(1)
    expect(updateActivityType).toHaveBeenCalledWith('m-run', 'cycling')
    expect(updateActivityType).not.toHaveBeenCalledWith('m-ride', expect.anything())
    expect(onApplied).toHaveBeenCalledWith(1)
  })

  it('影响预览随手动改动生效（跑步改骑行 → 里程次数 +1）', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeManualFixtures()
    render(
      <BatchActivityTypeDialog
        mode="manual"
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ updateActivityType: vi.fn() }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    // 改前骑行总里程 40km（仅正常骑行计入）
    expect(screen.getByText('40 km')).toBeInTheDocument()

    await user.selectOptions(
      screen.getByRole('combobox', { name: '修改「误标跑步」的目标类型' }),
      'cycling',
    )

    // 改后 45.2km（m-ride 40km + m-run 5.2km）
    expect(await screen.findByText('45 km')).toBeInTheDocument()
  })

  it('不改类型直接应用：按归一化后的当前类型幂等写入', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeManualFixtures()
    const updateActivityType = vi.fn().mockResolvedValue(undefined)
    const onApplied = vi.fn()
    render(
      <BatchActivityTypeDialog
        mode="manual"
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ updateActivityType }}
        onClose={vi.fn()}
        onApplied={onApplied}
      />,
    )

    await user.click(screen.getByRole('button', { name: /应用勾选项（2）/ }))

    expect(updateActivityType).toHaveBeenCalledWith('m-run', 'running')
    expect(updateActivityType).toHaveBeenCalledWith('m-ride', 'cycling')
    expect(onApplied).toHaveBeenCalledWith(2)
  })
})
