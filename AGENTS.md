# AGENTS.md

个人骑行数据分析网站（Strava Lite）：纯前端，FIT 在浏览器解析，数据存 IndexedDB，GitHub Pages 部署，默认展示作者公开数据快照（只读）+ 访客本地数据双数据源。

## 必读文档（动手前先读）

- `CLAUDE.md` — 架构分层、设计决策、代码/提交规范（中文注释、日志英文、`@/` 别名、React 组件 `function` 声明、无魔法值）
- `docs/PROGRESS.md` — 功能状态清单；**§0 是进行中任务清单，中断恢复必读；每开始任务先登记、完成后移出**
- `docs/个人骑行数据分析网站——Agent 开发规格说明.md` — 产品规格原文（规格 §N 引用出处）

## 命令

```bash
npm run dev                 # 本地开发
npm run check               # 提交前快速验证（并行：tsc -b + 改动文件 eslint + vitest related，约 30s）
npm run check -- --full     # 全量版（大改动/排查时用：全仓库 lint + 全量测试）
npx vitest run <file>       # 单文件测试
npm run test                # 全量测试（常规提交不用，CI 兜底）
npm run build              # vite build（本地通常不需要跑，见下方说明）
npm run build:author-data   # 快照构建（tsx 脚本，全量重建，fail-fast 解析失败即报错）
npm run test:e2e            # Playwright（本地跑，不进 CI；首次需 npx playwright install chromium）
node tests/fixtures/generate-samples.mjs   # 重新生成合成 FIT 样例
```

## 提交与发布流程（提速约定，2026-09-11）

- **提交前只跑 `npm run check`**（半分钟内），不跑全量测试、不跑 vite build——CI（`deploy.yml`）在 push 后自动 lint + 全量测试 + build 并发布 Pages，失败时线上保持旧版
- **push 后必须盯 CI**（`gh run watch` 或 Actions 页）：失败立即修复补提交，保证「发布成功」闭环；改动 tsconfig/vite.config/tests setup 等全局文件时本地改用 `npm run check -- --full`
- 大改动/大规模重构在推送前额外跑一次 `npm run check -- --full`，把失败发现提前到本地

## 并行会话临时文件约定（2026-09-11，用户指定）

多个会话并行开发同一仓库，共享文件（`docs/PROGRESS.md`、`changelogData.ts`、`AGENTS.md`、`.workbuddy/memory/` 日志）同时被多方写入极易冲突。约定：

- **每个任务/会话在 `.tmp/<任务标识>/` 下建自己的临时目录**（如 `.tmp/share-studio/`），会话过程中的中间产物**只写进这里**：工作笔记、git 查询输出、调试脚本与日志、待合并的文档草稿等，**不直接写共享文件**
- **提交代码前才合并**：把临时目录内容一次性并入共享文件（§0 登记与移出、changelog 条目、memory 日志追加），合并完**立即删除自己的 `.tmp/<任务标识>/`**
- **只清理自己的临时目录**；别人的 `.tmp/*` 哪怕看起来过期也不碰（对方任务可能还在跑）
- `.tmp/` 已整体 gitignore；任何临时文件严禁 `git add` 进提交
- 根目录与 docs/ 等处**不得新增散装临时文件**（`xxx-tmp.txt`、`tmp-*.log` 之类）；发现他人遗留的散装临时文件时，先看修改时间判断所属会话是否还在活动，活跃的不动，沉睡的方可清理

## 架构硬边界

```
FIT Decoder → Normalizer → Calculator → Storage Repository → UI
```

- React 组件**禁止**直接调用 `@garmin/fitsdk`；UI 只依赖 `src/types/activity.ts` 领域模型与 repository 接口
- 数据源：组件不 new 仓库，统一经 `useActivityRepository()`（`dataSourceStore` 当前源 → 本地 Dexie 或作者快照）；作者源只读，写操作 UI 必须按源隐藏
- 单位固定：米/m/s/bpm/W、Unix 秒；**缺失字段 = undefined ≠ 0**，UI 显示 `—`

## 关键坑

- **Stream 校验顺序**：`isFitFile`/`checkFitIntegrity` 必须在 `read()` 前调用，read 消费 stream 后会误报 false
- **Dexie 非索引字段免升版本**（如 `FileEntity.data`、`ActivityEntity.description`）；改索引列才需要 `db.ts` 升 `DB_VERSION`
- `activities` 表只存摘要，逐点数据在 `activity_blobs`（每活动一行，v5；旧 `activity_records` 逐点行表由后台迁移完成后清空、v6 删除；`getRecords` 按需加载，迁移完成前新表优先旧表兜底）；导入时摘要需含 `normalizedPower`（训练状态聚合依赖）
- 活动 ID = 文件内容指纹（快照确定性深链）；`.fit` 与 `.fit.gz` 同一活动判重一致
- Strava 标题还原：CSV「文件名」列匹配（批量导出数字 ID），未命中时文件名兜底（手动下载文件名=标题，纯数字跳过）；描述/估算功率仅 CSV 有对应行时生效
- 测试：Vitest + jsdom；`tests/setup.ts` 全局注册 fake-indexeddb，DB 测试用真 Dexie 实例注入；FIT 样例在 `tests/fixtures/`；**`private-fixtures/` 用户真实数据 gitignored，严禁提交**
- 组件渲染测试用 MemoryRouter；页面数据加载支持注入；mock `getBoundingClientRect` 让 Recharts 正常渲染
- 构建产物 `public/author-data/`、`dist/` gitignored，CI 重建；快照任一 FIT 解析失败 CI 即失败
- **本地验证不要跑 `vite build`**（2026-09-11 用户确认：本地 dist 根本不用）：提交前的验证标准是 `npm run lint` + `npx tsc -b` + `npm run test` 全绿，构建由 CI 兜底；确需本地构建时（排查构建本身的问题）先把旧 dist 挪走再 build（见项目记忆 build-env.md）

## 提交规范

- 前缀 `[NF]`/`[BF]`/`[IM]`/`[CU]` + 中文 Subject；**无 AI 署名**
- **提交格式（参照 `9d36a88`，勿回退到单行长 Subject 风格）**：
  - Subject 一句话概括本次提交做了什么（简洁、不堆砌细节），前缀后无冒号
  - 细节全部放正文 bullet list（`-` 开头）：新增/修改了什么文件与函数、关键实现点、测试情况（如「全量 NNN/NNN + lint/build 绿」）、文档同步说明
  - 版本号变更写进正文 bullet（如 `- 版本 2.12.0 → 2.13.0`），不追加在 Subject 尾部
  - 正例：Subject「[NF] 详情页报告化：一句话总结 + 核心指标精选 + 更多指标折叠」+ 正文逐条列文件与测试
  - 反例（已废弃）：把全部功能点用「+」串进一行长 Subject 并以「版本 X.Y.Z」结尾
- 提交身份固定 `999bug <999bug@users.noreply.github.com>`（项目 git config 已设，勿改）
- 改动前先读 `docs/PROGRESS.md` 确认现状，避免与进行中的任务冲突
- **每完成一个功能/阶段必须同步更新 `docs/PROGRESS.md`**（状态与文件清单）再提交代码，保持文档与代码同步
- 完成后 `codegraph sync`（如环境可用）
- **版本策略**：每次提交都必须前进版本号（`__APP_VERSION__` 由 vite define 自动读取，侧边栏底部显示）——功能改动 `[NF]` 升中间位（如 2.28.0 → 2.29.0），其余提交（`[BF]`/`[IM]`/`[DOC]`/`[CU]`）升末尾位（如 2.28.0 → 2.28.1）；changelog 同步追加条目

