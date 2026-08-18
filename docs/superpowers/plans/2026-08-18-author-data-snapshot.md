# 作者数据快照 + 双数据源 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 作者 Saul 的骑行数据经 CI 解析为静态快照随站点发布，访客默认只读浏览作者数据，也可导入自己的数据存本地。

**Architecture:** `author-data/fit/` 中的 FIT 文件由 Node 脚本（tsx）复用 src 解析纯函数生成 `public/author-data/` 快照；前端新增 `dataSourceStore`（author/local）与 `sourceActivityRepository` 门面，按调用时当前源分发到 `AuthorActivityRepository`（fetch 快照）或现有 Dexie 仓库。

**Tech Stack:** React 19 · TypeScript · Vite · zustand(persist) · Dexie · tsx(Node 脚本) · Vitest

**Spec:** `docs/superpowers/specs/2026-08-18-author-data-snapshot-design.md`

## Global Constraints

- 注释中文；日志/异常消息英文；React 组件 `function` 声明；`@/` 别名导入
- 提交前缀 `[NF]`/`[IM]` + 中文 Subject；**无 AI 署名**；提交身份项目级已固定，勿改
- 缺失字段 = undefined ≠ 0，UI 显示 `—`（不伪造数据）
- 写入操作（导入/删除/改名/设赛段/设置）永远只进本地 Dexie；作者源只读
- 每个 Task 结束跑 `npm run test` 与 `npm run lint`，全绿才提交
- `private-fixtures/` 严禁提交；`author-data/` 是要公开提交的源数据
- 快照拉取路径必须拼 `import.meta.env.BASE_URL`（适配子路径部署）

---

### Task 1: Strava 标题查找逻辑提取（重构）

**Files:**
- Modify: `src/features/import/stravaExport.ts`（新增两个导出函数）
- Modify: `src/features/import/importer.ts`（删除模块私有函数，改 import）

**Interfaces:**
- Produces: `buildStravaTitleLookup(stravaCsv: Map<string, StravaActivityMeta> | undefined): Map<string, string>`
- Produces: `matchStravaTitle(path: string, name: string, titles: Map<string, string>): string | undefined`
- Consumed by: Task 2 快照脚本（标题还原）

- [ ] **Step 1: 在 stravaExport.ts 末尾新增两个导出函数**（代码从 importer.ts 原样平移，仅改名加导出）

```ts
/**
 * 从 Strava 元数据构建"文件名 → 标题"查找表。
 * 同时索引完整相对路径与纯文件名，覆盖选择导出根目录 / 子目录两种场景；
 * 标题为空的记录不参与还原。
 */
export function buildStravaTitleLookup(
  stravaCsv: Map<string, StravaActivityMeta> | undefined,
): Map<string, string> {
  const titles = new Map<string, string>()
  for (const meta of stravaCsv?.values() ?? []) {
    if (!meta.name) {
      continue
    }
    titles.set(meta.fileName, meta.name)
    const slash = meta.fileName.lastIndexOf('/')
    if (slash >= 0) {
      titles.set(meta.fileName.slice(slash + 1), meta.name)
    }
  }
  return titles
}

/**
 * 按文件匹配 Strava 标题：相对路径精确匹配优先，纯文件名回退。
 */
export function matchStravaTitle(
  path: string,
  name: string,
  titles: Map<string, string>,
): string | undefined {
  return titles.get(path) ?? titles.get(name)
}
```

- [ ] **Step 2: importer.ts 删除私有 buildTitleLookup/matchTitle，改为 import**

```ts
import { buildStravaTitleLookup, matchStravaTitle, type StravaActivityMeta } from './stravaExport'
// importFiles 内：
const titles = buildStravaTitleLookup(options.stravaCsv)
// 原 matchTitle(entry.path, entry.name, titles) → matchStravaTitle(entry.path, entry.name, titles)
```

- [ ] **Step 3: 验证重构无行为变化**

Run: `npx vitest run tests/features/import && npm run lint`
Expected: 全绿（现有导入测试覆盖标题还原）

- [ ] **Step 4: Commit**

```bash
git add src/features/import/stravaExport.ts src/features/import/importer.ts
git commit -m "[IM]: Strava 标题查找逻辑提取至 stravaExport 供快照脚本复用"
```

---

### Task 2: 快照类型 + 生成脚本

**Files:**
- Create: `src/storage/authorData/snapshotTypes.ts`
- Create: `scripts/author-data/buildAuthorData.ts`（核心逻辑，可测试）
- Create: `scripts/build-author-data.ts`（CLI 入口）
- Test: `tests/authorData/buildAuthorData.test.ts`
- Modify: `package.json`（script + tsx devDep）、`tsconfig.node.json`（include scripts + paths）

**Interfaces:**
- Consumes: `parseFitBytes`（@/fit/worker/parseTask）、`computeFingerprint`、`shouldGunzip/gunzipBytes`、`calculateNormalizedPower`、`buildStravaTitleLookup/matchStravaTitle`、`parseStravaActivitiesCsv`、`simplifyRoute`、`buildSegmentLeaderboard`、`buildRouteGroups/extractEndpoints`、`buildPowerCurve/buildPowerRecords/POWER_RECORD_DURATIONS`
- Produces: `buildAuthorData(options: BuildAuthorDataOptions): Promise<BuildAuthorDataStats>`
- Produces: 快照文件布局（public/author-data/ 下 manifest.json、activities.json、records/<id>.json、profile.json?、segments.json?、precomputed/*）

- [ ] **Step 1: 写快照类型 `src/storage/authorData/snapshotTypes.ts`**

```ts
/**
 * 作者数据快照类型（构建脚本与前端快照客户端共用的跨层契约）。
 * 全部字段 JSON 可序列化；单位与领域模型一致（米/m/s/bpm/W/Unix 秒）。
 */
import type { ActivitySummary } from '@/storage/repositories/activityRepository'
import type { ActivityRecord } from '@/types/activity'
import type { UserProfile } from '@/features/settings/settings'
import type { SegmentEntity } from '@/storage/db'
import type { SegmentEffort } from '@/features/segments/segmentMatching'
import type { RouteGroup } from '@/features/routes/routeGrouping'
import type { PowerRecordEntry } from '@/features/records/personalRecords'

/** 快照格式版本（前端校验，不兼容即回退本地数据源） */
export const SNAPSHOT_VERSION = 1

/** manifest.json：快照元信息 */
export interface AuthorSnapshotManifest {
  snapshotVersion: number
  /** 作者显示名（切换器/横幅文案） */
  author: string
  /** 构建时间（ISO 8601） */
  generatedAt: string
  activityCount: number
}

/** records/<id>.json：单条活动逐点记录 */
export interface ActivityRecordsFile {
  activityId: string
  records: ActivityRecord[]
}

/** precomputed/tracks.json：全部轨迹抽稀点（热力图/网格覆盖用） */
export interface TracksFile {
  toleranceMeters: number
  /** 每条轨迹为 [纬度, 经度] 元组数组（5 位小数） */
  tracks: [number, number][][]
}

/** precomputed/segment-results.json：赛段 ID（字符串化）→ 成绩榜 */
export type SegmentResultsFile = Record<string, SegmentEffort[]>

export type {
  ActivitySummary,
  UserProfile,
  SegmentEntity,
  SegmentEffort,
  RouteGroup,
  PowerRecordEntry,
}
```

- [ ] **Step 2: 写失败测试 `tests/authorData/buildAuthorData.test.ts`**

用 `tests/fixtures/cycling-gps.fit`（合成带 GPS）复制进临时 fit 目录，断言产物结构与去重：

```ts
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAuthorData } from '@/scripts-author-data/buildAuthorData'
```

（vitest 根目录可用 `@/` 指 src；scripts 用相对路径 `../../scripts/author-data/buildAuthorData` 导入。）

断言点：
1. activities.json 为数组、长度 = fit 文件数、按 startTime 降序、id === 64 位 hex
2. records/<id>.json 存在且 records 非空、activityId 一致
3. manifest.json：snapshotVersion=1、author 透传、activityCount 正确
4. 同一内容复制两份文件名不同 → 去重后只有 1 条活动（stats.duplicates === 1）
5. 提供 activities.csv（两行：表头 + `activities/cycling-gps.fit.gz` 标题行）→ 摘要 name 被还原
6. 无坐标 fixture（如 power-only.fit）不产生 tracks 条目
7. profile.json 源文件存在时透传到产物；不存在时产物无该文件

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/authorData/buildAuthorData.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现 `scripts/author-data/buildAuthorData.ts`**

核心结构（完整实现，关键片段如下）：

```ts
/**
 * 作者数据快照构建核心（CI 与本地共用，规格见 docs/superpowers/specs/…design.md）。
 * 流程：扫描 fit 目录 → 解压/指纹/去重 → 解析标准化 → 摘要与逐点拆分写出 → 预计算。
 * 单一文件解析失败即抛错（fail-fast），由 CLI 入口转 exit 1。
 */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, basename, relative } from 'node:path'
import { parseFitBytes } from '@/fit/worker/parseTask'
import { computeFingerprint } from '@/utils/fingerprint'
import { gunzipBytes, shouldGunzip } from '@/features/import/gzip'
import { calculateNormalizedPower } from '@/features/analysis/normalizedPower'
import { parseStravaActivitiesCsv, buildStravaTitleLookup, matchStravaTitle } from '@/features/import/stravaExport'
import { simplifyRoute } from '@/map/simplify'
import { buildSegmentLeaderboard, type SegmentActivityInput } from '@/features/segments/segmentMatching'
import { buildRouteGroups, extractEndpoints, type RouteActivityInput } from '@/features/routes/routeGrouping'
import { buildPowerCurve } from '@/features/analysis/powerCurve'
import { buildPowerRecords, POWER_RECORD_DURATIONS, type ActivityPowerCurve } from '@/features/records/personalRecords'
import type { Activity } from '@/types/activity'
// …类型见 snapshotTypes

export interface BuildAuthorDataOptions {
  fitDir: string
  csvPath?: string
  profilePath?: string
  segmentsPath?: string
  outDir: string
  author: string
}

export interface BuildAuthorDataStats {
  parsed: number
  duplicates: number
  files: number
}
```

要点：
- `id = fingerprint`（确定性，不用 randomUUID）；`fileId` 同 fingerprint
- `parseFitBytes` 返回的 Activity 用解构覆盖 id/fileId/name：`{ ...activity, id: fingerprint, fileId: fingerprint, name }`；NP 计算落 `normalizedPower`
- 摘要剥离 records/route（复用与 toActivityEntity 同字段的局部映射函数 `toSummary`，放脚本内）
- records 写出前剥离 `grade`（与 Dexie 落库字段清单一致）
- 递归扫描用 `readdir(dir, { recursive: true, withFileTypes: true })`（Node 22 支持）
- 去重：fingerprint 已见 → duplicates++ 并 console.warn 跳过
- tracks：`simplifyRoute(records, 10)` → 坐标 `Number(v.toFixed(5))`
- segments.json 存在：读入数组，id 按下标 1 起始重排；逐赛段 buildSegmentLeaderboard 结果按 String(id) 键写出；segments 源文件缺失则两个文件都不产出
- route-groups/power-records 恒产出（可为空数组）
- 复制 profile.json / 写出 manifest.json 与 activities.json（`JSON.stringify(data)`，不加空格缩进控体积）
- 返回 `{ parsed, duplicates, files }`

- [ ] **Step 5: 实现 CLI `scripts/build-author-data.ts`**

```ts
/** 作者数据快照构建入口：npm run build:author-data */
import { buildAuthorData } from './author-data/buildAuthorData'

const AUTHOR = 'Saul'
const fitDir = 'author-data/fit'
// …路径常量（author-data/… → public/author-data）

try {
  const stats = await buildAuthorData({ … })
  console.log(`Author snapshot built: ${stats.parsed} activities, ${stats.duplicates} duplicates skipped`)
} catch (error) {
  console.error('Failed to build author snapshot:', error)
  process.exit(1)
}
```

注意 tsconfig.node.json `module: nodenext` + `verbatimModuleSyntax`：相对导入需带 `.ts` 扩展名，类型导入用 `import type`。顶层 await 在 nodenext ESM 下可用（package.json `"type": "module"`）。

- [ ] **Step 6: 配置改动**

`package.json`：
```json
"build:author-data": "tsx --tsconfig tsconfig.node.json scripts/build-author-data.ts"
```
devDependencies 加 `"tsx": "^4.x"`（npm i -D tsx）。

`tsconfig.node.json`：`include: ["vite.config.ts", "scripts"]`，compilerOptions 加 `"paths": { "@/*": ["./src/*"] }`。

- [ ] **Step 7: 跑测试确认通过 + 全量回归**

Run: `npx vitest run tests/authorData && npm run test && npm run lint && npm run build`
Expected: 全绿。若 `tsc -b` 在 scripts 上报 src 类型问题（DOM lib 差异），回退方案：tsconfig.node.json 保持不含 scripts，脚本类型安全由测试保证，lint 覆盖。

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "[NF]: 作者数据快照生成脚本（build:author-data）"
```

---

### Task 3: ActivityReadRepository 接口抽取 + 列表查询纯函数

**Files:**
- Modify: `src/storage/repositories/activityRepository.ts`

**Interfaces:**
- Produces: `ActivityReadRepository`（读取方法子集接口）、`queryActivityList(items: ActivitySummary[], options?: ActivityListOptions): ActivityListResult`
- `ActivityRepository extends ActivityReadRepository`（写方法留在子接口）
- Consumed by: Task 4（AuthorActivityRepository 复用 queryActivityList 保证筛选/排序/分页行为一致）

- [ ] **Step 1: 抽取接口与纯函数**

DexieActivityRepository.listActivities 的内存过滤/排序/分页整体移出为导出纯函数：

```ts
/**
 * 活动列表内存查询（筛选/排序/分页）。Dexie 与作者快照两个实现共用，
 * 保证任一数据源行为一致。数值条件含边界、组合语义 AND；
 * avgPower 缺失的活动不满足功率条件。
 */
export function queryActivityList(
  items: readonly ActivitySummary[],
  options: ActivityListOptions = {},
): ActivityListResult {
  // …原 listActivities 函数体（let items = [...items] 拷贝开头），slice 前 total
}
```

接口：

```ts
/** 活动仓库读取接口（作者快照只读实现与 Dexie 实现共用） */
export interface ActivityReadRepository {
  getById(id: string): Promise<ActivitySummary | undefined>
  getRecords(activityId: string, options?: RecordQueryOptions): Promise<ActivityRecord[]>
  listActivities(options?: ActivityListOptions): Promise<ActivityListResult>
  countActivities(): Promise<number>
  existsByFingerprint(fingerprint: string): Promise<boolean>
  summarizeByRange(startTime: string, endTime: string): Promise<ActivityRangeSummary>
  listAllSummaries(): Promise<ActivitySummary[]>
}

export interface ActivityRepository extends ActivityReadRepository {
  // addActivity/addActivities/updateName/updateNormalizedPower/deleteActivity/deleteAll
}
```

DexieActivityRepository.listActivities 改为 `return queryActivityList(await this.db.activities.toArray(), options)`。

- [ ] **Step 2: 回归**

Run: `npx vitest run tests/storage && npm run lint`
Expected: 全绿（现有 storage 测试覆盖 listActivities 全部条件分支）

- [ ] **Step 3: Commit**

```bash
git commit -am "[IM]: 抽取 ActivityReadRepository 读取接口与列表查询纯函数"
```

---

### Task 4: snapshotClient + AuthorActivityRepository

**Files:**
- Create: `src/storage/authorData/snapshotClient.ts`
- Create: `src/storage/authorData/authorActivityRepository.ts`
- Test: `tests/authorData/snapshotClient.test.ts`、`tests/authorData/authorActivityRepository.test.ts`

**Interfaces:**
- Consumes: snapshotTypes（Task 2）、ActivityReadRepository/queryActivityList（Task 3）
- Produces: `createSnapshotClient(): SnapshotClient`（工厂，测试注入）与默认单例 `defaultSnapshotClient`；`AuthorActivityRepository implements ActivityReadRepository`，构造参数为 SnapshotClient

```ts
/** 作者快照客户端：全部 getXxx 懒加载 + 会话内缓存（快照不可变，无需失效） */
export interface SnapshotClient {
  getManifest(): Promise<AuthorSnapshotManifest>
  getActivities(): Promise<ActivitySummary[]>
  getRecords(activityId: string): Promise<ActivityRecord[]>
  getProfile(): Promise<UserProfile>
  getSegments(): Promise<SegmentEntity[]>
  getTracks(): Promise<TracksFile>
  getSegmentResults(): Promise<SegmentResultsFile>
  getRouteGroups(): Promise<RouteGroup[]>
  getPowerRecords(): Promise<PowerRecordEntry[]>
}
```

- [ ] **Step 1: 写 snapshotClient 失败测试**

`vi.stubGlobal('fetch', vi.fn())` mock 响应；断言：
1. 路径拼接 `${BASE_URL}author-data/manifest.json`（vitest 下 BASE_URL='/'）
2. 同一路径第二次调用不重复 fetch（缓存）
3. res.ok === false → reject，错误消息含路径与状态码
4. getRecords 按 activityId 拼路径

- [ ] **Step 2: 实现 snapshotClient.ts**

```ts
export function createSnapshotClient(): SnapshotClient {
  const cache = new Map<string, Promise<unknown>>()
  async function fetchJson<T>(path: string): Promise<T> {
    let pending = cache.get(path)
    if (pending === undefined) {
      pending = fetch(`${import.meta.env.BASE_URL}author-data/${path}`).then((res) => {
        if (!res.ok) {
          throw new Error(`Author snapshot fetch failed: ${path} (HTTP ${res.status})`)
        }
        return res.json() as Promise<unknown>
      })
      cache.set(path, pending)
    }
    return pending as Promise<T>
  }
  return {
    getManifest: () => fetchJson('manifest.json'),
    getActivities: () => fetchJson('activities.json'),
    getRecords: (id) => fetchJson<ActivityRecordsFile>(`records/${id}.json`).then((f) => f.records),
    getProfile: () => fetchJson('profile.json'),
    getSegments: () => fetchJson('segments.json'),
    getTracks: () => fetchJson('precomputed/tracks.json'),
    getSegmentResults: () => fetchJson('precomputed/segment-results.json'),
    getRouteGroups: () => fetchJson('precomputed/route-groups.json'),
    getPowerRecords: () => fetchJson('precomputed/power-records.json'),
  }
}
export const defaultSnapshotClient = createSnapshotClient()
```

- [ ] **Step 3: 写 AuthorActivityRepository 对齐测试**

同一组行为用例跑两个实现（Dexie 版用 fake-indexeddb 注入独立 CyclingDatabase，作者版用假 SnapshotClient 返回内存数据）：列表默认排序/月份筛选/类型筛选/搜索/数值边界/分页 total、getById 命中与 miss、getRecords、count、summarizeByRange 含边界、listAllSummaries 降序、existsByFingerprint 恒 false。

- [ ] **Step 4: 实现 authorActivityRepository.ts**

```ts
export class AuthorActivityRepository implements ActivityReadRepository {
  constructor(private readonly client: SnapshotClient) {}
  async getById(id) { return (await this.client.getActivities()).find((a) => a.id === id) }
  getRecords(id, options = {}) {
    return this.client.getRecords(id).then((records) => {
      const { offset = 0, limit = 0 } = options
      return limit > 0 ? records.slice(offset, offset + limit) : records.slice(offset)
    })
  }
  async listActivities(options) { return queryActivityList(await this.client.getActivities(), options) }
  async countActivities() { return (await this.client.getActivities()).length }
  async existsByFingerprint() { return false }
  async summarizeByRange(startTime, endTime) { /* 过滤 + 聚合，逻辑对齐 Dexie 版（含边界） */ }
  async listAllSummaries() { /* [...all].sort 按 startTime 降序 */ }
}
```

- [ ] **Step 5: 跑测试 + 回归 + Commit**

Run: `npx vitest run tests/authorData && npm run test && npm run lint`
Commit: `[NF]: 作者快照客户端与只读活动仓库`

---

### Task 5: dataSourceStore + initDataSource

**Files:**
- Create: `src/stores/dataSourceStore.ts`
- Modify: `src/main.tsx`（启动调用 initDataSource）
- Test: `tests/stores/dataSourceStore.test.ts`

**Interfaces:**
- Produces:
  - `type DataSource = 'author' | 'local'`
  - `useDataSourceStore`（zustand persist，key `cycling-data-source`，partialize 仅持久化 source）
  - `selectEffectiveSource(state): DataSource`
  - `initDataSource(client?: SnapshotClient): Promise<void>`

- [ ] **Step 1: 写失败测试**

1. 默认 source='author'、authorAvailable=false → effectiveSource='local'
2. setAuthorAvailable(true, 'Saul') 后 effectiveSource='author'
3. setSource('local') 后持久化到 localStorage（key cycling-data-source），重创建 store 读回（persist 单例限制：直接断言 localStorage 内容）
4. initDataSource：manifest 版本不符/拉取失败 → authorAvailable=false + console.warn；成功 → true + authorName
5. authorAvailable 不持久化（partialize）

- [ ] **Step 2: 实现**

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SNAPSHOT_VERSION } from '@/storage/authorData/snapshotTypes'
import { defaultSnapshotClient, type SnapshotClient } from '@/storage/authorData/snapshotClient'

export type DataSource = 'author' | 'local'

interface DataSourceState {
  /** 用户显式选择的数据源（默认作者） */
  source: DataSource
  /** manifest 探测结果（默认 false：探测成功前有效源为 local，测试零影响） */
  authorAvailable: boolean
  /** 作者显示名（来自 manifest，探测失败为 null） */
  authorName: string | null
  setSource(source: DataSource): void
  setAuthorAvailable(available: boolean, authorName?: string): void
}

export const useDataSourceStore = create<DataSourceState>()(
  persist(
    (set) => ({
      source: 'author',
      authorAvailable: false,
      authorName: null,
      setSource: (source) => set({ source }),
      setAuthorAvailable: (available, authorName) =>
        set({ authorAvailable: available, authorName: authorName ?? null }),
    }),
    { name: 'cycling-data-source', partialize: (s) => ({ source: s.source }) },
  ),
)

export function selectEffectiveSource(state: { source: DataSource; authorAvailable: boolean }): DataSource {
  return state.source === 'author' && state.authorAvailable ? 'author' : 'local'
}

export async function initDataSource(client: SnapshotClient = defaultSnapshotClient): Promise<void> {
  try {
    const manifest = await client.getManifest()
    if (manifest.snapshotVersion !== SNAPSHOT_VERSION) {
      throw new Error(`Unsupported snapshot version: ${manifest.snapshotVersion}`)
    }
    useDataSourceStore.getState().setAuthorAvailable(true, manifest.author)
  } catch (error) {
    console.warn('Author snapshot unavailable, falling back to local data', error)
    useDataSourceStore.getState().setAuthorAvailable(false)
  }
}
```

main.tsx 在 `void initTheme()` 旁加 `void initDataSource()`。

- [ ] **Step 3: 测试 + 回归 + Commit**

Commit: `[NF]: 数据源 store（作者/本地）与快照探测初始化`

---

### Task 6: sourceActivityRepository 门面 + 页面接入

**Files:**
- Create: `src/storage/sourceActivityRepository.ts`
- Modify: 9 处消费方（见下）
- Test: `tests/storage/sourceActivityRepository.test.ts`

**Interfaces:**
- Produces: `sourceActivityRepository: ActivityReadRepository`（调用时按 selectEffectiveSource 分发）

```ts
const localRepository = new DexieActivityRepository(db)
const authorRepository = new AuthorActivityRepository(defaultSnapshotClient)

function current(): ActivityReadRepository {
  return selectEffectiveSource(useDataSourceStore.getState()) === 'author'
    ? authorRepository
    : localRepository
}

export const sourceActivityRepository: ActivityReadRepository = {
  getById: (id) => current().getById(id),
  getRecords: (id, options) => current().getRecords(id, options),
  listActivities: (options) => current().listActivities(options),
  countActivities: () => current().countActivities(),
  existsByFingerprint: (fingerprint) => current().existsByFingerprint(fingerprint),
  summarizeByRange: (start, end) => current().summarizeByRange(start, end),
  listAllSummaries: () => current().listAllSummaries(),
}
```

- [ ] **Step 1: 门面分发测试**（store 切源 → 断言分发到对应实现）

- [ ] **Step 2: 页面改造**（每页同一模式：换 import + `const source = useDataSourceStore(selectEffectiveSource)` 加入加载 effect 依赖数组）：

| 文件 | 改动 |
|---|---|
| DashboardPage.tsx | 模块单例 → `sourceActivityRepository`；reload useCallback deps 加 source |
| CalendarPage.tsx | 同上 |
| YearReviewPage.tsx | 同上 |
| ActivitiesPage.tsx | props `repository?: ActivityReadRepository`；默认 `sourceActivityRepository`；加载 effect deps 加 source |
| StatisticsPage.tsx | 模块单例 → 门面；reload deps 加 source（预计算分支在 Task 9） |
| HeatmapPage.tsx | 同上（author 分支在 Task 9） |
| SegmentsPage.tsx | 同上（author 分支在 Task 9） |
| ActivityDetailPage.tsx | 见 Step 3 |
| TrainingStatusSection.tsx | 模块单例 → 门面；effect deps 加 source（profile 接入在 Task 8） |

注意：导入/删除/清空等**写路径**（importer、dataClear、exportImport、SettingsPage、backfillNormalizedPower）保持直连 Dexie 仓库，不走门面。

- [ ] **Step 3: ActivityDetailPage 源切换安全**

- `loadedId`/`errorId` 改为 `loadedKey`/`errorKey`：key = `${source}:${id}`，effect deps `[id, source]`；渲染门禁同步改用 key 比对（切源时旧活动数据不外漏）
- 删除/重命名/设赛段按钮包裹 `{source === 'local' && (…)}`（Task 7 统一做也可以，此处先留 TODO 不行——直接在本步完成条件渲染，GPX 导出保留）
- AchievementsSection 的 listAllSummaries 已走门面，天然随源

- [ ] **Step 4: 全量回归 + Commit**

Run: `npm run test && npm run lint && npm run build`
（现有页面测试不触发 initDataSource，authorAvailable=false → 全走 local，零影响）
Commit: `[NF]: 数据源门面与各页面按源加载`

---

### Task 7: 切换器 + 横幅 + 导入自动切换 + 设置页文案

**Files:**
- Create: `src/components/DataSourceSwitcher.tsx`
- Create: `src/components/AuthorBanner.tsx`
- Modify: `src/layouts/AppLayout.tsx` + `src/layouts/AppLayout.css`
- Modify: `src/stores/importStore.ts`（导入完成自动切 local）
- Modify: `src/pages/SettingsPage.tsx`（关于区块 + 两处提示文案）
- Test: `tests/components/DataSourceSwitcher.test.tsx`、`tests/components/AuthorBanner.test.tsx`、importStore 自动切换用例

- [ ] **Step 1: 失败测试**

切换器：渲染两档（作者名来自 store authorName，回退「作者」）、aria-pressed 正确、点击调 setSource、authorAvailable=false 时作者档 disabled。
横幅：author 模式显示且含作者名；点关闭后消失且 localStorage 记忆；local 模式不渲染。
importStore：startImport 完成且 newImported>0 → dataSourceStore.source 变 'local'；newImported=0 不变。

- [ ] **Step 2: 实现 DataSourceSwitcher**

```tsx
/** 数据源切换器：作者数据（只读快照）/ 我的数据（本地 IndexedDB）。 */
function DataSourceSwitcher() {
  const source = useDataSourceStore((s) => s.source)
  const authorAvailable = useDataSourceStore((s) => s.authorAvailable)
  const authorName = useDataSourceStore((s) => s.authorName)
  const setSource = useDataSourceStore((s) => s.setSource)
  // 分段控件：role=group + aria-pressed（沿用既有 a11y 模式）
  // 作者档：{authorName ?? '作者'} 的数据 + 「作者」徽章；不可用时 disabled + title 提示
}
```

- [ ] **Step 3: 实现 AuthorBanner**

```tsx
const DISMISS_KEY = 'author-banner-dismissed'
/** 作者模式横幅：说明正在查看作者发布的只读数据，可关闭（localStorage 记忆）。 */
```
文案：`正在查看作者 {name} 发布的骑行数据（只读）。切换到「我的数据」可导入你自己的 FIT 文件。`
AppLayout：品牌区与 nav 之间挂切换器；`<main>` 内 Outlet 上方挂横幅。

- [ ] **Step 4: importStore 自动切换**

startImport 成功分支 set summary 之后：

```ts
// 导入进本地库后自动切到「我的数据」：访客导入即见其数据
if (summary.newImported > 0) {
  useDataSourceStore.getState().setSource('local')
}
```

- [ ] **Step 5: SettingsPage**

- 底部新增 `<section className="settings-section" aria-label="关于">`：站点为 Saul 的公开骑行数据；默认展示作者数据（只读）；导入数据仅存访客本地浏览器
- 「个人信息」hint 追加：训练配置仅作用于「我的数据」；查看作者数据时使用作者发布的配置
- 「数据管理」hint 追加：导出/清空仅作用于「我的数据」，不影响作者发布的数据

- [ ] **Step 6: 测试 + 回归 + Commit**

Commit: `[NF]: 数据源切换器与作者模式只读横幅`

---

### Task 8: effectiveProfile + 训练分析随源

**Files:**
- Create: `src/features/settings/effectiveProfile.ts`
- Modify: `src/pages/ActivityDetailPage.tsx`（profile 随源）
- Modify: `src/features/dashboard/TrainingStatusSection.tsx`（profile 随源 + author 跳过回填）
- Test: `tests/features/settings/effectiveProfile.test.ts` + 两处组件测试更新

- [ ] **Step 1: 失败测试 + 实现**

```ts
/**
 * 按数据源取训练配置：作者模式用快照 profile（访客不配置也能看完整训练分析），
 * 本地模式用访客自己的设置。单位/主题偏好不走这里（永远本地）。
 */
export async function getEffectiveProfile(
  source: DataSource,
  client: SnapshotClient = defaultSnapshotClient,
): Promise<UserProfile> {
  if (source === 'author') {
    return client.getProfile().catch(() => ({}))
  }
  return (await getSettings()).profile
}
```

测试：author → 返回快照 profile；快照 404 → {}；local → getSettings().profile。

- [ ] **Step 2: 接入**

ActivityDetailPage：保留 getSettings()（单位/时间格式）；新增 `profile` state，effect deps [source] 经 getEffectiveProfile 加载；`ftp`/`maxHeartRate` 改自 profile。
TrainingStatusSection：`getSettings()` → `getEffectiveProfile(source)`；author 模式跳过 `backfillNormalizedPower`（快照摘要已含 NP，且回填是写操作只能对本地）。

- [ ] **Step 3: 测试 + 回归 + Commit**

Commit: `[NF]: 训练配置随数据源（作者快照 profile）`

---

### Task 9: 预计算产物接入（热力图/赛段/统计）

**Files:**
- Modify: `src/pages/HeatmapPage.tsx`、`src/pages/SegmentsPage.tsx`、`src/pages/StatisticsPage.tsx`
- Test: 各页 author 分支用例（stub snapshotClient 或 fetch）

- [ ] **Step 1: HeatmapPage author 分支**

加载 effect 内：

```ts
if (source === 'author') {
  const file = await defaultSnapshotClient.getTracks()
  // tracks 已是抽稀结果，直接 setTracks(file.tracks)；空 → 'empty'
  return
}
// 现有本地扫描逻辑不变
```

- [ ] **Step 2: SegmentsPage author 分支**

```ts
if (source === 'author') {
  const [segments, results] = await Promise.all([
    defaultSnapshotClient.getSegments(),
    defaultSnapshotClient.getSegmentResults(),
  ])
  // results: Record<string, SegmentEffort[]> → Map<number, SegmentEffort[]>（Number(key)）
  // segments 缺失（404）→ 空数组空榜（catch 内回退，显示空态）
}
```

`SegmentCards` 的 `onDelete` 改可选，author 模式不传（按钮隐藏）。

- [ ] **Step 3: StatisticsPage author 分支**

扫描 effect 内 source === 'author' 时改为 `Promise.all([getPowerRecords(), getRouteGroups()])` 直接填 scanState；失败 → setScanFailed（现有失败态）。骑行纪录/设备统计本就走摘要（门面），无需分支。

- [ ] **Step 4: 测试 + 回归 + Commit**

Commit: `[NF]: 作者模式预计算产物接入（热力图/赛段榜/路线与功率纪录）`

---

### Task 10: CI 接入 + 真实数据 + 文档 + 发布

**Files:**
- Modify: `.github/workflows/deploy.yml`（Test 与 Build 之间插 `- name: Build author data / run: npm run build:author-data`）
- Modify: `.gitignore`（加 `public/author-data/`）
- Create: `author-data/fit/`（从 private-fixtures/export_161915040/activities/ 拷入 80 个 .fit.gz）、`author-data/activities.csv`
- Modify: `README.md`（功能 + 隐私）、`docs/PROGRESS.md`、`CLAUDE.md`（架构一句话）、`package.json` version → 1.7.0

- [ ] **Step 1: CI 与 gitignore 改动**
- [ ] **Step 2: 拷入真实数据，本地跑 `npm run build:author-data`**，检查产物文件数与体积（activities.json ~KB 级、records/ 80 个、precomputed/* 存在）
- [ ] **Step 3: `npm run dev` 用 Playwright 实测**：默认显示 Saul 数据（仪表盘有统计）→ 详情页地图图表正常 → 热力图/统计/赛段预计算区块正常 → 切「我的数据」为空态 → 导入合成 FIT → 自动切回本地并显示
- [ ] **Step 4: `npm run build && npm run preview`** 复验生产构建 + 深链
- [ ] **Step 5: 文档三处更新**（README 功能清单/隐私说明；PROGRESS.md 新章节含文件清单与测试数；CLAUDE.md 架构节加数据源一行）
- [ ] **Step 6: 全量验证 `npm run lint && npm run test && npm run build`**
- [ ] **Step 7: 提交并 push**（触发部署；提交信息 `[NF]: 作者数据快照发布与双数据源`），随后确认线上 manifest 可访问
- [ ] **Step 8: `codegraph sync`**

---

## 自审记录

- 覆盖：spec §4 脚本→Task 2；§5.2/5.3→Task 3/4/6；§5.1→Task 5；§5.4→Task 8；§5.5→Task 9；§6→Task 7；§7 错误处理分散在各 Task；§8 测试各 Task 内；§9 文档→Task 10
- authorAvailable 默认 false（探测成功翻牌）为对 spec 的修正，spec 已同步更新
- 已知留待实现核对：`SegmentCards` onDelete 是否需改可选；`tsc -b` 对 scripts 的纳管（有回退方案）；PowerRecordEntry/RouteGroup/SegmentEffort 均已确认为可序列化纯数据
