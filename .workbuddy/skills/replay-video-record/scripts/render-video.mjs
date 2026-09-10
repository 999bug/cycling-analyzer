#!/usr/bin/env node
/**
 * 把 record-replay.mjs 产出的 webm 切成成片：裁剪操作段 → 变速到目标时长 → 烧中文字幕 → H.264 MP4。
 *
 * 裁剪用 trim 而不是 -ss：webm 的 -ss 会 seek 到关键帧，实际起点比给定值早，时长不可控。
 *
 * 用法：
 *   node scripts/render-video.mjs --take .workbuddy/exports/take-2026-09-10T09-49-16 --duration 34
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const argv = process.argv.slice(2)
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def
}

/**
 * 解析可用的 ffmpeg 可执行文件路径，保证 clone 后开箱即用：
 * 1. `--ffmpeg` 参数显式指定；
 * 2. 系统 PATH 里的 ffmpeg；
 * 3. devDependency `ffmpeg-static`（npm install 时自动下载的二进制，随仓库分发）。
 * 注意：成片用 libx264 编码 + libass 烧 ass 字幕，选中的 ffmpeg 必须同时支持这两样；
 * ffmpeg-static 的构建自带，系统自带构建未必——运行结束前会先做能力探测。
 */
function resolveFfmpeg() {
  const explicit = arg('ffmpeg', '')
  const candidates = [
    ...(explicit ? [explicit] : []),
    'ffmpeg',
    /** ffmpeg-static 是 CJS 包，ESM 里用 createRequire 拿二进制路径 */
    (() => {
      try {
        return createRequire(path.join(process.cwd(), 'package.json'))('ffmpeg-static')
      } catch {
        return null
      }
    })(),
  ].filter(Boolean)
  for (const cand of candidates) {
    const shell = process.platform === 'win32' && cand === 'ffmpeg'
    const enc = spawnSync(cand, ['-hide_banner', '-encoders'], { encoding: 'utf8', shell })
    const flt = spawnSync(cand, ['-hide_banner', '-filters'], { encoding: 'utf8', shell })
    const encOut = `${enc.stdout ?? ''}${enc.stderr ?? ''}`
    const fltOut = `${flt.stdout ?? ''}${flt.stderr ?? ''}`
    // 注意：libx264 是 encoder、libass 是 filter，要分两路探测，一个列表里永远凑不齐
    if (enc.status === 0 && flt.status === 0 && encOut.includes('libx264') && fltOut.includes(' libass ')) {
      console.log(`[ffmpeg] 使用：${cand === 'ffmpeg' ? '系统 PATH 中的 ffmpeg' : cand}`)
      return cand
    }
    if (enc.status === 0 && flt.status === 0) {
      const missing = [!encOut.includes('libx264') && 'libx264', !fltOut.includes(' libass ') && 'libass']
        .filter(Boolean)
        .join(' / ')
      console.warn(`[ffmpeg] ${cand} 缺 ${missing}，跳过（成片必须这两样）`)
    }
  }
  console.error(
    '[ffmpeg] 找不到可用的 ffmpeg（需要 libx264 + libass）。' +
      '请在项目根目录执行 `npm install`（会带 ffmpeg-static），或用 --ffmpeg 指定路径。',
  )
  process.exit(1)
}
const FFMPEG = resolveFfmpeg()

const TAKE = arg('take', '')
if (TAKE === '') {
  console.error('缺少 --take <take 目录>')
  process.exit(1)
}
const TAKE_DIR = path.resolve(TAKE)
const TARGET = Number(arg('duration', '34'))
const LEAD = Number(arg('lead', '1.0'))
const TAIL = Number(arg('tail', '0.8'))
// 全屏时地图容器比视口窄约 40px，右侧会留一条非地图的空白带，裁掉再拉回 1080 宽
const TRIM_RIGHT = Number(arg('trim-right', '40'))

const marksPath = path.join(TAKE_DIR, 'marks.json')
if (!fs.existsSync(marksPath)) {
  console.error('找不到 marks.json：', marksPath)
  process.exit(1)
}
const meta = JSON.parse(fs.readFileSync(marksPath, 'utf8'))
const marks = meta.marks

/** 秒 → 中文时长文案 */
function humanDuration(sec) {
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600)
    const m = Math.round((sec % 3600) / 60)
    return `${h} 小时 ${m} 分`
  }
  return `${Math.round(sec / 60)} 分钟`
}

/** 从作者快照里找活动，用来自动生成字幕文案 */
function findActivity(activityId) {
  if (activityId === '') return undefined
  const p = path.resolve('public/author-data/activities.json')
  if (!fs.existsSync(p)) return undefined
  const list = JSON.parse(fs.readFileSync(p, 'utf8'))
  return list.find((a) => a.id === activityId)
}

// 兼容早期 marks.json 的字段名（id / 无 mapMode）
const activityId = meta.activity ?? meta.id ?? ''
const modeLabel =
  typeof meta.mapMode === 'string' && meta.mapMode !== '' && meta.mapMode !== '正常'
    ? `-${meta.mapMode}`
    : ''
const act = findActivity(activityId)
const defaultHook =
  act === undefined
    ? '这段骑行回放\\N别人要开会员才能看'
    : `这条 ${Math.round(act.distance / 1000)} 公里的回放\\N别人要开会员才能看`
const defaultInfo =
  act === undefined
    ? '在线回放 · 免费'
    : `${act.distance / 1000 >= 10 ? Math.round(act.distance / 1000) : (act.distance / 1000).toFixed(1)} km · 爬升 ${act.elevationGain} m\\N运动 ${humanDuration(act.duration)} · ${meta.speed}× 加速`

const hookText = arg('hook', defaultHook)
const infoText = arg('info', defaultInfo)

const start = Math.max(0, marks.playStart - LEAD)
const end = marks.playEnd + TAIL
const srcLen = end - start
const factor = srcLen / TARGET

console.log(`[range] ${start.toFixed(2)}s → ${end.toFixed(2)}s（源 ${srcLen.toFixed(1)}s）`)
console.log(`[speed] setpts 变速 ${factor.toFixed(3)}× → 目标 ${TARGET}s`)

const infoEnd = Math.max(5, TARGET - 0.4)
const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,Microsoft YaHei,64,&H00FFFFFF,&H000000FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,8,60,60,170,134
Style: Info,Microsoft YaHei,42,&H00FFFFFF,&H000000FF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,4,1,2,90,90,185,134

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.20,0:00:04.40,Hook,,0,0,0,,${hookText}
Dialogue: 0,0:00:04.60,0:00:${infoEnd.toFixed(2)},Info,,0,0,0,,${infoText}
`
fs.writeFileSync(path.join(TAKE_DIR, 'subs.ass'), ass, 'utf8')

const inName = path.basename(meta.video)
const baseName = act === undefined ? path.basename(TAKE_DIR) : `${act.name}-竖屏`
const outPath = path.resolve(
  path.join(TAKE_DIR, '..', `${baseName}${modeLabel}${arg('suffix', '')}.mp4`),
)

execFileSync(
  FFMPEG,
  [
    '-y',
    '-i', inName,
    '-vf',
    `trim=start=${start}:end=${end},setpts=(PTS-STARTPTS)/${factor},` +
      `crop=iw-${TRIM_RIGHT}:ih:0:0,scale=1080:1920,setsar=1,ass=subs.ass`,
    '-an',
    '-r', '30',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outPath,
  ],
  { cwd: TAKE_DIR, stdio: ['ignore', 'pipe', 'pipe'] },
)

const stat = fs.statSync(outPath)
console.log(`[done] ${outPath}  ${(stat.size / 1024 / 1024).toFixed(1)} MB`)
