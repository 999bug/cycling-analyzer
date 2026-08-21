// 导入 FIT：本地选择（微信会话文件）+ 主线程解码（fitsdk）+ 本地存储（离线、不联网）。
// 小程序不能像电脑直接打开文件夹，标准做法是「把 .fit 转发到文件传输助手 → 这里选」。
const { decodeAndNormalize } = require('../../fit/normalize.js');
const myRepo = require('../../repositories/myRepository.js');
const ds = require('../../store/dataSourceStore.js');

function titleFromName(fileName) {
  let n = (fileName || '').replace(/\.(fit|gz)$/i, '').replace(/\.fit\.gz$/i, '');
  n = n.trim();
  return n || '我的骑行';
}

Page({
  data: {
    status: 'idle', // idle | parsing | done | error
    fileName: '',
    msg: '',
    count: 0,
  },
  onShow() {
    const list = myRepo.getActivities();
    this.setData({ count: list.length });
  },
  onChoose() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['fit', 'gz'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        this.parseFile(f);
      },
      fail: () => {},
    });
  },
  parseFile(f) {
    this.setData({ status: 'parsing', fileName: f.name, msg: '解析中…' });
    const fs = wx.getFileSystemManager();
    fs.readFile({
      filePath: f.path,
      success: (r) => {
        try {
          const buf = r.data; // ArrayBuffer
          const id = 'my_' + f.size + '_' + (f.time || Date.now());
          const fingerprint = id;
          const meta = { id, fileName: f.name, fingerprint, name: titleFromName(f.name) };
          const { activity, records } = decodeAndNormalize(buf, meta);
          myRepo.saveActivity(activity, records);
          ds.setSource('my');
          this.setData({ status: 'done', msg: '已导入：' + activity.name, count: myRepo.getActivities().length });
          wx.showToast({ title: '导入成功', icon: 'success' });
          setTimeout(() => {
            wx.switchTab({ url: '/pages/activities/activities' });
          }, 900);
        } catch (e) {
          const msg =
            e && e.code === 'NOT_FIT_FILE'
              ? '不是有效的 FIT 文件'
              : e && e.code === 'CORRUPTED_FIT'
                ? '文件已损坏（校验失败）'
                : '解析失败：' + (e && e.message ? e.message : e);
          this.setData({ status: 'error', msg });
          wx.showToast({ title: '导入失败', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ status: 'error', msg: '读取文件失败' });
        wx.showToast({ title: '读取失败', icon: 'none' });
      },
    });
  },
});
