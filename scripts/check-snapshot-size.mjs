/**
 * 作者数据快照产物体积门禁（npm run check:snapshot-size）。
 *
 * 为什么需要它：快照体积随「活动数 × 单活动点数」线性增长，而它是**发布产物**——
 * 每一次部署都要把整个目录上传一遍，GitHub Pages 侧还会保留历史版本。
 * 没有门禁时，体积只会一路涨到有人抱怨「部署要十分钟」才被发现。
 *
 * 阈值取自 2026-09-16 实测基线（87 个活动）：
 * - 快照总计 157 MB（records 137.8 MB / tiles 约 18 MB / precomputed 0.5 MB）
 * - 单活动 records 平均 1.58 MB、最大 6.96 MB
 * 这里按约 1.5~2 倍余量设卡：正常增长（多骑几趟车）不会触发，
 * 而「误把原始 FIT 或未抽稀轨迹塞进产物」这类事故必然触发。
 * 调整阈值请在 PR 里说明理由——这个数字本身就是一条设计约束。
 *
 * 同时打印体积最大的 5 个活动文件：门禁失败时直接给出排查入口。
 *
 * 用法：node scripts/check-snapshot-size.mjs [--dir=public/author-data]
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** 各分组的体积上限（字节） */
const BUDGETS = {
  /** 快照总计 */
  total: 256 * 1024 * 1024,
  /** records/ 逐点数据总计 */
  recordsTotal: 224 * 1024 * 1024,
  /** 单个活动的逐点文件上限：详情页要把它整体下载并解析，超了就是首屏事故 */
  recordsSingle: 16 * 1024 * 1024,
  /** precomputed/ 预计算产物总计（热力图轨迹、赛段榜、路线分组、功率纪录） */
  precomputed: 8 * 1024 * 1024,
}

/** 分组体积统计 */
const groups = { records: 0, precomputed: 0, tiles: 0, other: 0 }

/** 单文件体积（用于找最大的 records） */
const recordsFiles = []

/**
 * 递归统计目录体积。
 *
 * @param dir 目录路径
 * @param relative 相对根目录的路径前缀
 */
async function walk(dir, relative = '') {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') {
      return
    }
    throw error
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    const rel = relative === '' ? entry.name : `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      await walk(full, rel)
      continue
    }
    const { size } = await stat(full)
    if (rel.startsWith('records/')) {
      groups.records += size
      recordsFiles.push({ rel, size })
    } else if (rel.startsWith('precomputed/')) {
      groups.precomputed += size
    } else if (rel.startsWith('tiles/')) {
      groups.tiles += size
    } else {
      groups.other += size
    }
  }
}

/**
 * 格式化字节数。
 *
 * @param bytes 字节数
 */
function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 判定一项是否超预算，返回描述文本。
 *
 * @param label 项目名
 * @param actual 实际值（字节）
 * @param budget 预算（字节）
 * @returns 超预算时的失败描述，未超时为 undefined
 */
function check(label, actual, budget) {
  const used = ((actual / budget) * 100).toFixed(0)
  console.log(`  ${label.padEnd(22)} ${formatBytes(actual).padStart(10)} / ${formatBytes(budget).padStart(10)}  (${used}%)`)
  if (actual > budget) {
    return `${label} 超预算：${formatBytes(actual)} > ${formatBytes(budget)}`
  }
  return undefined
}

const dirArg = process.argv.find((arg) => arg.startsWith('--dir='))?.slice('--dir='.length)
const target = dirArg ?? 'public/author-data'

await walk(target)

const total = groups.records + groups.precomputed + groups.tiles + groups.other
console.log(`\n=== 作者数据快照体积门禁（${target}） ===`)
console.log(`  活动数                 ${recordsFiles.length}`)

const failures = [
  check('records/ 逐点数据', groups.records, BUDGETS.recordsTotal),
  check('precomputed/ 预计算', groups.precomputed, BUDGETS.precomputed),
  check('快照总计', total, BUDGETS.total),
].filter((item) => item !== undefined)

console.log(`  （tiles/ ${formatBytes(groups.tiles)}，其它 ${formatBytes(groups.other)}，均不设门禁）`)

const largest = [...recordsFiles].sort((a, b) => b.size - a.size).slice(0, 5)
if (largest.length > 0) {
  console.log('\n  最大的 5 个活动逐点文件：')
  for (const item of largest) {
    console.log(`    ${formatBytes(item.size).padStart(10)}  ${item.rel}`)
  }
  const biggest = largest[0]
  const single = check('单活动逐点文件', biggest.size, BUDGETS.recordsSingle)
  if (single !== undefined) {
    failures.push(`${single}（${biggest.rel}）`)
  }
}

if (failures.length > 0) {
  console.error('\n体积门禁未通过：')
  for (const failure of failures) {
    console.error(`  ✗ ${failure}`)
  }
  console.error('\n若增长是预期的，请在 PR 中说明理由并同步调整 scripts/check-snapshot-size.mjs 的阈值。')
  process.exit(1)
}

console.log('\n体积门禁通过。')
