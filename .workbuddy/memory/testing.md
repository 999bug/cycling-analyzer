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
- PowerShell 跑 vitest 天然免疫（Set-Location 自动大写盘符），但其 stdout 会被工具吞掉：
  用 `npx vitest run ... *> out.txt` 落盘再读，或直接 bash `cd F:/...` 跑最省事。

## 扫描缓存指纹陷阱（2026-09-10 实测，最坑）

- 热力图页 / 路线图页有**模块级** `trackScanCache` / `routeScanCache`，键是
  `summariesScanKey()` = `数量|总距离|开始时间|hash(名称)|hash(坐标系+微调)` —— **不含活动 ID**。
- 症状：新用例一直停在空态（「还没有可展示的骑行轨迹」），而单独跑（`-t`）却能过。
- 对策：必须让**摘要字段本身**不同 —— 给 `startTime` / `distance` 传不同值
  （测试内 `makeActivity` 加 `overrides: Partial<Activity>` 第三参最方便）。
- 这两页测试的 `beforeEach` 要 `sessionStorage.clear()`，否则瓦片源降级记忆（OSM）会串到下一个用例。

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
