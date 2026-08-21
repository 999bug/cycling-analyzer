// 数据源切换（复用 web 端 dataSourceStore 概念）。
// author = 包内作者公开快照（只读）；my = 用户本地导入数据（可读写）。
// 组件统一经此获取当前源，避免直接依赖具体仓库实现。

let current = 'author';
const listeners = [];

function getSource() {
  return current;
}

function setSource(next) {
  if (next !== 'author' && next !== 'my') return;
  if (next === current) return;
  current = next;
  listeners.forEach((fn) => fn(current));
}

function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

// 当前源的活动摘要列表（供仪表盘 / 活动列表使用，无需逐点流图）。
function listActivities() {
  if (current === 'my') {
    return require('../repositories/myRepository.js').getActivities();
  }
  return require('../repositories/authorRepository.js').getActivities();
}

module.exports = { getSource, setSource, subscribe, listActivities };
