const { call, loading, hideLoading } = require('../../../utils/cloud');

Page({
  data: {
    ready: false,
    err: '',
    list: [],
    showEdit: false,
    editId: '',
    editName: '',
    editPrice: '',
  },

  onShow() { this.load(); },

  /* 顶部标签页：工序 ↔ 品类管理 */
  goTab(e) {
    if (e.currentTarget.dataset.t === 'prod') {
      wx.redirectTo({ url: '/pages/worklog/products/products' });
    }
  },

  load() {
    loading('加载中');
    call('admin', { action: 'processList' }).then((r) => {
      hideLoading();
      this.setData({ ready: true, err: '', list: r.list || [] });
    }).catch((e) => {
      hideLoading();
      this.setData({ ready: true, err: e.message });
    });
  },

  onAdd() {
    this._name = undefined;
    this._price = undefined;
    this.setData({ showEdit: true, editId: '', editName: '', editPrice: '' });
  },

  onEditRow(e) {
    const row = this.data.list.find((x) => x.id === e.currentTarget.dataset.id);
    if (!row) return;
    this._name = undefined;
    this._price = undefined;
    this.setData({ showEdit: true, editId: row.id, editName: row.name, editPrice: row.price_text });
  },

  closeEdit() { this.setData({ showEdit: false }); },
  noop() {},

  onNameInput(e) { this._name = e.detail.value; },
  onPriceInput(e) { this._price = e.detail.value; },

  save() {
    const name = String(this._name !== undefined ? this._name : this.data.editName || '').trim();
    const priceRaw = String(this._price !== undefined ? this._price : this.data.editPrice || '').trim();
    if (!name) { wx.showToast({ title: '填一下工序名', icon: 'none' }); return; }
    const pv = parseFloat(priceRaw);
    if (isNaN(pv) || pv < 0 || pv > 9999) { wx.showToast({ title: '单价填 0~9999 元', icon: 'none' }); return; }
    if (this._saving) return;
    this._saving = true;
    loading('保存中');
    call('admin', { action: 'processSave', id: this.data.editId || undefined, name, unit_price: pv })
      .then(() => {
        hideLoading();
        this._saving = false;
        this.setData({ showEdit: false });
        wx.showToast({ title: '已保存', icon: 'none' });
        this.load();
      })
      .catch((e) => {
        hideLoading();
        this._saving = false;
        wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  toggleActive(e) {
    const row = this.data.list.find((x) => x.id === e.currentTarget.dataset.id);
    if (!row) return;
    loading(row.active ? '停用中' : '启用中');
    call('admin', { action: 'processSave', id: row.id, active: !row.active })
      .then(() => { hideLoading(); this.load(); })
      .catch((err) => {
        hideLoading();
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },
});
