# 测试规则（cycling-analyzer）

> 跑法：单文件 `cd F:/<repo> && npx vitest run tests/xxx.test.ts`；全量 `npx vitest run`
> （1300+ 用例，约 1 分钟）。`npm run test` 同全量。

## vitest Windows 小写盘符 bug（2026-09-08 实锤）

- **Git Bash 里跑 vitest 前必须 `cd F:/<repo>`（盘符大写 F）**。cwd 是小写 `f:/...` 会触发 vitest #10692：
  小写盘符加载的 vitest runtime 与 Vite 规范化大写盘符的模块 ID 在 Node ESM 注册表里对不上，
  测试文件拿到第二份未初始化 runtime，所有测试报
  `TypeError: Cannot read properties of undefined (reading 'config')` 或 "Vitest failed to find the current suite"。
- 判别方法：看输出 `RUN v4.x.x X:/path` 的**盘符大小写**——小写必挂，大写必过。
  与 NODE_OPTIONS/环境变量无关（曾误诊为宿主 shim 注入，已纠正）。
- **`npm run check` 同样中招（2026-09-11 实测）**：fast-check.mjs 用当前会话 cwd spawn vitest，
  会话 bash cwd 是小写 `f:` 时 vitest related 照样全挂。所以**会话里跑任何 vitest（含 npm run check）
  之前，先 `cd F:/<repo>` 把 cwd 大写化**；报 config 错先看 RUN 行盘符，别急着查缓存/依赖。
  npx 在本环境还可能拉起 wsl.exe 被安全策略拦截——用
  `"C:/Users/<home>/.workbuddy/binaries/node/versions/<ver>/node.exe" node_modules/vitest/vitest.mjs run ...` 直跑。
- PowerShell 跑 vitest 天然免疫（Set-Location 自动大写盘符），但其 stdout 会被工具吞掉：
  用 `npx vitest run ... *> out.txt` 落盘再读，或直接 bash `cd F:/...` 跑最省事。

## 扫描缓存指纹陷阱（2026-09-10 实测，最坑）

- 热力图页 / 路线图页有**模块级** `trackScanCache` / `routeScanCache`，键是
  `summariesScanKey()` = `数量|总距离|开始时间|hash(名称)|hash(坐标系+微调)` —— **不含活动 ID**。
- 症状：新用例一直停在空态（「还没有可展示的骑行轨迹」），而单独跑（`-t`）却能过。
- 对策：必须让**摘要字段本身**不同 —— 给 `startTime` / `distance` 传不同值
  （测试内 `makeActivity` 加 `overrides: Partial<Activity>` 第三参最方便）。
- 这两页测试的 `beforeEach` 要 `sessionStorage.clear()`，否则瓦片源降级记忆（OSM）会串到下一个用例。

## 时区：测试样例不要用带偏移的绝对时间（2026-09-12 实测踩坑）

- **现象**：本地绿、CI 红（`[NF] 2.74.0` 那次，`ShareStageCard` 的日期文案断言与
  `ShareStudioModal` 的下载文件名断言挂了两个），CI 日志里 diff 显示收到的日期是**前一天**。
- **根因**：样例活动 `startTime: '2026-09-06T07:30:00+08:00'`，`new Date()` 落在 2026-09-05T23:30Z；
  应用按**本地时区**渲染日期 → CI 跑 UTC 就成了 9 月 5 日（本地 +08:00 才是 9 月 6 日）。
- **对策**：测试样例的日期时间**不带时区偏移**（`'2026-09-06T12:00:00'`，按本地时间解析），
  任何时区下都落在同一天；确需固定某一时刻时，断言改用应用自己的格式化函数复算，别硬写日期串。
- **前置自检**：涉及日期/时间/时长的用例，推送前用 `TZ=UTC node node_modules/vitest/vitest.mjs run <文件>`
  跑一遍（本机默认 +08:00，UTC 是 CI 环境，能提前抓到这类跨日问题）。

## 全局 mock

- `tests/setup.ts` 全局 mock 了 `@/map/CachingTileLayer`（避免全量渲染时真实发包）。需要真实实现的测试
  必须自己覆盖回原样：
  `vi.mock('@/map/CachingTileLayer', async (importOriginal) => ({ ...(await importOriginal()) }))`，
  否则报 `No "X" export is defined on the ... mock`。

## 其它

- jest-dom `toHaveValue` 对 `input[type=number]`：空值返回 null 而非 `''`，`toHaveValue('')` 永远失败；
  断言空值改用 `(el as HTMLInputElement).value === ''`。
- `userEvent.type` 遇 `{xx}` 会按按键语法解析，含花括号的输入用 `fireEvent.change`。
- 组件渲染测试用 MemoryRouter；页面数据加载支持注入；mock `getBoundingClientRect` 让 Recharts 正常渲染。
- 需要真实骑行数据做回归时见 `data-docs.md` 的 `npm run check:replay`。
