// 小程序逻辑层（主线程 / Worker）全局没有 TextDecoder，而 @garmin/fitsdk 依赖它解码字符串。
// 这里仅在缺失时注入一个最小可用的 UTF-8 解码器；Node / 已有环境会跳过，无副作用。
if (typeof TextDecoder === 'undefined') {
  (function () {
    function decode(bytes) {
      if (typeof bytes === 'string') return bytes;
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      let out = '';
      let i = 0;
      const len = u8.length;
      while (i < len) {
        let c = u8[i++];
        if (c < 0x80) {
          out += String.fromCharCode(c);
        } else if (c >= 0xc0 && c < 0xe0) {
          const c2 = u8[i++] & 0x3f;
          out += String.fromCharCode(((c & 0x1f) << 6) | c2);
        } else if (c >= 0xe0 && c < 0xf0) {
          const c2 = u8[i++] & 0x3f;
          const c3 = u8[i++] & 0x3f;
          out += String.fromCharCode(((c & 0x0f) << 12) | (c2 << 6) | c3);
        } else if (c >= 0xf0) {
          const c2 = u8[i++] & 0x3f;
          const c3 = u8[i++] & 0x3f;
          const c4 = u8[i++] & 0x3f;
          let cp = ((c & 0x07) << 18) | (c2 << 12) | (c3 << 6) | c4;
          cp -= 0x10000;
          out += String.fromCharCode(0xd800 + ((cp >> 10) & 0x3ff), 0xdc00 + (cp & 0x3ff));
        } else {
          out += String.fromCharCode(c);
        }
      }
      return out;
    }
    // 忽略构造参数（fitsdk 传 { fatal, ignoreBOM }），本实现按容错模式工作
    global.TextDecoder = function TextDecoder() {
      this.decode = function (b) {
        return decode(b);
      };
      this.encoding = 'utf-8';
    };
    if (typeof global.TextDecoder !== 'undefined' && !global.TextDecoder.prototype) {
      global.TextDecoder.prototype = {};
    }
  })();
}

module.exports = {};
