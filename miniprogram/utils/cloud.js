// 云函数调用封装：统一业务错误与网络错误的提示
function call(name, data) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('当前微信版本过低，不支持云开发'));
      return;
    }
    wx.cloud.callFunction({ name, data: data || {} })
      .then((res) => {
        const r = (res && res.result) || {};
        if (r.ok) resolve(r);
        else reject(new Error(r.err || '操作失败'));
      })
      .catch((e) => {
        const msg = String((e && e.errMsg) || (e && e.message) || e || '');
        if (msg.indexOf('FunctionName') >= 0 || msg.indexOf('not found') >= 0) {
          reject(new Error('云函数还没部署，先看部署手册'));
        } else if (msg.indexOf('env') >= 0 || msg.indexOf('-601002') >= 0 || msg.indexOf('-501000') >= 0 || msg.indexOf('云开发') >= 0) {
          reject(new Error('云服务还没配好（见部署手册）'));
        } else {
          reject(new Error('网络不太好，请重试'));
        }
      });
  });
}

function fmtYuan(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function loading(title) {
  wx.showLoading({ title: title || '加载中', mask: true });
}

function hideLoading() {
  try { wx.hideLoading(); } catch (e) {}
}

function toastErr(e) {
  wx.showToast({ title: (e && e.message) || '出错了', icon: 'none', duration: 2400 });
}

module.exports = { call, fmtYuan, loading, hideLoading, toastErr };
