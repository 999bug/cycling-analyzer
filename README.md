# 骑行数据（Cycling Analyzer）

![GitHub Actions](https://github.com/999bug/cycling-analyzer/actions/workflows/deploy.yml/badge.svg)
![Release](https://img.shields.io/github/v/release/999bug/cycling-analyzer)

一个纯前端、个人使用、数据完全本地化的骑行数据分析网站（**Strava Lite**）。

将 Garmin / Wahoo / COROS 等设备产生的 `.fit` 骑行文件导入浏览器，在本地完成 FIT 解析、数据统计、轨迹展示、骑行记录管理和历史趋势分析。所有数据只保存在浏览器本地（IndexedDB），不上传任何服务器。

**在线地址**：https://999bug.github.io/cycling-analyzer/

## 主要功能

### 数据导入
- 三种导入方式：选择目录（File System Access API）/ 文件上传 / 拖拽
- 支持 Strava 批量导出（`.fit.gz` 自动解压），还原活动原标题
- SHA-256 指纹去重，重复文件自动跳过
- Web Worker 后台解析，不阻塞页面；失败文件记录原因可重试

### 骑行数据
- **仪表盘**：本周/本月/总计统计（次数/距离/时长/爬升）+ 30/90/365 天距离趋势
- **骑行记录**：排序 / 搜索 / 月份与类型筛选 / 高级数值筛选（距离/爬升/功率）/ 分页
- **活动详情**：Leaflet 轨迹地图（轨迹抽稀 + 起点终点标记）、速度/心率/海拔/功率/踏频图、速度+心率组合图、训练区间分布
- **统计页**：10 项指标（总距离/最长骑行/最快速度/最高功率等）+ 6 种时间范围
- **骑行日历**：GitHub 风格热力图，按骑行距离分 5 档着色，hover 查看详情
- **轨迹着色**：地图轨迹按速度/心率/功率/海拔分段着色

### 训练分析
- 标准化功率（NP）、强度因子（IF）、训练压力（TSS）
- 心率区间 / 功率区间（5 区间分布），基于用户配置的 FTP 与最大心率

### 数据管理
- IndexedDB 本地持久化，刷新不丢失
- JSON 数据导出 / 导入备份（迁移到其他电脑）
- 删除单条记录 / 清空全部数据（二次确认）

## 技术栈

React 19 · TypeScript · Vite · React Router · Zustand · Dexie (IndexedDB) · Leaflet · Recharts · @garmin/fitsdk · Vitest · GitHub Actions

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
# 单文件测试
npx vitest run tests/fit/decoder.test.ts
```

## 部署

推送 main 分支自动触发 GitHub Actions：lint → test → build → 部署到 GitHub Pages。

## FIT 解析说明

使用 Garmin 官方 FIT JavaScript SDK（`@garmin/fitsdk`）解析，不自行实现二进制协议。解析链路：FIT 完整性校验（CRC）→ 解码 → 标准化领域模型 → 统计计算。非 FIT 文件、损坏文件、缺失数据字段均有明确处理（缺失字段显示 `—` 而非 0）。

## 数据隐私说明

- 所有骑行数据只保存在用户自己的浏览器本地（IndexedDB），**不上传任何服务器**
- 原始 FIT 文件不上传，可随时导出备份
- 地图服务使用 OpenStreetMap 公开瓦片，仅加载地图数据，不发送用户骑行数据
- 无账号、无登录、无后端

## 浏览器兼容性

- **Chrome / Edge**（优先支持）：支持目录选择导入
- **Safari / Firefox**：可通过文件上传 / 拖拽方式导入 FIT

## 项目文档

- [功能状态与开发进度](docs/PROGRESS.md)（已实现/未实现清单、架构接口）
- [产品规格说明](docs/个人骑行数据分析网站——Agent%20开发规格说明.md)

## 开源协议

本项目为个人开源项目，仅供学习与个人使用。
