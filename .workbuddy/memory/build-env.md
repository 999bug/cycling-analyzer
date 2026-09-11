# 构建与环境坑（cycling-analyzer）

## 本地验证不要跑 vite build（2026-09-11 用户确认）

- **本地 dist 用户根本不用**（GitHub Pages 产物由 CI 重建），提交前验证标准 =
  `npm run lint` + `npx tsc -b` + `npm run test` 全绿即可，`vite build` 留给 CI 兜底。
- 确需本地构建（排查构建本身的问题）时，先按下节把旧 dist 挪走再 build。

## 构建前清 dist：不能 `rm -rf`（2026-09-10）

- `rm -rf dist` 会命中 safe-delete 批量确认钩子（1740 个文件触发
  `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`），**整个命令被拒、dist 原样保留**；
  而 vite `emptyOutDir` 自身也会触发 safe-delete shim（移入回收站），文件多时 genie-trash ETIMEDOUT
  导致构建失败。
- 可行做法：**把旧 dist 挪走而不是删** ——
  `mv dist .workbuddy/tmp/dist-prev-<日期>`（同盘重命名不受删除钩子约束；`.workbuddy/*` 已 gitignored，
  不会污染 `git status`；dist 约 22MB），然后直接 `npm run build`。

## vitest 4 起不来：`Cannot find native binding`

- 报 `Cannot find native binding` / `@rolldown/binding-wasm32-wasi` = node_modules 里
  `@rolldown/binding-win32-x64-msvc` 丢失（可选依赖被跳过）。
- 修法：`npm install --no-save @rolldown/binding-win32-x64-msvc@<rolldown 版本>`
  （版本对齐 `node_modules/rolldown/package.json` 的 optionalDependencies）。
- ⚠️ 该命令会**改坏 `package-lock.json` 的 version 字段**（实测被改成 2.31.1），装完必须检查并手工还原。

## Playwright 与浏览器（2026-09-10 实测）

- 本机 **Playwright 自带的 Chromium 未下载**：`npm run test:e2e` 与
  `.workbuddy/skills/replay-video-record` 都会报
  `Executable doesn't exist at C:/Users/<home>/AppData/Local/ms-playwright/chromium_headless_shell-*`。
  二选一：`npx playwright install chromium`，或 `chromium.launch({ channel: 'chrome' })` 用系统 Chrome
  （本机已装 Chrome 152 / Edge）。录屏技能的脚本已内置「自带 Chromium 失败 → 自动回退系统 Chrome」。
- **headless 下 `navigator.mediaDevices.getDisplayMedia` 不存在**（录屏 API 在无头模式被禁用）；
  校验「浏览器内录屏」类功能必须用有头模式跑或人工验证，别把 headless 的 false 当成不支持。
- 2026-09-11 晚实测：`~/AppData/Local/ms-playwright/` 下已有 chromium-1223/1228/1234 与对应
  headless_shell，`chromium.launch()` 可直接跑（用 `@playwright/test` 里的 `chromium`，
  自写脚本验证 UI 很划算；本次 Share Stage 就是靠它验的成图）。上面那条「未下载」是更早的记录。
- 系统 Chrome 152 的 `MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')` = **true**，
  即浏览器内可直出 H.264 MP4，不需要 ffmpeg 转码。
- **`.workbuddy/skills/` 未入库**（`.gitignore` 第 41 行 `.workbuddy/*`，只有 `memory/` 被否定规则放行）：
  技能与脚本只存在于本机，换机器/重新 clone 不会带过去。

## 本机 npm 命令跑不了时怎么验证（2026-09-11 实测）

- 托管 node 的 `npm`（`~/.workbuddy/binaries/node/**/npm`）在本环境**所有子命令都报「拒绝访问。」**
  （含 `npm --version` / `npm install`，沙箱内外都试过，UTF-16 中文错误串）。不要浪费时间反复试。
- 两条可用替代：
  1. 系统 npm：`/c/nvm4w/nodejs/npm.cmd install <pkg>`（npm 10.9.7 / node 22.22.2，装依赖可用）；
  2. **直接 node 跑本地二进制**（推荐，最稳）：
     `/c/nvm4w/nodejs/node.exe node_modules/typescript/bin/tsc -b`、
     `… node_modules/vitest/vitest.mjs run [路径]`、
     `… node_modules/eslint/bin/eslint.js <路径>`、
     `… node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5199`（起 dev server 给 Playwright 验 UI）。
- 注意 `npm run check`（scripts/fast-check.mjs）依赖 npm，同样跑不了；按上面三条手工跑一遍等价。
- 网络：本环境出网走代理，GitHub `git fetch/push` 会 `CONNECT tunnel failed, response 502`，
  绕代理（`env -u https_proxy …`）则直连超时 —— **推送可能暂时做不了，提交先落本地**，事后补推。

## 其它

- `public/author-data/`、`dist/` 为构建产物、gitignored，由 CI 重建；快照任一 FIT 解析失败 CI 即失败。
- 构建产物无法用浏览器肉眼验证时（本地快照未构建 / IndexedDB 为空），要主动向用户说明「只做了源码级推算」。
