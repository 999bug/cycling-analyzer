/**
 * 作者数据快照构建脚本测试。
 *
 * 输入为 tests/fixtures 合成 FIT（可复制、可 gzip），输出到临时目录，
 * 校验快照文件布局、确定性 ID（= 内容指纹）、去重、CSV 标题还原与 fail-fast。
 */
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { gzipSync } from 'fflate'
import { buildAuthorData } from '../../scripts/buildAuthorData'
import type { AuthorSnapshotManifest, TracksFile } from '@/storage/authorData/snapshotTypes'
import { readFixtureBytes } from '../helpers/fixtures'

/** 测试用作者名 */
const AUTHOR = 'Saul'

/** fixtures 目录绝对路径（copyFile 需要真实路径） */
const FIXTURES_DIR_ABS = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

/** 临时目录路径集合（fit 输入目录 + 输出目录） */
interface TempLayout {
  root: string
  fitDir: string
  outDir: string
}

/**
 * 创建临时目录布局并把指定 fixture 拷入 fit 目录。
 *
 * @param files 目标文件名 → fixture 源文件名（或 'gzip:xxx' 表示 gzip 压缩后放入）
 */
async function setupTemp(files: Record<string, string>): Promise<TempLayout> {
  const root = await mkdtemp(join(tmpdir(), 'author-data-test-'))
  const fitDir = join(root, 'fit')
  const outDir = join(root, 'out')
  await mkdir(fitDir, { recursive: true })
  for (const [target, source] of Object.entries(files)) {
    if (source.startsWith('gzip:')) {
      const raw = new Uint8Array(readFixtureBytes(source.slice(5)))
      await writeFile(join(fitDir, target), gzipSync(raw))
    } else {
      await copyFile(join(FIXTURES_DIR_ABS, source), join(fitDir, target))
    }
  }
  return { root, fitDir, outDir }
}

/**
 * 读取产物 JSON 文件。
 */
async function readOutJson<T>(outDir: string, name: string): Promise<T> {
  const text = await readFile(join(outDir, name), 'utf8')
  return JSON.parse(text) as T
}

describe('buildAuthorData', () => {
  let layout: TempLayout | undefined

  afterEach(async () => {
    if (layout !== undefined) {
      await rm(layout.root, { recursive: true, force: true })
      layout = undefined
    }
  })

  it('生成 manifest/activities/records 快照，ID 为确定性内容指纹', async () => {
    layout = await setupTemp({ 'ride.fit': 'cycling-gps.fit' })
    const stats = await buildAuthorData({ fitDir: layout.fitDir, outDir: layout.outDir, author: AUTHOR })

    expect(stats).toEqual({ files: 1, parsed: 1, duplicates: 0 })

    const manifest = await readOutJson<AuthorSnapshotManifest>(layout.outDir, 'manifest.json')
    expect(manifest.snapshotVersion).toBe(1)
    expect(manifest.author).toBe(AUTHOR)
    expect(manifest.activityCount).toBe(1)
    expect(typeof manifest.generatedAt).toBe('string')

    const activities = await readOutJson<Array<{ id: string; records?: unknown }>>(
      layout.outDir,
      'activities.json',
    )
    expect(activities).toHaveLength(1)
    // 确定性 ID = SHA-256 内容指纹（64 位小写 hex），重建不变、深链跨部署存活
    expect(activities[0].id).toMatch(/^[0-9a-f]{64}$/)
    // 摘要不携带逐点数据
    expect(activities[0].records).toBeUndefined()

    const recordsFile = await readOutJson<{ activityId: string; records: unknown[] }>(
      layout.outDir,
      `records/${activities[0].id}.json`,
    )
    expect(recordsFile.activityId).toBe(activities[0].id)
    expect(recordsFile.records.length).toBeGreaterThan(0)
  })

  it('gzip 文件自动解压且与原始内容指纹一致（重复去重）', async () => {
    layout = await setupTemp({
      'a.fit.gz': 'gzip:cycling-gps.fit',
      'b.fit': 'cycling-gps.fit',
    })
    const stats = await buildAuthorData({ fitDir: layout.fitDir, outDir: layout.outDir, author: AUTHOR })
    expect(stats).toEqual({ files: 2, parsed: 1, duplicates: 1 })

    const manifest = await readOutJson<AuthorSnapshotManifest>(layout.outDir, 'manifest.json')
    expect(manifest.activityCount).toBe(1)
  })

  it('多条活动摘要按开始时间降序', async () => {
    layout = await setupTemp({
      'gps.fit': 'cycling-gps.fit',
      'power.fit': 'power-only.fit',
    })
    await buildAuthorData({ fitDir: layout.fitDir, outDir: layout.outDir, author: AUTHOR })
    const activities = await readOutJson<Array<{ startTime: string }>>(layout.outDir, 'activities.json')
    expect(activities).toHaveLength(2)
    expect(activities[0].startTime >= activities[1].startTime).toBe(true)
  })

  it('activities.csv 存在时还原活动标题', async () => {
    layout = await setupTemp({ '14871421155.fit.gz': 'gzip:cycling-gps.fit' })
    const csv = [
      '活动 ID,活动名称,活动类型,文件名',
      '1,晨骑青山湖,骑行,activities/14871421155.fit.gz',
    ].join('\n')
    const csvPath = join(layout.root, 'activities.csv')
    await writeFile(csvPath, csv, 'utf8')

    await buildAuthorData({
      fitDir: layout.fitDir,
      outDir: layout.outDir,
      author: AUTHOR,
      csvPath,
    })
    const activities = await readOutJson<Array<{ name?: string }>>(layout.outDir, 'activities.json')
    expect(activities[0].name).toBe('晨骑青山湖')
  })

  it('profile.json 与 segments.json 透传，赛段 id 重排并产出成绩榜', async () => {
    layout = await setupTemp({ 'ride.fit': 'cycling-gps.fit' })
    const profilePath = join(layout.root, 'profile.json')
    await writeFile(profilePath, JSON.stringify({ ftp: 250, maxHeartRate: 190 }), 'utf8')
    const segmentsPath = join(layout.root, 'segments.json')
    await writeFile(
      segmentsPath,
      JSON.stringify([
        {
          name: '桥北爬坡',
          startLatitude: 30.0,
          startLongitude: 120.0,
          endLatitude: 30.01,
          endLongitude: 120.01,
          sourceActivityId: 'any',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
      'utf8',
    )

    await buildAuthorData({
      fitDir: layout.fitDir,
      outDir: layout.outDir,
      author: AUTHOR,
      profilePath,
      segmentsPath,
    })

    const profile = await readOutJson<{ ftp: number }>(layout.outDir, 'profile.json')
    expect(profile.ftp).toBe(250)

    const segments = await readOutJson<Array<{ id: number; name: string }>>(
      layout.outDir,
      'segments.json',
    )
    expect(segments).toHaveLength(1)
    expect(segments[0].id).toBe(1)

    const results = await readOutJson<Record<string, unknown[]>>(layout.outDir, 'precomputed/segment-results.json')
    expect(Object.keys(results)).toEqual(['1'])
    expect(Array.isArray(results['1'])).toBe(true)
  })

  it('预计算产物：tracks 含全部含坐标轨迹，power-records 与 route-groups 恒产出', async () => {
    layout = await setupTemp({
      'gps.fit': 'cycling-gps.fit',
      'power.fit': 'power-only.fit',
    })
    await buildAuthorData({ fitDir: layout.fitDir, outDir: layout.outDir, author: AUTHOR })

    const tracks = await readOutJson<TracksFile>(layout.outDir, 'precomputed/tracks.json')
    expect(tracks.toleranceMeters).toBe(10)
    expect(tracks.tracks).toHaveLength(2)
    for (const track of tracks.tracks) {
      expect(track.length).toBeGreaterThanOrEqual(2)
    }

    const powerRecords = await readOutJson<unknown[]>(layout.outDir, 'precomputed/power-records.json')
    expect(Array.isArray(powerRecords)).toBe(true)
    const routeGroups = await readOutJson<unknown[]>(layout.outDir, 'precomputed/route-groups.json')
    expect(Array.isArray(routeGroups)).toBe(true)
  })

  it('任一文件解析失败即抛错（fail-fast，不静默少数据）', async () => {
    layout = await setupTemp({ 'bad.fit': 'cycling-gps.fit' })
    // 破坏内容：截断文件使其无法通过 FIT 校验
    const broken = readFixtureBytes('cycling-gps.fit').slice(0, 20)
    await writeFile(join(layout.fitDir, 'bad.fit'), new Uint8Array(broken))

    await expect(
      buildAuthorData({ fitDir: layout.fitDir, outDir: layout.outDir, author: AUTHOR }),
    ).rejects.toThrow(/bad\.fit/)
  })
})
