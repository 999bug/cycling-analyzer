/**
 * sync-fitsdk.mjs
 *
 * 把 node_modules/@garmin/fitsdk（ESM，纯 JS）转成小程序可用的 CommonJS，
 * 复制到 miniprogram/vendor/fitsdk/。
 *
 * 原因：
 *  - 小程序原生不支持 ESM 的 import/export；
 *  - 该包是纯 JS（无 .wasm），可在 Worker 内运行，风险远低于「WASM 适配」；
 *  - 仅依赖标准 DataView / TypedArray，外加一个 TextDecoder（小程序运行时缺失，
 *    由 Worker 入口 polyfill，见 workers/fitParser.js）。
 *
 * 转换规则（已适配本包实际导出风格）：
 *  - import 默认 / 命名 → const = require(...)
 *  - export default X / export default {…} → module.exports = X
 *  - export { A, B } → module.exports = { A, B }
 *
 * 用法：node scripts/sync-fitsdk.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'node_modules', '@garmin', 'fitsdk', 'src');
const OUT = path.join(root, 'miniprogram', 'vendor', 'fitsdk');

function transform(code) {
  let out = code;

  // import Def, { A, B } from "./x.js"
  out = out.replace(
    /import\s+([A-Za-z0-9_$]+)\s*,\s*\{([^}]*)\}\s+from\s+["']([^"']+)["']/g,
    (_m, def, named, p) =>
      `const ${def} = require("${p}");\nconst { ${named} } = require("${p}");`
  );
  // import { A, B } from "./x.js"
  out = out.replace(
    /import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["']/g,
    (_m, named, p) => `const { ${named} } = require("${p}");`
  );
  // import Def from "./x.js"
  out = out.replace(
    /import\s+([A-Za-z0-9_$]+)\s+from\s+["']([^"']+)["']/g,
    (_m, def, p) => `const ${def} = require("${p}");`
  );
  // export { A, B }
  out = out.replace(
    /export\s+\{\s*([^}]+?)\s*\}\s*;/g,
    (_m, names) => `module.exports = { ${names} };`
  );
  // export default X  /  export default {…}
  out = out.replace(/export\s+default\s+/g, 'module.exports = ');

  // 路径归一化：源码个别引用写成 ../src/x.js 或 ../x.js，扁平化后统一为 ./
  out = out.replace(/\.\.\/src\//g, './');
  out = out.replace(/\.\.\//g, './');

  return out;
}

function build() {
  // 注意：不调用 fs.rmSync（会被沙箱安全删除拦截超时）。文件集合固定，直接覆盖写入即可。
  fs.mkdirSync(OUT, { recursive: true });
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js'));
  let count = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    const cjs = transform(src);
    fs.writeFileSync(path.join(OUT, f), cjs);
    count++;
  }
  console.log(`[sync-fitsdk] 转换 ${count} 个文件 → miniprogram/vendor/fitsdk/`);
}

build();
