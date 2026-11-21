const { call, loading, hideLoading } = require('../../../utils/cloud');

Page({
  data: {
    ready: false,
    err: '',
    list: [],
    showEdit: false,
    editId: '',
    editName: '',
  },

  onShow() { this.load(); },

  load() {
    loading('加载中');
    call('admin', { action: 'productList' }).then((r) => {
      hideLoading();
      this.setData({ ready: true, err: '', list: r.list || [] });
    }).catch((e) => {
      hideLoading();
      this.setData({ ready: true, err: e.message });
    });
  },

  onAdd() {
    this._name = undefined;
    this.setData({ showEdit: true, editId: '', editName: '' });
  },

  onEditRow(e) {
    const row = this.data.list.find((x) => x.id === e.currentTarget.dataset.id);
    if (!row) return;
    this._name = undefined;
    this.setData({ showEdit: true, editId: row.id, editName: row.name });
  },

  closeEdit() { this.setData({ showEdit: false }); },
  noop() {},

  onNameInput(e) { this._name = e.detail.value; },

  save() {
    const name = String(this._name !== undefined ? this._name : this.data.editName || '').trim();
    if (!name) { wx.showToast({ title: '填一下名称', icon: 'none' }); return; }
    if (name.length > 20) { wx.showToast({ title: '名称最多 20 个字', icon: 'none' }); return; }
    loading('保存中');
    call('admin', { action: 'productSave', id: this.data.editId || undefined, name })
      .then(() => {
        hideLoading();
        this.setData({ showEdit: false });
        wx.showToast({ title: '已保存', icon: 'none' });
        this.load();
      })
      .catch((e) => {
        hideLoading();
        wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  toggleActive(e) {
    const row = this.data.list.find((x) => x.id === e.currentTarget.dataset.id);
    if (!row) return;
    loading(row.active ? '停用中' : '启用中');
    call('admin', { action: 'productSave', id: row.id, active: !row.active })
      .then(() => { hideLoading(); this.load(); })
      .catch((err) => {
        hideLoading();
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  /* 长按一行：删除这个名称 */
  onDeleteRow(e) {
    const row = this.data.list.find((x) => x.id === e.currentTarget.dataset.id);
    if (!row) return;
    wx.showModal({
      title: '删掉「' + row.name + '」？',
      content: '删了它不再出现在工人的下拉框里；已有记录不受影响。',
      confirmText: '删除',
      confirmColor: '#D9363E',
      success: (res) => {
        if (!res.confirm) return;
        loading('删除中');
        call('admin', { action: 'productDelete', id: row.id })
          .then(() => {
            hideLoading();
            wx.showToast({ title: '已删除', icon: 'none' });
            this.load();
          })
          .catch((err) => {
            hideLoading();
            wx.showToast({ title: err.message, icon: 'none' });
          });
      },
    });
  },
});
