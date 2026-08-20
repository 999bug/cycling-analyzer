/**
 * 训练计划生成测试。
 *
 * buildTrainingPlan：基于周期化训练理论生成目标赛事前的逐周计划，
 * 验证阶段分配、TSS 递进/减量、时长折算与非法输入兜底。
 */
import { describe, expect, it } from 'vitest'
import { buildTrainingPlan, type TrainingPlanWeek } from '@/features/training/plan'

describe('buildTrainingPlan 训练计划生成', () => {
  it('非法输入返回空数组', () => {
    expect(buildTrainingPlan({ startDate: '2026-09-01', eventDate: '2026-08-01', weeklyHours: 6, currentCtl: 30 })).toEqual([])
    expect(buildTrainingPlan({ startDate: '2026-09-01', eventDate: '2026-09-01', weeklyHours: 6, currentCtl: 30 })).toEqual([])
    expect(buildTrainingPlan({ startDate: '2026-09-01', eventDate: '2026-10-01', weeklyHours: 0, currentCtl: 30 })).toEqual([])
    expect(buildTrainingPlan({ startDate: '2026-09-01', eventDate: '2026-10-01', weeklyHours: 6, currentCtl: -1 })).toEqual([])
  })

  it('12 周计划：基础期 → 强化期 → 减量期 → 巅峰期', () => {
    const plan = buildTrainingPlan({ startDate: '2026-09-01', eventDate: '2026-11-24', weeklyHours: 6, currentCtl: 30 })

    expect(plan.length).toBe(12)
    const phaseSequence = plan.map((w) => w.phase)
    // 前段基础、中段强化、末尾减量 + 最后一周巅峰
    expect(phaseSequence[0]).toBe('base')
    expect(phaseSequence).toContain('build')
    expect(phaseSequence).toContain('taper')
    expect(phaseSequence[phaseSequence.length - 1]).toBe('peak')
    // 阶段顺序：base 全在 build 前，build 全在 taper 前
    const firstBuild = phaseSequence.indexOf('build')
    const firstTaper = phaseSequence.indexOf('taper')
    expect(firstBuild).toBeGreaterThanOrEqual(0)
    expect(firstTaper).toBeGreaterThan(firstBuild)
    // 周序号与起始日期递增
    expect(plan[0].weekIndex).toBe(1)
    expect(plan[1].weekStart).toBe('2026-09-08')
  })

  it('TSS 基础期递增、强化期峰值、减量期回落且每周增量受限', () => {
    const plan = buildTrainingPlan({ startDate: '2026-09-01', eventDate: '2026-11-24', weeklyHours: 6, currentCtl: 30 })

    // 峰值在强化期，减量期低于峰值
    const peakTss = Math.max(...plan.map((w) => w.targetTss))
    const taperWeek = plan.find((w) => w.phase === 'taper')
    expect(taperWeek).toBeDefined()
    expect((taperWeek as TrainingPlanWeek).targetTss).toBeLessThan(peakTss)
    // 每周增量不超过 15%
    for (let i = 1; i < plan.length; i++) {
      if (plan[i].targetTss > plan[i - 1].targetTss) {
        expect(plan[i].targetTss / plan[i - 1].targetTss).toBeLessThanOrEqual(1.16)
      }
    }
    // 6 小时/周 → 基准 360 TSS，强化峰值 450
    expect(peakTss).toBeLessThanOrEqual(450)
  })

  it('每周含骑行次数、时长与训练重点', () => {
    const plan = buildTrainingPlan({ startDate: '2026-09-01', eventDate: '2026-09-29', weeklyHours: 4, currentCtl: 20 })

    expect(plan.length).toBeGreaterThanOrEqual(4)
    for (const week of plan) {
      expect(week.rideCount).toBeGreaterThan(0)
      expect(week.hours).toBeGreaterThan(0)
      expect(week.focus.length).toBeGreaterThan(0)
      expect(week.phaseLabel.length).toBeGreaterThan(0)
    }
  })

  it('短计划（不足减量期分配）退化为基础期 + 巅峰期', () => {
    const plan = buildTrainingPlan({ startDate: '2026-09-01', eventDate: '2026-09-08', weeklyHours: 6, currentCtl: 30 })

    expect(plan.length).toBe(1)
    expect(plan[0].phase).toBe('peak')
  })
})