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
    call('admin', { action: 'workerList' }).then((r) => {
      hideLoading();
      this.setData({ ready: true, err: '', list: r.list || [] });
    }).catch((e) => {
      hideLoading();
      this.setData({ ready: true, err: e.message });
    });
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

  saveName() {
    const name = String(this._name !== undefined ? this._name : this.data.editName || '').trim();
    if (!name || name.length > 10) {
      wx.showToast({ title: '姓名请填 1~10 个字', icon: 'none' });
      return;
    }
    loading('保存中');
    call('admin', { action: 'workerSave', id: this.data.editId, name })
      .then(() => {
        hideLoading();
        this.setData({ showEdit: false });
        wx.showToast({ title: '已改名', icon: 'none' });
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
    const nextActive = !row.active;
    const doIt = () => {
      loading('保存中');
      call('admin', { action: 'workerSave', id: row.id, active: nextActive })
        .then(() => { hideLoading(); this.load(); })
        .catch((err) => {
          hideLoading();
          wx.showToast({ title: err.message, icon: 'none' });
        });
    };
    if (!nextActive) {
      wx.showModal({
        title: '停用 ' + row.name + '？',
        content: '停用后他不能再报工，历史记录不受影响。',
        confirmText: '停用',
        success: (res) => { if (res.confirm) doIt(); },
      });
    } else {
      doIt();
    }
  },
});
