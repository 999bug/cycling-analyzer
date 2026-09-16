/**
 * 数据层基线测量（docs/数据层重构方案.md §6）。
 *
 * 为什么需要它：P1-2（逐点分片）/ P1-3（大扫描按片流式）的收益必须能被证伪。
 * 没有基线数字，「分片省了多少」只能靠感觉，很容易做成心理安慰。
 *
 * 测量口径：**一次查询实际解出多少行 / 多少点**，而不是墙钟耗时。
 * 理由：本脚本跑在 fake-indexeddb（纯内存实现）上，耗时与真实浏览器（磁盘
 * +结构化克隆 + IPC）没有可比性；而「解出行数」是 IndexedDB 语义层面的硬指标
 * ——它同时决定反序列化开销与峰值内存，且跨环境完全一致。
 * 墙钟耗时仅作同进程内相对参考，已明确标注不可外推。
 *
 * 计数手段：Dexie 的 `hook('reading')` 在「从 IndexedDB 读出对象、即将交给调用方」
 * 时触发。对 IndexedDB 游标而言，跳过 offset 的每一行同样会被解出（游标返回完整
 * 记录），因此该计数能直接暴露「假分页」——这正是本项目列表查询的历史问题。
 *
 * 用法：npm run bench:data-layer [-- --scale small|default|large]
 *
 * 数据全部为合成数据（严禁使用 private-fixtures/ 真实骑行数据）。
 */
import 'fake-indexeddb/auto'
import { CyclingDatabase } from '@/storage/db'
import { DexieActivityRepository } from '@/storage/repositories/activityRepository'
import type { Activity, ActivityRecord } from '@/types/activity'

/** 规模档位：写入量与测量规模（default 为方案 §6 的目标量级） */
type ScaleName = 'small' | 'default' | 'large'

interface ScalePreset {
  /** 列表场景活动数 */
  listActivities: number
  /** 列表场景每活动点数（列表查询不读逐点，小即可） */
  listPointsPerActivity: number
  /** 详情页场景单活动点数（对应「单个活动 10 万点」） */
  detailPoints: number
  /** 批量扫描场景活动数 */
  scanActivities: number
  /** 批量扫描每活动点数 */
  scanPointsPerActivity: number
}

const SCALES: Record<ScaleName, ScalePreset> = {
  small: {
    listActivities: 200,
    listPointsPerActivity: 40,
    detailPoints: 20_000,
    scanActivities: 60,
    scanPointsPerActivity: 500,
  },
  default: {
    listActivities: 1000,
    listPointsPerActivity: 120,
    detailPoints: 100_000,
    scanActivities: 500,
    scanPointsPerActivity: 2000,
  },
  large: {
    listActivities: 2000,
    listPointsPerActivity: 200,
    detailPoints: 200_000,
    scanActivities: 1000,
    scanPointsPerActivity: 3000,
  },
}

/** 读取计数（每次测量前 reset） */
interface ReadMeter {
  /** activities 表解出的行数 */
  activityRows: number
  /** activity_blobs 表解出的行数 */
  blobs: number
  /** activity_blobs 解出的逐点总数 */
  points: number
}

const meter: ReadMeter = { activityRows: 0, blobs: 0, points: 0 }

/**
 * 重置读取计数。
 */
function resetMeter(): void {
  meter.activityRows = 0
  meter.blobs = 0
  meter.points = 0
}

/**
 * 合成一段逐点记录（字段与落库字段一致：规格 §18 清单，grade 不落库）。
 *
 * @param count 点数
 * @param startTs 起始时间（Unix 秒）
 */
function makeRecords(count: number, startTs: number): ActivityRecord[] {
  const records: ActivityRecord[] = []
  for (let i = 0; i < count; i += 1) {
    records.push({
      timestamp: startTs + i,
      latitude: 31.2 + i * 1e-5,
      longitude: 121.5 + i * 1e-5,
      altitude: 10 + Math.round(Math.sin(i / 100) * 30),
      distance: Math.round(i * 8.5 * 100) / 100,
      speed: 8.3,
      heartRate: 130 + (i % 20),
      cadence: 85,
      power: 180 + (i % 50),
      temperature: 24,
    })
  }
  return records
}

/**
 * 合成一条活动（含逐点记录）。
 *
 * @param index 序号（决定 id / 时间 / 指纹）
 * @param points 点数
 */
function makeActivity(index: number, points: number): Activity {
  // 每天一条，便于 startTime 索引有稳定顺序；跨度足够时年/月筛选才有意义
  const startMs = Date.UTC(2024, 0, 1) + index * 86_400_000
  const records = makeRecords(points, Math.floor(startMs / 1000))
  return {
    id: `bench-${String(index).padStart(6, '0')}`,
    name: `合成骑行 ${index}`,
    fileId: `file-${index}`,
    fileName: `bench-${index}.fit`,
    fingerprint: `fp-${String(index).padStart(6, '0')}`,
    activityType: 'cycling',
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(startMs + points * 1000).toISOString(),
    duration: points,
    elapsedTime: points,
    distance: points * 8.5,
    elevationGain: 300,
    avgSpeed: 8.3,
    avgHeartRate: 140,
    avgCadence: 85,
    avgPower: 190,
    records,
  }
}

/**
 * 单点 JSON 字节数（用于把点数换算成数据量）。
 *
 * 直接对整段 stringify 在大规模下过慢（10 万点），改为取一段样本估算——
 * 合成数据同构，该近似足够；真实数据的字段缺失率会使其偏小，属已知偏差。
 *
 * @param records 采样逐点记录
 */
function bytesPerPoint(records: readonly ActivityRecord[]): number {
  return JSON.stringify(records).length / records.length
}

/**
 * 格式化字节数为可读文本。
 *
 * @param bytes 字节数
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 度量一次异步读取：重置计数、执行、回读计数。
 *
 * @param label 测量项名称
 * @param run 待测量的读取操作
 */
async function measure(
  label: string,
  run: () => Promise<unknown>,
): Promise<{ label: string; elapsedMs: number; snapshot: ReadMeter }> {
  resetMeter()
  const started = performance.now()
  await run()
  const elapsedMs = performance.now() - started
  return { label, elapsedMs, snapshot: { ...meter } }
}

/**
 * 打印一组测量结果。
 *
 * @param title 分组标题
 * @param rows 测量结果
 * @param bpp 单点字节数（用于换算数据量；0 表示不换算）
 */
function report(
  title: string,
  rows: readonly { label: string; elapsedMs: number; snapshot: ReadMeter }[],
  bpp: number,
): void {
  console.log(`\n=== ${title} ===`)
  for (const row of rows) {
    const bytes = bpp > 0 ? ` / ${formatBytes(row.snapshot.points * bpp)}` : ''
    console.log(
      `  ${row.label.padEnd(38)} activities=${String(row.snapshot.activityRows).padStart(6)}` +
        ` blobs=${String(row.snapshot.blobs).padStart(5)}` +
        ` points=${String(row.snapshot.points).padStart(8)}${bytes}` +
        `   [${row.elapsedMs.toFixed(1)}ms，内存实现仅供参考]`,
    )
  }
}

/**
 * 列表场景：无筛选分页查询解出多少 activities 行。
 *
 * 关注点：首页（offset=0）与尾页（offset≈N）的解出行数是否不同——
 * 若相同，说明 IDB 游标为跳到该位置解出了前面所有行，「索引分页」只在首页有效。
 *
 * @param db 数据库实例
 * @param repo 活动仓库
 * @param preset 规模档位
 */
async function benchList(
  db: CyclingDatabase,
  repo: DexieActivityRepository,
  preset: ScalePreset,
): Promise<void> {
  const count = preset.listActivities
  const activities = Array.from({ length: count }, (_, i) =>
    makeActivity(i, preset.listPointsPerActivity),
  )
  await repo.addActivities(activities)

  const rows = [
    await measure('旧路径：toArray() 全量（对照基准）', () => db.activities.toArray()),
    await measure('listActivities(limit=50) 首页', () => repo.listActivities({ limit: 50 })),
    await measure('listActivities(limit=50, offset=N-50) 尾页', () =>
      repo.listActivities({ limit: 50, offset: count - 50 }),
    ),
    await measure('listActivities(limit=50, offset=N/2) 中页', () =>
      repo.listActivities({ limit: 50, offset: Math.floor(count / 2) }),
    ),
  ]
  report(`场景 A · 列表分页（${count} 活动，每活动 ${preset.listPointsPerActivity} 点）`, rows, 0)

  // 逐点不参与列表查询，故不计字节；此处给出口径说明即可
  console.log('  说明：列表查询只解出 activities 表行，不触碰 activity_blobs')
}

/**
 * 详情页场景：按页读取逐点时解出多少点。
 *
 * 关注点：`getRecords(id, {limit:100})` 当前整行读出后 slice，
 * 因此解出点数恒等于活动总点数——分页不减少任何反序列化开销。
 *
 * @param db 数据库实例
 * @param repo 活动仓库
 * @param preset 规模档位
 */
async function benchDetail(
  repo: DexieActivityRepository,
  preset: ScalePreset,
): Promise<void> {
  const activity = makeActivity(999_999, preset.detailPoints)
  await repo.addActivities([activity])

  const sample = makeRecords(200, 0)
  const bpp = bytesPerPoint(sample)

  const rows = [
    await measure(`getRecords(id, limit=100)（目标：100 点）`, () =>
      repo.getRecords(activity.id, { offset: 0, limit: 100 }),
    ),
    await measure('getRecords(id, offset=中段, limit=100)', () =>
      repo.getRecords(activity.id, {
        offset: Math.floor(preset.detailPoints / 2),
        limit: 100,
      }),
    ),
    await measure('getRecords(id) 全量（详情页首屏现状）', () => repo.getRecords(activity.id)),
  ]
  report(`场景 B · 详情页按页读取（单活动 ${preset.detailPoints} 点）`, rows, bpp)
  console.log(`  口径：单点 JSON ≈ ${bpp.toFixed(1)} B（合成数据同构估算）`)
}

/**
 * 批量扫描场景：热力图/路线图一次拉全部活动的逐点数据。
 *
 * 关注点：`getRecordsByActivityIds` 当前 bulkGet 全部整行 blob，
 * 解出点数 = 活动数 × 每活动点数，峰值内存即全部逐点数据。
 * 分片后理想值：解出点数 ≈ 片大小（按片流式迭代，同一时刻只驻留一片）。
 *
 * @param db 数据库实例
 * @param repo 活动仓库
 * @param preset 规模档位
 */
async function benchScan(
  repo: DexieActivityRepository,
  preset: ScalePreset,
): Promise<void> {
  const count = preset.scanActivities
  const activities = Array.from({ length: count }, (_, i) =>
    makeActivity(i, preset.scanPointsPerActivity),
  )
  await repo.addActivities(activities)

  const ids = activities.map((a) => a.id)
  const sample = makeRecords(200, 0)
  const bpp = bytesPerPoint(sample)

  const rows = [
    await measure(`getRecordsByActivityIds(全部 ${count} 个活动)`, () =>
      repo.getRecordsByActivityIds(ids),
    ),
  ]
  report(
    `场景 C · 批量扫描（${count} 活动 × ${preset.scanPointsPerActivity} 点）`,
    rows,
    bpp,
  )
  console.log('  说明：该场景峰值内存 = 解出点数 × 单点开销；分片目标为「单片驻留」')
}

/** 导出路径的批大小（与 src/features/settings/exportImport.ts 的默认值一致） */
const EXPORT_RECORD_BATCH_SIZE = 10_000

/**
 * 场景 D · 导出分批读取的放大倍数。
 *
 * 关注点：`exportImport.ts` 的 `iterateRecordBatches` 按 offset 递增、每批 1 万点读取，
 * 而 `getRecords` 每次调用都整行读出后 slice——于是 N 次调用解出 N 倍全量数据。
 * 这是「假分页」最恶劣的后果：不是不省，而是**放大**。
 *
 * @param repo 活动仓库
 * @param preset 规模档位
 */
async function benchExport(
  repo: DexieActivityRepository,
  preset: ScalePreset,
): Promise<void> {
  const activity = makeActivity(888_888, preset.detailPoints)
  await repo.addActivities([activity])

  const sample = makeRecords(200, 0)
  const bpp = bytesPerPoint(sample)

  resetMeter()
  const started = performance.now()
  let offset = 0
  let calls = 0
  for (;;) {
    const batch = await repo.getRecords(activity.id, {
      offset,
      limit: EXPORT_RECORD_BATCH_SIZE,
    })
    calls += 1
    if (batch.length < EXPORT_RECORD_BATCH_SIZE) {
      break
    }
    offset += batch.length
  }
  const elapsedMs = performance.now() - started
  const snapshot = { ...meter }

  report(
    `场景 D · 导出分批读取（单活动 ${preset.detailPoints} 点，批大小 ${EXPORT_RECORD_BATCH_SIZE}）`,
    [{ label: `iterateRecordBatches（${calls} 次调用）`, elapsedMs, snapshot }],
    bpp,
  )
  const amplification = snapshot.points / preset.detailPoints
  console.log(
    `  放大倍数 = 解出点数 / 全量点数 = ${snapshot.points} / ${preset.detailPoints}` +
      ` = ${amplification.toFixed(2)}x（分片后目标 ≈ 1.0x）`,
  )
}

/**
 * 入口。
 */
async function main(): Promise<void> {
  const scaleArg = process.argv.find((arg) => arg.startsWith('--scale='))?.slice('--scale='.length)
  const scaleName: ScaleName =
    scaleArg === 'small' || scaleArg === 'default' || scaleArg === 'large' ? scaleArg : 'default'
  const preset = SCALES[scaleName]

  console.log(`数据层基线测量（scale=${scaleName}）`)
  console.log('计数口径 = IndexedDB 实际解出的行数/点数；耗时不可外推至真实浏览器')

  const db = new CyclingDatabase()
  await db.open()

  // 读计数：Dexie 在「已解出对象、即将交给调用方」时回调，返回原对象不改行为
  db.activities.hook('reading', (obj) => {
    meter.activityRows += 1
    return obj
  })
  db.activity_blobs.hook('reading', (obj) => {
    meter.blobs += 1
    meter.points += obj.records?.length ?? 0
    return obj
  })

  // 清空遗留数据（同一 DB 名重复运行时保证起点一致）
  await Promise.all([db.activities.clear(), db.activity_blobs.clear()])

  const repo = new DexieActivityRepository(db)

  await benchList(db, repo, preset)

  await Promise.all([db.activities.clear(), db.activity_blobs.clear()])
  await benchDetail(repo, preset)

  await Promise.all([db.activities.clear(), db.activity_blobs.clear()])
  await benchScan(repo, preset)

  await Promise.all([db.activities.clear(), db.activity_blobs.clear()])
  await benchExport(repo, preset)

  console.log('\n完成。数字解读见 docs/数据层重构方案.md §6。')
  db.close()
}

await main()
