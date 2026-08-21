// 用户本地数据仓储：导入的 FIT 解析结果存到小程序本地存储（wx storage，离线、不联网）。
// 仅保存本次会话可用；换设备或清理缓存会丢失（零域名方案下不做云端同步）。
const KEY_SUM = 'my_activities';
const KEY_REC_PREFIX = 'my_records_';

function getActivities() {
  try {
    return wx.getStorageSync(KEY_SUM) || [];
  } catch (e) {
    return [];
  }
}

function getActivityRecords(id) {
  try {
    return wx.getStorageSync(KEY_REC_PREFIX + id) || [];
  } catch (e) {
    return [];
  }
}

function saveActivity(activity, records) {
  const list = getActivities();
  const idx = list.findIndex((a) => a.id === activity.id); // 同 ID 覆盖（去重）
  if (idx >= 0) list[idx] = activity;
  else list.push(activity);
  try {
    wx.setStorageSync(KEY_SUM, list);
    wx.setStorageSync(KEY_REC_PREFIX + activity.id, records);
  } catch (e) {
    // 存储配额超限时回滚，避免脏数据
    try {
      wx.removeStorageSync(KEY_REC_PREFIX + activity.id);
    } catch (_) {}
    throw e;
  }
}

function removeActivity(id) {
  const list = getActivities().filter((a) => a.id !== id);
  try {
    wx.setStorageSync(KEY_SUM, list);
    wx.removeStorageSync(KEY_REC_PREFIX + id);
  } catch (e) {}
}

module.exports = { getActivities, getActivityRecords, saveActivity, removeActivity };
