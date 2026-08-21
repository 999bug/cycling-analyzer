// 设置：数据源切换（author 只读 / my 本地）。复用 dataSourceStore。
const ds = require('../../store/dataSourceStore.js');

Page({
  data: { source: 'author' },
  onShow() {
    this.setData({ source: ds.getSource() });
  },
  onSwitch(e) {
    const s = e.currentTarget.dataset.src;
    ds.setSource(s);
    this.setData({ source: s });
  },
});
