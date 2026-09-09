/**
 * GPX 导出测试（规格 §25）。
 *
 * 验证 GPX 1.1 XML 结构（trkpt 坐标/海拔/时间）、XML 转义、
 * 无坐标点返回 undefined（不伪造轨迹）、文件名派生规则、
 * 坐标系换算（WGS-84 默认 / GCJ-02 可选 / 微调叠加 / 行者纠偏导出）。
 */
import { describe, expect, it } from 'vitest'
import { wgs84ToGcj02 } from '@/geo/coordinateSystem'
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

  it('默认 WGS-84 恒等输出（既有调用不受影响）', () => {
    const records = [{ timestamp: 0, latitude: 31.2, longitude: 121.5 }]
    expect(buildGpx('默认', records, { from: 'wgs84' })).toBe(buildGpx('默认', records))
  })

  it('可选导出 GCJ-02：坐标按火星坐标换算', () => {
    const gpx = buildGpx('国内', [{ timestamp: 0, latitude: 31.2, longitude: 121.5 }], {
      to: 'gcj02',
    })
    const gcj = wgs84ToGcj02({ latitude: 31.2, longitude: 121.5 })
    expect(gpx).toContain(
      `<trkpt lat="${gcj.latitude.toFixed(7)}" lon="${gcj.longitude.toFixed(7)}">`,
    )
  })

  it('行者（GCJ-02）记录纠偏导出：gcj02 → wgs84 归一化输出', () => {
    // 模拟行者落库坐标：真实 GPS 点经 wgs84→gcj02 后存库
    const stored = wgs84ToGcj02({ latitude: 31.2, longitude: 121.5 })
    const gpx = buildGpx(
      '行者纠偏导出',
      [{ timestamp: 0, latitude: stored.latitude, longitude: stored.longitude }],
      { from: 'gcj02', to: 'wgs84' },
    )
    expect(gpx).toContain('<trkpt lat="31.2000000" lon="121.5000000">')
  })

  it('手动微调叠加到导出坐标（向东 10m ≈ 经度 +0.0001°）', () => {
    const gpx = buildGpx('微调', [{ timestamp: 0, latitude: 31.2, longitude: 121.5 }], {
      trackOffset: { northMeters: 0, eastMeters: 10 },
    })
    // 10m 东向在纬度 31.2° 处 ≈ 0.0001050°（METERS_PER_DEGREE_LAT = 111320）
    expect(gpx).toContain('lon="121.5001050"')
    expect(gpx).toContain('lat="31.2000000"')
  })
})

describe('buildGpxFileName', () => {
  it('去掉 .fit / .fit.gz 后缀追加 .gpx', () => {
    expect(buildGpxFileName('ride.fit')).toBe('ride.gpx')
    expect(buildGpxFileName('ride.fit.gz')).toBe('ride.gpx')
    expect(buildGpxFileName('RIDE.FIT')).toBe('RIDE.gpx')
  })
})
