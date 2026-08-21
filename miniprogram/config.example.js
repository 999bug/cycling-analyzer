// 本地私有配置模板（开源仓库安全）
//
// 用法：把本文件复制为 `config.local.js`，填入你自己的密钥。
// `config.local.js` 已被 .gitignore 忽略，永不会进入公开仓库。
// 代码中通过 `require('./config.local.js')` 读取；若文件不存在则回退为空字符串。

module.exports = {
  // 腾讯位置服务 Key：微信原生 <map> 组件的 mapKey 使用。
  // 在 https://lbs.qq.com 免费申请，并绑定你的小程序 AppID。
  // 注意：地图 Key 同样属于敏感配置，不要提交到公开仓库。
  TENCENT_MAP_KEY: 'YOUR_TENCENT_MAP_KEY',
};
