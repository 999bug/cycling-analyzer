// 活动详情（分包）：活动摘要 + 逐点流图自绘曲线。
// 支持两种数据源：author（包内抽稀流图）/ my（本地导入全量流图）。
const author = require('../../../../data/author/index.js');
const ds = require('../../../../store/dataSourceStore.js');

function fmtDuration(sec) {
  if (sec === undefined || sec === null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return h + '小时' + m + '分';
  return m + '分';
}

// 需要绘制的序列（speed 用 m/s→km/h 展示）。power 字段本批作者数据缺失时自动跳过。
const SERIES = [
  { key: 'heartRate', color: '#e2574c', label: '心率', unit: 'bpm', scale: 1 },
  { key: 'speed', color: '#2f6df6', label: '速度', unit: 'km/h', scale: 3.6 },
  { key: 'altitude', color: '#7a8aa0', label: '海拔', unit: 'm', scale: 1 },
  { key: 'power', color: '#f0a020', label: '功率', unit: 'W', scale: 1 },
];

// 从逐点流图抽取路线 polyline（GPS 活动才有 lat/lng；室内/功率台无坐标则无地图）。
// 点数过多时按步长抽稀，避免 setData 体积过大。
function buildRouteMap(stream) {
  const pts = stream.filter((p) => p.latitude != null && p.longitude != null);
  if (pts.length < 2) return { hasMap: false, polyline: [], center: null, scale: 13 };
  const MAX = 200;
  let sampled = pts;
  if (pts.length > MAX) {
    const step = Math.ceil(pts.length / MAX);
    sampled = [];
    for (let i = 0; i < pts.length; i += step) sampled.push(pts[i]);
    sampled.push(pts[pts.length - 1]); // 保证终点在线上
  }
  const points = sampled.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
  const mid = points[Math.floor(points.length / 2)];
  return {
    hasMap: true,
    polyline: [{ points, color: '#2f6df6', width: 5, dottedLine: false }],
    center: { latitude: mid.latitude, longitude: mid.longitude },
    scale: 13,
  };
}

Page({
  data: {
    loaded: false,
    name: '',
    date: '',
    activityType: '',
    metrics: [],
    hasStream: false,
    legend: [],
  },
  onLoad(o) {
    const id = o.activityId || '';
    this.activityId = id;
    const source = ds.getSource();
    let act = null;
    let stream = [];

    if (source === 'my') {
      const myRepo = require('../../../../repositories/myRepository.js');
      act = myRepo.getActivities().find((a) => a.id === id) || null;
      stream = myRepo.getActivityRecords(id);
    } else {
      act = (author.activities || []).find((a) => a.id === id) || null;
      const records = require('../../records/index.js');
      const mod = records[id];
      stream = mod && mod.records ? mod.records : [];
    }
    const hasStream = stream.length > 0;
    const routeMap = buildRouteMap(stream);

    const metrics = [];
    if (act) {
      metrics.push({ label: '距离', value: ((act.distance || 0) / 1000).toFixed(1), unit: 'km' });
      metrics.push({ label: '时长', value: fmtDuration(act.duration), unit: '' });
      metrics.push({
        label: '均速',
        value: act.avgSpeed != null ? (act.avgSpeed * 3.6).toFixed(1) : '—',
        unit: 'km/h',
      });
      metrics.push({ label: '海拔爬升', value: Math.round(act.elevationGain || 0), unit: 'm' });
      metrics.push({ label: '消耗', value: Math.round(act.calories || 0), unit: 'kcal' });
      metrics.push({
        label: '平均心率',
        value: act.avgHeartRate != null ? Math.round(act.avgHeartRate) : '—',
        unit: 'bpm',
      });
      metrics.push({
        label: '最大心率',
        value: act.maxHeartRate != null ? Math.round(act.maxHeartRate) : '—',
        unit: 'bpm',
      });
      metrics.push({
        label: '平均踏频',
        value: act.avgCadence != null ? Math.round(act.avgCadence) : '—',
        unit: 'rpm',
      });
      metrics.push({
        label: '平均功率',
        value: act.avgPower != null ? Math.round(act.avgPower) : '—',
        unit: 'W',
      });
    }

    this.stream = stream; // 大数据存实例，避免走 setData
    this.setData({
      loaded: !!act,
      name: act ? act.name : id ? '未知活动' : '未找到活动',
      date: act ? (act.startTime || '').slice(0, 10) : '',
      activityType: act ? act.activityType : '',
      metrics,
      hasStream,
      hasMap: routeMap.hasMap,
      polyline: routeMap.polyline,
      center: routeMap.center,
      mapScale: routeMap.scale,
    });
    // 开启胶囊「···」转发/分享朋友圈入口
    try {
      wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    } catch (e) {}
  },
  onReady() {
    if (this.data.hasStream) this.drawChart();
  },
  drawChart() {
    const stream = this.stream || [];
    if (!stream.length) return;
    const avail = SERIES.filter((s) => stream.some((p) => p[s.key] != null));
    const info =
      typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const dpr = info.pixelRatio || 2;

    wx.createSelectorQuery()
      .select('#streamChart')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const W = res[0].width;
        const H = res[0].height;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, W, H);

        const padL = 10;
        const padR = 10;
        const padT = 12;
        const padB = 20;
        const plotW = W - padL - padR;
        const plotH = H - padT - padB;

        // 横向网格
        ctx.strokeStyle = '#eceef2';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 3; i++) {
          const y = padT + (plotH * i) / 3;
          ctx.beginPath();
          ctx.moveTo(padL, y);
          ctx.lineTo(padL + plotW, y);
          ctx.stroke();
        }

        const stats = avail.map((s) => {
          const vals = stream
            .map((p) => p[s.key])
            .filter((v) => v != null)
            .map((v) => v * s.scale);
          const min = Math.min.apply(null, vals);
          const max = Math.max.apply(null, vals);
          return { ...s, min, max };
        });

        const n = stream.length;
        stats.forEach((s) => {
          const range = s.max - s.min || 1;
          ctx.strokeStyle = s.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          let started = false;
          for (let i = 0; i < n; i++) {
            const v = stream[i][s.key];
            if (v == null) continue;
            const x = padL + (plotW * i) / (n - 1);
            const y = padT + plotH * (1 - (v * s.scale - s.min) / range);
            if (!started) {
              ctx.moveTo(x, y);
              started = true;
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
        });

        this.setData({
          legend: stats.map((s) => ({
            label: s.label,
            color: s.color,
            range: Math.round(s.min) + '–' + Math.round(s.max) + s.unit,
          })),
        });
      });
  },
  // 分享给好友：带活动成绩卡，好友点开直达该活动（作者数据公开可见）
  onShareAppMessage() {
    const d = this.data;
    const dist = (d.metrics.find((m) => m.label === '距离') || {}).value || '';
    const title = d.name + (dist ? '｜骑行 ' + dist + ' km' : '');
    return {
      title,
      path: '/subpackages/author-detail/pages/detail/detail?activityId=' + this.activityId,
    };
  },
  // 分享到朋友圈
  onShareTimeline() {
    const d = this.data;
    const dist = (d.metrics.find((m) => m.label === '距离') || {}).value || '';
    return { title: d.name + (dist ? '｜骑行 ' + dist + ' km' : '') };
  },
});
