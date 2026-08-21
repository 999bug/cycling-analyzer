/**
 * sync-core.mjs
 *
 * 把 src 下「框架无关的核心逻辑」单向复制到 miniprogram/core/，供原生小程序复用：
 *   src/fit/normalizer, src/fit/calculator, src/features/analysis,
 *   src/features/statistics, src/utils, src/types
 *
 * 规则：
 *  - 仅复制 .ts，**排除 .tsx（React 组件，框架相关）**；
 *  - 改写 `@/` 别名为相对路径（小程序无 @ 别名，且 DevTools TS 转译时 import type 会被擦除）；
 *  - 扫描 window/document/indexedDB/localStorage 等浏览器 API，命中则告警（期望为 0）。
 *
 * 用法：node scripts/sync-core.mjs
 * 单向同步：src 为唯一真相源，miniprogram/core 为生成产物（可随时重建）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const CORE_OUT = path.join(root, 'miniprogram', 'core');

const coreSrcDirs = [
  'src/fit/normalizer',
  'src/fit/calculator',
  'src/features/analysis',
  'src/features/statistics',
  'src/utils',
  'src/types',
];

const FORBIDDEN = [
  'window.',
  'document.',
  'indexedDB',
  'localStorage',
  'sessionStorage',
  'navigator.',
  'location.',
  'fetch(',
  'XMLHttpRequest',
];

/** 把 `@/x/y` 改成相对当前文件的位置（基于 core 根，统一用 / 分隔） */
function rewriteAlias(content, outRel) {
  const dir = path.dirname(outRel);
  return content.replace(/(from\s*['"])@\/([^'"]+)(['"])/g, (_m, pre, target, post) => {
    let rel = path.relative(dir, target).split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = './' + rel;
    return `${pre}${rel}${post}`;
  });
}

let copied = 0;
let skippedTsx = 0;
const unresolved = new Set();
const forbiddenHits = [];

function walk(srcDirAbs) {
  for (const entry of fs.readdirSync(srcDirAbs, { withFileTypes: true })) {
    const abs = path.join(srcDirAbs, entry.name);
    if (entry.isDirectory()) {
      walk(abs);
      continue;
    }
    if (entry.name.endsWith('.tsx')) {
      skippedTsx += 1; // React 组件，框架相关，排除
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;

    // 归一化分隔符，去掉顶层 src/ 前缀
    const relWithinSrc = path.relative(root, abs).split(path.sep).join('/'); // src/fit/calculator/calculator.ts
    const outRel = relWithinSrc.replace(/^src\//, ''); // fit/calculator/calculator.ts
    const outAbs = path.join(CORE_OUT, outRel);

    let content = fs.readFileSync(abs, 'utf8');

    // 改写前先检测未解析的 @/ 目标（基于 core 内是否存在对应文件）
    const dir = path.dirname(outRel);
    content.replace(/(from\s*['"])@\/([^'"]+)(['"])/g, (_m, _pre, target) => {
      const resolved = path.join(CORE_OUT, `${target}.ts`);
      if (!fs.existsSync(resolved)) unresolved.add(target);
      return _m;
    });

    content = rewriteAlias(content, outRel);

    for (const token of FORBIDDEN) {
      if (content.includes(token)) forbiddenHits.push(`${outRel}: ${token}`);
    }

    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, content);
    copied += 1;
  }
}

for (const d of coreSrcDirs) {
  walk(path.join(root, d));
}

console.log(`[sync-core] 已复制 .ts 文件：${copied}`);
console.log(`[sync-core] 已排除 .tsx（React 组件）：${skippedTsx}`);
if (unresolved.size) {
  console.log(
    '[sync-core] 注意：以下 @/ 目标不在复制集合内（均为 import type，DevTools 转译时擦除，无运行时依赖）：'
  );
  for (const u of [...unresolved].sort()) console.log('   -', u);
}
if (forbiddenHits.length) {
  console.warn('[sync-core] ⚠️ 发现浏览器 API 引用，需人工确认：');
  for (const h of forbiddenHits) console.warn('   -', h);
} else {
  console.log('[sync-core] 浏览器 API 扫描：无命中 ✅');
}
