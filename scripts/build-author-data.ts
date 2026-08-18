/**
 * 作者数据快照构建入口（npm run build:author-data）。
 *
 * 读取 author-data/（作者提交的真实数据）生成 public/author-data/ 快照产物，
 * 由 vite build 拷入 dist 随站点发布；本地 dev 前手动运行即可预览作者模式。
 * 任一 FIT 解析失败即 exit 1（fail-fast，部署中止而非线上悄悄少数据）。
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

try {
  const startedAt = performance.now()
  const stats = await buildAuthorData({
    fitDir: FIT_DIR,
    outDir: OUT_DIR,
    author: AUTHOR_NAME,
    csvPath: CSV_PATH,
    profilePath: PROFILE_PATH,
    segmentsPath: SEGMENTS_PATH,
  })
  const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1)
  console.log(
    `Author snapshot built: ${stats.parsed} activities from ${stats.files} files ` +
      `(${stats.duplicates} duplicates skipped) in ${elapsed}s -> ${OUT_DIR}`,
  )
} catch (error) {
  console.error('Failed to build author snapshot:', error)
  process.exit(1)
}
