/**
 * 精选路线批量接入器：一个需求单数组文件 → 串行调用 curate-route.mjs → 汇总报告。
 *
 * 背景：curate-route.mjs 一次只能处理一条路线，二期「每地区 20 条」量级（数百条）
 * 不可能逐条敲命令。本脚本只做调度与汇总，几何/数据/测试的写入逻辑仍由单条脚本负责。
 *
 * 用法：
 *   node scripts/curate-batch.mjs --specs <specs.json> [--dry] [--force] [--refetch]
 *                                 [--only id1,id2] [--from 5] [--delay 1500]
 *
 * specs 文件格式：JSON 数组（每项为 curate-route.mjs 的需求单），
 * 或 { "routes": [ ... ] }（便于在文件里写注释性字段）。
 *
 * 参数：
 *   --only  只跑指定 id（逗号分隔），用于补跑失败条目
 *   --from  从数组第 N 项开始（1 起），用于断点续跑
 *   --delay  每条之间的间隔毫秒（默认 1500，给 Overpass 留限流余量）
 *   --dry/--force/--refetch  透传给 curate-route.mjs
 *
 * 退出码：全部成功 0；有失败条目 2（汇总报告已落盘，不中断后续条目）。
 * 每条的完整日志由 curate-route.mjs 写入 .tmp/curate/<id>/report.txt。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CURATE = resolve(ROOT, 'scripts/curate-route.mjs')
const OUT_DIR = resolve(ROOT, '.tmp/curate-batch')

// ---- CLI 参数 ----
const args = process.argv.slice(2)
function argOf(name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const specsArg = argOf('--specs')
if (!specsArg) {
  console.error('用法：node scripts/curate-batch.mjs --specs <specs.json> [--dry] [--force] [--only a,b] [--from 5]')
  process.exit(1)
}
// 透传给单条脚本的开关（顺序无关，curate-route.mjs 用 includes 判断）
const PASS_FLAGS = ['--dry', '--force', '--refetch'].filter((f) => args.includes(f))
const ONLY = (argOf('--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const FROM = Number(argOf('--from') ?? 1)
const DELAY = Number(argOf('--delay') ?? 1500)

const parsed = JSON.parse(readFileSync(resolve(specsArg), 'utf8'))
const allSpecs = Array.isArray(parsed) ? parsed : (parsed.routes ?? [])
if (!allSpecs.length) {
  console.error('specs 文件为空或格式不对（需为数组或 { routes: [...] }）')
  process.exit(1)
}
// 文件级 defaults（region/regionLabel/entryPrefix 等）合并到每条需求单，
// 新地区只需在文件里写一次 —— 否则第二条起会因缺 regionLabel 被单条脚本拒绝
const defaults = Array.isArray(parsed) ? {} : (parsed.defaults ?? {})

let specs = allSpecs.map((spec) => ({ ...defaults, ...spec }))
if (ONLY.length) specs = specs.filter((s) => ONLY.includes(s.id))
specs = specs.slice(Math.max(0, FROM - 1))

mkdirSync(OUT_DIR, { recursive: true })
console.log(`批量接入：${specs.length}/${allSpecs.length} 条${PASS_FLAGS.length ? ` [${PASS_FLAGS.join(' ')}]` : ''}`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 从单条脚本的报告里摘关键结论（几何行数），便于汇总一眼看质量 */
function summarize(id) {
  try {
    const text = readFileSync(resolve(ROOT, '.tmp/curate', id, 'report.txt'), 'utf8')
    const geo = text.split('\n').find((line) => line.startsWith('几何：'))
    const scope = text.split('\n').find((line) => line.startsWith('geometryScope'))
    return [geo, scope].filter(Boolean).join(' | ')
  } catch {
    return ''
  }
}

const results = []
for (let i = 0; i < specs.length; i += 1) {
  const spec = specs[i]
  const label = `[${i + 1}/${specs.length}] ${spec.region}/${spec.id} ${spec.name ?? ''}`
  const started = Date.now()
  const res = spawnSync(process.execPath, [CURATE, '--spec', JSON.stringify(spec), ...PASS_FLAGS], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
  if (res.status === 0) {
    console.log(`✔ ${label}（${seconds}s） ${summarize(spec.id)}`)
    results.push({ id: spec.id, status: 'ok', seconds, detail: summarize(spec.id) })
  } else {
    // 失败不中断：把单条日志尾巴打出来，便于集中排障
    const tail = out.trim().split('\n').slice(-6).join('\n')
    console.log(`✗ ${label}（${seconds}s，exit ${res.status}）\n${tail}\n`)
    results.push({ id: spec.id, status: 'fail', seconds, detail: tail.replace(/\n/g, ' / ') })
  }
  if (i < specs.length - 1 && DELAY > 0) await sleep(DELAY)
}

const okCount = results.filter((r) => r.status === 'ok').length
const failList = results.filter((r) => r.status !== 'ok')
const summary = [
  `批量接入汇总 ${new Date().toISOString()}`,
  `来源文件：${resolve(specsArg)}`,
  `总计 ${results.length} 条，成功 ${okCount}，失败 ${failList.length}`,
  '',
  ...results.map((r) => `${r.status === 'ok' ? 'OK  ' : 'FAIL'} ${r.id}  ${r.seconds}s  ${r.detail}`),
]
const summaryFile = resolve(OUT_DIR, 'summary.txt')
writeFileSync(summaryFile, summary.join('\n'), 'utf8')

console.log('')
console.log(`完成：成功 ${okCount} / 失败 ${failList.length}；汇总 → ${summaryFile}`)
if (failList.length) {
  console.log(`失败 id：${failList.map((r) => r.id).join(', ')}`)
  console.log(`补跑：node scripts/curate-batch.mjs --specs ${specsArg} --only ${failList.map((r) => r.id).join(',')}`)
  process.exit(2)
}
