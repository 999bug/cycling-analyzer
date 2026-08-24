/**
 * GPX 活动解析测试：字段映射、扩展解析、距离累计、容错与错误分支。
 */
import { describe, expect, it } from 'vitest'
import { parseGpxActivity } from '@/gpx/gpxParser'
import type { ParseTaskInput } from '@/fit/worker/parseTask'

/**
 * 构造完整三点轨迹 GPX（含海拔/时间/心率/踏频/温度/功率扩展）。
 *
 * 点序列：起点(100m 海拔) → +60s 爬到 105m → +60s 降到 103m，
 * 每步经纬度各 +0.001°（约 140m，纬度 39.94°）。
 */
function fullGpx(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><time>2024-05-01T01:00:00.000Z</time></metadata>
  <trk>
    <name>晨骑妙峰山</name>
    <type>ride</type>
    <trkseg>
      <trkpt lat="39.940000" lon="116.100000">
        <ele>100.0</ele>
        <time>2024-05-01T01:00:00.000Z</time>
        <extensions>
          <gpxtpx:TrackPointExtension xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
            <gpxtpx:hr>120</gpxtpx:hr>
            <gpxtpx:cad>85</gpxtpx:cad>
            <gpxtpx:atemp>21</gpxtpx:atemp>
            <gpxtpx:power>180</gpxtpx:power>
          </gpxtpx:TrackPointExtension>
        </extensions>
      </trkpt>
      <trkpt lat="39.941000" lon="116.101000">
        <ele>105.0</ele>
        <time>2024-05-01T01:01:00.000Z</time>
        <extensions>
          <gpxtpx:TrackPointExtension xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
            <gpxtpx:hr>130</gpxtpx:hr>
            <gpxtpx:cad>90</gpxtpx:cad>
            <gpxtpx:atemp>22</gpxtpx:atemp>
            <gpxtpx:power>200</gpxtpx:power>
          </gpxtpx:TrackPointExtension>
        </extensions>
      </trkpt>
      <trkpt lat="39.942000" lon="116.102000">
        <ele>103.0</ele>
        <time>2024-05-01T01:02:00.000Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`
}

/** 文本 → UTF-8 字节流（ParseTaskInput.bytes） */
function gpxBytes(xml: string): ArrayBuffer {
  return new TextEncoder().encode(xml).buffer as ArrayBuffer
}

/** 构造解析输入 */
function makeInput(xml: string, fileName = 'ride.gpx'): ParseTaskInput {
  return { fileName, bytes: gpxBytes(xml), fingerprint: 'fp-test' }
}

describe('parseGpxActivity 字段映射', () => {
  it('解析逐点记录：坐标/海拔/时间/扩展字段齐全', () => {
    const activity = parseGpxActivity(makeInput(fullGpx()))
    const records = activity.records ?? []

    expect(records).toHaveLength(3)
    const [first] = records
    expect(first.timestamp).toBe(Date.parse('2024-05-01T01:00:00.000Z') / 1000)
    expect(first.latitude).toBeCloseTo(39.94, 6)
    expect(first.longitude).toBeCloseTo(116.1, 6)
    expect(first.altitude).toBe(100.0)
    expect(first.heartRate).toBe(120)
    expect(first.cadence).toBe(85)
    expect(first.temperature).toBe(21)
    expect(first.power).toBe(180)
  })

  it('汇总指标：时长/爬升/平均速度来自记录计算', () => {
    const activity = parseGpxActivity(makeInput(fullGpx()))

    expect(activity.duration).toBe(120)
    expect(activity.elapsedTime).toBe(120)
    // 爬升 = 正增量之和：100→105 计 5m，105→103 为下降不计
    expect(activity.elevationGain).toBeCloseTo(5, 6)
    expect(activity.elevationLoss).toBeCloseTo(2, 6)
    // 平均速度 = 总距离 / 时长
    expect(activity.distance).toBeGreaterThan(0)
    expect(activity.avgSpeed).toBeCloseTo(activity.distance / 120, 6)
    // 第三点无扩展字段：均值只统计有点位的记录（120+130)/2、(180+200)/2
    expect(activity.avgHeartRate).toBe(125)
    expect(activity.avgPower).toBe(190)
    // 标准化功率等派生指标不在此层计算
    expect(activity.normalizedPower).toBeUndefined()
  })

  it('累计距离单调递增且量级合理（每步约 140m）', () => {
    const records = parseGpxActivity(makeInput(fullGpx())).records ?? []

    expect(records[0].distance).toBe(0)
    expect(records[1].distance!).toBeGreaterThan(100)
    expect(records[1].distance!).toBeLessThan(200)
    expect(records[2].distance!).toBeGreaterThan(records[1].distance!)
    expect(records[2].distance!).toBeLessThan(400)
  })

  it('元数据：类型/creator/轨迹名/起止时间', () => {
    const activity = parseGpxActivity(makeInput(fullGpx()))

    expect(activity.activityType).toBe('ride')
    expect(activity.device?.productName).toBe('StravaGPX')
    expect(activity.name).toBe('晨骑妙峰山')
    expect(activity.startTime).toBe(new Date(Date.parse('2024-05-01T01:00:00.000Z')).toISOString())
    expect(activity.endTime).toBe(new Date(Date.parse('2024-05-01T01:02:00.000Z')).toISOString())
    expect(activity.fileName).toBe('ride.gpx')
    expect(activity.fingerprint).toBe('fp-test')
  })

  it('haversine 距离基准：赤道 1° 纬度差 ≈ 111.19km', () => {
    const xml = `<?xml version="1.0"?>
<gpx creator="t">
  <trk><trkseg>
    <trkpt lat="0.0" lon="0.0"><time>2024-05-01T01:00:00Z</time></trkpt>
    <trkpt lat="1.0" lon="0.0"><time>2024-05-01T02:00:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`
    const activity = parseGpxActivity(makeInput(xml))

    expect(activity.distance).toBeGreaterThan(110000)
    expect(activity.distance).toBeLessThan(112500)
  })
})

describe('parseGpxActivity 缺失容错', () => {
  it('无海拔/扩展字段的点对应字段为 undefined（非 0）', () => {
    const xml = `<?xml version="1.0"?>
<gpx creator="t">
  <trk><trkseg>
    <trkpt lat="39.9" lon="116.1"><time>2024-05-01T01:00:00Z</time></trkpt>
    <trkpt lat="39.91" lon="116.11"><time>2024-05-01T01:01:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`
    const activity = parseGpxActivity(makeInput(xml))
    const records = activity.records ?? []

    expect(records[0].altitude).toBeUndefined()
    expect(records[0].heartRate).toBeUndefined()
    expect(records[0].power).toBeUndefined()
    expect(activity.elevationGain).toBe(0)
    expect(activity.maxHeartRate).toBeUndefined()
  })

  it('缺 type 默认 cycling，缺 creator 无设备信息', () => {
    const xml = `<?xml version="1.0"?>
<gpx>
  <trk><trkseg>
    <trkpt lat="39.9" lon="116.1"><time>2024-05-01T01:00:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`
    const activity = parseGpxActivity(makeInput(xml))

    expect(activity.activityType).toBe('cycling')
    expect(activity.device).toBeUndefined()
    expect(activity.name).toBeUndefined()
  })

  it('无有效时间的点被跳过；乱序轨迹按时间排序', () => {
    const xml = `<?xml version="1.0"?>
<gpx creator="t">
  <trk><trkseg>
    <trkpt lat="39.92" lon="116.12"><time>2024-05-01T01:02:00Z</time></trkpt>
    <trkpt lat="39.94" lon="116.14"><time>invalid</time></trkpt>
    <trkpt lat="39.90" lon="116.10"><time>2024-05-01T01:00:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`
    const activity = parseGpxActivity(makeInput(xml))
    const records = activity.records ?? []
    const times = records.map((r) => r.timestamp)

    // 无效时间点被丢弃，剩余两点按时间升序
    expect(records).toHaveLength(2)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(times[0]).toBeLessThan(times[1])
  })
})

describe('parseGpxActivity 结构兼容与错误分支', () => {
  it('多 track / 多 trkseg 拼接为单条记录序列', () => {
    const xml = `<?xml version="1.0"?>
<gpx creator="t">
  <trk>
    <trkseg>
      <trkpt lat="39.90" lon="116.10"><time>2024-05-01T01:00:00Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="39.91" lon="116.11"><time>2024-05-01T01:01:00Z</time></trkpt>
    </trkseg>
  </trk>
  <trk>
    <trkseg>
      <trkpt lat="39.92" lon="116.12"><time>2024-05-01T01:02:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`
    const activity = parseGpxActivity(makeInput(xml))

    expect(activity.records ?? []).toHaveLength(3)
    expect(activity.duration).toBe(120)
  })

  it('非法 XML 抛出 Invalid GPX file', () => {
    expect(() => parseGpxActivity(makeInput('<gpx><trk>'))).toThrow('Invalid GPX file')
  })

  it('无轨迹点抛出 No track points', () => {
    const xml = `<?xml version="1.0"?><gpx creator="t"><trk></trk></gpx>`
    expect(() => parseGpxActivity(makeInput(xml))).toThrow('No track points in GPX file')
  })

  it('全部点位无有效时间抛出 No valid timestamps', () => {
    const xml = `<?xml version="1.0"?>
<gpx creator="t">
  <trk><trkseg>
    <trkpt lat="39.9" lon="116.1"></trkpt>
    <trkpt lat="39.91" lon="116.11"></trkpt>
  </trkseg></trk>
</gpx>`
    expect(() => parseGpxActivity(makeInput(xml))).toThrow('No valid timestamps in GPX file')
  })
})
