const { call, loading, hideLoading } = require('../../utils/cloud');

Page({
  data: { ready: false, isAdmin: false, showPass: false },

  onShow() {
    call('login').then((r) => {
      this.setData({ ready: true, isAdmin: r.role === 'admin' });
    }).catch(() => {
      this.setData({ ready: true });
    });
  },

  /* 报工时：所有设备都能进 */
  goWorklog() {
    wx.reLaunch({ url: '/pages/worklog/home/home' });
  },

  /* 计算器：老板设备直接进；其他设备弹口令框，输对一次即成为老板设备 */
  goCalc() {
    if (this.data.isAdmin) {
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    this.setData({ showPass: true });
  },

  closePass() { this.setData({ showPass: false }); },
  noop() {},
  onPassInput(e) { this._passDraft = e.detail.value; },

  submitPass() {
    const pass = String(this._passDraft || '').trim();
    if (!pass) { wx.showToast({ title: '请输入口令', icon: 'none' }); return; }
    loading('验证中');
    call('admin', { action: 'claim', pass })
      .then(() => {
        hideLoading();
        this.setData({ showPass: false, isAdmin: true });
        wx.showToast({ title: '已设为老板设备', icon: 'none' });
        wx.reLaunch({ url: '/pages/index/index' });
      })
      .catch((e) => {
        hideLoading();
        wx.showToast({ title: e.message, icon: 'none' });
      });
  },
});
