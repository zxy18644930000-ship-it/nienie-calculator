const config = require('./config');

App({
  onLaunch() {
    if (!wx.cloud) return;
    const opts = { traceUser: true };
    if (config.ENV_ID) opts.env = config.ENV_ID;
    wx.cloud.init(opts);
  },
});
