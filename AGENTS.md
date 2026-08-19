# AGENTS.md

个人骑行数据分析网站（Strava Lite）：纯前端，FIT 在浏览器解析，数据存 IndexedDB，GitHub Pages 部署，默认展示作者公开数据快照（只读）+ 访客本地数据双数据源。

## 必读文档（动手前先读）

- `CLAUDE.md` — 架构分层、设计决策、代码/提交规范（中文注释、日志英文、`@/` 别名、React 组件 `function` 声明、无魔法值）
- `docs/PROGRESS.md` — 功能状态清单；**§0 是进行中任务清单，中断恢复必读；每开始任务先登记、完成后移出**
- `docs/个人骑行数据分析网站——Agent 开发规格说明.md` — 产品规格原文（规格 §N 引用出处）

## 命令

```bash
npm run dev                 # 本地开发
npx vitest run <file>       # 单文件测试（全量 631+ 用例约 40s）
npm run test                # 全量测试
npm run lint && npm run build   # 静态检查 + tsc -b + vite build
npm run build:author-data   # 快照构建（tsx 脚本，全量重建，fail-fast 解析失败即报错）
npm run test:e2e            # Playwright（本地跑，不进 CI；首次需 npx playwright install chromium）
node tests/fixtures/generate-samples.mjs   # 重新生成合成 FIT 样例
```

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
- `activities` 表只存摘要，逐点数据在 `activity_records`（`getRecords` 按需加载）；导入时摘要需含 `normalizedPower`（训练状态聚合依赖）
- 活动 ID = 文件内容指纹（快照确定性深链）；`.fit` 与 `.fit.gz` 同一活动判重一致
- Strava 标题还原：CSV「文件名」列匹配（批量导出数字 ID），未命中时文件名兜底（手动下载文件名=标题，纯数字跳过）；描述/估算功率仅 CSV 有对应行时生效
- 测试：Vitest + jsdom；`tests/setup.ts` 全局注册 fake-indexeddb，DB 测试用真 Dexie 实例注入；FIT 样例在 `tests/fixtures/`；**`private-fixtures/` 用户真实数据 gitignored，严禁提交**
- 组件渲染测试用 MemoryRouter；页面数据加载支持注入；mock `getBoundingClientRect` 让 Recharts 正常渲染
- 构建产物 `public/author-data/`、`dist/` gitignored，CI 重建；快照任一 FIT 解析失败 CI 即失败

## 提交规范

- 前缀 `[NF]`/`[BF]`/`[IM]`/`[CU]` + 中文 Subject；**无 AI 署名**
- 提交身份固定 `999bug <999bug@users.noreply.github.com>`（项目 git config 已设，勿改）
- 先同步更新 `docs/PROGRESS.md` 再提交；完成后 `codegraph sync`（如环境可用）
- **版本策略**：每次 push 一组功能提交前，`package.json` 升一次 minor 版本（`__APP_VERSION__` 由 vite define 自动读取，侧边栏底部显示）；如已升过则跳过
