/**
 * 社媒分享卡 Canvas 绘制层（规格外延伸功能）。
 *
 * 与 yearReview/shareCard.ts 同源的深色 + 荧光绿视觉语言；
 * 布局数学来自设计原型 docs/prototypes/share-studio.html（两轮审查定稿）：
 * - 朋友圈单图 1080×1440：日期/车型 → 两行标题 → 路线主视觉 → 4 指标条
 * - 小红书 4 页 1080×1440：封面（结论句+钩子数字）/ 路线+指标 / 洞察×3 / 数据图表
 *
 * 绘制红线（Anti-Slop）：无彩色渐变、无装饰 emoji、中文 ≤96px、
 * 数字一律等宽字体、缺失数据显示 '—' 不伪造（规格 §25）。
 * getContext 不可用（jsdom）时返回 false，调用方降级处理。
 */
import type { ShareData, ShareElevationPoint } from '@/features/share/shareData'

/** 卡片逻辑宽度（px，导出时 ×2） */
export const SHARE_CARD_WIDTH = 1080

/** 卡片逻辑高度（px，导出时 ×2） */
export const SHARE_CARD_HEIGHT = 1440

/** 高清导出缩放比 */
const EXPORT_SCALE = 2

/** 页边距 */
const PAD = 72

/** 内容宽度 */
const CONTENT = SHARE_CARD_WIDTH - PAD * 2

/** 配色（与 index.css 深色主题变量一致；硬编码因 canvas 不支持 CSS 变量） */
const COLORS = {
  bg: '#121417',
  surface: '#1b1e23',
  plate: '#22262c',
  border: '#2a2e35',
  gridMinor: '#2a2f37',
  gridMajor: '#343b45',
  text: '#e8eaed',
  textSecondary: '#9aa0a6',
  textTertiary: '#6b7178',
  primary: '#b8e62e',
  neutral: '#3d4759',
  casing: '#121417',
} as const

/** 字体栈（数字用 mono 栈保证等宽对齐；中文按系统可用字体回退） */
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif'
const MONO = '"SF Mono","JetBrains Mono","Roboto Mono",ui-monospace,Menlo,Consolas,monospace'

/** 地图/图表面板内边距与圆角 */
const PLATE_INNER_PAD = 56
const PLATE_RADIUS = 16

/** 网格间距（与页边距同值成节奏；每 4 格一条主线） */
const GRID_STEP = 72
const GRID_MAJOR_EVERY = 4

/** 页脚基线（全部 1440 卡统一，避免翻页跳动） */
const FOOTER_BASELINE = 1350

/** 小红书各页标签（弹窗分页器与下载文件名共用） */
export const XHS_PAGE_LABELS = ['封面', '路线', '洞察', '图表'] as const

/** 平台标识 */
export type SharePlatform = 'moments' | 'xhs'

/** 各平台页数（朋友圈 1 张；小红书 4 页） */
export function sharePageCount(platform: SharePlatform): number {
  return platform === 'moments' ? 1 : XHS_PAGE_LABELS.length
}

/** 下载文件名用的平台标签 */
function platformFileLabel(platform: SharePlatform, page: number): string {
  return platform === 'moments' ? '朋友圈' : `小红书${XHS_PAGE_LABELS[page] ?? ''}`
}

/**
 * 把指定平台的某一页绘制到 canvas（2x 缩放导出高清）。
 *
 * @param canvas 目标画布
 * @param data 分享素材数据（buildShareData 产出）
 * @param platform 平台
 * @param page 页码（朋友圈恒 0；小红书 0..3）
 * @returns 绘制成功返回 true（jsdom 无 2d context 时 false）
 */
export function drawShareCard(
  canvas: HTMLCanvasElement,
  data: ShareData,
  platform: SharePlatform,
  page: number,
): boolean {
  const ctx = canvas.getContext('2d')
  if (ctx === null) {
    return false
  }
  canvas.width = SHARE_CARD_WIDTH * EXPORT_SCALE
  canvas.height = SHARE_CARD_HEIGHT * EXPORT_SCALE
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE)
  ctx.textBaseline = 'alphabetic'

  // 背景
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT)

  if (platform === 'moments') {
    drawMoments(ctx, data)
  } else {
    drawXhsPage(ctx, data, page)
  }

  drawFooter(ctx, data)
  return true
}

/** 朋友圈单图：日期/车型 → 标题 → 路线主视觉 → 4 指标条 */
function drawMoments(ctx: CanvasRenderingContext2D, data: ShareData): void {
  // 顶部日期 + 车型角标（右对齐；无车型整段省略）
  ctx.fillStyle = COLORS.textSecondary
  ctx.font = `24px ${SANS}`
  ctx.fillText(data.dateText, PAD, 100)
  if (data.bikeName !== undefined) {
    ctx.textAlign = 'right'
    ctx.fillText(data.bikeName, SHARE_CARD_WIDTH - PAD, 100)
    ctx.textAlign = 'left'
  }

  // 两行大标题（真实数据）
  drawHeadline(ctx, data.headlineLines, PAD, 240, 76, 96, 2)

  // 路线主视觉（约 54% 版面；无轨迹时诚实降级）
  drawRoutePlate(ctx, data, PAD, 384, CONTENT, 774)

  // 4 指标条：钩子指标（距离）用主色，其余正文色
  drawMetricRow(ctx, data.metrics, 1190, [PAD, 312, 552, 792], 216, 0)
}

/** 小红书分页绘制 */
function drawXhsPage(ctx: CanvasRenderingContext2D, data: ShareData, page: number): void {
  switch (page) {
    case 1:
      drawXhsRoute(ctx, data)
      break
    case 2:
      drawXhsInsights(ctx, data)
      break
    case 3:
      drawXhsCharts(ctx, data)
      break
    default:
      drawXhsCover(ctx, data)
  }
}

/** 小红书封面：大字结论句 + 钩子数字（第一落点是结论，不是数字） */
function drawXhsCover(ctx: CanvasRenderingContext2D, data: ShareData): void {
  ctx.fillStyle = COLORS.textSecondary
  ctx.font = `26px ${SANS}`
  ctx.fillText(data.kicker || '骑行记录', PAD, 168)

  drawHeadline(ctx, data.headlineLines, PAD, 300, 76, 97, 3)

  ctx.strokeStyle = COLORS.border
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, 580)
  ctx.lineTo(SHARE_CARD_WIDTH - PAD, 580)
  ctx.stroke()

  // 钩子数字：取「距离」指标的值与单位（缺失时取爬升，再取时长）
  const hook = pickHookMetric(data)
  ctx.fillStyle = COLORS.textSecondary
  ctx.font = `26px ${SANS}`
  ctx.fillText(hook.label, PAD, 660)

  ctx.fillStyle = COLORS.primary
  ctx.font = `bold 160px ${MONO}`
  ctx.fillText(hook.value, PAD, 860)
  const valueWidth = ctx.measureText(hook.value).width
  ctx.fillStyle = COLORS.text
  ctx.font = `56px ${SANS}`
  ctx.fillText(hook.unit, PAD + valueWidth + 16, 860)

  // 次要指标 3 列（剩余指标中取前 3 个非 '—' 值优先）
  drawMetricRow(ctx, data.metrics, 1000, [PAD, 392, 712], 296, -1, 52)
}

/** 小红书内页 1：路线 + 2×2 指标 */
function drawXhsRoute(ctx: CanvasRenderingContext2D, data: ShareData): void {
  drawKicker(ctx, '本次骑行', 140)
  drawRoutePlate(ctx, data, PAD, 176, CONTENT, 680)

  ctx.strokeStyle = COLORS.border
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, 920)
  ctx.lineTo(SHARE_CARD_WIDTH - PAD, 920)
  ctx.stroke()

  drawMetric2x2(ctx, data.metrics, PAD, 552, 456, 1000, 1180)
}

/** 小红书内页 2：洞察 ×3（不足 3 条按实际条数绘制，不凑数） */
function drawXhsInsights(ctx: CanvasRenderingContext2D, data: ShareData): void {
  drawKicker(ctx, '骑行洞察', 140)
  const rows = [200, 512, 824]
  const cardHeight = 280
  for (let i = 0; i < data.insights.length && i < rows.length; i += 1) {
    const insight = data.insights[i]
    const y = rows[i]
    ctx.fillStyle = COLORS.surface
    roundRectPath(ctx, PAD, y, CONTENT, cardHeight, PLATE_RADIUS)
    ctx.fill()

    // 荧光绿圆点：与首行文字视觉居中（基线 y+96）
    ctx.fillStyle = COLORS.primary
    ctx.beginPath()
    ctx.arc(PAD + 46, y + 83, 6, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = COLORS.text
    ctx.font = `bold 36px ${SANS}`
    ctx.fillText(ellipsisText(ctx, insight.title, CONTENT - 120), PAD + 76, y + 96)

    ctx.fillStyle = COLORS.textSecondary
    ctx.font = `30px ${SANS}`
    drawWrapped(ctx, insight.text, PAD + 76, y + 160, CONTENT - 140, 46, 3)
  }
  // 一条洞察都没有时给出诚实空态（不编造）
  if (data.insights.length === 0) {
    ctx.fillStyle = COLORS.textSecondary
    ctx.font = `30px ${SANS}`
    ctx.fillText('本次骑行暂无可呈现的洞察数据', PAD, 300)
  }
}

/** 小红书内页 3：数据图表（海拔剖面 + 分段配速） */
function drawXhsCharts(ctx: CanvasRenderingContext2D, data: ShareData): void {
  drawKicker(ctx, '数据图表', 140)
  const hasElevation = data.elevation !== undefined
  const hasSplits = data.splits !== undefined
  if (hasElevation) {
    drawElevationPlate(ctx, data, PAD, 176, CONTENT, 576)
  }
  if (hasSplits) {
    drawSplitsPlate(ctx, data, PAD, hasElevation ? 784 : 300, CONTENT, hasElevation ? 400 : 700)
  }
  if (!hasElevation && !hasSplits) {
    ctx.fillStyle = COLORS.textSecondary
    ctx.font = `30px ${SANS}`
    ctx.fillText('该活动无海拔/速度逐点数据，无法绘制图表', PAD, 300)
  }
}

/** 眉标（页内小标题） */
function drawKicker(ctx: CanvasRenderingContext2D, text: string, baseline: number): void {
  ctx.fillStyle = COLORS.textSecondary
  ctx.font = `26px ${SANS}`
  ctx.fillText(text, PAD, baseline)
}

/** 页脚：统一基线与对比度达标色（24px + textSecondary，≥ AA） */
function drawFooter(ctx: CanvasRenderingContext2D, data: ShareData): void {
  ctx.fillStyle = COLORS.textSecondary
  ctx.font = `24px ${SANS}`
  ctx.fillText('本地解析 · 数据不出浏览器', PAD, FOOTER_BASELINE)
  ctx.textAlign = 'right'
  ctx.fillText('骑了么', SHARE_CARD_WIDTH - PAD, FOOTER_BASELINE)
  ctx.textAlign = 'left'
  void data
}

/** 大标题（两行，第二行可空；CJK 可断行，超行省略号截断不缩字号） */
function drawHeadline(
  ctx: CanvasRenderingContext2D,
  lines: readonly [string, string],
  x: number,
  firstBaseline: number,
  fontSize: number,
  lineHeight: number,
  maxLines: number,
): void {
  ctx.fillStyle = COLORS.text
  ctx.font = `bold ${fontSize}px ${SANS}`
  const wrapped = wrapCjk(ctx, lines.filter((line) => line.length > 0).join(' '), CONTENT, maxLines)
  wrapped.forEach((line, index) => {
    ctx.fillText(line, x, firstBaseline + index * lineHeight)
  })
}

/**
 * 指标行：label 在上（次要色）+ value 在下（等宽字体）。
 * hookIndex：用主色高亮的指标下标（-1 = 不高亮）；valueSize 可调（封面 52 / 主图 64）。
 * 列起始 x 由 cols 给出；valueSize 可调（封面 52 / 主图 64）。
 */
function drawMetricRow(
  ctx: CanvasRenderingContext2D,
  metrics: ShareData['metrics'],
  top: number,
  cols: readonly number[],
  colWidth: number,
  hookIndex: number,
  valueSize = 64,
): void {
  for (let i = 0; i < metrics.length && i < cols.length; i += 1) {
    const metric = metrics[i]
    const x = cols[i]
    ctx.fillStyle = COLORS.textSecondary
    ctx.font = `24px ${SANS}`
    ctx.fillText(metric.label, x, top + 22)
    ctx.fillStyle = i === hookIndex && metric.value !== '—' ? COLORS.primary : COLORS.text
    ctx.font = `bold ${valueSize}px ${MONO}`
    ctx.fillText(ellipsisText(ctx, metric.value, colWidth), x, top + 84)
  }
}

/** 2×2 指标（小红书内页 1） */
function drawMetric2x2(
  ctx: CanvasRenderingContext2D,
  metrics: ShareData['metrics'],
  col1: number,
  col2: number,
  colWidth: number,
  row1LabelBaseline: number,
  row2LabelBaseline: number,
): void {
  const positions = [
    { x: col1, label: row1LabelBaseline },
    { x: col2, label: row1LabelBaseline },
    { x: col1, label: row2LabelBaseline },
    { x: col2, label: row2LabelBaseline },
  ]
  for (let i = 0; i < metrics.length && i < positions.length; i += 1) {
    const metric = metrics[i]
    const position = positions[i]
    ctx.fillStyle = COLORS.textSecondary
    ctx.font = `24px ${SANS}`
    ctx.fillText(metric.label, position.x, position.label)
    ctx.fillStyle = COLORS.text
    ctx.font = `bold 64px ${MONO}`
    ctx.fillText(ellipsisText(ctx, metric.value, colWidth), position.x, position.label + 80)
  }
}

/**
 * 路线面板：深色坐标纸 + 双描边荧光绿轨迹 + 起终点标记 + 比例尺 + 四角裁切角标。
 * 无轨迹时诚实显示「无轨迹数据」（不伪造图形）。
 */
function drawRoutePlate(
  ctx: CanvasRenderingContext2D,
  data: ShareData,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  drawPlate(ctx, x, y, width, height)
  if (data.route.length < 2) {
    ctx.fillStyle = COLORS.textSecondary
    ctx.font = `28px ${SANS}`
    ctx.textAlign = 'center'
    ctx.fillText('无轨迹数据', x + width / 2, y + height / 2)
    ctx.textAlign = 'left'
    return
  }

  // 轨迹 fit：归一化坐标（0..1）等比映射到内缩区域并居中
  const scale = Math.min(width, height) - PLATE_INNER_PAD * 2
  const drawWidth = width - PLATE_INNER_PAD * 2
  const drawHeight = height - PLATE_INNER_PAD * 2
  const offsetX = x + (width - drawWidth) / 2
  const offsetY = y + (height - drawHeight) / 2
  const toPixel = (point: { x: number; y: number }) => ({
    px: offsetX + drawWidth / 2 + (point.x - 0.5) * scale,
    py: offsetY + drawHeight / 2 + (point.y - 0.5) * scale,
  })

  // 底纹网格：从面板中心对称展开（左右上下留白一致）
  drawGrid(ctx, x, y, width, height)

  ctx.save()
  roundRectPath(ctx, x, y, width, height, PLATE_RADIUS)
  ctx.clip()

  const pixels = data.route.map(toPixel)

  // 双描边：深色 casing 垫底 + 荧光绿主线（真实地图库的路线画法）
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = COLORS.casing
  ctx.lineWidth = 14
  ctx.beginPath()
  pixels.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.px, point.py)
    } else {
      ctx.lineTo(point.px, point.py)
    }
  })
  ctx.stroke()
  ctx.strokeStyle = COLORS.primary
  ctx.lineWidth = 6
  ctx.stroke()

  // 起终点标记
  const first = pixels[0]
  const last = pixels[pixels.length - 1]
  ctx.fillStyle = COLORS.textSecondary
  ctx.beginPath()
  ctx.arc(first.px, first.py, 10, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = COLORS.primary
  ctx.beginPath()
  ctx.arc(last.px, last.py, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = COLORS.bg
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(last.px, last.py, 14, 0, Math.PI * 2)
  ctx.stroke()

  // 比例尺：由路线真实跨度换算（有跨度数据才画；无则不伪造）
  if (data.routeSpanKm !== undefined) {
    drawScaleBar(ctx, data, x, y, height, scale)
  }
  drawCropMarks(ctx, x, y, width, height)
  ctx.restore()
}

/** 比例尺：左下角刻度线 + 「N km」标签，长度取 ≤160px 的最大整刻度 */
function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  data: ShareData,
  x: number,
  y: number,
  height: number,
  scale: number,
): void {
  const span = data.routeSpanKm
  if (span === undefined) {
    return
  }
  const maxSpanKm = Math.max(span.widthKm, span.heightKm)
  if (!Number.isFinite(maxSpanKm) || maxSpanKm <= 0) {
    return
  }
  const kmPerPx = maxSpanKm / scale
  const candidates = [1, 2, 5, 10, 20, 50, 100]
  let barKm = candidates[0]
  for (const candidate of candidates) {
    if (candidate / kmPerPx <= 160) {
      barKm = candidate
    }
  }
  const barPx = barKm / kmPerPx
  const bx = x + 28
  const by = y + height - 28

  ctx.strokeStyle = COLORS.textSecondary
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(bx, by - 8)
  ctx.lineTo(bx, by)
  ctx.lineTo(bx + barPx, by)
  ctx.lineTo(bx + barPx, by - 8)
  ctx.stroke()
  ctx.fillStyle = COLORS.textSecondary
  ctx.font = `22px ${MONO}`
  ctx.fillText(`${barKm} km`, bx + barPx + 12, by)
}

/** 四角 L 形裁切角标（相机取景框隐喻，暗示「按真实坐标等比绘制」） */
function drawCropMarks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const length = 22
  const inset = 16
  ctx.strokeStyle = COLORS.textTertiary
  ctx.lineWidth = 2
  const corners: Array<[number, number, number, number]> = [
    [x + inset, y + inset, 1, 1],
    [x + width - inset, y + inset, -1, 1],
    [x + inset, y + height - inset, 1, -1],
    [x + width - inset, y + height - inset, -1, -1],
  ]
  ctx.beginPath()
  for (const [cx, cy, dx, dy] of corners) {
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + length * dx, cy)
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx, cy + length * dy)
  }
  ctx.stroke()
}

/**
 * 海拔剖面面板：荧光绿面积剖面 + 爬坡段加深 + 等级标注（包围盒防叠字）。
 * 峰值标注与爬坡等级同位时并入「最高 N m · X级」，保证 1级/2级 真实出现。
 */
function drawElevationPlate(
  ctx: CanvasRenderingContext2D,
  data: ShareData,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const elevation = data.elevation
  if (elevation === undefined) {
    return
  }
  drawPlate(ctx, x, y, width, height)
  drawGrid(ctx, x, y, width, height)

  const innerPad = 40
  const plotX = x + innerPad
  const plotY = y + 88
  const plotWidth = width - innerPad * 2
  const plotHeight = height - 88 - 56
  const points = elevation.points
  const minKm = points[0].km
  const maxKm = points[points.length - 1].km
  const spanKm = Math.max(maxKm - minKm, Number.EPSILON)
  const minAlt = elevation.min
  const altSpan = Math.max(elevation.max - minAlt, 10)

  const toPixel = (point: ShareElevationPoint) => ({
    px: plotX + ((point.km - minKm) / spanKm) * plotWidth,
    py: plotY + plotHeight - ((point.altitude - minAlt) / altSpan) * plotHeight,
  })

  ctx.save()
  roundRectPath(ctx, x, y, width, height, PLATE_RADIUS)
  ctx.clip()

  // 爬坡段加深（先画带，再画剖面线压在上面）
  for (const climb of elevation.climbs) {
    const startX = plotX + ((climb.startKm - minKm) / spanKm) * plotWidth
    const endX = plotX + ((climb.endKm - minKm) / spanKm) * plotWidth
    ctx.fillStyle = 'rgba(184, 230, 46, 0.22)'
    ctx.fillRect(startX, plotY, Math.max(endX - startX, 2), plotHeight)
  }

  // 面积 + 剖面线（纯色低透明填充，不用渐变）
  ctx.beginPath()
  points.forEach((point, index) => {
    const pixel = toPixel(point)
    if (index === 0) {
      ctx.moveTo(pixel.px, pixel.py)
    } else {
      ctx.lineTo(pixel.px, pixel.py)
    }
  })
  ctx.lineTo(toPixel(points[points.length - 1]).px, plotY + plotHeight)
  ctx.lineTo(toPixel(points[0]).px, plotY + plotHeight)
  ctx.closePath()
  ctx.fillStyle = 'rgba(184, 230, 46, 0.14)'
  ctx.fill()
  ctx.strokeStyle = COLORS.primary
  ctx.lineWidth = 3
  ctx.beginPath()
  points.forEach((point, index) => {
    const pixel = toPixel(point)
    if (index === 0) {
      ctx.moveTo(pixel.px, pixel.py)
    } else {
      ctx.lineTo(pixel.px, pixel.py)
    }
  })
  ctx.stroke()

  // 标题行：左「海拔剖面」，右「累计爬升 N m」（数字等宽）
  ctx.fillStyle = COLORS.textSecondary
  ctx.font = `24px ${SANS}`
  ctx.fillText('海拔剖面', plotX, y + 52)
  ctx.textAlign = 'right'
  ctx.fillText(`累计爬升 ${elevation.gainM} m`, x + width - innerPad, y + 52)
  ctx.textAlign = 'left'

  // 峰值标注（与爬坡等级标签共用包围盒防叠：先占位峰值，再放等级）
  const peak = points.reduce((best, point) => (point.altitude > best.altitude ? point : best), points[0])
  const peakPixel = toPixel(peak)
  const peakText = `最高 ${Math.round(peak.altitude)} m`
  ctx.font = `22px ${MONO}`
  const peakBox = { x: peakPixel.px - 8, y: peakPixel.py - 34, w: ctx.measureText(peakText).width + 16, h: 30 }
  // 峰值所在爬坡段并入峰值标注（方案 B），其余段独立标注
  const peakClimb = elevation.climbs.find(
    (climb) => peak.km >= climb.startKm && peak.km <= climb.endKm,
  )
  const peakFullText =
    peakClimb !== undefined ? `${peakText} · ${peakClimb.label}` : peakText
  ctx.fillStyle = COLORS.text
  ctx.fillText(peakFullText, Math.min(Math.max(peakBox.x, plotX), x + width - innerPad - 160), peakBox.y + 22)

  // 其余爬坡段等级标注：包围盒相交检测，真重叠才抑制（1级/2级 能真实出现）
  const drawnBoxes = [{ ...peakBox, w: ctx.measureText(peakFullText).width + 16 }]
  for (const climb of elevation.climbs) {
    if (peakClimb !== undefined && climb === peakClimb) {
      continue
    }
    const midX = plotX + (((climb.startKm + climb.endKm) / 2 - minKm) / spanKm) * plotWidth
    const label = climb.label
    ctx.font = `22px ${SANS}`
    const box = { x: midX - 24, y: plotY + 6, w: ctx.measureText(label).width + 16, h: 28 }
    const overlaps = drawnBoxes.some(
      (other) =>
        box.x < other.x + other.w &&
        box.x + box.w > other.x &&
        box.y < other.y + other.h &&
        box.y + box.h > other.y,
    )
    if (overlaps) {
      continue
    }
    ctx.fillStyle = COLORS.textSecondary
    ctx.fillText(label, box.x + 8, box.y + 20)
    drawnBoxes.push(box)
  }

  // x 轴里程刻度（数字等宽）
  ctx.fillStyle = COLORS.textTertiary
  ctx.font = `20px ${MONO}`
  const ticks = [minKm, (minKm + maxKm) / 2, maxKm]
  ticks.forEach((km, index) => {
    const label = index === ticks.length - 1 ? km.toFixed(1) : String(Math.round(km))
    ctx.textAlign = index === 0 ? 'left' : index === ticks.length - 1 ? 'right' : 'center'
    ctx.fillText(`${label} km`, plotX + ((km - minKm) / spanKm) * plotWidth, y + height - 20)
  })
  ctx.textAlign = 'left'
  ctx.restore()
}

/**
 * 分段配速面板：每 5 km 柱（末段按真实里程等比缩宽），最快段主色高亮，
 * 全程均速虚线（距离/时间口径），x 轴为真实里程轴（右端 = 总里程）。
 */
function drawSplitsPlate(
  ctx: CanvasRenderingContext2D,
  data: ShareData,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const splits = data.splits
  if (splits === undefined) {
    return
  }
  drawPlate(ctx, x, y, width, height)

  const innerPad = 40
  const plotX = x + innerPad
  const plotY = y + 88
  const plotWidth = width - innerPad * 2
  const plotHeight = height - 88 - 64
  const items = splits.items
  const totalSpanKm = Math.max(splits.totalKm, items[items.length - 1].startKm + items[items.length - 1].lengthKm)
  const maxSpeed = Math.max(...items.map((item) => item.speedKmh), splits.avgKmh) * 1.1
  const kmToPx = (km: number) => plotX + (km / totalSpanKm) * plotWidth
  const speedToPy = (speed: number) => plotY + plotHeight - (speed / maxSpeed) * plotHeight

  // 柱：宽 = 段实际里程占比（末段 3.4km 不画成 5km，图面读数诚实）
  let bestIndex = 0
  items.forEach((item, index) => {
    if (item.speedKmh > items[bestIndex].speedKmh) {
      bestIndex = index
    }
  })
  items.forEach((item, index) => {
    const x0 = kmToPx(item.startKm)
    const x1 = kmToPx(item.startKm + item.lengthKm)
    const barWidth = Math.max(x1 - x0 - 4, 2)
    ctx.fillStyle = index === bestIndex ? COLORS.primary : COLORS.neutral
    ctx.fillRect(x0 + 2, speedToPy(item.speedKmh), barWidth, plotY + plotHeight - speedToPy(item.speedKmh))
  })

  // 全程均速虚线（口径 = 距离/时间，与指标卡均速一致）
  ctx.strokeStyle = COLORS.textSecondary
  ctx.lineWidth = 1
  ctx.setLineDash([6, 6])
  ctx.beginPath()
  ctx.moveTo(plotX, speedToPy(splits.avgKmh))
  ctx.lineTo(plotX + plotWidth, speedToPy(splits.avgKmh))
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = COLORS.textSecondary
  ctx.font = `20px ${MONO}`
  ctx.textAlign = 'right'
  ctx.fillText(`全程 ${splits.avgKmh.toFixed(1)}`, plotX + plotWidth, speedToPy(splits.avgKmh) - 8)
  ctx.textAlign = 'left'

  // 标题 + x 轴里程刻度（0 / 50 / 100 / 总里程，数字等宽）
  ctx.fillStyle = COLORS.textSecondary
  ctx.font = `24px ${SANS}`
  ctx.fillText('分段配速 (km/h)', plotX, y + 52)
  ctx.fillStyle = COLORS.textTertiary
  ctx.font = `20px ${MONO}`
  const tickKm = [0, 50, 100, totalSpanKm].filter(
    (km, index, list) => km <= totalSpanKm && list.indexOf(km) === index,
  )
  tickKm.forEach((km) => {
    const label = km === totalSpanKm ? km.toFixed(1) : String(km)
    ctx.textAlign = km === 0 ? 'left' : km === totalSpanKm ? 'right' : 'center'
    ctx.fillText(`${label} km`, kmToPx(km), y + height - 24)
  })
  ctx.textAlign = 'left'
}

/** 面板底：plate 色 + 描边 + 圆角 */
function drawPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = COLORS.plate
  roundRectPath(ctx, x, y, width, height, PLATE_RADIUS)
  ctx.fill()
  ctx.strokeStyle = COLORS.border
  ctx.lineWidth = 1
  ctx.stroke()
}

/** 底纹网格：从面板中心对称展开（细线 72px 一格，每 4 格一条主线） */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const centerX = x + width / 2
  const centerY = y + height / 2
  ctx.save()
  roundRectPath(ctx, x, y, width, height, PLATE_RADIUS)
  ctx.clip()
  for (let offset = GRID_STEP; offset < Math.max(width, height); offset += GRID_STEP) {
    const isMajor = (offset / GRID_STEP) % GRID_MAJOR_EVERY === 0
    ctx.strokeStyle = isMajor ? COLORS.gridMajor : COLORS.gridMinor
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(centerX + offset, y)
    ctx.lineTo(centerX + offset, y + height)
    ctx.moveTo(centerX - offset, y)
    ctx.lineTo(centerX - offset, y + height)
    ctx.moveTo(x, centerY + offset)
    ctx.lineTo(x + width, centerY + offset)
    ctx.moveTo(x, centerY - offset)
    ctx.lineTo(x + width, centerY - offset)
    ctx.stroke()
  }
  ctx.restore()
}

/** 圆角矩形路径 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

/** 多行文本绘制：wrapCjk 折行后逐行 fillText（行距 lineHeight，首行基线 baseline） */
function drawWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): void {
  wrapCjk(ctx, text, maxWidth, maxLines).forEach((line, index) => {
    ctx.fillText(line, x, baseline + index * lineHeight)
  })
}

/**
 * CJK 感知折行：中文逐字可断，拉丁字母/数字串整体不断。
 * 超出 maxLines 时末行末尾加省略号（不缩字号）。
 */
function wrapCjk(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = []
  let current = ''
  let latinRun = ''
  const flushLatin = () => {
    if (latinRun.length === 0) {
      return
    }
    current += latinRun
    latinRun = ''
  }
  for (const char of text) {
    if (/[\w.,:%-]/.test(char)) {
      latinRun += char
      continue
    }
    flushLatin()
    const candidate = current + char
    if (ctx.measureText(candidate).width > maxWidth && current.length > 0) {
      lines.push(current)
      current = char === ' ' ? '' : char
      if (lines.length === maxLines) {
        break
      }
    } else {
      current = candidate === ' ' && current.length === 0 ? '' : candidate
    }
  }
  if (lines.length < maxLines) {
    flushLatin()
    if (current.length > 0) {
      lines.push(current)
    }
  }
  if (lines.length > maxLines) {
    lines.length = maxLines
  }
  // 溢出截断：把剩余字符折算成省略号拼在末行（简化：检测是否还有未消费文本）
  const consumed = lines.join('').replace(/ /g, '').length
  const total = text.replace(/ /g, '').length
  if (consumed < total && lines.length > 0) {
    const last = lines[maxLines - 1]
    lines[maxLines - 1] = `${last.slice(0, Math.max(last.length - 1, 0))}…`
  }
  return lines
}

/** 单行省略号截断（指标值防撞列：64px mono 在 216px 列内约 5 字符） */
function ellipsisText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text
  }
  let result = text
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1)
  }
  return `${result}…`
}

/** 封面钩子指标：距离 > 爬升 > 时长（全缺时回退第一项，不编数字） */
function pickHookMetric(data: ShareData): { label: string; value: string; unit: string } {
  const distance = data.metrics[0]
  if (distance.value !== '—') {
    return { label: '总距离', value: distance.value, unit: 'km' }
  }
  const climb = data.metrics[2]
  if (climb.value !== '—') {
    return { label: '累计爬升', value: climb.value, unit: 'm' }
  }
  const duration = data.metrics[1]
  if (duration.value !== '—') {
    return { label: '骑行时长', value: duration.value, unit: 'h:mm' }
  }
  return { label: distance.label, value: '—', unit: '' }
}

/**
 * 绘制并下载某一页 PNG（独立离屏 canvas，不影响预览）。
 *
 * @param data 分享素材数据
 * @param platform 平台
 * @param page 页码
 * @param dateKey 日期键（文件名用，如 '2026-09-06'）
 * @returns 绘制失败（jsdom）返回 false
 */
export function downloadSharePng(
  data: ShareData,
  platform: SharePlatform,
  page: number,
  dateKey: string,
): boolean {
  const canvas = document.createElement('canvas')
  if (!drawShareCard(canvas, data, platform, page)) {
    return false
  }
  canvas.toBlob((blob) => {
    if (blob === null) {
      return
    }
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `骑了么-${dateKey}-${platformFileLabel(platform, page)}.png`
    anchor.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
  return true
}
