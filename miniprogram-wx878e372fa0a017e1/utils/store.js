const { uid } = require('./util');

const K_ITEMS = 'n_items';
const K_RECORDS = 'n_records';
const K_DISCOUNTS = 'n_discounts';
const K_REC_DEL = 'n_rec_del';       // 已删记录的墓碑（跨设备同步"删除"用）
const K_SYNC_META = 'n_sync_meta';   // 每块数据的同步状态 {rev, dirtyTs}
const DEFAULT_ITEMS = 15;
const MAX_RECORDS = 1000;
/* 小程序单个 storage key 上限 1MB、云同步上限 900KB：记录再多也按体积兜底，只保留最近的 */
const MAX_RECORDS_BYTES = 600 * 1024;
const KINDS = ['records', 'recDel']; // 只同步订单（单价/满减保持每台设备独立）
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

/* 记录按「最新在前」排序；先按条数截断，再按体积兜底（超出时成比例丢最旧的） */
function trimRecords(list) {
  let out = (list || []).slice(0, MAX_RECORDS);
  const size = () => {
    try { return JSON.stringify(out).length; } catch (e) { return 0; }
  };
  let sz = size();
  while (out.length > 1 && sz > MAX_RECORDS_BYTES) {
    out = out.slice(0, Math.max(1, Math.floor(out.length * 0.8)));
    sz = size();
  }
  return out;
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

/* ==================== 云端同步（本地优先） ====================
   本地存储永远是主存储：算价速度不受影响、断网照常用；
   改动静默推到云；打开页面时拉云上的最新。
   - 商品/满减：整份对比，谁最后改谁生效
   - 订单记录：按 id 合并 + 墓碑记删除（防两台设备并发时丢单） */

function getMeta() {
  try { return wx.getStorageSync(K_SYNC_META) || {}; } catch (e) { return {}; }
}
function setMeta(m) {
  try { wx.setStorageSync(K_SYNC_META, m); } catch (e) {}
}

/* 设备身份：订单要标明是哪台机器报的 */
function getDevice() {
  let d = getSync('n_device', null);
  if (!d || !d.id) {
    let name = '';
    try {
      let info = {};
      if (wx.getDeviceInfo) info = wx.getDeviceInfo();
      else if (wx.getSystemInfoSync) info = wx.getSystemInfoSync();
      name = info.model || info.brand || '';
      const plat = String(info.platform || '');
      if (plat && plat !== 'ios' && plat !== 'android' && name.indexOf(plat) < 0) {
        name = name ? (name + '（' + plat + '）') : plat;
      }
    } catch (e) {}
    d = { id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name || '未知设备' };
    setSync('n_device', d);
  }
  return d;
}

function kindData(kind) {
  if (kind === 'records') return store.loadRecords();
  if (kind === 'recDel') return getSync(K_REC_DEL, []);
  return null;
}

function setKindData(kind, data) {
  if (kind === 'records') setSync(K_RECORDS, trimRecords(data));
  else if (kind === 'recDel') setSync(K_REC_DEL, data || []);
}

function cloudCall(data) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) { reject(new Error('no cloud')); return; }
    wx.cloud.callFunction({ name: 'calc', data }).then((res) => {
      resolve((res && res.result) || {});
    }).catch(() => reject(new Error('net')));
  });
}

function markDirty(kind) {
  const m = getMeta();
  const cur = m[kind] || {};
  m[kind] = { rev: cur.rev || 0, dirtyTs: Date.now() };
  setMeta(m);
  schedulePush();
}

function mergeRecords(local, cloud, dels) {
  const map = {};
  (cloud || []).forEach((r) => { if (r && r.id) map[r.id] = r; });
  (local || []).forEach((r) => { if (r && r.id && !map[r.id]) map[r.id] = r; });
  const delSet = {};
  (dels || []).forEach((id) => { delSet[id] = 1; });
  return trimRecords(Object.keys(map).map((k) => map[k])
    .filter((r) => !delSet[r.id])
    .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0)));
}

async function pushKind(kind) {
  const m = getMeta();
  const mm = m[kind];
  if (!mm || !mm.dirtyTs) return;
  const data = kindData(kind);
  let r;
  try { r = await cloudCall({ action: 'save', kind, data, rev: mm.rev || 0 }); } catch (e) { return; }
  if (r.ok) {
    const m1 = getMeta();
    const cur = m1[kind] || {};
    if ((cur.dirtyTs || 0) === mm.dirtyTs) m1[kind] = { rev: r.rev, dirtyTs: 0 };
    setMeta(m1);
    return;
  }
  if (!r.conflict) return;

  /* 冲突：另一台设备先改过 */
  if (kind === 'records' || kind === 'recDel') {
    /* 记录类先合并再推，避免丢单子 */
    try {
      const all = await cloudCall({ action: 'loadAll' });
      if (!all.ok) return;
      const serverRecs = (all.docs.records && all.docs.records.data) || [];
      const serverDels = (all.docs.recDel && all.docs.recDel.data) || [];
      const mergedDels = Array.from(new Set(getSync(K_REC_DEL, []).concat(serverDels)));
      const merged = mergeRecords(store.loadRecords(), serverRecs, mergedDels);
      setKindData('recDel', mergedDels);
      setKindData('records', merged);
      const m2 = getMeta();
      m2.records = { rev: (all.docs.records && all.docs.records.rev) || 0, dirtyTs: Date.now() };
      m2.recDel = { rev: (all.docs.recDel && all.docs.recDel.rev) || 0, dirtyTs: Date.now() };
      setMeta(m2);
      await pushKind('recDel');
      await pushKind('records');
    } catch (e) {}
    return;
  }

  if ((mm.dirtyTs || 0) > (r.serverUpdatedAt || 0)) {
    /* 本机更新 → 覆盖云端 */
    try {
      const r2 = await cloudCall({ action: 'save', kind, data, rev: r.serverRev || 0 });
      if (r2.ok) {
        const m3 = getMeta();
        m3[kind] = { rev: r2.rev, dirtyTs: 0 };
        setMeta(m3);
      }
    } catch (e) {}
  } else {
    /* 远端更新 → 采用远端 */
    try {
      const all = await cloudCall({ action: 'loadAll' });
      if (all.ok && all.docs[kind]) {
        setKindData(kind, all.docs[kind].data);
        const m4 = getMeta();
        m4[kind] = { rev: all.docs[kind].rev || 0, dirtyTs: 0 };
        setMeta(m4);
        notifyPages();
      }
    } catch (e) {}
  }
}

async function pushAll() {
  for (const kind of KINDS) {
    try { await pushKind(kind); } catch (e) {}
  }
}

function isMeaningful(kind) {
  if (kind === 'records') return store.loadRecords().length > 0;
  if (kind === 'recDel') return (getSync(K_REC_DEL, []) || []).length > 0;
  return false;
}

async function pullAll() {
  let r;
  try { r = await cloudCall({ action: 'loadAll' }); } catch (e) { return; }
  if (!r.ok) return;
  const m = getMeta();
  let changed = false;

  for (const kind of KINDS) {
    const doc = r.docs[kind];
    const mm = m[kind] || { rev: 0, dirtyTs: 0 };
    const firstContact = !mm.rev && !mm.dirtyTs;

    if (firstContact) {
      /* 第一次接通同步：本机有真实数据 → 以本机为源推上去（防被云端旧数据/空数据覆盖）；
         本机是空的 → 采用云端（新设备首次打开就是走这条） */
      if (isMeaningful(kind)) {
        markDirty(kind);
        continue;
      }
      if (!doc) continue;
      /* 落到下面的"采用云端" */
    } else {
      if (!doc) continue;
      if (mm.dirtyTs) continue; // 本地有未推送的改动，交给 pushAll
      if ((doc.rev || 0) === (mm.rev || 0)) continue;
    }

    if (kind === 'records') {
      const serverDels = (r.docs.recDel && r.docs.recDel.data) || [];
      const localRecs = store.loadRecords();
      const mergedDels = Array.from(new Set(getSync(K_REC_DEL, []).concat(serverDels)));
      const merged = mergeRecords(localRecs, doc.data || [], mergedDels);
      const serverIds = {};
      (doc.data || []).forEach((x) => { if (x && x.id) serverIds[x.id] = 1; });
      const hasLocalOnly = localRecs.some((x) => x && x.id && !serverIds[x.id]);
      setKindData('recDel', mergedDels);
      setKindData('records', merged);
      const m2 = getMeta();
      m2.records = { rev: doc.rev || 0, dirtyTs: 0 };
      m2.recDel = { rev: (r.docs.recDel && r.docs.recDel.rev) || 0, dirtyTs: 0 };
      setMeta(m2);
      changed = true;
      if (hasLocalOnly) markDirty('records'); // 本机有云上没有的 → 补推
    } else if (kind === 'recDel') {
      const mergedDels = Array.from(new Set(getSync(K_REC_DEL, []).concat(doc.data || [])));
      setKindData('recDel', mergedDels);
      const m3 = getMeta();
      m3.recDel = { rev: doc.rev || 0, dirtyTs: 0 };
      setMeta(m3);
    } else {
      setKindData(kind, doc.data);
      const m4 = getMeta();
      m4[kind] = { rev: doc.rev || 0, dirtyTs: 0 };
      setMeta(m4);
      changed = true;
    }
  }
  if (changed) notifyPages();
}

function notifyPages() {
  try {
    const pages = getCurrentPages();
    const pg = pages[pages.length - 1];
    if (pg && typeof pg.onSyncApplied === 'function') pg.onSyncApplied();
  } catch (e) {}
}

let pushTimer = null;
let syncing = false;
let lastPull = 0;

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; runSync(); }, 1200);
}

async function runSync() {
  if (syncing) return;
  syncing = true;
  try {
    await pushAll();
    const now = Date.now();
    if (now - lastPull > 15000) {
      lastPull = now;
      await pullAll();
    }
  } finally {
    syncing = false;
  }
}

const store = {
  loadItems() { return normalizeItems(getSync(K_ITEMS, null)); },
  /* 单价只在本机（店主要求：每台设备保持独立，不同步） */
  saveItems(items) { setSync(K_ITEMS, items); },
  loadRecords() {
    const r = getSync(K_RECORDS, []);
    return Array.isArray(r) ? r : [];
  },
  saveRecords(records) {
    const trimmed = trimRecords(records);
    /* 每条新订单打上设备标记（订单跨设备汇总时要区分是哪台机器报的） */
    const dev = getDevice();
    trimmed.forEach((r) => {
      if (r && r.id && !r.dev) { r.dev = dev.id; r.devName = dev.name; }
    });
    /* 对比出被删掉的 id，记墓碑（跨设备同步"删除"） */
    const oldIds = store.loadRecords().map((r) => r && r.id).filter(Boolean);
    const keep = {};
    trimmed.forEach((r) => { if (r && r.id) keep[r.id] = 1; });
    const dels = oldIds.filter((id) => !keep[id]);
    if (dels.length) {
      setSync(K_REC_DEL, Array.from(new Set(getSync(K_REC_DEL, []).concat(dels))));
      markDirty('recDel');
    }
    setSync(K_RECORDS, trimmed);
    markDirty('records');
  },
  loadDiscounts() { return normalizeDiscounts(getSync(K_DISCOUNTS, null)); },
  /* 满减也只在本机 */
  saveDiscounts(d) { setSync(K_DISCOUNTS, d); },
  deleteImage(path) {
    if (!path) return;
    try { fs.unlinkSync(path); } catch (e) {}
  },
  normalizeItems,
  normalizeDiscounts,
  syncInit() { runSync(); },
  syncKick() { runSync(); },
};

module.exports = store;
