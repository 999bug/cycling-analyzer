# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

个人骑行数据分析网站（Strava Lite）：纯前端、数据完全本地化，FIT 文件在浏览器内解析，数据存 IndexedDB，部署 GitHub Pages。产品规格与功能状态见 `docs/PROGRESS.md`（已实现/未实现清单、架构接口、agent 工作须知）。

## 常用命令

```bash
npm run dev        # 本地开发（默认 5173 端口）
npm run test       # 全量测试（vitest run，610+ 用例）
npx vitest run tests/fit/decoder.test.ts   # 单文件测试
npm run lint       # ESLint（flat config）
npm run build      # tsc -b + vite build（产出 dist/）
node tests/fixtures/generate-samples.mjs   # 重新生成合成 FIT 测试样例
```

代码修改后执行 `codegraph sync` 同步索引。

## 架构

### 数据分层（硬边界，规格 §42）

```
FIT Decoder → Normalizer → Calculator → Storage Repository → UI
```

- `src/fit/decoder`：封装 @garmin/fitsdk。**Stream 的 isFIT/checkIntegrity 必须在 read() 前调用**（read 消费 stream 后误报 false）
- `src/fit/normalizer`：SDK 结构 → 领域模型（半周→十进制度、Date→Unix 秒）
- `src/fit/calculator`：统计计算（爬升=相邻正增量、平均速度=距离/时长）
- `src/storage`：Dexie 库 `cycling-data`（activities 摘要 / activity_records 逐点分表、files 台账、settings）
- `src/features/*`：业务功能域（import/activity/dashboard/statistics/calendar/settings）
- `src/pages`、`src/charts`、`src/map`：页面与展示组件

**约束**：React 组件禁止直接调用 `@garmin/fitsdk`；UI 只依赖 `src/types/activity.ts` 领域模型与 repository 接口。

### 关键设计决策

- **领域模型是唯一跨层契约**（`src/types/activity.ts`）：单位固定（米/m/s/bpm/rpm/W、Unix 秒、十进制度）；**缺失字段 = undefined ≠ 0**（规格 §25），UI 显示 `—`
- **摘要与逐点分表**：activities 表不存 records；`getById` 返回摘要，`getRecords` 按需加载
- **去重指纹基于解压后内容**（`.fit` 与 `.fit.gz` 同一活动判重一致）
- **Strava 标题还原**：CSV 文件名匹配（`src/features/import/stravaExport.ts`），跨行引号感知
- **SPA 路由**：`main.tsx` basename 生产 `/cycling-analyzer`、dev `/`；`public/404.html` 处理深链接
- **导入在 Web Worker 解析**（jsdom 自动降级主线程），失败进台账可重试
- **双数据源**：`dataSourceStore` 管理「作者的数据（CI 构建的静态快照，只读）/ 我的数据（本地 IndexedDB）」；组件统一经 `useActivityRepository()` 获取当前源的仓库，训练配置经 `getEffectiveProfile(source)` 随源切换；作者源下写操作 UI 一律隐藏

### 测试约定

- Vitest + jsdom；DB 测试用 `fake-indexeddb`（tests/setup.ts 已全局注册）+ 真 Dexie 实例注入
- FIT 样例在 `tests/fixtures/`（Garmin 官方公开样例 + 合成带 GPS 文件，不包含个人真实数据）
- 纯函数优先可测；页面测试用 MemoryRouter；数据加载支持注入
- **`private-fixtures/` 为用户真实骑行数据，gitignored，严禁提交或引用进测试**

## 代码与提交规范

- 注释中文；日志/异常消息英文；`@/` 别名导入；React 组件 `function` 声明
- 提交前缀 `[NF]`/`[BF]`/`[IM]`/`[CU]` + 中文 Subject，**无 AI 署名**
- 提交身份固定 `999bug <999bug@users.noreply.github.com>`（项目级 git config，勿改）
- 改动前先读 `docs/PROGRESS.md` 确认现状，避免与进行中的任务冲突
- **每完成一个功能/阶段必须同步更新 `docs/PROGRESS.md`**（状态与文件清单）再提交代码，保持文档与代码同步
