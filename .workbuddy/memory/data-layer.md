# 数据层（Dexie / IndexedDB）与构建管道

> 什么时候读：改 `src/storage/**`、动 schema/迁移、改快照构建脚本或 CI 流水线、
> 想「优化查询/性能」之前。**先读本文的「先量再改」一节**——本次重构里三项计划
> 工作都被实测否掉了，省下的返工比省下的代码多。

## 一、先量再改：基线脚本是这套改动的地基

`npm run bench:data-layer`（`scripts/bench-data-layer.ts`，支持 `--scale=small|default|large`）。

**测量口径 = IndexedDB 实际解出的行数/点数**（Dexie 的 `db.<table>.hook('reading', ...)` 计数），
**不要用墙钟耗时**：脚本跑在 fake-indexeddb（纯内存）上，与真实浏览器（磁盘 + 结构化克隆 +
IPC）无可比性。解出行数同时决定反序列化开销与峰值内存，跨环境完全一致，可以写成断言。

坑：
- `hook('reading')` 在**主键 get 未命中时会以 `undefined` 触发**，hook 里必须判空，
  否则脚本自身崩在读取兜底路径上。
- 字节数由 `JSON.stringify(records).length` 估算，**高估**真实 IDB 占用（IDB 不重复字段名），
  只用于横向比较。

本次由数字得出的结论（数字见 `docs/数据层重构方案.md` §6）：
- 列表分页**不需要 keyset**：IDB 游标 `advance()` 不解对象，解出行数恒等于 limit，代价只在遍历时间。
- 分片的第一收益方是**导出**（分批读放大 11 倍）而非详情页。
- **快照增量构建无价值**：全量构建 87 个 FIT / 12MB 输入只要 7.0s，
  缓存 150MB+ 产物在 CI 上的上传下载比重建更慢。
- **产物 gzip 落盘 / 按年分片无价值**：GitHub Pages 已对 JSON 做 gzip
  （响应头 `Content-Encoding: gzip`，约 3.8x）；落盘 `.gz` 反而让 Pages 不再压缩。
  而 `records/<id>.json` 已是「详情页取一条活动」的最优粒度。

## 二、存储布局（DB_VERSION 见 `src/storage/db.ts` 常量注释）

| 表 | 用途 |
| --- | --- |
| `activities` | 摘要；索引 `id, &fingerprint, startTime, activityType, localDate` |
| `activity_chunks` | **逐点数据主存储（v9 起）**，复合主键 `[activityId+seq]`，`activityId` 单索引供级联删除 |
| `activity_blobs` | v5~v8 的整活动一行；v9 起**只作迁移源，不再写入** |
| `activity_records` | v4 及更早的逐点行表；迁移兜底 |

- `activities.startTime` 是 **UTC ISO 字符串**（`toISOString()`），字典序 = 时间序，可直接当排序索引用。
- `localDate` 是**写入时算好的本地日期键**：年/月筛选按本地日期前缀匹配，与 UTC 日期在时区边界
  不等价（东八区 8-31 23:30 → 本地 9-1），所以必须另开字段。
- **不要建 `[activityType+startTime]` 复合索引**：库里存的是平台原始写法（`road_biking`/`骑行`），
  筛选传归一化值（`cycling`），复合索引只命中字面量相等的行 → **静默漏记录**。

## 三、逐点数据分片（v9）

- 片大小 `ACTIVITY_CHUNK_SIZE = 2000`（`src/storage/activityChunks.ts`）。纯逻辑都在该模块：
  `toChunkEntities` / `chunkSeqRange` / `sliceChunks`——分片边界算错的表现是「静默少点/错位」，
  端到端测很难定位，所以边界必须有单测。
- 读：`getRecords(id, {offset, limit})` 用 `where('[activityId+seq]').between(...)` 范围查询，
  **只解出覆盖目标区间的片**。复合主键可以直接 `where('[a+b]')`（已实测）。
- 读优先级：`chunks` → `blobs` → `activity_records`。后两级读到时会按**当前**布局回填分片，
  让迁移与读取双向收敛。
- 对外契约始终是 `ActivityRecord[]`，重组责任在 repository 内部；两个实现（Dexie / Author 快照）
  共用 `queryActivityList` 作为 oracle。
- **`Dexie` 的 `EntityTable` 第二个类型参数只能是 `keyof T`**，无法表达复合主键，
  所以 `activity_chunks` 声明成 `EntityTable<ActivityChunkEntity, 'activityId'>` 并加注释说明；
  `where()` 接受任意字符串所以查询没问题。

## 四、迁移（两层，共用同一把锁）

`src/storage/migrationLock.ts` 是**共用**的：CAS 抢锁（检查与写入必须在同一读写事务内）+
心跳随每个处理单位续期（只在批间续期会被其它标签误判崩溃并接管）+ done 标记。
**不要把这段逻辑复制到第二个迁移里**——写错一次就丢数据。

- 第一层 `recordsMigration.ts`（v4 逐点行 → v5 整活动行）：消费 `done` 标志位，
  完成后清旧表与标记 done **必须同事务**。
- 第二层 `chunksMigration.ts`（v5 整活动行 → v9 分片）：完成判据用「blobs 表是否还有行」
  **而非 done 标志位**（标志位会漏掉「上一层晚到又写回一份 blob」的自愈场景）；
  上一层 `running` 时主动让路。每个活动「写全部分片 + 删源行」同事务原子替换。
- **代价要记住**：迁移按活动原子替换、不双写，所以**降级到更早版本后轨迹读不出来**
  （数据在 chunks 里没丢，是旧代码没有读取路径）。回滚应发「能读 chunks」的补丁版本，
  而不是退回更早 tag。已记入方案 §8，须在发布说明告知。

## 五、大扫描：用 `iterateRecordBatches`，别用 `getRecordsByActivityIds`

`getRecordsByActivityIds` 的返回值是 `Map<活动, 全量记录>`，峰值 = 所有活动逐点之和
（实测 500 活动 × 2000 点 = 154MB）。全量轨迹扫描类页面一律用
`iterateRecordBatches(ids, visit, { batchSize })`（默认 16 活动/批）：
- 回调**串行**，返回 `false` 可提前终止（页面卸载短路用）；
- 批内 Map 迭代序 = 入参顺序（成绩榜并列名次、路线绘制层级依赖这点）；
- **不要在回调里长期持有 batch**，否则退化回全量驻留。

已切换：热力图 / 路线图 / 赛段页 / 赛段详情 / 赛段创建预览。
**未切换**：`SegmentRecommendations` 的网格聚类 `mineSegmentCandidates(inputs)` 需要全部活动
才能成网格，改流式要先改算法。

作者源实现**刻意返回空记录**（与本类 `getRecordsByActivityIds` 既有语义一致）：
赛段创建预览与赛段挖掘两个调用点没有作者源分支，返回真实记录会让访客本地库被写入
「由站主快照推导出的成绩」——那是重构之外的行为变化。

## 六、快照构建与 CI

- 构建失败策略：坏 FIT **跳过并告警**（默认），CLI `--fail-fast` 才是严格模式。
  告警会发 GitHub Actions `::warning` 注解（`GITHUB_ACTIONS=true` 时），
  不允许退化成「静默少数据」。**全部**文件失败仍 exit 1（不发布空快照）。
- `npm run check:snapshot-size`：4 项体积预算，阈值 = 实测基线 + 1.5~2 倍余量。
  调阈值要在 PR 说明理由。门禁自身有测试（真实子进程跑脚本），因为它悄悄失效比没有更糟。
- CI 4 个 job：`verify`(lint+test+audit) → `e2e` / `build` 并行 → `deploy`。
  - `npm audit` **刻意非阻塞**：新披露的传递依赖漏洞会让一次与它无关的提交无法上线。
  - e2e **先构建作者快照**再跑，否则测的是「无快照降级模式」。
  - 回滚入口：Actions → Deploy GitHub Pages → Run workflow → `ref` 填历史提交 SHA。

## 七、测试隔离坑

**逐点数据有三种布局，测试的 `beforeEach` 必须三种都清**（`activities.clear()` +
`activity_blobs.clear()` + `activity_chunks.clear()`）。只清 `activity_records` 时，
旧布局下新写入会用空 blob 覆盖残留，**分片后不再产生 blob，残留就从兜底路径漏进来**，
表现为「上一条用例的轨迹出现在本条用例里」。已知踩过的文件：
`tests/features/statistics/statisticsPage.test.tsx` 等 12 个用例文件已全部补齐。
