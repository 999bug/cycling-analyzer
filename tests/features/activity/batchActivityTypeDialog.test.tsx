/**
 * 批量修正运动类型弹窗测试。
 *
 * 重点验证「不静默修改」这条设计约束：默认勾选只覆盖非灰区，
 * 灰区必须由用户手动勾选后才会写入。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import BatchActivityTypeDialog from '@/features/activity/BatchActivityTypeDialog'
import { detectTypeSuspects } from '@/features/activity/suspectTypes'
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
        writeRepository={{ confirmActivityType: vi.fn() }}
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
        writeRepository={{ confirmActivityType: vi.fn() }}
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
        writeRepository={{ confirmActivityType: vi.fn() }}
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
        writeRepository={{ confirmActivityType: vi.fn() }}
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
    const confirmActivityType = vi.fn().mockResolvedValue(undefined)
    const onApplied = vi.fn()
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ confirmActivityType }}
        onClose={vi.fn()}
        onApplied={onApplied}
      />,
    )

    await user.click(screen.getByRole('button', { name: /应用勾选项（2）/ }))

    expect(confirmActivityType).toHaveBeenCalledTimes(2)
    expect(confirmActivityType).toHaveBeenCalledWith('walk', 'walking')
    expect(confirmActivityType).toHaveBeenCalledWith('run', 'running')
    // 灰区必须由用户主动勾选
    expect(confirmActivityType).not.toHaveBeenCalledWith('grey', expect.anything())
    expect(onApplied).toHaveBeenCalledWith(2)
  })

  it('手动勾选灰区后一并写入（灰区建议保持骑行）', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeFixtures()
    const confirmActivityType = vi.fn().mockResolvedValue(undefined)
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ confirmActivityType }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    // 第 3 行是灰区的「城市通勤」：建议保持骑行，勾选即按骑行落定
    const greyBox = screen.getAllByRole('checkbox')[2]
    await user.click(greyBox)
    await user.click(screen.getByRole('button', { name: /应用勾选项（3）/ }))

    expect(confirmActivityType).toHaveBeenCalledWith('grey', 'cycling')
    expect(confirmActivityType).not.toHaveBeenCalledWith('grey', 'running')
  })

  it('下拉手动改类型后按所选项写入（不再局限于单一建议）', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeFixtures()
    const confirmActivityType = vi.fn().mockResolvedValue(undefined)
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ confirmActivityType }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    // 把「早上跑步」（建议跑步）手动改成骑行再应用
    const runSelect = screen.getByRole('combobox', { name: '修改「早上跑步」的目标类型' })
    await user.selectOptions(runSelect, 'cycling')
    await user.click(screen.getByRole('button', { name: /应用勾选项（2）/ }))

    expect(confirmActivityType).toHaveBeenCalledWith('run', 'cycling')
    expect(confirmActivityType).toHaveBeenCalledWith('walk', 'walking')
  })

  it('灰区手动改成跑步后应用，按用户所选拍板', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeFixtures()
    const confirmActivityType = vi.fn().mockResolvedValue(undefined)
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ confirmActivityType }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    const greyBox = screen.getAllByRole('checkbox')[2]
    await user.click(greyBox)
    const greySelect = screen.getByRole('combobox', { name: '修改「城市通勤」的目标类型' })
    await user.selectOptions(greySelect, 'running')
    await user.click(screen.getByRole('button', { name: /应用勾选项（3）/ }))

    expect(confirmActivityType).toHaveBeenCalledWith('grey', 'running')
  })

  it('全部取消勾选时应用按钮禁用（不得提交空修改）', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeFixtures()
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allSummaries={allSummaries}
        writeRepository={{ confirmActivityType: vi.fn() }}
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
        writeRepository={{ confirmActivityType: vi.fn() }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    expect(screen.getByText(/检测到 0 条活动/)).toBeInTheDocument()
    expect(screen.getByText('该分组下没有记录')).toBeInTheDocument()
  })
})

/** 范围切换夹具：记为骑行但实为跑步节奏（会被检出）+ 正常骑行 + 正常步行 */
function makeManualFixtures() {
  const allSummaries = [
    makeSummary('m-run', 'cycling', 5.2, 9.8, '误标跑步'),
    makeSummary('m-ride', 'cycling', 40, 25.6, '正常骑行'),
    makeSummary('m-walk', 'walking', 2.1, 4.3, '晚间散步'),
  ]
  return { allSummaries, suspects: detectTypeSuspects(allSummaries) }
}

describe('BatchActivityTypeDialog 范围切换（全部记录）', () => {
  it('默认可疑记录范围；切到「全部记录」后列出全量，下拉默认=当前类型', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeManualFixtures()
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allowFullRange
        allSummaries={allSummaries}
        writeRepository={{ confirmActivityType: vi.fn() }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    // 默认可疑范围：只有「误标跑步」被检出（正常骑行/步行不入清单）
    expect(screen.getByText(/检测到 1 条活动/)).toBeInTheDocument()
    expect(screen.getByText('误标跑步')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /全部记录/ }))

    expect(screen.getByText(/共 3 条记录/)).toBeInTheDocument()
    expect(screen.getByText('误标跑步')).toBeInTheDocument()
    expect(screen.getByText('正常骑行')).toBeInTheDocument()
    expect(screen.getByText('晚间散步')).toBeInTheDocument()
    // 下拉默认 = 归一化后的当前类型（该条库里记为 cycling，用户可改成跑步）
    expect(
      screen.getByRole('combobox', { name: '修改「误标跑步」的目标类型' }),
    ).toHaveValue('cycling')
    // 依据展示速度证据（与检测范围同列语义），无灰区标记
    expect(screen.getByText(/均速 9\.8 km\/h、距离 5\.2 km/)).toBeInTheDocument()
    expect(screen.queryByText(/灰区/)).not.toBeInTheDocument()
  })

  it('「全部记录」范围按当前类型分组 chips + 关键词搜索过滤', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeManualFixtures()
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allowFullRange
        allSummaries={allSummaries}
        writeRepository={{ confirmActivityType: vi.fn() }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /全部记录/ }))

    // 类型 chips 按当前类型分组（骑行 2 / 步行 1）
    await user.click(screen.getByRole('button', { name: /^步行 1$/ }))
    expect(screen.getByText('晚间散步')).toBeInTheDocument()
    expect(screen.queryByText('正常骑行')).not.toBeInTheDocument()

    // 回到全部 → 关键词搜索命中标题
    await user.click(screen.getByRole('button', { name: /^全部 3$/ }))
    await user.type(screen.getByLabelText('搜索记录'), '正常')
    expect(screen.getByText('正常骑行')).toBeInTheDocument()
    expect(screen.queryByText('晚间散步')).not.toBeInTheDocument()
  })

  it('「全部记录」范围默认不勾选（避免误点应用批量重写）', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeManualFixtures()
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allowFullRange
        allSummaries={allSummaries}
        writeRepository={{ confirmActivityType: vi.fn() }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /全部记录/ }))

    const checked = screen.getAllByRole('checkbox').filter((el) => (el as HTMLInputElement).checked)
    expect(checked).toHaveLength(0)
    expect(screen.getByRole('button', { name: /应用勾选项（0）/ })).toBeDisabled()
  })

  it('「全部记录」范围勾选后改类型：按所选写入并标记已确认', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeManualFixtures()
    const confirmActivityType = vi.fn().mockResolvedValue(undefined)
    const onApplied = vi.fn()
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allowFullRange
        allSummaries={allSummaries}
        writeRepository={{ confirmActivityType }}
        onClose={vi.fn()}
        onApplied={onApplied}
      />,
    )

    await user.click(screen.getByRole('button', { name: /全部记录/ }))
    await user.selectOptions(
      screen.getByRole('combobox', { name: '修改「误标跑步」的目标类型' }),
      'running',
    )
    // 只勾选第一行（误标跑步那条）
    await user.click(screen.getAllByRole('checkbox')[0])
    await user.click(screen.getByRole('button', { name: /应用勾选项（1）/ }))

    expect(confirmActivityType).toHaveBeenCalledTimes(1)
    expect(confirmActivityType).toHaveBeenCalledWith('m-run', 'running')
    expect(onApplied).toHaveBeenCalledWith(1)
  })

  it('影响预览随所选改动生效（改跑步 → 骑行里程减少）', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeManualFixtures()
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allowFullRange
        allSummaries={allSummaries}
        writeRepository={{ confirmActivityType: vi.fn() }}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /全部记录/ }))
    // 改前骑行总里程 45.2km（误标跑步那条也被算作骑行）
    expect(screen.getByText('45 km')).toBeInTheDocument()

    await user.click(screen.getAllByRole('checkbox')[0])
    await user.selectOptions(
      screen.getByRole('combobox', { name: '修改「误标跑步」的目标类型' }),
      'running',
    )

    // 改后 40km（只剩正常骑行）
    await waitFor(() => expect(screen.getByText('40 km')).toBeInTheDocument())
  })

  it('「全部记录」范围不改类型直接应用：按归一化后的当前类型幂等确认', async () => {
    const user = userEvent.setup()
    const { allSummaries, suspects } = makeManualFixtures()
    const confirmActivityType = vi.fn().mockResolvedValue(undefined)
    const onApplied = vi.fn()
    render(
      <BatchActivityTypeDialog
        suspects={suspects}
        allowFullRange
        allSummaries={allSummaries}
        writeRepository={{ confirmActivityType }}
        onClose={vi.fn()}
        onApplied={onApplied}
      />,
    )

    await user.click(screen.getByRole('button', { name: /全部记录/ }))
    for (const box of screen.getAllByRole('checkbox')) {
      await user.click(box)
    }
    await user.click(screen.getByRole('button', { name: /应用勾选项（3）/ }))

    expect(confirmActivityType).toHaveBeenCalledWith('m-run', 'cycling')
    expect(confirmActivityType).toHaveBeenCalledWith('m-ride', 'cycling')
    expect(confirmActivityType).toHaveBeenCalledWith('m-walk', 'walking')
    expect(onApplied).toHaveBeenCalledWith(3)
  })
})
