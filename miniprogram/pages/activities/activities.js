// 活动列表：读取当前数据源的活动（离线，零域名）。
const ds = require('../../store/dataSourceStore.js');

function fmtDuration(sec) {
  if (sec === undefined || sec === null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return h + '小时' + m + '分';
  return m + '分';
}

Page({
  data: { list: [], source: 'author' },
  onShow() {
    this.load();
  },
  load() {
    const source = ds.getSource();
    const list = ds
      .listActivities()
      .slice()
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
      .map((a) => ({
        id: a.id,
        name: a.name,
        date: (a.startTime || '').slice(0, 10),
        distanceKm: ((a.distance || 0) / 1000).toFixed(1),
        durationText: fmtDuration(a.duration),
        avgHr: a.avgHeartRate ? Math.round(a.avgHeartRate) : '—',
      }));
    this.setData({ list, source });
  },
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/subpackages/author-detail/pages/detail/detail?activityId=' + id });
  },
});
