const { call, loading, hideLoading, toastErr, fmtYuan } = require('../../../utils/cloud');

Page({
  data: {
    ready: false,
    err: '',
    pname: '',
    priceText: '0',
    photo: '',
    qty: 0,
    todayQty: 0,
    previewText: '0',
    submitting: false,
  },

  onLoad(query) {
    this.pid = String(query.pid || '');
    this.load();
  },

  load() {
    if (!this.pid) {
      wx.showToast({ title: '请从首页选工序进入', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 900);
      return;
    }
    loading('加载中');
    call('report', { action: 'home' }).then((r) => {
      hideLoading();
      const p = (r.processes || []).find((x) => x.id === this.pid);
      if (!p) {
        wx.showToast({ title: '这个工序不存在或已停用', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 900);
        return;
      }
      const todayItem = (r.today.list || []).find((x) => x.id === this.pid);
      this.setData({
        ready: true,
        err: '',
        pname: p.name,
        priceText: p.price_text,
        qty: 0,
        todayQty: todayItem ? todayItem.qty : 0,
        previewText: '0',
      });
    }).catch((e) => {
      hideLoading();
      this.setData({ ready: true, err: e.message });
    });
  },

  calcText(qty, priceText) {
    const c = Math.round((parseFloat(priceText) || 0) * 100);
    return fmtYuan((c * qty) / 100);
  },

  /* 必须现场拍照（不允许从相册选，防止旧图重传） */
  choosePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera'],
      sizeType: ['compressed'],
      camera: 'back',
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (f && f.tempFilePath) this.setData({ photo: f.tempFilePath });
      },
    });
  },

  previewPhoto() {
    if (this.data.photo) wx.previewImage({ urls: [this.data.photo] });
  },

  clearPhoto() { this.setData({ photo: '' }); },

  onQtyInput(e) {
    this.setDataPlus(Math.floor(Number(e.detail.value) || 0));
  },

  qtyDelta(e) {
    const d = Number(e.currentTarget.dataset.d) || 0;
    try { wx.vibrateShort({ type: 'light' }); } catch (err) {}
    this.setDataPlus((this.data.qty || 0) + d);
  },

  setDataPlus(v) {
    const qty = Math.min(9999, Math.max(0, v));
    this.setData({ qty, previewText: this.calcText(qty, this.data.priceText) });
  },

  submit() {
    if (this._busy) return;
    if (!this.data.photo) {
      wx.showToast({ title: '先拍一张照片', icon: 'none' });
      return;
    }
    const qty = this.data.qty;
    if (!(qty >= 1)) {
      wx.showToast({ title: '填一下这批的数量', icon: 'none' });
      return;
    }
    this._busy = true;
    this.setData({ submitting: true });
    loading('上传中');

    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const dir = '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate());
    const path = 'wl_reports/' + dir + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.jpg';

    wx.cloud.uploadFile({ cloudPath: path, filePath: this.data.photo })
      .then((res) => call('report', { action: 'submit', process_id: this.pid, qty, photo: res.fileID }))
      .then((r) => {
        hideLoading();
        this._busy = false;
        /* 提交成功后数量归零、照片清空，下一批重新数重新填 */
        this.setData({ submitting: false, photo: '', qty: 0, previewText: '0', todayQty: r.today_qty });
        wx.showToast({ title: '已记 ' + this.data.pname + ' ' + qty + ' 件', icon: 'none' });
        try { wx.vibrateShort({ type: 'medium' }); } catch (err) {}
      })
      .catch((e) => {
        hideLoading();
        this._busy = false;
        this.setData({ submitting: false });
        const msg = String((e && (e.errMsg || e.message)) || '');
        if (msg.indexOf('cloud') >= 0 && msg.indexOf('init') >= 0) {
          wx.showToast({ title: '云开发还没配好，见部署手册', icon: 'none', duration: 3000 });
        } else {
          toastErr(e);
        }
      });
  },

  goHome() { wx.reLaunch({ url: '/pages/worklog/home/home' }); },
});
