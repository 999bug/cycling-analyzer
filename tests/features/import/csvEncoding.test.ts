/**
 * CSV 编码探测解码测试（decodeTextAuto / readTextAuto）。
 *
 * 背景：Strava 中文账号导出的 activities.csv 为 GB18030 编码，固定 UTF-8
 * 解码会把中文表头变乱码导致标题还原整体失效。本组用例覆盖三条解码路径：
 * UTF-8 BOM / 合法 UTF-8（含纯 ASCII）/ GB18030 回退。
 *
 * GB18030 字节常量来自公开码表（GBK 双字节编码，如 活=BBEE、文=CEC4），
 * 与具体用户数据无关。
 */
import { describe, expect, it } from 'vitest'
import { decodeTextAuto, parseStravaActivitiesCsv } from '@/features/import/stravaExport'

/** 常用汉字的 GB18030 编码字节（公开码表值） */
const GBK: Record<string, number[]> = {
  活: [0xbb, 0xee],
  动: [0xb6, 0xaf],
  名: [0xc3, 0xfb],
  称: [0xb3, 0xc6],
  文: [0xce, 0xc4],
  件: [0xbc, 0xfe],
  骑: [0xc6, 0xef],
  行: [0xd0, 0xd0],
  测: [0xb2, 0xe2],
  试: [0xca, 0xd4],
  晨: [0xb3, 0xbf],
  夜: [0xd2, 0xb9],
  训: [0xd1, 0xb5],
  练: [0xc1, 0xb7],
}

/** 把字符串按 GB18030 编码为字节（仅覆盖 ASCII + 上表汉字） */
function gbkBytes(text: string): Uint8Array {
  const bytes: number[] = []
  for (const ch of text) {
    const gbk = GBK[ch]
    if (gbk) {
      bytes.push(...gbk)
    } else if (ch.codePointAt(0)! < 0x80) {
      bytes.push(ch.codePointAt(0)!)
    } else {
      throw new Error(`测试样本包含未登记 GBK 码表的字符: ${ch}`)
    }
  }
  return new Uint8Array(bytes)
}

describe('decodeTextAuto 编码探测', () => {
  it('UTF-8 BOM 直接按 UTF-8 解码', () => {
    const text = '活动 ID,文件名'
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)])

    expect(decodeTextAuto(bytes)).toBe(text)
  })

  it('合法 UTF-8（无 BOM）严格解码通过', () => {
    const text = '活动 ID,文件名\n1,晨骑测试'
    const bytes = new TextEncoder().encode(text)

    expect(decodeTextAuto(bytes)).toBe(text)
  })

  it('纯 ASCII 走严格解码路径不受影响', () => {
    const text = 'Activity ID,Filename\n1,a.fit.gz'

    expect(decodeTextAuto(new TextEncoder().encode(text))).toBe(text)
  })

  it('非法 UTF-8 序列回退 GB18030 解码（Strava 中文账号导出场景）', () => {
    // '活动 ID,活动名称,文件名' 的 GB18030 字节（非合法 UTF-8）
    const header = '活动 ID,活动名称,文件名'
    const row = '\n1,晨骑测试,activities/20898459132.fit.gz'
    const bytes = gbkBytes(header + row)

    const text = decodeTextAuto(bytes)
    expect(text).toBe(header + row)
  })
})

describe('decodeTextAuto 与 CSV 解析联动（端到端语义）', () => {
  it('GB18030 CSV 解码后可正常解析出标题与文件名映射', () => {
    // 模拟 Strava 中文导出的最小结构（GB18030 字节）
    const csv =
      '活动 ID,活动名称,文件名\n' +
      '20898459132,晨骑测试,activities/20898459132.fit.gz\n' +
      '20798438204,夜骑训练,activities/20798438204.fit.gz\n'
    const metas = parseStravaActivitiesCsv(decodeTextAuto(gbkBytes(csv)))

    expect(metas.size).toBe(2)
    expect(metas.get('20898459132')?.name).toBe('晨骑测试')
    expect(metas.get('20898459132')?.fileName).toBe('activities/20898459132.fit.gz')
    expect(metas.get('20798438204')?.name).toBe('夜骑训练')
  })

  it('UTF-8 BOM CSV 同样正常解析（作者快照管线编码）', () => {
    const csv = '活动 ID,活动名称,文件名\n123,周末长距离,activities/123.fit.gz'
    const bom = new Uint8Array([0xef, 0xbb, 0xbf])
    const metas = parseStravaActivitiesCsv(
      decodeTextAuto(new Uint8Array([...bom, ...new TextEncoder().encode(csv)])),
    )

    expect(metas.get('123')?.name).toBe('周末长距离')
  })
})
