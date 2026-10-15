const { call, loading, hideLoading } = require('../../../utils/cloud');

Page({
  data: {
    ready: false,
    err: '',
    filter: 'pending',
    list: [],
    ratioText: '30',
    checking: false,
  },

  onLoad() { this.load(); },

  load() {
    loading('加载中');
    call('admin', { action: 'reviewList', status: this.data.filter }).then((r) => {
      hideLoading();
      this.setData({ ready: true, err: '', list: r.list || [], ratioText: r.flag_ratio_text || '30' });
    }).catch((e) => {
      hideLoading();
      this.setData({ ready: true, err: e.message });
    });
  },

  setFilter(e) {
    const f = e.currentTarget.dataset.f;
    if (f === this.data.filter) return;
    this.setData({ filter: f });
    this.load();
  },

  mark(e) {
    const id = e.currentTarget.dataset.id;
    const review = e.currentTarget.dataset.r;
    loading('保存中');
    call('admin', { action: 'reviewMark', id, review }).then(() => {
      hideLoading();
      this.setData({ list: this.data.list.filter((x) => x.id !== id) });
      wx.showToast({ title: review === 'ok' ? '已确认没问题' : '已标记「要核实」', icon: 'none' });
    }).catch((err) => {
      hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  /* 手动催一把 AI 数数（平时每 5 分钟自动跑） */
  checkNow() {
    if (this.data.checking) return;
    this.setData({ checking: true });
    loading('核对中，需要几秒');
    call('countPhoto', { batch: 5, retryErrors: true }).then((r) => {
      hideLoading();
      this.setData({ checking: false });
      if (r.skipped) {
        wx.showToast({ title: 'AI 数数还没开启（见部署手册）', icon: 'none', duration: 3000 });
      } else {
        wx.showToast({ title: '看完 ' + r.done + ' 张，出错 ' + r.failed + ' 张', icon: 'none', duration: 2600 });
        this.load();
      }
    }).catch((e) => {
      hideLoading();
      this.setData({ checking: false });
      wx.showToast({ title: e.message, icon: 'none' });
    });
  },

  /* 优先用服务端换好的临时链接（管理员看工人照片必须走服务端） */
  previewPhoto(e) {
    const f = e.currentTarget.dataset.f;
    const u = e.currentTarget.dataset.u;
    if (u) {
      wx.previewImage({ urls: [u] });
      return;
    }
    if (!f) return;
    wx.cloud.getTempFileURL({ fileList: [f] }).then((res) => {
      const url = res.fileList && res.fileList[0] && res.fileList[0].tempFileURL;
      if (url) wx.previewImage({ urls: [url] });
      else wx.showToast({ title: '照片打不开（可让老板调存储权限或稍后重试）', icon: 'none' });
    }).catch(() => {
      wx.showToast({ title: '照片打不开', icon: 'none' });
    });
  },
});
