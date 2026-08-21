/**
 * sync-author-data.mjs
 *
 * 把 public/author-data 的「347KB 摘要/预聚合层」打成小程序可 `require` 的 JS 模块，
 * 直接进主包、离线即用（零域名方案的核心数据来源）。
 *
 * 转换规则：`<name>.json` → `<name>.js`，内容包成 `module.exports = <rawJson>;`
 * （保留原始紧凑格式，避免 JSON.stringify 展开体积）。最后生成 `index.js` 清单。
 *
 * 用法：node scripts/sync-author-data.mjs
 * 单向同步：public/author-data 为唯一真相源，输出写入 miniprogram/data/author/。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'public', 'author-data');
const OUT = path.join(root, 'miniprogram', 'data', 'author');

// 顶层摘要/清单/档案
const topFiles = ['activities.json', 'manifest.json', 'profile.json'];
// 预聚合层
const precomputed = ['tracks.json', 'power-records.json', 'route-groups.json'];

/** 文件名 → 合法 JS 标识符（去掉扩展名、连字符转下划线） */
function toVarName(base) {
  return base.replace(/\.json$/, '').replace(/-/g, '_');
}

function emit(rawRel, varName) {
  const abs = path.join(SRC, rawRel);
  const raw = fs.readFileSync(abs, 'utf8');
  JSON.parse(raw); // fail-fast：JSON 非法直接抛错
  const outPath = path.join(OUT, `${varName}.js`);
  fs.writeFileSync(outPath, `module.exports = ${raw};\n`);
}

fs.mkdirSync(OUT, { recursive: true });

const exported = [];
for (const f of topFiles) {
  const name = toVarName(f);
  emit(f, name);
  exported.push(name);
}
for (const f of precomputed) {
  const name = toVarName(f);
  emit(path.join('precomputed', f), name);
  exported.push(name);
}

// index.js 清单
const requires = exported.map((n) => `const ${n} = require('./${n}.js');`).join('\n');
const indexBody = `${requires}\n\nmodule.exports = {\n${exported
  .map((n) => `  ${n},`)
  .join('\n')}\n};\n`;
fs.writeFileSync(path.join(OUT, 'index.js'), indexBody);

// 统计体积
let total = 0;
for (const f of fs.readdirSync(OUT)) {
  total += fs.statSync(path.join(OUT, f)).size;
}

console.log('[sync-author-data] 已生成模块：', exported.join(', '));
console.log(`[sync-author-data] 输出目录：${OUT}`);
console.log(`[sync-author-data] 主包数据体积：${(total / 1024).toFixed(1)} KB（上限 2MB）`);
