// 仪表盘：读取当前数据源的公开快照（离线，零域名）。
const ds = require('../../store/dataSourceStore.js');

function fmtDuration(sec) {
  if (sec === undefined || sec === null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return h + '小时' + m + '分';
  return m + '分';
}

Page({
  data: {
    nickname: '',
    source: 'author',
    summary: { count: 0, distanceKm: '0', totalClimb: 0, durationText: '—' },
    recent: [],
  },
  onShow() {
    this.load();
  },
  load() {
    const source = ds.getSource();
    const acts = ds.listActivities();
    let distance = 0;
    let climb = 0;
    let duration = 0;
    for (const a of acts) {
      distance += a.distance || 0;
      climb += a.elevationGain || 0;
      duration += a.duration || 0;
    }
    const recent = acts
      .slice()
      .sort((x, y) => new Date(y.startTime) - new Date(x.startTime))
      .slice(0, 8)
      .map((a) => ({
        id: a.id,
        name: a.name,
        date: (a.startTime || '').slice(0, 10),
        distanceKm: ((a.distance || 0) / 1000).toFixed(1),
        durationText: fmtDuration(a.duration),
      }));
    this.setData({
      source,
      nickname: source === 'my' ? '我的骑行' : '骑了么 · 作者公开数据',
      summary: {
        count: acts.length,
        distanceKm: (distance / 1000).toFixed(0),
        totalClimb: Math.round(climb),
        durationText: fmtDuration(duration),
      },
      recent,
    });
  },
  goActivities() {
    wx.switchTab({ url: '/pages/activities/activities' });
  },
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/subpackages/author-detail/pages/detail/detail?activityId=' + id });
  },
});
