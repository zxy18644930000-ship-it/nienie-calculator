const { call, loading, hideLoading } = require('../../../utils/cloud');

const WD = ['日', '一', '二', '三', '四', '五', '六'];

Page({
  data: { ready: false, err: '', days: [] },

  onShow() { this.load(); },

  load() {
    loading('加载中');
    call('report', { action: 'mine', days: 14 }).then((r) => {
      hideLoading();
      const d0 = new Date();
      const today = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
      this.setData({
        ready: true,
        err: '',
        days: (r.days || []).map((d) => {
          const dt = new Date(d.date + 'T00:00:00');
          let label = (dt.getMonth() + 1) + '月' + dt.getDate() + '日 周' + WD[dt.getDay()];
          if (d.date === today) label = '今天 · ' + label;
          return { date: d.date, label, qty: d.qty, amountText: d.amount_text, items: d.items };
        }),
      });
    }).catch((e) => {
      hideLoading();
      this.setData({ ready: true, err: e.message });
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
});
