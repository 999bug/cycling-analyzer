---
name: replay-video-record
description: 把骑行活动的「在线回放」录成 1080×1920 竖屏短视频（MP4，带字幕），用于小红书/抖音发布。触发词：生成回放视频、把这条骑行录成视频、做轨迹小视频、录个回放、做视频笔记。
agent_created: true
---

# 骑行回放短视频录制

把「活动详情页 → 在线回放」的**真实页面录屏**做成 1080×1920 竖屏 MP4。

与项目内置的「生成竖屏视频」按钮不是一回事——那个跑在浏览器里、由 canvas 自绘（把真实高德瓦片抓下来
拼成静态底图，再自己画轨迹/光标/字幕），因此**永远画不出真实地图控件、回放操作栏与真实 Leaflet 渲染**，
观感偏"示意图"。本技能录的是**真实页面**（真实 Leaflet 地图 + 真实控件 + 假光标），成片观感与内置按钮
明显不同，用户要的就是这个观感。

## 何时使用

用户要某条骑行记录的**回放视频**时。典型请求：「把戒台寺那条录成视频」「生成 XX 的回放小视频」
「做个能发小红书的轨迹视频」。

## 前置条件

- 本地 dev server 已启动：`npm run dev`（默认 `http://localhost:5173`，端口可用 `--base` 覆盖）
- 依赖已就绪：Playwright（项目 devDependencies 已含）+ ffmpeg
  - **ffmpeg 已随仓库分发**：devDependency `ffmpeg-static`（`npm install` 时自动下载二进制），
    `render-video.mjs` 会自动解析（`--ffmpeg` 显式指定 > 系统 PATH > ffmpeg-static），并探测
    libx264 + libass（成片硬依赖，缺了会报错退出）。国内网络下 npm 装不上时用镜像重试：
    `FFMPEG_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static npm install -D ffmpeg-static`
  - **自带 Chromium 需要先 `npx playwright install chromium`**（录屏封装 webm 还需要
    `npx playwright install ffmpeg`）；这台机器通常**没装**（报
    `Executable doesn't exist at ...ms-playwright/chromium_headless_shell-*`），此时脚本会自动回退
    系统 Chrome（本机已装），也可显式 `--channel chrome` / `--channel msedge`
  - 本机若另有一份捆绑构建的 ffmpeg（本机路径登记在 `memory/LOCAL-ONLY.md`，不入库），可作为
    ffmpeg-static 之外的备用，用 `--ffmpeg <路径>` 指定
- 目标活动在页面上可见（作者快照 `public/author-data/` 或用户已导入本地数据）

## 用法

```bash
# 1) 先查活动 ID（作者快照里就是 id 字段）
node -e "const a=require('./public/author-data/activities.json');a.sort((x,y)=>x.startTime.localeCompare(y.startTime)).slice(0,10).forEach(x=>console.log(x.id, (x.distance/1000).toFixed(1)+'km', x.name))"

# 2) 录屏（脚本会临时改 TrackReplay.tsx，结束自动还原）
node .workbuddy/skills/replay-video-record/scripts/record-replay.mjs \
  --activity <活动id> --speed 1024 --mode 卫星

# 3) 合成（裁剪 + 字幕 + H.264，输出到 .workbuddy/exports/）
node .workbuddy/skills/replay-video-record/scripts/render-video.mjs --take <上一步的 take 目录>
```

### record-replay.mjs 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--activity` | 必填 | 活动 ID（文件内容指纹） |
| `--speed` | `1024` | 回放倍速。**按运动时长反推**：目标秒数 ≈ 运动时长 ÷ 倍速。⚠️ 运动时长 = 回放时间轴长度（`buildMovingTimeline` 已折叠暂停段），**不是**记录首尾时间戳跨度（elapsed）——按 elapsed 反推会录短、成片被拉成慢动作 |
| `--mode` | 空（正常） | `正常` / `卫星` / `卫星+路网` |
| `--base` | `http://localhost:5173` | dev server 地址 |
| `--out` | `.workbuddy/exports` | 输出根目录（每次录制建独立 take-时间戳 子目录） |
| `--attempts` | `3` | 开播前瓦片体检不通过时换新 context 重录的最大次数（见关键坑 9） |
| `--hold` | `3000` | 回放结束后的静止帧毫秒数，便于剪辑 |
| `--channel` | 空（自动） | 浏览器通道（`chrome`/`msedge`）。留空时先用自带 Chromium，失败自动回退系统 Chrome |
| `--headed` | 关 | 带界面运行。headless 下全屏行为异常时改用它排查 |
| `--restore-only` | 关 | **只清理遗留补丁、不录制**。脚本被 Ctrl+C / 崩溃打断后用它把 `TrackReplay.tsx` 还原干净 |

### render-video.mjs 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--take` | 必填 | take 目录（含 `marks.json`） |
| `--ffmpeg` | 自动解析 | ffmpeg 路径。默认顺序：显式指定 → 系统 PATH → `ffmpeg-static`（npm 依赖），自动探测 libx264 + libass |
| `--duration` | `34` | 目标成片秒数 |
| `--hook` | 内置 | 开头大字钩子（两行用 `\N` 分隔） |
| `--info` | 内置 | 全程底部信息行 |

## 关键坑（都实测踩过，改脚本前先看）

1. **`recordVideo.size` 必须等于 viewport 的 CSS 像素，且 `deviceScaleFactor` 必须为 1**。
   dsf=2 或 videoSize > viewport 时，画面只占视频画布左上角一块、其余全是灰边。
2. **headless 下 Fullscreen API 按「屏幕尺寸」渲染，不是视口尺寸**。不声明 screen 时全屏地图只渲染成
   一小块。必须用 CDP 显式声明，且与视频同尺寸：
   `Emulation.setDeviceMetricsOverride({width,height,deviceScaleFactor:1,mobile:true,screenWidth,screenHeight,screenOrientation})`。
3. **全屏后必须派发 `window.dispatchEvent(new Event('resize'))`**：全屏是 CSS 尺寸突变，
   Leaflet 不会自动重算容器尺寸，不派发就会看到地图只占容器一角。项目 2.56.0 起
   `ActivityMap` 的 `FitBounds` 已原生监听 `resize` 重新 `fitBounds`，所以派发 resize 之后
   视野也会跟着重算（**脚本不再为此打补丁**，见下方「已知限制」）。
4. **`followCursor` 是录制杀手**：它第一次跟随就把地图 `setView(..., FOLLOW_ZOOM)` 缩到街道级，
   整条轨迹看不出全貌；高速回放下镜头疯狂平移、瓦片永远追不上 → **画面全黑**。
   必须临时禁用它（脚本已自动处理）。
5. **禁跟随后视野固定，瓦片只加载一次**，等 `.leaflet-tile-loaded` 数量稳定（1080×1920 约 40 张）
   再开播，否则前几秒是空白。
6. **底图切到卫星曾撞上项目 bug**（本地矢量瓦片预缓存不区分底图模式，卫星请求错拿路网瓦片）。
   该 bug 已于 **2.56.0 修复**（`CachingTileLayer.allowLocalTile` 仅 `normal` 模式开放本地预缓存），
   因此 `--mode 卫星` 时不会再有 `/author-data/tiles/**` 请求。脚本里的拦截仍**保留作回归保险**，
   通常不会命中；若将来该 bug 回归，这段代理会自动兜住。
   注意 `route.continue({url})` **不允许跨协议改写**（本地 http → 高德 https 会报
   "New URL must have same protocol"），必须用 `route.fetch()` + `route.fulfill()`。
7. **`fs.rmSync(目录)` 会触发 safe-delete shim（genie-trash ETIMEDOUT）**，同 `rm -rf dist` 的坑。
   所以每次都建独立的 take 目录，**从不删除**。
8. **瓦片是 Blob URL**（项目有 `CachingTileLayer` 缓存层），想按域名统计瓦片来源会全部落空，
   要判断底图是否加载正确，直接截图看。
9. **黑瓦片（间歇性，最恶心的坑）**：偶发约 10/40 块瓦片纯黑（深色页面背景透出）。实测特征：
   网络层**零失败请求**（`requestfailed` 为 0），坏瓦片的 `<img>` `src` 是**空串**（既不是 blob 也不是 url）——
   应用层 `fetch → blob` 链路间歇性地对个别瓦片永不完成，而 Leaflet 出错/无 src 后**永久放弃、绝不重试**，
   resize / 切底图重建图层都救不回来。没有可靠的主动修复手段，所以脚本的做法是
   **「充分等待 → 体检（统计 `naturalWidth === 0` 的瓦片，同时覆盖请求失败与空 src 两种坏法）→
   不通过就丢弃该 context、换全新 context 重录」**（`--attempts`，默认 3；废片落在 `raw/` 子目录，不删）。
   实测同一活动多数次数 40/40 全好，偶发 10 块坏——重跑一次通常就好。**体检必须等瓦片稳定后做**，
   且**不要**试图给 fetch 加超时兜底（实测无效，根因不在超时）。
10. **Playwright webm 的 SAR 不是 1:1**（实测 26:27），直接转 H.264 显示宽度会被压成 1040。
    render-video.mjs 的滤镜链已带 `setsar=1`，改滤镜链时别弄丢。

## 已知限制

- 只临时改 `src/map/TrackReplay.tsx` **一处文件两处规则**（倍速档位、禁用跟随镜头）。脚本用
  try/finally 保证还原，结束后会用 `git diff --stat` 校验。**录制期间不要同时编辑该文件**，
  也不要与并行会话同时录制。
- **⚠️ 补丁残留会污染仓库（已真实发生过一次）**：try/finally 只覆盖「进程正常退出或抛错」，
  Ctrl+C 硬杀 / 断电时不执行，源码就停在补丁态；此时**任何会话若在这个窗口里提交代码，
  会把补丁一并提交**——曾把临时倍速 `[1, 8, 32, 600]` 与注释掉的 `followCursor` 提进 main。
  两道防御：① 脚本每次启动先 `undoPatches()` 自愈遗留补丁再取快照，故补丁应用是幂等的；
  ② `--restore-only` 可跨进程单独清理。**提交前自查口径**：
  `grep -rn "\[replay-video-record\]" src/ tests/` 应为空（扫标记本身；别扫技能名——文档与注释里
  描述这个坑的文字会命中，必定误报），且 `SPEED_OPTIONS` 保持 5 档 `[1, 8, 32, 64, 128]`。
- 快照还原（写回 `target.original`）**只在单次进程内有效**——它是脚本启动时读的内容，所以跨进程
  清理一律走 `undo` 反向规则。**改补丁规则时必须同步补一条 `undo` 规则**，否则中断后无法自愈。
  另注意本仓库源码是 CRLF：`undo` 正则尾部要写 `[^\r\n]*`（`\r` 属于正则行终止符，`[^\n]*` 会把
  它一起吃掉导致还原后该行变成 LF）；apply 侧的 `[ \t]*$` 不受影响（终止于 `\r` 之前）。
- 补丁规则**未命中即抛错**（fail-fast，避免"静默没改到"录出废片）。所以项目改了 TrackReplay
  的 `SPEED_OPTIONS` 或 `followCursor` 写法后，要同步更新脚本里的正则。
  ⚠️ 历史上曾在此打 `ActivityMap.tsx` 的补丁（全屏后重新适配视野），该项目 2.56.0 已原生实现，
  规则已删除——**不要加回来**，否则每次录制都会在开录前直接失败。
- 录屏输出的中间文件是 **webm(vp8)**，必须经 `render-video.mjs` 转 H.264 才能在平台正常播放。
- 依赖 headless 浏览器的 Fullscreen 行为，Playwright 大版本升级后建议先跑一次小验证。

## 配套封面（小红书 / 抖音 3:4）

小红书视频笔记的封面在信息流里按 **3:4** 展示，所以封面做成 **1080×1440**。

```bash
# 1) 从原始 webm 抽一帧、裁成 3:4 底图
#    注意：全屏录屏右侧有约 40px 灰边（地图容器比视口窄），必须 crop 掉
#    时间点选「轨迹点亮大半、橙蓝都有」的那一帧，全橙/全蓝都不如中间态抓眼
ffmpeg -ss 52 -i <take目录>/replay-*.webm -frames:v 1 \
  -vf "crop=1040:1387:0:280,scale=1080:1440" -y cover/base.png

# 2) 写 cover.ass（PlayResX=1080 / PlayResY=1440），再用 -loop 1 把字烧上去
ffmpeg -loop 1 -t 1 -i cover/base.png -vf "ass=cover.ass" -frames:v 1 -y "小红书封面-3x4.png"
```

封面文字要点：
- 主标题字号要 **110px 以上**（信息流里封面只有 200~300px 宽，字小了看不清）
- 必须用**粗描边**（ASS `Outline` 8~9）或加深色底框，否则压在卫星影像上读不出来
- 结构：小字说事（`210 公里骑行轨迹回放`）→ 大字抓人（`别人要会员` / `我的免费`）→ 底部数据（`爬升 2818 m · 运动 9 小时 57 分`）
- 中文一律 `Microsoft YaHei`，金色用 ASS 的 `&H0000E5FF`（BGR 写法）

## 产物

- `.workbuddy/exports/take-<时间戳>/replay-<id前8位>.webm` — 原始录屏（含操作段）
- `.workbuddy/exports/take-<时间戳>/marks.json` — 各关键动作时间戳（裁剪依据）
- `.workbuddy/exports/<活动名>-竖屏.mp4` — 最终成片（1080×1920，H.264）
