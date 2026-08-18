# 作者数据快照 + 双数据源 设计文档

> 日期：2026-08-18。状态：已批准（用户在对话中确认方案 A 与整体设计）。
> 需求来源：作者 Saul 希望把自己的骑行数据发布到 GitHub Pages 站点，
> 访客默认看到作者数据（只读），也可以导入自己的 FIT 数据（仅存其本地浏览器）。

## 1. 背景与目标

cycling-analyzer（骑记 Ride Insight）是纯前端应用，现有数据全部存访客本地 IndexedDB。
本功能新增「作者数据」第二数据源：作者 Saul 的骑行数据在构建时解析为静态 JSON 快照，
随站点一起发布，任何访客打开站点即可看到；访客仍可导入自己的数据，数据只存其本地。

目标：

- 默认展示作者 Saul 的数据（仪表盘/列表/详情/统计/日历/热力图/年度回顾/赛段全部可用）
- 作者数据只读：访客不能修改、删除作者数据
- 访客导入自己的 FIT → 进本地 IndexedDB（现有行为不变），导入完成自动切到「我的数据」
- 作者更新数据 = 把新 FIT 文件提交到 `author-data/fit/` 并 push，CI 自动解析发布
- 首屏性能：作者模式首屏只加载 manifest + 摘要（~100KB 级），逐点记录按需加载

非目标：

- 不做账号体系、不做服务端存储、访客数据不上传
- 不做增量解析（80 个文件全量解析为秒级，简单优先）
- 不改现有本地导入/存储链路的行为语义

## 2. 总体架构

```
author-data/fit/*.fit|.fit.gz     （作者提交，骑行数据唯一事实来源）
author-data/activities.csv        （可选，Strava 导出 CSV，标题还原）
author-data/profile.json          （可选，作者训练配置：ftp/maxHeartRate/weightKg…）
author-data/segments.json         （可选，作者赛段定义）
        │
        ▼  CI / 本地：npm run build:author-data（scripts/build-author-data.ts，tsx 运行，
        │             复用 src 的 decoder/normalizer/calculator/NP/预计算纯函数）
public/author-data/               （构建产物，gitignored；CI 生成后由 vite build 拷入 dist）
        │
        ▼  浏览器 fetch（`${import.meta.env.BASE_URL}author-data/…`）
dataSourceStore（zustand + persist：source = 'author' | 'local'，默认 author）
        │
        ▼  sourceActivityRepository 门面（按调用时当前源分发）
   ├─ author → AuthorActivityRepository（快照 fetch + 内存索引，只读）
   └─ local  → DexieActivityRepository（现有实现，不变）
```

关键决策：

1. **活动 ID 确定性**：快照中活动 `id = 文件内容指纹（SHA-256 hex）`。
   重新构建 id 不变，详情页深链跨部署存活；records 文件名稳定，HTTP 缓存友好。
2. **写入永远进本地**：导入/删除/改名/设赛段/设置保存，全部只操作 Dexie。
   作者模式是纯粹只读视图，AuthorActivityRepository 不实现任何写方法。
3. **跨活动全量逐点扫描类功能由 CI 预计算**：热力图轨迹、赛段成绩榜、路线分析、功率纪录。
   访客端不下载全部逐点数据（80 条约 25MB），只取预计算小文件。
4. **训练配置随数据源**：作者模式的 FTP/最大心率/体重来自快照 profile.json，
   访客不配置也能看到完整区间/IF/TSS/训练状态；单位/主题永远用访客本地设置。
5. **快照探测回退**：manifest.json 拉取失败（本地 dev 未生成快照等）→ 有效源回退 local，不打断访客。

## 3. 目录与文件

### 3.1 提交的源文件（git 跟踪）

| 路径 | 说明 |
|---|---|
| `author-data/fit/**/*.{fit,fit.gz}` | 作者 FIT 文件（递归扫描） |
| `author-data/activities.csv` | 可选。Strava 批量导出的 activities.csv，用于活动标题还原 |
| `author-data/profile.json` | 可选。`{ nickname?, weightKg?, heightCm?, ftp?, maxHeartRate?, restingHeartRate? }`（与 UserProfile 同构） |
| `author-data/segments.json` | 可选。赛段定义数组（字段同 SegmentEntity，id 由脚本按下标重排） |

### 3.2 构建产物（public/author-data/，gitignored）

| 文件 | 内容 | 加载时机 |
|---|---|---|
| `manifest.json` | `{ snapshotVersion: 1, author: "Saul", generatedAt, activityCount }` | 应用启动探测 |
| `activities.json` | ActivitySummary 数组（startTime 降序，含 Strava 还原标题 name） | 作者模式首屏 |
| `records/<activityId>.json` | `{ activityId, records: ActivityRecord[] }` | 进详情页时按需 |
| `profile.json` | UserProfile 子集（透传源文件） | 训练分析展示时 |
| `segments.json` | SegmentEntity 数组（透传 + id 重排） | 赛段页 |
| `precomputed/tracks.json` | `{ toleranceMeters: 10, tracks: [ [lat,lng][] ] }`（坐标 5 位小数） | 热力图页 |
| `precomputed/segment-results.json` | `{ [segmentId]: SegmentEffort[] }` 成绩榜 | 赛段页 |
| `precomputed/route-groups.json` | RouteGroup 数组（buildRouteGroups 输出） | 统计页 |
| `precomputed/power-records.json` | PowerRecordEntry 数组（buildPowerRecords 输出） | 统计页 |

快照格式常量与类型放 `src/storage/authorData/snapshotTypes.ts`，脚本与前端共用同一类型定义。

### 3.3 体积估算（80 条活动）

activities.json ~100KB；records 单文件 200-500KB；tracks.json 约 2-5MB（仅热力图页加载）。
GitHub Pages 对文本自动 gzip/br，传输体积约 1/4。

## 4. 快照生成脚本（scripts/build-author-data.ts）

Node 22 + tsx 运行，直接 import src 现有模块（零重复实现）：

1. 递归扫描 `author-data/fit/` 的 `.fit`/`.fit.gz`
2. 每文件：读字节 → `shouldGunzip`/`gunzipBytes` → `computeFingerprint` → 指纹去重（文件夹内重复跳过并 warn）→
   `parseFitBytes`（decodeFit + normalizeActivity，`id = fingerprint`）→ `calculateNormalizedPower` 落摘要
3. 标题还原：`activities.csv` 存在时 `parseStravaActivitiesCsv` 构建查找表写入摘要 name
   - 需要小重构：把 importer.ts 模块私有的 `buildTitleLookup`/`matchTitle` 移到 stravaExport.ts 导出，importer 改 import
4. 写出 manifest/activities/records/*
5. 预计算（复用现有纯函数）：
   - tracks：`simplifyRoute(records, 10)`，坐标保留 5 位小数
   - segment-results：segments.json 存在时逐赛段 `buildSegmentLeaderboard`
   - route-groups：`extractEndpoints` + `buildRouteGroups`
   - power-records：逐活动 `buildPowerCurve(records, POWER_RECORD_DURATIONS)` + `buildPowerRecords`
6. **fail-fast**：任一文件解析失败 → 打印文件名与原因，`process.exit(1)`，构建失败（不静默少数据）
7. 输出统计：解析 N 条 / 跳过重复 M 条 / 总耗时

环境依赖核对：Node 22 全局有 `crypto.subtle`（指纹）与 `crypto.randomUUID`；`@garmin/fitsdk` 为纯 JS；
fflate 跨环境。均已在 jsdom（无 Worker）主线程降级路径验证过可非浏览器运行。

npm script：`"build:author-data": "tsx scripts/build-author-data.ts"`；新增 devDependency `tsx`。
CI（.github/workflows/deploy.yml）在 `npm run test` 之后、`npm run build` 之前插入 `npm run build:author-data`。
`.gitignore` 增加 `public/author-data/`。

## 5. 前端数据源抽象

### 5.1 类型与 store

- `src/storage/dataSource.ts`：`export type DataSource = 'author' | 'local'`
- `src/stores/dataSourceStore.ts`（zustand + persist，localStorage key `cycling-data-source`）：
  - `source: DataSource`（用户显式选择，默认 'author'）
  - `authorAvailable: boolean`（manifest 探测结果，**默认 false**——探测成功才翻牌；
    现有页面测试不走探测，有效源恒为 local，测试零影响；生产端首屏先 local 加载态，
    manifest 探测完成（毫秒级）后自动切 author 刷新）
  - `effectiveSource()`：source === 'author' && authorAvailable ? 'author' : 'local'
  - `setSource(source)`、`setAuthorAvailable(available)`
- `initDataSource()`（main.tsx 启动调用，与 initTheme 并列）：fetch manifest.json，
  成功 → 缓存 manifest 到 store；失败 → `setAuthorAvailable(false)`（console.warn，不打断）

### 5.2 AuthorActivityRepository（只读）

`src/storage/authorData/`：

- `snapshotClient.ts`：快照 fetch 封装。模块级缓存（快照在一次会话内不可变，无需失效）：
  `getManifest/getActivities/getRecords(id)/getProfile/getSegments/getTracks/getSegmentResults/getRouteGroups/getPowerRecords`，
  路径拼接 `import.meta.env.BASE_URL`；404/网络错误向上抛，由调用方降级
- `authorActivityRepository.ts`：实现读取接口
  `getById/getRecords/listActivities/countActivities/summarizeByRange/listAllSummaries`
  （existsByFingerprint 恒 false——访客指纹去重只查本地库，与作者数据天然隔离）。
  listActivities 的筛选/排序/分页逻辑镜像 Dexie 实现（原本就是内存过滤，逻辑直接平移）。
- 接口定义：从 activityRepository.ts 抽取 `ActivityReadRepository`（读取方法子集），
  `ActivityRepository extends ActivityReadRepository`，Dexie 实现不变。

### 5.3 门面 sourceActivityRepository

`src/storage/sourceActivityRepository.ts`：对象方法逐项分发（**调用时**读 store 当前有效源，
模块级单例安全）：

```ts
export const sourceActivityRepository: ActivityReadRepository = {
  getById: (id) => current().getById(id),
  // …其余读取方法同
}
```

页面改造（每个页面两处小改）：

1. `const repository = new DexieActivityRepository(db)` →
   `import { sourceActivityRepository } from '@/storage/sourceActivityRepository'`（变量名沿用 repository 的调用点逐一替换）
2. `const source = useDataSourceStore((s) => s.effectiveSource)` 加入加载 effect 依赖，
   切换源自动重新加载

涉及页面/组件：DashboardPage、ActivitiesPage、ActivityDetailPage、StatisticsPage、CalendarPage、
YearReviewPage、HeatmapPage、SegmentsPage、TrainingStatusSection。

模块级扫描缓存（scanCache、HeatmapPage/SegmentsPage/StatisticsPage 内的缓存）以活动集合指纹为 key，
两源指纹不同即自动隔离，无需改动。

### 5.4 训练配置随源

`src/features/settings/effectiveProfile.ts`：

```ts
export async function getEffectiveProfile(source: DataSource): Promise<UserProfile>
```

- author → snapshotClient.getProfile()（快照无 profile.json 时返回 {}，走现有「未配置」引导文案）
- local → getSettings().profile

接入点：ActivityDetailPage（区间/IF/TSS）、TrainingStatusSection（FTP）。
SettingsPage 的 FTP 估算区块保持本地语义不变（页内文案注明训练配置仅作用于「我的数据」）。
TrainingStatusSection 在 author 模式跳过 `backfillNormalizedPower`（快照摘要已含 NP）。

### 5.5 赛段随源

SegmentsPage：author 模式 → `getSegments()` + `getSegmentResults()`（预计算）；
local → 现有 Dexie + 全量扫描。详情页「设为赛段」按钮仅 local 模式渲染。

## 6. UI 变更

### 6.1 数据源切换器（AppLayout 侧边栏，品牌区与导航之间）

`src/components/DataSourceSwitcher.tsx`：分段控件两档

- 「Saul 的数据」带「作者」徽章；authorAvailable === false 时禁用（title 提示「作者数据暂不可用」）
- 「我的数据」
- 切换即 setSource，各页面经 effect 依赖自动刷新

### 6.2 作者模式横幅

主内容区顶部细横幅（仅 author 模式、可关闭，关闭状态 localStorage 记忆）：
「正在查看作者 Saul 发布的骑行数据（只读）。切换到左侧「我的数据」可导入你自己的 FIT 文件。」

### 6.3 只读约束（author 模式）

- 隐藏：活动删除按钮、重命名入口、「设为赛段」按钮、赛段删除按钮
- 保留（只读性质）：导出 GPX、年度分享图、全屏地图
- **ImportPanel 保持可见**（对批准设计的一处有意调整）：它是访客唯一的上传入口，
  隐藏会让访客先找到切换器才能导入，多一步且更费解。导入永远进本地库，
  导入完成后 importStore 自动 `setSource('local')` 并可在面板结果区提示「已导入到你的数据」。

### 6.4 设置页

- 「关于」区块（新增）：说明本站为 Saul 的公开骑行数据站点；默认展示作者数据（只读）；
  导入的数据仅存访客本地浏览器，不上传任何服务器
- 「数据管理」区块加注：清空/导出仅作用于「我的数据」，不影响作者发布的数据
- 训练配置（FTP/心率/体重）加注：仅作用于「我的数据」；查看作者数据时使用作者发布的配置

## 7. 错误处理

| 场景 | 行为 |
|---|---|
| manifest.json 拉取失败 | authorAvailable=false，有效源回退 local，console.warn |
| 快照版本 snapshotVersion !== 1 | 同上回退 |
| 某条 records/<id>.json 404/失败 | 详情页现有错误态「加载失败」 |
| profile.json 缺失 | 返回 {}，训练分析显示现有「未配置」引导文案 |
| segments.json 缺失 | 赛段页 author 模式显示空态文案 |
| precomputed 文件缺失 | 对应区块显示现有失败/空态，不崩溃 |
| CI 脚本任一 FIT 解析失败 | 打印文件名，exit 1，部署中止（fail-fast） |
| activities.csv 缺失 | 跳过标题还原，name 为空（详情页日期兜底名） |

## 8. 测试

- **脚本**：`tests/authorData/buildAuthorData.test.ts`——以 tests/fixtures 合成 FIT 为输入，
  临时目录输出，校验 manifest/activities/records 结构、指纹去重、确定性 id、CSV 标题还原、
  解析失败 fail-fast
- **仓库行为对齐**：`tests/authorData/authorActivityRepository.test.ts`——同一组用例
  （排序/筛选/搜索/分页/范围聚合）跑 AuthorActivityRepository（内存快照）与 Dexie 实现，断言结果一致
- **store**：dataSourceStore 默认 author、持久化、authorAvailable 回退逻辑
- **snapshotClient**：fetch mock，路径含 BASE_URL，缓存只拉一次
- **组件**：DataSourceSwitcher 渲染/切换/禁用态；作者横幅显隐与关闭记忆；
  author 模式详情页无删除/改名/设赛段按钮；导入完成自动切 local
- **effectiveProfile**：author 返回快照 profile，local 返回本地设置
- 现有 490+ 用例全量回归不破

## 9. 文档同步

- README：主要功能加「作者数据」段；数据隐私说明更新（作者数据公开快照可下载，
  含完整 GPS 轨迹；访客数据仍仅存本地）
- docs/PROGRESS.md：按维护规则登记本功能（文件清单、测试数、设计决策）
- CLAUDE.md：架构节加数据源分层一句话 + author-data 目录说明

## 10. 隐私说明（已与作者确认）

仓库公开 → `author-data/fit/` 原始 FIT 文件任何人可下载（含完整 GPS 轨迹、设备序列号）；
快照 JSON 同样公开。作者在需求中明确「别人可以看到」，视为已知悉接受。
访客数据始终只存其本地浏览器，与作者数据物理隔离。

## 11. 实现顺序（供实现计划参考）

1. 小重构：buildTitleLookup/matchTitle 移入 stravaExport.ts
2. snapshotTypes + 快照生成脚本 + 脚本测试（本地用合成 fixture 验证，再用真实数据人工验证一次）
3. ActivityReadRepository 抽取 + AuthorActivityRepository + snapshotClient + 对齐测试
4. dataSourceStore + 门面 + 页面改造 + store/组件测试
5. UI：切换器/横幅/只读隐藏/设置页关于区块 + 组件测试
6. 预计算接入（热力图/赛段/统计）+ effectiveProfile 接入
7. CI 工作流 + .gitignore + package.json
8. 文档（README/PROGRESS/CLAUDE.md）+ 全量 lint/test/build 验证
