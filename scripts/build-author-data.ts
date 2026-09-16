/**
 * 作者数据快照构建入口（npm run build:author-data）。
 *
 * 读取 author-data/（作者提交的真实数据）生成 public/author-data/ 快照产物，
 * 由 vite build 拷入 dist 随站点发布；本地 dev 前手动运行即可预览作者模式。
 *
 * 失败策略（P2 起）：单个 FIT 解析失败**跳过并告警**，构建继续——坏文件不应让整站
 * 发不出去（代价是站点一直停在上一版，作者的新内容全部上不去）。跳过会以
 * `::warning` 注解出现在 CI 运行页顶部，不允许静默。
 * 环境问题（一个都没解析成功）仍然 exit 1。本地排查坏文件时传 `--fail-fast`。
 */
import { buildAuthorData } from './buildAuthorData.ts'

/** 作者显示名（写入 manifest，切换器/横幅展示） */
const AUTHOR_NAME = 'Saul'

/** FIT 源文件目录（唯一事实来源） */
const FIT_DIR = 'author-data/fit'

/** 可选：Strava 导出 CSV（标题还原） */
const CSV_PATH = 'author-data/activities.csv'

/** 可选：作者训练配置（ftp/maxHeartRate/weightKg 等，透传） */
const PROFILE_PATH = 'author-data/profile.json'

/** 可选：作者赛段定义（透传 + 预计算成绩榜） */
const SEGMENTS_PATH = 'author-data/segments.json'

/** 快照输出目录（gitignored，vite build 自动拷入 dist） */
const OUT_DIR = 'public/author-data'

/** 是否严格模式（任一文件失败即中止，用于本地排查坏文件） */
const FAIL_FAST = process.argv.includes('--fail-fast')

try {
  const startedAt = performance.now()
  const stats = await buildAuthorData({
    fitDir: FIT_DIR,
    outDir: OUT_DIR,
    author: AUTHOR_NAME,
    csvPath: CSV_PATH,
    profilePath: PROFILE_PATH,
    segmentsPath: SEGMENTS_PATH,
    onParseError: FAIL_FAST ? 'fail' : 'skip',
  })
  const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1)
  console.log(
    `Author snapshot built: ${stats.parsed} activities from ${stats.files} files ` +
      `(${stats.duplicates} duplicates, ${stats.skipped.length} skipped) in ${elapsed}s -> ${OUT_DIR}`,
  )
  if (stats.skipped.length > 0) {
    // 汇总再列一遍：单条告警容易被长日志淹没，这里给出可清点的清单
    console.warn(`\n[author-data] 有 ${stats.skipped.length} 个文件被跳过，快照不含这些活动：`)
    for (const item of stats.skipped) {
      console.warn(`  - ${item.file}: ${item.reason}`)
    }
  }
  if (stats.parsed === 0) {
    console.warn('[author-data] 警告：本次快照没有任何活动，站点作者模式将为空')
  }
} catch (error) {
  console.error('Failed to build author snapshot:', error)
  process.exit(1)
}
