# README 界面截图（docs/screenshots/骑了么/）生成流程

> 什么时候读：需要重拍或新增 README 界面预览图时。
> 工具：`scripts/capture-screenshots.mjs`（本地工具，不进 CI）。

## 一句话流程

```bash
# 源可选：本地 dev（默认 http://localhost:5173）或线上发布版
node scripts/capture-screenshots.mjs                                   # 本地 dev
node scripts/capture-screenshots.mjs --base https://<站点>/<子路径>      # 线上
node scripts/capture-screenshots.mjs --only 15-分享素材                 # 单张重拍（按文件名前缀）
```

产物落在 `docs/screenshots/骑了么/`，**21 张编号命名**（`1-首页.png` … `21-更多设置页.png`），
README「界面预览」章节按同一编号引用，改文件名必须同步改 README。

## 页面清单与交互

- 步骤表 `STEPS` 在脚本顶部：`path`（'detail' = 作者快照最近一次活动）/ `nav`（站内导航点击）/
  `title`（h1 断言）/ `ready`（信号选择器）/ `scroll` / `click` / `hover` / `tiles` / `settle`
- 详情页五张（地图 / 分段 / 训练区间 / 活动对比 / 在线回放）走 `path: 'detail'`
- 弹窗类（导入 / 竖屏视频 / 分享素材）靠 `click` 文字找按钮
- AI 解读那张需要注入一份**假 Key 的演示配置**（`DEMO_AI_CONFIG`）：未配置供应商时全部 AI 入口
  不渲染，拍不到「✦ AI 解读」药丸；注入只发生在独立 context，不写入仓库

## 本环境已知坑（都已在脚本里规避，改脚本时别退回去）

1. **`locator.waitFor()` 会挂**：元素 `count() > 0` 却一直不返回 → 一律用计数轮询
   （`waitForSelector`）。`scrollIntoViewIfNeeded()` 同理 → 用 `evaluate` 里的 `scrollIntoView`。
2. **`npm run dev` / `npm run check` 在本沙箱被拦**（黑名单程序 wsl.exe）→ 直接用 node 跑
   `node_modules/vite/bin/vite.js` 与 `node_modules/vitest/vitest.mjs`（见 `build-env.md`）。
3. **本地 dev 首进重页面要现场编译**（十几秒）→ 本地源才预热、`ready` 选择器给足 60s；
   线上源**不要预热**（构建产物无需编译，预热反而触发 SPA 内部跳转打断导航）。
4. **页导航**：GitHub Pages 深链要先经 `404.html` 还原再跳 `?/path`，一次 goto 期间有二次跳转 →
   用 `waitUntil: 'commit'` + 容错重试；能点侧边栏就用 `nav`（走 React Router，最稳）。
5. **`/routes-map` 等路径曾因 App.tsx 路由索引错位渲染成别的页**（2026-09-14 记录，线上同样错位）：
   脚本里那三条用 `path: '/segments/routes-map'` 之类的等价路径绕行，并在步骤表上方写了注释——
   **App.tsx 索引修好后应改回 `nav: '路线图'` / `nav: '训练计划'` / `nav: '表现趋势'`**。
   每步都带 `title` 断言，拍错页会直接报错而不是静默留下错图。
6. **dev 下热力图 / 路线图会拖死渲染线程**：共用同一个 page 时后续页面连 h1 都出不来 →
   每张截图独立 context（脚本已如此）。
7. 地图页必须等瓦片稳定（`tiles: true`，轮询 `.leaflet-tile-loaded` 计数连续两次不变），
   否则成片是空底图；等待期间可能撞上导航，`evaluate` 要 try/catch 重试。

## 版本一致性

线上源截图会把侧边栏底部版本号一起拍进去，**跨多次发布重拍会出现同一套图里版本号不一致**。
要发版级整洁的图，就在一次发布收敛后整套重拍（`--base` 指线上，约 5 分钟）。
