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
    store.syncKick();
  },

  /* 云端同步拉到了新数据（其他设备改的）：刷新列表 */
  onSyncApplied() {
    this.refresh();
  },

  refresh() {
    const raw = store.loadRecords();
    const records = raw.map((r) => ({
      id: r.id,
      orderNo: r.orderNo || '',
      no: r.no || '',
      timeText: fmtTime(r.ts),
      devText: r.devName ? ('来自 ' + r.devName) : '',
      itemsText: (Array.isArray(r.items) ? r.items : []).map((x) => x.no + '号×' + x.count).join(' + ') + '（共 ' + r.count + ' 件）',
      totalText: fmtMoney(r.total),
      discText: (Array.isArray(r.discounts) && r.discounts.length)
        ? ('原价 ¥' + fmtMoney(Number(r.subtotal) || (r.total + r.discounts.reduce((s, x) => s + x.amount, 0))) + ' · ' + r.discounts.map((x) => x.label + ' −¥' + fmtMoney(x.amount)).join(' · '))
        : '',
    }));
    /* 跨设备汇总：所有设备的订单合在一起看总量，并标明各设备各报了多少单 */
    let sum = 0;
    const byDev = {};
    raw.forEach((r) => {
      sum += Number(r.total) || 0;
      const k = r.devName || '旧数据';
      byDev[k] = (byDev[k] || 0) + 1;
    });
    const devSummary = Object.keys(byDev).map((k) => k + ' ' + byDev[k] + '单').join(' · ');
    this.setData({ records, sumText: fmtMoney(sum), devSummary });
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
