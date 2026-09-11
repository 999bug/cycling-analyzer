# 开发流程与代码约定（cycling-analyzer）

> 架构分层、命名等长期约定以 `CLAUDE.md` / `AGENTS.md` 为准；这里只记「踩过坑才总结出来」的。

## UI 改动先出原型

涉及布局/交互调整时，先用 show_widget 画原型给用户审批，**批准后才改代码**；
不要「方案一写完就提交」。

## 「完成后自动 reload」必须防再入（2026-09-09 无限刷新事故）

- 凡基于持久化状态决定是否刷新的组件，必须区分「本次刚完成」与「早就完成」（后者静默跳过）；
- 实现前先列 状态×终态 表自查，且每个起点状态都要有测试；
- 自动刷新一律走 `@/utils/navigation reloadPage`（jsdom 可注入），**禁止直接 `window.location.reload()`**；
- 参考实现：`main.tsx` 的 sessionStorage 一次性标记模式。

## 不在 effect 里同步 setState（2026-09-10）

本项目 ESLint 启用了 `react-hooks/set-state-in-effect`，在 effect 体内直接 `setState` 会报 error
（"Calling setState synchronously within an effect can trigger cascading renders"）。
需要「外部状态变化 → 派生界面状态」时，优先把状态写成**纯派生**
（例：侧边栏是否收起 = `sidebarMode === 'auto' && !revealed`，悬停/焦点事件照常维护 revealed），
而不是用 effect 去重置。

## 可折叠侧边栏/面板的裁剪式收起（参照 `AppLayout.css`）

- 外层 `width` 过渡 + 内层固定宽度容器 + 外层 `overflow: hidden`，内容不重排
- 内层用 `flex: 1 0 auto` 撑满，而非 `height: 100%`
- 收起态给内层加 `inert`（React 19 原生支持），让键盘焦点跳过不可见内容
- 异步读取的偏好加 hydrated 标记 + 首帧 `transition: none`，避免启动「先展开再收起」的闪动

## 录屏技能的源码补丁：中断会残留，可污染提交（2026-09-10 真实事故）

`replay-video-record` 技能录制前会临时改 `src/map/TrackReplay.tsx`：把 `SPEED_OPTIONS` 换成单档位
目标倍速、把 `followCursor(latLng)` 注释掉（加 `[replay-video-record]` 标记）。

- **快照还原只在单次进程内有效**（`target.original` = 脚本启动时读的内容）。Ctrl+C 硬杀 / 断电时
  `try/finally` 不执行 → 源码停在补丁态；此时**取到的快照本身就是脏的**，下次还原也脏。
- **曾把补丁提交进 main**：上一轮改 `TrackReplay.tsx` 与技能录制撞在同一个窗口，直接把
  `[1, 8, 32, 600]` 与注释掉的 `followCursor` 提交推送了。症状很隐蔽——本地测试全绿，
  直到次日全量测试报「找不到 128× 按钮」+ lint 报「followCursor 未被使用」才暴露。
- 已加两道防御（脚本内）：① 每次启动先 `undoPatches()` 自愈遗留补丁再取快照（幂等）；
  ② `--restore-only` 跨进程单独清理。**改补丁规则时必须同步补一条 `undo` 反向规则。**
- **CRLF 坑**：源码是 CRLF，而 `\r` 属于正则行终止符（`$` 能匹配在它之前）。`undo` 正则尾部
  必须用 `[^\r\n]*`，写 `[^\n]*` 会把 `\r` 一起吃进替换结果、让该行行尾变成 LF。
  反过来 apply 侧的 `[ \t]*$` 终止于 `\r` 之前，`\r\n` 原样保留，不受影响。
- **提交前自查**（已写进 `git-ops.md`）：`grep -rn "\[replay-video-record\]" src/ tests/` 应为空。
  注意别用 `git diff | grep 技能名` 当口径——**描述这个坑的文档与注释本身就会命中，必定误报**
  （实测过），必须扫「标记本身」而不是技能名。
- 教训推广：凡是「工具临时改源码」的机制，**必须有一条不依赖进程内存的反向还原路径**，
  否则中断即永久残留；而助手在工具可能运行过的窗口里提交代码前，必须先扫一遍工具留下的标记。

## 浏览器内「录制真实页面」的两个硬约束（2026-09-10，v2.58.0 实测）

1. **一个用户手势只能消耗一次**：`getDisplayMedia()` 与 `requestFullscreen()` 都必须在用户手势中调用，
   同一手势里连续调两个，第二个必失败。所以录制舞台**不能用 Fullscreen API**，改用 CSS 固定定位
   （`.map-export-stage` 全屏黑底 + `aspect-ratio` 居中画框），合成时按 `getBoundingClientRect` 裁画框区域。
2. **`getDisplayMedia` 在 headless 里恒为 undefined**（无头模式禁用录屏 API），
   单测里 `canCaptureTab()` 返回 false 是预期，别当成 bug；校验这条链路要有头模式或人工验证。
   同理 `MediaRecorder` + `canvas.captureStream()` 在 jsdom 里也没有，测试要 `Object.defineProperty` 打桩。

配套：录屏成片必须在瓦片加载稳定后开播（轮询 `.leaflet-tile-loaded` 计数连续不变再开），
否则片头是空白底图；`MapContainer` 的 `className` 只在首挂生效，动态挂类要用子组件 `classList.toggle`。

## 地图悬浮控件约定（2026-09-10）

- **地图模式三处共用一份记忆**：`cycling-map-mode`（`src/map/useMapMode.ts`）——详情页回放、热力图页、
  路线图页，以及导出视频的「跟随当前底图」都读同一个键，新增用图页面照此接入。
- 悬浮在地图上的控件（全屏按钮、模式切换）**字色一律写死浅色**，不跟随主题变量：
  深色半透明底在浅色主题下用 `var(--text)` 会变成深字压深底。
- 控件贴地图右下角时，要按控件自身高度抬升 Leaflet 右下角控件（缩放 + 署名）：
  `.leaflet-container .leaflet-control-attribution{margin:0}` 使署名位于最底，故不能只留一条细缝。
  参考 `mapModeSwitcher.css`（静态 56px）与 `ActivityMap.css` 的 `--replay-bar-height`（动态）。

## 加热门路线的标准流程（2026-09-11 用户定：脚本优先，省积分）

1. **先跑 `npm run curate -- --spec <需求单.json> --dry`**（需求单字段见 `scripts/curate-route.mjs` 头部注释）：
   geocode/路网/例外探测/自诊断/数据条目/测试断言/预览全自动，只写 `.tmp/curate/<id>/`。
2. 人工只做两件事：① 来源 A/B/C 定级（需求单里给）② 打开预览审核线形。
3. dry 通过 → 去掉 `--dry` 正式入库 → `tsc -b` + 相关 vitest → 版本号/changelog/PROGRESS → 提交。
4. 只有当 curate 报「无法生成」（OSM 缺路）或比例异常时，才回退到人工探针调试；把新踩的坑回写进脚本规则。
5. 需求单来源必须真实可溯（A 官方/B 权威媒体/C 社区码表），没有来源的里程不许上线（测试把关）。
