/**
 * Strava 批量导出 CSV 元数据解析测试。
 * 用途：导入时还原用户在 Strava 上的活动原标题（规格 §31）。
 */
import { describe, expect, it } from 'vitest'
import {
  applyStravaMeta,
  buildStravaMetaLookup,
  matchStravaMeta,
  parseStravaActivitiesCsv,
  titleFromFileName,
} from '@/features/import/stravaExport'
import type { Activity } from '@/types/activity'

describe('parseStravaActivitiesCsv', () => {
  it('解析标题、文件名与运动类型', () => {
    const csv = [
      '活动 ID,活动日期,活动名称,活动类型,活动描述,全程耗时,距离,文件名',
      '19766221137,2026年8月16日 09:01:41,温榆河绕圈✘2+机场东路有氧,骑行,"",13127,87.69,activities/20898459132.fit.gz',
      '19669469796,2026年8月8日 22:47:15,戒台寺-潭王路-妙峰山3连击,骑行,"",55894,210.28,activities/20798438204.fit.gz',
    ].join('\n')

    const meta = parseStravaActivitiesCsv(csv)

    expect(meta.size).toBe(2)
    const first = meta.get('19766221137')
    expect(first).toMatchObject({
      activityId: '19766221137',
      name: '温榆河绕圈✘2+机场东路有氧',
      activityType: '骑行',
      fileName: 'activities/20898459132.fit.gz',
    })
  })

  it('活动描述含逗号与引号时正确解析', () => {
    const csv = [
      '活动 ID,活动名称,活动描述,文件名',
      '1,测试骑行,"去程休闲骑，返程被""拉爆"",猛蹬反超",activities/1.fit.gz',
    ].join('\n')

    const meta = parseStravaActivitiesCsv(csv)

    expect(meta.get('1')?.name).toBe('测试骑行')
  })

  it('活动描述含换行时整行正确解析（含后续列）', () => {
    const csv = [
      '活动 ID,活动名称,活动描述,文件名',
      '2,环湖骑行,"第一行描述\n第二行描述",activities/2.fit.gz',
    ].join('\n')

    const meta = parseStravaActivitiesCsv(csv)

    expect(meta.get('2')).toMatchObject({
      name: '环湖骑行',
      fileName: 'activities/2.fit.gz',
    })
  })

  it('带 BOM 的 UTF-8 文件正常解析', () => {
    const csv = '﻿活动 ID,活动名称,文件名\n1,有氧40公里,activities/3.fit.gz'

    const meta = parseStravaActivitiesCsv(csv)

    expect(meta.get('1')?.name).toBe('有氧40公里')
  })

  it('无标题活动返回空名称', () => {
    const csv = '活动 ID,活动名称,文件名\n1,,activities/4.fit.gz'

    const meta = parseStravaActivitiesCsv(csv)

    expect(meta.get('1')?.name).toBe('')
  })

  it('空文件返回空映射', () => {
    expect(parseStravaActivitiesCsv('').size).toBe(0)
    expect(parseStravaActivitiesCsv('活动 ID,活动名称,文件名').size).toBe(0)
  })
})

describe('parseStravaActivitiesCsv 描述与功率列', () => {
  it('解析活动描述', () => {
    const csv = [
      '活动 ID,活动名称,活动描述,文件名',
      '1,机场东路有氧40公里,"去程休闲骑，返程被拉爆",activities/1.fit.gz',
    ].join('\n')

    const meta = parseStravaActivitiesCsv(csv)

    expect(meta.get('1')?.description).toBe('去程休闲骑，返程被拉爆')
  })

  it('描述含逗号与引号时正确解析', () => {
    const csv = [
      '活动 ID,活动名称,活动描述,文件名',
      '1,测试骑行,"风大，""顶风""骑不动",activities/1.fit.gz',
    ].join('\n')

    const meta = parseStravaActivitiesCsv(csv)

    expect(meta.get('1')?.description).toBe('风大，"顶风"骑不动')
  })

  it('空描述返回 undefined', () => {
    const csv = '活动 ID,活动名称,活动描述,文件名\n1,,,activities/1.fit.gz'

    expect(parseStravaActivitiesCsv(csv).get('1')?.description).toBeUndefined()
  })

  it('解析估算功率列（空/非法为 undefined）', () => {
    const csv = [
      '活动 ID,活动名称,文件名,平均瓦特数,最大瓦特数,加权平均功率',
      '1,晨骑,activities/1.fit.gz,127.0,320.5,',
      '2,夜骑,activities/2.fit.gz,,abc,140.0',
    ].join('\n')

    const first = parseStravaActivitiesCsv(csv).get('1')
    expect(first?.avgPower).toBe(127.0)
    expect(first?.maxPower).toBe(320.5)
    expect(first?.weightedAvgPower).toBeUndefined()

    const second = parseStravaActivitiesCsv(csv).get('2')
    expect(second?.avgPower).toBeUndefined()
    expect(second?.maxPower).toBeUndefined()
    expect(second?.weightedAvgPower).toBe(140.0)
  })
})

describe('buildStravaMetaLookup / matchStravaMeta', () => {
  const csv = parseStravaActivitiesCsv(
    [
      '活动 ID,活动名称,活动描述,文件名',
      '1,晨骑,今早风大,activities/1.fit.gz',
    ].join('\n'),
  )

  it('相对路径精确匹配优先', () => {
    const lookup = buildStravaMetaLookup(csv)
    expect(matchStravaMeta('activities/1.fit.gz', '1.fit.gz', lookup)?.description).toBe('今早风大')
  })

  it('纯文件名回退匹配', () => {
    const lookup = buildStravaMetaLookup(csv)
    expect(matchStravaMeta('other/1.fit.gz', '1.fit.gz', lookup)?.name).toBe('晨骑')
  })

  it('未匹配返回 undefined', () => {
    const lookup = buildStravaMetaLookup(csv)
    expect(matchStravaMeta('x.fit.gz', 'x.fit.gz', lookup)).toBeUndefined()
  })

  it('空 CSV 返回空表', () => {
    expect(buildStravaMetaLookup(undefined).size).toBe(0)
  })
})

describe('applyStravaMeta', () => {
  function makeActivity(overrides: Partial<Activity> = {}): Activity {
    return {
      id: '1',
      fileId: 'f1',
      fileName: '1.fit',
      fingerprint: 'fp-1',
      activityType: 'cycling',
      startTime: '2026-08-01T00:00:00.000Z',
      endTime: '2026-08-01T01:00:00.000Z',
      duration: 3600,
      elapsedTime: 3600,
      distance: 30000,
      elevationGain: 200,
      ...overrides,
    }
  }

  it('写入描述与缺失的估算功率', () => {
    const activity = makeActivity()
    applyStravaMeta(activity, {
      activityId: '1',
      name: '晨骑',
      activityType: 'cycling',
      fileName: 'activities/1.fit.gz',
      description: '今早风大',
      avgPower: 127,
      weightedAvgPower: 135,
    })

    expect(activity.description).toBe('今早风大')
    expect(activity.avgPower).toBe(127)
    expect(activity.normalizedPower).toBe(135)
  })

  it('不覆盖 FIT 实测功率', () => {
    const activity = makeActivity({ avgPower: 180, maxPower: 500, normalizedPower: 200 })
    applyStravaMeta(activity, {
      activityId: '1',
      name: '晨骑',
      activityType: 'cycling',
      fileName: 'activities/1.fit.gz',
      avgPower: 127,
      maxPower: 300,
      weightedAvgPower: 135,
    })

    expect(activity.avgPower).toBe(180)
    expect(activity.maxPower).toBe(500)
    expect(activity.normalizedPower).toBe(200)
  })

  it('meta 为空时不修改活动', () => {
    const activity = makeActivity()
    applyStravaMeta(activity, undefined)

    expect(activity.description).toBeUndefined()
    expect(activity.avgPower).toBeUndefined()
  })
})

describe('titleFromFileName', () => {  it('手动下载文件名即标题时提取标题', () => {
    expect(titleFromFileName('机场东路有氧_平均心率138.fit')).toBe('机场东路有氧_平均心率138')
  })

  it('fit.gz 后缀同样提取', () => {
    expect(titleFromFileName('周末休闲骑.fit.gz')).toBe('周末休闲骑')
  })

  it('大写扩展名同样提取', () => {
    expect(titleFromFileName('环湖拉练.FIT')).toBe('环湖拉练')
  })

  it('批量导出数字 ID 文件名不提取', () => {
    expect(titleFromFileName('20898459132.fit')).toBeUndefined()
    expect(titleFromFileName('activities/20898459132.fit.gz')).toBeUndefined()
  })

  it('非 FIT 文件不提取', () => {
    expect(titleFromFileName('readme.txt')).toBeUndefined()
  })

  it('纯扩展名文件名不提取', () => {
    expect(titleFromFileName('.fit')).toBeUndefined()
  })
})
