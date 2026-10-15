const { call, loading, hideLoading } = require('../../../utils/cloud');

Page({
  data: {
    ready: false,
    err: '',
    role: '',
    name: '',
    isAdmin: false,
    needName: false,
    processes: [],
    todayText: '0',
    todayQty: 0,
    todayList: [],
    showPass: false,
  },

  onShow() {
    this.load(this._loadedOnce === true);
  },

  retry() {
    this.load(false);
  },

  load(silent) {
    if (!silent) loading('加载中');
    call('report', { action: 'home' }).then((r) => {
      if (!silent) hideLoading();
      this._loadedOnce = true;
      const d = new Date();
      this.setData({
        ready: true,
        err: '',
        role: r.role,
        name: r.name || '',
        isAdmin: r.role === 'admin',
        needName: r.role !== 'admin' && r.role !== 'blocked' && !r.name,
        processes: (r.processes || []).map((p) => ({ id: p.id, name: p.name, priceText: p.price_text })),
        todayText: r.today.amount_text,
        todayQty: r.today.qty,
        todayDate: (d.getMonth() + 1) + '月' + d.getDate() + '日',
        todayList: (r.today.list || []).map((x) => ({ id: x.id, name: x.name, qty: x.qty, amountText: x.amount_text })),
      });
    }).catch((e) => {
      if (!silent) {
        hideLoading();
        this.setData({ ready: true, err: e.message });
      }
    });
  },

  /* 首次使用：填写姓名 */
  onNameInput(e) { this._nameDraft = e.detail.value; },

  saveName() {
    const name = String(this._nameDraft || '').trim();
    if (!name || name.length > 10) {
      wx.showToast({ title: '请填姓名（10 个字以内）', icon: 'none' });
      return;
    }
    loading('保存中');
    call('report', { action: 'setName', name })
      .then(() => {
        hideLoading();
        wx.showToast({ title: '你好，' + name, icon: 'none' });
        this.load(true);
      })
      .catch((e) => { hideLoading(); wx.showToast({ title: e.message, icon: 'none' }); });
  },

  goReport(e) {
    wx.navigateTo({ url: '/pages/worklog/report/report?pid=' + e.currentTarget.dataset.pid });
  },
  goMine() { wx.navigateTo({ url: '/pages/worklog/mine/mine' }); },
  goProcesses() { wx.navigateTo({ url: '/pages/worklog/processes/processes' }); },
  goDaily() { wx.navigateTo({ url: '/pages/worklog/daily/daily' }); },
  goReview() { wx.navigateTo({ url: '/pages/worklog/review/review' }); },
  goWorkers() { wx.navigateTo({ url: '/pages/worklog/workers/workers' }); },
  goCalc() { wx.reLaunch({ url: '/pages/index/index' }); },

  /* 管理员入口（输口令成为管理员） */
  openPass() { this.setData({ showPass: true }); },
  closePass() { this.setData({ showPass: false }); },
  onPassInput(e) { this._passDraft = e.detail.value; },
  noop() {},

  submitPass() {
    const pass = String(this._passDraft || '').trim();
    if (!pass) { wx.showToast({ title: '请输入口令', icon: 'none' }); return; }
    loading('验证中');
    call('admin', { action: 'claim', pass })
      .then((r) => {
        hideLoading();
        this.setData({ showPass: false });
        wx.showToast({ title: r.initialized ? '初始化完成，你已是管理员' : '已设为管理员', icon: 'none' });
        this.load(true);
      })
      .catch((e) => { hideLoading(); wx.showToast({ title: e.message, icon: 'none' }); });
  },
});
