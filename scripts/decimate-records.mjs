/**
 * decimate-records.mjs
 *
 * 把 public/author-data/records 的「125MB 逐点数据」抽稀后打入小程序分包
 * （miniprogram/subpackages/author-detail/records），供作者活动「完整流图」离线展示。
 *
 * 规则：
 *  - 每条活动按目标点数等间隔抽样（保留首尾），仅保留核心流字段；
 *  - 自适应：若分包总体积 > 1.8MB（上限 2MB），自动减半目标点数重抽，直到达标；
 *  - 输出 <hash>.js（module.exports = { activityId, records }），并生成 index.js 清单。
 *
 * 用法：node scripts/decimate-records.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'public', 'author-data', 'records');
const OUT = path.join(root, 'miniprogram', 'subpackages', 'author-detail', 'records');

// 抽稀后保留的核心流字段（源缺字段自动跳过）
const KEEP = [
  'timestamp',
  'distance',
  'altitude',
  'heartRate',
  'speed',
  'latitude',
  'longitude',
  'power',
  'cadence',
  'temperature',
];

const SUBPACKAGE_LIMIT = 1.8 * 1024 * 1024; // 1.8MB 安全线

function pickEssentials(point) {
  const out = {};
  for (const k of KEEP) {
    if (point[k] !== undefined && point[k] !== null) out[k] = point[k];
  }
  return out;
}

function decimate(points, targetPoints) {
  if (points.length <= targetPoints) return points.map(pickEssentials);
  const step = Math.max(1, Math.floor(points.length / targetPoints));
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(pickEssentials(points[i]));
  // 保证末尾点也在（轨迹终点）
  const last = points[points.length - 1];
  if (out[out.length - 1] !== pickEssentials(last)) out.push(pickEssentials(last));
  return out;
}

function dirSize(dir) {
  let total = 0;
  for (const f of fs.readdirSync(dir)) total += fs.statSync(path.join(dir, f)).size;
  return total;
}

function build(targetPoints) {
  fs.mkdirSync(OUT, { recursive: true });
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.json'));
  const ids = [];
  for (const f of files) {
    const hash = f.replace(/\.json$/, '');
    const raw = fs.readFileSync(path.join(SRC, f), 'utf8');
    const { activityId, records } = JSON.parse(raw);
    const slim = decimate(records, targetPoints);
    fs.writeFileSync(
      path.join(OUT, `${hash}.js`),
      `module.exports = ${JSON.stringify({ activityId, records: slim })};\n`
    );
    ids.push(hash);
  }
  const indexBody =
    ids.map((h) => `const _${h} = require('./${h}.js');`).join('\n') +
    `\nmodule.exports = { ${ids.map((h) => `'${h}': _${h}`).join(', ')} };\n`;
  fs.writeFileSync(path.join(OUT, 'index.js'), indexBody);
  return { count: ids.length, size: dirSize(OUT) };
}

let targetPoints = 160;
let result = build(targetPoints);
while (result.size > SUBPACKAGE_LIMIT && targetPoints > 20) {
  targetPoints = Math.floor(targetPoints / 2);
  console.log(
    `[decimate] 体积 ${(result.size / 1024 / 1024).toFixed(2)}MB 超 1.8MB，目标点数降至 ${targetPoints} 重抽…`
  );
  result = build(targetPoints);
}

console.log(`[decimate] 活动数：${result.count}`);
console.log(`[decimate] 目标点数：${targetPoints}`);
console.log(
  `[decimate] 分包体积：${(result.size / 1024 / 1024).toFixed(2)}MB（上限 2MB） ${
    result.size <= 2 * 1024 * 1024 ? '✅' : '❌ 超限'
  }`
);
