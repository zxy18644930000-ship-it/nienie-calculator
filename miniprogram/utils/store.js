const { uid } = require('./util');

const K_ITEMS = 'n_items';
const K_RECORDS = 'n_records';
const K_DISCOUNTS = 'n_discounts';
const DEFAULT_ITEMS = 15;
const MAX_RECORDS = 500;
const fs = wx.getFileSystemManager();

function getSync(key, def) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v == null ? def : v;
  } catch (e) {
    return def;
  }
}
function setSync(key, val) {
  try { wx.setStorageSync(key, val); } catch (e) {}
}

function makeDefaultItems() {
  return Array.from({ length: DEFAULT_ITEMS }, () => ({ id: uid(), price: 0, hasImg: false, name: '', imgPath: '' }));
}

function normalizeItems(saved) {
  if (!Array.isArray(saved) || !saved.length) return makeDefaultItems();
  return saved.map((it) => ({
    id: String(it.id || uid()),
    price: Number(it.price) || 0,
    hasImg: !!it.hasImg,
    name: typeof it.name === 'string' ? it.name : '',
    imgPath: typeof it.imgPath === 'string' ? it.imgPath : '',
  }));
}

function normalizeDiscounts(d) {
  const out = { rules: [], keys: [] };
  if (d && Array.isArray(d.rules)) {
    out.rules = d.rules.slice(0, 5).map((r) => ({
      id: String(r.id || uid()),
      min: Math.max(0, Math.round((Number(r.min) || 0) * 100) / 100),
      off: Math.max(0, Math.round((Number(r.off) || 0) * 100) / 100),
    }));
  }
  if (d && Array.isArray(d.keys)) {
    out.keys = d.keys.slice(0, 6).map((k) => ({
      id: String(k.id || uid()),
      name: typeof k.name === 'string' ? k.name.slice(0, 12) : '',
      off: Math.max(0, Math.round((Number(k.off) || 0) * 100) / 100),
    }));
  }
  return out;
}

const store = {
  loadItems() { return normalizeItems(getSync(K_ITEMS, null)); },
  saveItems(items) { setSync(K_ITEMS, items); },
  loadRecords() {
    const r = getSync(K_RECORDS, []);
    return Array.isArray(r) ? r : [];
  },
  saveRecords(records) { setSync(K_RECORDS, records.slice(0, MAX_RECORDS)); },
  loadDiscounts() { return normalizeDiscounts(getSync(K_DISCOUNTS, null)); },
  saveDiscounts(d) { setSync(K_DISCOUNTS, d); },
  deleteImage(path) {
    if (!path) return;
    try { fs.unlinkSync(path); } catch (e) {}
  },
  normalizeItems,
  normalizeDiscounts,
};

module.exports = store;
