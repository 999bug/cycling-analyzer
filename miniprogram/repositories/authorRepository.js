// 作者公开数据仓储：读取包内预置快照（离线、只读）。
// 仅暴露摘要列表（主包可见）；逐点流图由分包内的详情页直接读取，避免把 ~1MB 流图拉进主包。
const author = require('../data/author/index.js');

function getActivities() {
  return author.activities || [];
}

function getProfile() {
  return author.profile || {};
}

module.exports = { getActivities, getProfile };
