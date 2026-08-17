/**
 * GPX 导出测试（后续工作项：导出 GPX）。
 *
 * 验证 GPX 1.1 XML 结构（trkpt 坐标/海拔/时间）、XML 转义、
 * 无坐标点返回 undefined（不伪造轨迹）、文件名派生规则。
 */
import { describe, expect, it } from 'vitest'
import { buildGpx, buildGpxFileName } from '@/features/activity/gpxExport'

describe('buildGpx', () => {
  it('生成 GPX 1.1 结构：坐标/海拔/时间齐全', () => {
    const gpx = buildGpx('晨骑', [
      { timestamp: 1755400000, latitude: 31.2, longitude: 121.5, altitude: 12.34 },
      { timestamp: 1755400001, latitude: 31.2001, longitude: 121.5001 },
    ])

    expect(gpx).toContain('<gpx version="1.1"')
    expect(gpx).toContain('<name>晨骑</name>')
    // 坐标保留 7 位小数
    expect(gpx).toContain('<trkpt lat="31.2000000" lon="121.5000000">')
    // 海拔 1 位小数 + ISO 时间
    expect(gpx).toContain('<ele>12.3</ele>')
    expect(gpx).toContain(`<time>${new Date(1755400000 * 1000).toISOString()}</time>`)
    // 无海拔的点省略 <ele>，仅 <time>
    expect(gpx).toContain(
      `<trkpt lat="31.2001000" lon="121.5001000"><time>${new Date(1755400001 * 1000).toISOString()}</time></trkpt>`,
    )
  })

  it('活动名 XML 特殊字符转义', () => {
    const gpx = buildGpx('A&B <ride> "x"', [{ timestamp: 0, latitude: 1, longitude: 2 }])
    expect(gpx).toContain('<name>A&amp;B &lt;ride&gt; &quot;x&quot;</name>')
  })

  it('无坐标点返回 undefined（不伪造轨迹）', () => {
    expect(buildGpx('室内', [{ timestamp: 0, power: 200 }])).toBeUndefined()
    expect(buildGpx('空', [])).toBeUndefined()
  })

  it('混合数据只导出含坐标的点', () => {
    const gpx = buildGpx('混合', [
      { timestamp: 0, power: 200 },
      { timestamp: 1, latitude: 31.2, longitude: 121.5 },
    ])
    expect(gpx).toBeDefined()
    expect(gpx?.match(/<trkpt /g)).toHaveLength(1)
  })
})

describe('buildGpxFileName', () => {
  it('去掉 .fit / .fit.gz 后缀追加 .gpx', () => {
    expect(buildGpxFileName('ride.fit')).toBe('ride.gpx')
    expect(buildGpxFileName('ride.fit.gz')).toBe('ride.gpx')
    expect(buildGpxFileName('RIDE.FIT')).toBe('RIDE.gpx')
  })
})
