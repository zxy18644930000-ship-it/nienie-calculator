const { fmtMoney, fmtTime } = require('../../utils/util');
const store = require('../../utils/store');
const backup = require('../../utils/backup');

Page({
  data: {
    records: [],
    modal: { show: false, title: '', text: '', okText: '确定', danger: false, action: '' },
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const records = store.loadRecords().map((r) => ({
      id: r.id,
      orderNo: r.orderNo || '',
      no: r.no || '',
      timeText: fmtTime(r.ts),
      itemsText: (Array.isArray(r.items) ? r.items : []).map((x) => x.no + '号×' + x.count).join(' + ') + '（共 ' + r.count + ' 件）',
      totalText: fmtMoney(r.total),
      discText: (Array.isArray(r.discounts) && r.discounts.length)
        ? ('原价 ¥' + fmtMoney(Number(r.subtotal) || (r.total + r.discounts.reduce((s, x) => s + x.amount, 0))) + ' · ' + r.discounts.map((x) => x.label + ' −¥' + fmtMoney(x.amount)).join(' · '))
        : '',
    }));
    this.setData({ records });
  },

  onDelete(e) {
    this._delId = e.currentTarget.dataset.id;
    this.setData({ modal: { show: true, title: '删除这条记录？', text: '', okText: '删除', danger: true, action: 'delete' } });
  },

  closeModal() {
    this.setData({ 'modal.show': false });
  },

  noop() {},

  submitModal() {
    const action = this.data.modal.action;
    if (action === 'delete' && this._delId) {
      const records = store.loadRecords().filter((x) => x.id !== this._delId);
      store.saveRecords(records);
      this._delId = null;
      this.closeModal();
      this.refresh();
    } else if (action === 'import' && this._importData) {
      const data = this._importData;
      this._importData = null;
      this.closeModal();
      backup.applyImport(data, () => {
        wx.showToast({ title: '已从备份恢复', icon: 'none' });
        this.refresh();
      });
    } else {
      this.closeModal();
    }
  },

  onExport() {
    backup.exportBackup();
  },

  onImport() {
    backup.chooseAndReadBackup((data) => {
      this._importData = data;
      this.setData({ modal: { show: true, title: '导入备份？', text: '会覆盖当前全部商品设置和记录，恢复成备份里的样子。', okText: '导入并覆盖', danger: true, action: 'import' } });
    });
  },
});
