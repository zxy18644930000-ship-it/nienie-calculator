const config = require('./config');

App({
  onLaunch() {
    if (!wx.cloud) return;
    const opts = { traceUser: true };
    if (config.ENV_ID) opts.env = config.ENV_ID;
    wx.cloud.init(opts);
    /* 算价数据云端同步：启动时后台跑一轮（拉最新 + 推本地改动），失败静默 */
    try { require('./utils/store').syncInit(); } catch (e) {}
  },
});
