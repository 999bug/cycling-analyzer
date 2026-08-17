# 骑行数据（Cycling Analyzer）

一个纯前端、个人使用、数据完全本地化的骑行数据分析网站（Strava Lite）。

将 Garmin / Wahoo / COROS 等设备产生的 `.fit` 骑行文件导入浏览器，在本地完成 FIT 解析、数据统计、轨迹展示、骑行记录管理和历史趋势分析。所有数据只保存在浏览器本地（IndexedDB），不上传任何服务器，最终部署到 GitHub Pages。

## 当前进度

- [x] Phase 1：项目初始化（Vite + React + TypeScript + ESLint + Prettier + Vitest、基础路由与布局骨架）
- [ ] Phase 2：FIT Parser
- [ ] Phase 3：IndexedDB
- [ ] Phase 4：Import
- [ ] Phase 5：Activity List
- [ ] Phase 6：Activity Detail
- [ ] Phase 7：Dashboard
- [ ] Phase 8：GitHub Pages

## 技术栈

React 19 · TypeScript · Vite · React Router · Vitest · ESLint · Prettier

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 测试

```bash
npm run test
```

## 数据隐私说明

所有骑行数据默认只保存在用户自己的浏览器本地（IndexedDB），不会上传到任何服务器。地图服务使用 OpenStreetMap 等公开地图瓦片，仅加载地图数据，不发送用户骑行数据。

## 浏览器兼容性

Chrome / Edge 为优先支持目标（支持目录选择导入）；其他浏览器可通过文件上传方式导入 FIT。
