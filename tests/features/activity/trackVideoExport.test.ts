/**
 * 回放视频导出纯计算测试：画布比例、Web Mercator 投影、拟合缩放、瓦片范围、
 * 时长选项与字幕文案。画布/MediaRecorder 相关路径依赖真实浏览器环境，不在 jsdom 覆盖范围。
 */
import { describe, expect, it } from 'vitest'
import {
  buildVideoCaptionTexts,
  buildVideoFileName,
  canvasLayoutOf,
  computeFittedZoom,
  computeTileRange,
  distanceBasedDurationSeconds,
  expandTileUrl,
  latToWorldPx,
  lngToWorldPx,
  resolveVideoDuration,
  VIDEO_ASPECT_SIZES,
} from '@/features/activity/trackVideoExport'

describe('画布比例', () => {
  it('三种比例的尺寸：短边统一 1080', () => {
    expect(VIDEO_ASPECT_SIZES['9:16']).toEqual({ width: 1080, height: 1920 })
    expect(VIDEO_ASPECT_SIZES['1:1']).toEqual({ width: 1080, height: 1080 })
    expect(VIDEO_ASPECT_SIZES['16:9']).toEqual({ width: 1920, height: 1080 })
  })

  it('安全边距按短边换算（三种比例一致，均为 80px）', () => {
    expect(canvasLayoutOf('9:16').padding).toBe(80)
    expect(canvasLayoutOf('1:1').padding).toBe(80)
    expect(canvasLayoutOf('16:9').padding).toBe(80)
    expect(canvasLayoutOf('9:16').shortSide).toBe(1080)
  })

  it('竖屏比例下轨迹能占满短边（fitBounds 余量充足）', () => {
    const layout = canvasLayoutOf('9:16')
    const zoom = computeFittedZoom(
      { minLat: 31.15, maxLat: 31.35, minLng: 121.3, maxLng: 121.6 },
      layout.width,
      layout.height,
      layout.padding,
    )
    const spanX = lngToWorldPx(121.6, zoom) - lngToWorldPx(121.3, zoom)
    expect(spanX).toBeLessThanOrEqual(layout.width - layout.padding * 2)
  })
})

describe('时长选项', () => {
  it('固定档位直接取秒数', () => {
    expect(resolveVideoDuration('15', undefined)).toBe(15)
    expect(resolveVideoDuration('30', undefined)).toBe(30)
    expect(resolveVideoDuration('60', undefined)).toBe(60)
  })

  it('「跟随里程」约每 5 km 1 秒', () => {
    expect(distanceBasedDurationSeconds(25_000)).toBe(15)
    expect(distanceBasedDurationSeconds(100_000)).toBe(20)
  })

  it('「跟随里程」夹在 15~60 秒区间', () => {
    expect(distanceBasedDurationSeconds(5_000)).toBe(15)
    expect(distanceBasedDurationSeconds(210_000)).toBe(42)
    expect(distanceBasedDurationSeconds(800_000)).toBe(60)
  })

  it('里程缺失或非法时回退默认 30 秒（不伪造）', () => {
    expect(distanceBasedDurationSeconds(undefined)).toBe(30)
    expect(distanceBasedDurationSeconds(0)).toBe(30)
    expect(distanceBasedDurationSeconds(Number.NaN)).toBe(30)
    expect(resolveVideoDuration('distance', undefined)).toBe(30)
  })
})

describe('瓦片 URL 展开', () => {
  it('替换 {s}/{z}/{x}/{y} 占位符，子域按坐标轮询', () => {
    const template = 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}'
    expect(expandTileUrl(template, ['1', '2', '3', '4'], 12, 3372, 1556)).toBe(
      'https://webst01.is.autonavi.com/appmaptile?style=6&x=3372&y=1556&z=12',
    )
    // (x + y) 变化 → 子域轮换，避免单域名限流
    expect(expandTileUrl(template, ['1', '2', '3', '4'], 12, 3373, 1556)).toContain('webst02')
  })

  it('无子域的模板不残留 {s}', () => {
    expect(expandTileUrl('https://t/{s}/{z}/{x}/{y}.png', [], 1, 1, 1)).toBe('https://t//1/1/1.png')
  })
})

describe('字幕文案', () => {
  const base = { videoSeconds: 30, showHook: true, showDataLine: true }

  it('钩子 + 数据行都取真实数据', () => {
    const captions = buildVideoCaptionTexts({
      ...base,
      distanceMeters: 33_900,
      elevationGainMeters: 620,
      movingSeconds: 6000,
    })
    expect(captions.hook).toEqual(['这条 33.9 公里的回放', '别人要开会员才能看'])
    expect(captions.dataLine).toEqual(['33.9 km · 爬升 620 m', '运动 1:40:00 · 200× 加速'])
  })

  it('缺少爬升时数据行只留里程（不伪造）', () => {
    const captions = buildVideoCaptionTexts({ ...base, distanceMeters: 20_000 })
    expect(captions.dataLine).toEqual(['20.0 km'])
    expect(captions.hook).toEqual(['这条 20.0 公里的回放', '别人要开会员才能看'])
  })

  it('开关关闭时不生成对应字幕', () => {
    const captions = buildVideoCaptionTexts({
      ...base,
      showHook: false,
      showDataLine: false,
      distanceMeters: 20_000,
    })
    expect(captions.hook).toBeUndefined()
    expect(captions.dataLine).toBeUndefined()
  })

  it('里程缺失时钩子省略、数据行仅保留时长', () => {
    const captions = buildVideoCaptionTexts({ ...base, movingSeconds: 3600 })
    expect(captions.hook).toBeUndefined()
    expect(captions.dataLine).toEqual(['运动 1:00:00 · 120× 加速'])
  })

  it('自定义文案整块覆盖自动生成（钩子与数据行各自独立）', () => {
    const captions = buildVideoCaptionTexts({
      ...base,
      distanceMeters: 33_900,
      hookText: '今天骑了这条线',
      dataLineText: '自定义第一行\n自定义第二行',
    })
    expect(captions.hook).toEqual(['今天骑了这条线'])
    expect(captions.dataLine).toEqual(['自定义第一行', '自定义第二行'])
  })

  it('自定义文案空串/纯空白时按自动生成处理（清空即恢复默认）', () => {
    const captions = buildVideoCaptionTexts({
      ...base,
      distanceMeters: 20_000,
      hookText: '   \n  ',
      dataLineText: '',
    })
    expect(captions.hook).toEqual(['这条 20.0 公里的回放', '别人要开会员才能看'])
    expect(captions.dataLine).toEqual(['20.0 km'])
  })

  it('自定义钩子不依赖里程数据（无里程也能显示自定义文案）', () => {
    const captions = buildVideoCaptionTexts({
      ...base,
      hookText: '随便一句开场',
    })
    expect(captions.hook).toEqual(['随便一句开场'])
    expect(captions.dataLine).toBeUndefined()
  })

  it('自定义文案仍受开关控制（关闭钩子即不显示自定义钩子）', () => {
    const captions = buildVideoCaptionTexts({
      ...base,
      showHook: false,
      hookText: '这句不该出现',
      dataLineText: '这句会出现',
    })
    expect(captions.hook).toBeUndefined()
    expect(captions.dataLine).toEqual(['这句会出现'])
  })
})

describe('导出文件名', () => {
  it('直接取活动标题作为文件名', () => {
    expect(buildVideoFileName('环湖骑行', 'mp4', '2026-03-08 骑行')).toBe('环湖骑行.mp4')
    expect(buildVideoFileName('早班车队拉练', 'webm', '2026-03-08 骑行')).toBe('早班车队拉练.webm')
  })

  it('过滤文件名非法字符，连续空白压缩为一个空格', () => {
    expect(buildVideoFileName('环湖 / 拉练: 第2圈', 'mp4', '备用名')).toBe('环湖 拉练 第2圈.mp4')
    expect(buildVideoFileName('a\\b*c?d"e<f>g|h', 'mp4', '备用名')).toBe('a b c d e f g h.mp4')
  })

  it('标题缺失或清洗后为空时回退备用名', () => {
    expect(buildVideoFileName('', 'mp4', '2026-03-08 骑行')).toBe('2026-03-08 骑行.mp4')
    expect(buildVideoFileName('///', 'mp4', '2026-03-08 骑行')).toBe('2026-03-08 骑行.mp4')
  })

  it('超长标题截断到 60 字符', () => {
    const long = '骑'.repeat(100)
    expect(buildVideoFileName(long, 'mp4', '备用名')).toBe(`${'骑'.repeat(60)}.mp4`)
  })
})

describe('Web Mercator 投影', () => {
  it('lngToWorldPx：经度 0 在世界中心，每升一级缩放坐标翻倍', () => {
    expect(lngToWorldPx(0, 0)).toBe(128)
    expect(lngToWorldPx(0, 3)).toBe(128 * 8)
    // 经度 -180 / 180 落在金字塔两端
    expect(lngToWorldPx(-180, 2)).toBe(0)
    expect(lngToWorldPx(180, 2)).toBe(256 * 4)
  })

  it('latToWorldPx：纬度 0 在世界中心，极端纬度钳制在墨卡托有效域', () => {
    expect(latToWorldPx(0, 0)).toBe(128)
    // ±85.0511° 对应金字塔上下边缘（约 0 / 256），超出值被钳制
    expect(latToWorldPx(85.05112878, 0)).toBeCloseTo(0, 5)
    expect(latToWorldPx(-85.05112878, 0)).toBeCloseTo(256, 5)
    expect(latToWorldPx(89, 0)).toBeCloseTo(0, 5)
  })
})

describe('computeFittedZoom 拟合缩放', () => {
  const CANVAS_W = 1280
  const CANVAS_H = 720
  const PADDING = 80

  it('极小包围盒返回上限 17（街道级细节）', () => {
    const zoom = computeFittedZoom(
      { minLat: 31.2, maxLat: 31.2001, minLng: 121.4, maxLng: 121.4001 },
      CANVAS_W,
      CANVAS_H,
      PADDING,
    )
    expect(zoom).toBe(17)
  })

  it('超大包围盒（跨国骑行）返回下限 2，不越界', () => {
    const zoom = computeFittedZoom(
      { minLat: -40, maxLat: 50, minLng: -10, maxLng: 120 },
      CANVAS_W,
      CANVAS_H,
      PADDING,
    )
    expect(zoom).toBe(2)
  })

  it('中等包围盒返回单调合理的中间级别（城区一日骑行）', () => {
    const zoom = computeFittedZoom(
      { minLat: 31.15, maxLat: 31.35, minLng: 121.3, maxLng: 121.6 },
      CANVAS_W,
      CANVAS_H,
      PADDING,
    )
    expect(zoom).toBeGreaterThan(2)
    expect(zoom).toBeLessThan(17)
  })

  it('缩放级别随包围盒增大单调不增', () => {
    const small = computeFittedZoom(
      { minLat: 31.2, maxLat: 31.25, minLng: 121.4, maxLng: 121.45 },
      CANVAS_W,
      CANVAS_H,
      PADDING,
    )
    const large = computeFittedZoom(
      { minLat: 31.0, maxLat: 31.45, minLng: 121.1, maxLng: 121.75 },
      CANVAS_W,
      CANVAS_H,
      PADDING,
    )
    expect(large).toBeLessThanOrEqual(small)
  })
})

describe('computeTileRange 瓦片范围', () => {
  it('常规视口返回连续的小范围（约 6×4 张）', () => {
    const range = computeTileRange(14, 3_000_000, 1_600_000, 1280, 720)
    expect(range.xEnd - range.xStart).toBeLessThanOrEqual(6)
    expect(range.yEnd - range.yStart).toBeLessThanOrEqual(4)
    expect(range.xEnd).toBeGreaterThanOrEqual(range.xStart)
    expect(range.yEnd).toBeGreaterThanOrEqual(range.yStart)
  })

  it('视口越出金字塔边界时钳制到 [0, 2^z - 1]', () => {
    const range = computeTileRange(2, 0, 0, 1280, 720)
    expect(range.xStart).toBe(0)
    expect(range.yStart).toBe(0)
    expect(range.xEnd).toBeLessThanOrEqual(3)
    expect(range.yEnd).toBeLessThanOrEqual(3)
  })
})
