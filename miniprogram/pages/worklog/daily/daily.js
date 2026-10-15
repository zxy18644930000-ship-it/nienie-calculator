const { call, loading, hideLoading } = require('../../../utils/cloud');

Page({
  data: {
    ready: false,
    err: '',
    date: '',
    list: [],
    totalText: '0',
    totalQty: 0,
    showDetail: false,
    detailName: '',
    detailList: [],
  },

  onLoad() {
    const d = new Date();
    const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    this.setData({ date: today });
  },

  onShow() { this.load(); },

  load() {
    loading('加载中');
    call('admin', { action: 'dailyGet', date: this.data.date }).then((r) => {
      hideLoading();
      this.setData({
        ready: true,
        err: '',
        list: (r.list || []).map((w) => ({
          openid: w.openid,
          name: w.name,
          qty: w.qty,
          amountText: w.amount_text,
          itemsText: (w.items || []).map((it) => it.name + ' ' + it.qty + '件 ¥' + it.amount_text).join(' · '),
        })),
        totalText: r.total_text,
        totalQty: r.total_qty,
      });
    }).catch((e) => {
      hideLoading();
      this.setData({ ready: true, err: e.message });
    });
  },

  onDate(e) {
    this.setData({ date: e.detail.value });
    this.load();
  },

  openDetail(e) {
    const w = this.data.list.find((x) => x.openid === e.currentTarget.dataset.openid);
    if (!w) return;
    loading('加载中');
    call('admin', { action: 'dayDetail', date: this.data.date, openid: w.openid }).then((r) => {
      hideLoading();
      this.setData({ showDetail: true, detailName: w.name, detailList: r.list || [] });
    }).catch((err) => {
      hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  closeDetail() { this.setData({ showDetail: false }); },
  noop() {},

  /* 长按明细里的一条记录：确认删除（报错了/误报时用） */
  deleteRecord(e) {
    const id = e.currentTarget.dataset.id;
    const it = this.data.detailList.find((x) => x.id === id);
    if (!it) return;
    wx.showModal({
      title: '删掉这条记录？',
      content: it.process_name + ' ×' + it.qty + ' 件（¥' + it.amount_text + '）。删了会从汇总里去掉，照片也一起删。',
      confirmText: '删除',
      confirmColor: '#D9363E',
      success: (res) => {
        if (!res.confirm) return;
        loading('删除中');
        call('admin', { action: 'reportDelete', id })
          .then(() => {
            hideLoading();
            wx.showToast({ title: '已删除', icon: 'none' });
            this.setData({ detailList: this.data.detailList.filter((x) => x.id !== id) });
            this.load();
          })
          .catch((err) => {
            hideLoading();
            wx.showToast({ title: err.message, icon: 'none' });
          });
      },
    });
  },

  previewPhoto(e) {
    const f = e.currentTarget.dataset.f;
    if (!f) return;
    wx.cloud.getTempFileURL({ fileList: [f] }).then((res) => {
      const u = res.fileList && res.fileList[0] && res.fileList[0].tempFileURL;
      if (u) wx.previewImage({ urls: [u] });
      else wx.showToast({ title: '照片打不开', icon: 'none' });
    }).catch(() => {
      wx.showToast({ title: '照片打不开', icon: 'none' });
    });
  },

  copySummary() {
    const d = this.data;
    if (!d.list.length) {
      wx.showToast({ title: '这天还没有记录', icon: 'none' });
      return;
    }
    const lines = [d.date + ' 报工汇总', '合计：' + d.totalQty + ' 件 · ¥' + d.totalText, ''];
    d.list.forEach((w) => {
      lines.push(w.name + '：' + w.qty + ' 件 · ¥' + w.amountText);
      lines.push('　' + w.itemsText);
    });
    wx.setClipboardData({ data: lines.join('\n') });
  },
});
