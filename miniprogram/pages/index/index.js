const { uid, cents, fmtMoney, genOrderNo } = require('../../utils/util');
const store = require('../../utils/store');

const MAX_ITEMS = 60;

Page({
  data: {
    items: [],
    editing: false,
    orderNo: '',
    totalText: '0',
    countText: '共 0 件',
    detailText: '',
    discText: '',
    keyPills: [],
    hasKeys: false,
    cfgScrollTo: '',
    rulesView: [],
    keysView: [],
    modal: { show: false, type: 'input', inputType: 'text', title: '', value: '', placeholder: '', text: '', okText: '确定', danger: false, action: '' },
  },

  onLoad() {
    this.model = {
      items: store.loadItems(),
      counts: {},
      discounts: store.loadDiscounts(),
      activeKeys: [],
      orderNo: null,
    };
    this.editing = this.model.items.every((it) => !(it.price > 0));
    this.syncAll();
  },

  onShow() {
    // 从记录页返回时同步一次配置（保留本单已选数量）
    this.model.items = store.loadItems();
    this.model.discounts = store.loadDiscounts();
    this.syncAll();
  },

  /* ==================== 渲染 ==================== */
  calcDiscounts() {
    const m = this.model;
    let subC = 0;
    let n = 0;
    for (const it of m.items) {
      const k = m.counts[it.id] || 0;
      if (k > 0) { subC += cents(it.price) * k; n += k; }
    }
    const list = [];
    let best = null;
    for (const r of m.discounts.rules) {
      if (!(r.min > 0) || !(r.off > 0)) continue;
      if (subC >= cents(r.min) && (!best || r.min > best.min)) best = r;
    }
    if (best) list.push({ label: '满' + fmtMoney(cents(best.min)) + '减' + fmtMoney(cents(best.off)), amount: cents(best.off) });
    for (const k of m.discounts.keys) {
      if (!(k.off > 0) || m.activeKeys.indexOf(k.id) < 0) continue;
      list.push({ label: k.name || '快捷优惠', amount: cents(k.off) });
    }
    const offTotal = list.reduce((s, x) => s + x.amount, 0);
    return { sub: { c: subC, n }, list, offTotal, final: Math.max(0, subC - offTotal) };
  },

  syncAll() {
    const m = this.model;
    const itemsView = m.items.map((it) => ({
      id: it.id,
      priceText: fmtMoney(cents(it.price)),
      count: m.counts[it.id] || 0,
    }));
    const d = this.calcDiscounts();
    const parts = [];
    m.items.forEach((it, i) => {
      const k = m.counts[it.id] || 0;
      if (k > 0) parts.push((i + 1) + '号×' + k);
    });
    this.setData({
      items: itemsView,
      editing: !!this.editing,
      orderNo: m.orderNo || '',
      totalText: fmtMoney(d.final),
      countText: '共 ' + d.sub.n + ' 件',
      detailText: parts.join(' + '),
      discText: d.list.length
        ? ('合计 ¥' + fmtMoney(d.sub.c) + ' · ' + d.list.map((x) => x.label).join(' · ') + '（共减 ¥' + fmtMoney(d.offTotal) + '）')
        : '',
      rulesView: m.discounts.rules.map((r) => ({ id: r.id, minText: r.min ? String(r.min) : '', offText: r.off ? String(r.off) : '' })),
      keysView: m.discounts.keys.map((k) => ({ id: k.id, name: k.name || '', offText: k.off ? String(k.off) : '' })),
      keyPills: m.discounts.keys.map((k) => ({ id: k.id, name: k.name || '未命名', on: m.activeKeys.indexOf(k.id) >= 0 })),
      hasKeys: m.discounts.keys.length > 0,
    });
  },

  /* ==================== 基础交互 ==================== */
  toggleEdit() {
    this.editing = !this.editing;
    this.syncAll();
  },

  changeCount(id, delta) {
    const m = this.model;
    const it = m.items.find((x) => x.id === id);
    if (!it) return;
    if (delta > 0 && !(it.price > 0)) {
      wx.showToast({ title: '这格还没定价，点右上「编辑」填价格', icon: 'none' });
      return;
    }
    const cur = m.counts[id] || 0;
    const next = Math.max(0, cur + delta);
    if (next === cur) return;
    m.counts[id] = next;
    if (!m.orderNo) m.orderNo = genOrderNo();
    try { wx.vibrateShort({ type: 'light' }); } catch (e) {}
    this.syncAll();
  },

  onCardTap(e) {
    if (this.editing) return;
    this.changeCount(e.currentTarget.dataset.id, +1);
  },

  onCardLongPress(e) {
    if (this.editing) return;
    this.changeCount(e.currentTarget.dataset.id, -1);
  },

  onMinusTap(e) {
    if (this.editing) return;
    this.changeCount(e.currentTarget.dataset.id, -1);
  },

  /* ==================== 改价 / 删格 / 清空 ==================== */
  onPriceTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.editing) {
      this.changeCount(id, +1);
      return;
    }
    const it = this.model.items.find((x) => x.id === id);
    if (!it) return;
    this._modalTargetId = id;
    this._modalValue = it.price ? String(it.price) : '';
    this.setData({ modal: { show: true, type: 'input', inputType: 'digit', title: '改价（元）', value: this._modalValue, placeholder: '如 28', text: '', okText: '确定', danger: false, action: 'price' } });
  },

  onDeleteTap(e) {
    const id = e.currentTarget.dataset.id;
    const it = this.model.items.find((x) => x.id === id);
    if (!it) return;
    this._modalTargetId = id;
    this.setData({ modal: { show: true, type: 'confirm', inputType: 'text', title: '删除这一格？', value: '', placeholder: '', text: '这一格的价格设置会一起删掉。', okText: '删除', danger: true, action: 'deleteItem' } });
  },

  onClearTap() {
    const d = this.calcDiscounts();
    if (d.sub.n === 0 && this.model.activeKeys.length === 0) {
      this.model.counts = {};
      this.model.orderNo = null;
      this.model.activeKeys = [];
      this.syncAll();
      return;
    }
    this.setData({ modal: { show: true, type: 'confirm', inputType: 'text', title: '清空本单？', value: '', placeholder: '', text: '已选 ' + d.sub.n + ' 件，合计 ¥' + fmtMoney(d.sub.c), okText: '清空', danger: false, action: 'clear' } });
  },

  onModalInput(e) {
    this._modalValue = e.detail.value;
  },

  closeModal() {
    this.setData({ 'modal.show': false });
  },

  noop() {},

  submitModal() {
    const action = this.data.modal.action;
    const target = this.model.items.find((x) => x.id === this._modalTargetId);
    if (action === 'price') {
      const p = parseFloat(this._modalValue);
      if (isNaN(p) || p < 0 || p > 99999) {
        wx.showToast({ title: '填个数字，如 28', icon: 'none' });
        return;
      }
      if (!target) { this.closeModal(); return; }
      target.price = Math.round(p * 100) / 100;
      store.saveItems(this.model.items);
      this.closeModal();
      this.syncAll();
    } else if (action === 'deleteItem') {
      if (!target) { this.closeModal(); return; }
      store.deleteImage(target.imgPath);
      delete this.model.counts[target.id];
      this.model.items = this.model.items.filter((x) => x.id !== target.id);
      store.saveItems(this.model.items);
      this.closeModal();
      this.syncAll();
    } else if (action === 'clear') {
      this.model.counts = {};
      this.model.orderNo = null;
      this.model.activeKeys = [];
      this.closeModal();
      this.syncAll();
    }
  },

  /* ==================== 加一格 ==================== */
  addItem() {
    if (this.model.items.length >= MAX_ITEMS) {
      wx.showToast({ title: '最多 ' + MAX_ITEMS + ' 格', icon: 'none' });
      return;
    }
    this.model.items.push({ id: uid(), price: 0, hasImg: false, name: '', imgPath: '' });
    store.saveItems(this.model.items);
    this.syncAll();
  },

  /* ==================== 满减 / 快捷键配置 ==================== */
  onAddRule() {
    if (this.model.discounts.rules.length >= 5) {
      wx.showToast({ title: '满减最多 5 条', icon: 'none' });
      return;
    }
    this.model.discounts.rules.push({ id: uid(), min: 0, off: 0 });
    store.saveDiscounts(this.model.discounts);
    this.syncAll();
  },

  onDelRule(e) {
    const id = e.currentTarget.dataset.id;
    this.model.discounts.rules = this.model.discounts.rules.filter((x) => x.id !== id);
    store.saveDiscounts(this.model.discounts);
    this.syncAll();
  },

  /* 边输入边记录（不 setData，避免重渲染打断输入；失焦时优先采用记录值） */
  onCfgInput(e) {
    const { id, field } = e.currentTarget.dataset;
    this._drafts = this._drafts || {};
    this._drafts[id + '.' + field] = e.detail.value;
  },

  /* 点中输入框时，把所在行滚到滚动区顶部，避免被键盘挡住 */
  onCfgFocus(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ cfgScrollTo: 'cfgrow-' + id });
    setTimeout(() => { this.setData({ cfgScrollTo: '' }); }, 800);
  },

  onRuleBlur(e) {
    const { id, field } = e.currentTarget.dataset;
    const r = this.model.discounts.rules.find((x) => x.id === id);
    if (!r) return;
    const key = id + '.' + field;
    const raw = (this._drafts && this._drafts[key] !== undefined) ? this._drafts[key] : e.detail.value;
    if (this._drafts) delete this._drafts[key];
    const v = parseFloat(raw);
    r[field] = isNaN(v) || v < 0 ? 0 : Math.round(v * 100) / 100;
    store.saveDiscounts(this.model.discounts);
    this.syncAll();
  },

  onAddKey() {
    if (this.model.discounts.keys.length >= 6) {
      wx.showToast({ title: '快捷键最多 6 个', icon: 'none' });
      return;
    }
    this.model.discounts.keys.push({ id: uid(), name: '', off: 0 });
    store.saveDiscounts(this.model.discounts);
    this.syncAll();
  },

  onDelKey(e) {
    const id = e.currentTarget.dataset.id;
    this.model.discounts.keys = this.model.discounts.keys.filter((x) => x.id !== id);
    this.model.activeKeys = this.model.activeKeys.filter((x) => x !== id);
    store.saveDiscounts(this.model.discounts);
    this.syncAll();
  },

  onKeyBlur(e) {
    const { id, field } = e.currentTarget.dataset;
    const k = this.model.discounts.keys.find((x) => x.id === id);
    if (!k) return;
    const key = id + '.' + field;
    const raw = (this._drafts && this._drafts[key] !== undefined) ? this._drafts[key] : e.detail.value;
    if (this._drafts) delete this._drafts[key];
    if (field === 'name') {
      k.name = String(raw || '').trim().slice(0, 12);
    } else {
      const v = parseFloat(raw);
      k.off = isNaN(v) || v < 0 ? 0 : Math.round(v * 100) / 100;
    }
    store.saveDiscounts(this.model.discounts);
    this.syncAll();
  },

  toggleKey(e) {
    const id = e.currentTarget.dataset.id;
    const i = this.model.activeKeys.indexOf(id);
    if (i >= 0) this.model.activeKeys.splice(i, 1);
    else this.model.activeKeys.push(id);
    this.syncAll();
  },

  /* ==================== 保存 / 记录 ==================== */
  saveOrder() {
    const m = this.model;
    const d = this.calcDiscounts();
    if (d.sub.n === 0) {
      wx.showToast({ title: '还没选商品', icon: 'none' });
      return;
    }
    const rec = {
      id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      orderNo: m.orderNo || genOrderNo(),
      no: '',
      items: m.items
        .map((it, i) => ({ no: i + 1, price: it.price || 0, count: m.counts[it.id] || 0 }))
        .filter((x) => x.count > 0),
      total: d.final,
      subtotal: d.sub.c,
      discounts: d.list.map((x) => ({ label: x.label, amount: x.amount })),
      count: d.sub.n,
    };
    const records = store.loadRecords();
    records.unshift(rec);
    store.saveRecords(records);

    m.counts = {};
    m.orderNo = null;
    m.activeKeys = [];
    this.syncAll();
    wx.showToast({ title: '已保存 ¥' + fmtMoney(rec.total), icon: 'none' });
  },

  openRecords() {
    wx.navigateTo({ url: '/pages/records/records' });
  },
});
