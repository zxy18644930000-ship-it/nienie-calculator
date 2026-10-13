'use strict';

/* ==================== 工具 ==================== */
const $ = (s) => document.querySelector(s);
const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad2 = (n) => String(n).padStart(2, '0');

function cents(p) { return Math.round((Number(p) || 0) * 100); }
function fmtMoney(c) {
  const v = c / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
function fmtTime(ts) {
  const d = new Date(ts);
  return (d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/* ==================== 常量 ==================== */
const DEFAULT_ITEMS = 15;
const MAX_ITEMS = 60;
const MAX_RECORDS = 500;
const META_ITEMS = 'items';
const META_RECORDS = 'records';

/* ==================== 状态 ==================== */
const state = {
  items: [],          // [{ id, price, hasImg }]
  counts: {},         // itemId -> 本单件数
  records: [],        // [{ id, ts, no, items:[{no,price,count}], total, count }]
  editing: false,
  imgURLs: new Map(), // itemId -> objectURL
};

let pendingItemId = null;

/* ==================== 元素 ==================== */
const el = {
  grid: $('#grid'),
  editBanner: $('#editBanner'),
  btnEditDone: $('#btnEditDone'),
  totalAmount: $('#totalAmount'),
  totalCount: $('#totalCount'),
  totalDetail: $('#totalDetail'),
  customerNo: $('#customerNo'),
  btnEdit: $('#btnEdit'),
  btnRecords: $('#btnRecords'),
  btnSave: $('#btnSave'),
  btnClear: $('#btnClear'),
  btnAddItem: $('#btnAddItem'),
  recordsView: $('#recordsView'),
  recordsList: $('#recordsList'),
  btnRecordsBack: $('#btnRecordsBack'),
  btnExport: $('#btnExport'),
  btnImport: $('#btnImport'),
  modalRoot: $('#modalRoot'),
  toastBox: $('#toastBox'),
  filePicker: $('#filePicker'),
  importPicker: $('#importPicker'),
};

/* ==================== 提示 / 弹窗 ==================== */
let toastTimer = null;
function toast(msg) {
  el.toastBox.textContent = msg;
  el.toastBox.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toastBox.classList.remove('show'), 2000);
}

function closeModal() {
  el.modalRoot.innerHTML = '';
  el.modalRoot.classList.add('hidden');
}

function openModal(build) {
  el.modalRoot.innerHTML = '';
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const box = document.createElement('div');
  box.className = 'modal-box';
  mask.appendChild(box);
  mask.addEventListener('click', (e) => { if (e.target === mask) closeModal(); });
  el.modalRoot.appendChild(mask);
  el.modalRoot.classList.remove('hidden');
  build(box, closeModal);
}

function openInputModal(opts) {
  openModal((box, close) => {
    const h = document.createElement('h3');
    h.textContent = opts.title;
    box.appendChild(h);

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = opts.inputMode || 'text';
    input.value = opts.value != null ? String(opts.value) : '';
    input.placeholder = opts.placeholder || '';
    box.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn secondary';
    cancel.textContent = '取消';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn primary';
    ok.textContent = opts.okText || '确定';
    actions.append(cancel, ok);
    box.appendChild(actions);

    cancel.addEventListener('click', close);
    const submit = async () => {
      const proceed = await opts.onOk(input.value.trim());
      if (proceed !== false) close();
    };
    ok.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    input.focus();
    input.select();
  });
}

function openConfirmModal(opts) {
  openModal((box, close) => {
    const h = document.createElement('h3');
    h.textContent = opts.title;
    box.appendChild(h);

    if (opts.text) {
      const p = document.createElement('p');
      p.className = 'modal-text';
      p.textContent = opts.text;
      box.appendChild(p);
    }

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn secondary';
    cancel.textContent = opts.cancelText || '取消';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn ' + (opts.danger ? 'danger' : 'primary');
    ok.textContent = opts.okText || '确定';
    actions.append(cancel, ok);
    box.appendChild(actions);

    cancel.addEventListener('click', close);
    ok.addEventListener('click', () => { close(); if (opts.onOk) opts.onOk(); });
  });
}

/* ==================== 汇总 ==================== */
function totals() {
  let c = 0;
  let n = 0;
  for (const it of state.items) {
    const k = state.counts[it.id] || 0;
    if (k > 0) { c += cents(it.price) * k; n += k; }
  }
  return { c, n };
}

function updateSummary() {
  const t = totals();
  el.totalAmount.textContent = fmtMoney(t.c);
  el.totalCount.textContent = '共 ' + t.n + ' 件';
  const parts = [];
  state.items.forEach((it, i) => {
    const k = state.counts[it.id] || 0;
    if (k > 0) parts.push((i + 1) + '号×' + k);
  });
  el.totalDetail.textContent = parts.join(' + ');
}

/* ==================== 网格渲染 ==================== */
function renderGrid() {
  const keepScroll = el.grid.scrollTop;
  el.grid.innerHTML = '';
  state.items.forEach((it, idx) => el.grid.appendChild(buildCard(it, idx)));
  el.grid.scrollTop = keepScroll;
}

function buildCard(it, idx) {
  const card = document.createElement('div');
  card.className = 'card' + ((state.counts[it.id] || 0) > 0 ? ' sel' : '');
  card.dataset.id = it.id;

  const no = document.createElement('div');
  no.className = 'no';
  no.textContent = (idx + 1) + '号';
  card.appendChild(no);

  const wrap = document.createElement('div');
  wrap.className = 'imgwrap';

  const url = state.imgURLs.get(it.id);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    wrap.appendChild(img);
  } else {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.editing ? '点这里放图片' : '还没设置';
    wrap.appendChild(empty);
  }

  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = state.counts[it.id] || 0;
  wrap.appendChild(badge);
  card.appendChild(wrap);

  const foot = document.createElement('div');
  foot.className = 'card-foot';

  if (!state.editing) {
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'minus' + ((state.counts[it.id] || 0) > 0 ? '' : ' off');
    minus.textContent = '−';
    minus.addEventListener('pointerdown', (e) => e.stopPropagation());
    minus.addEventListener('pointerup', (e) => e.stopPropagation());
    minus.addEventListener('pointercancel', (e) => e.stopPropagation());
    minus.addEventListener('click', (e) => {
      e.stopPropagation();
      changeCount(it, -1);
    });
    foot.appendChild(minus);
  }

  const price = document.createElement('div');
  price.className = 'price';
  price.textContent = '¥' + fmtMoney(cents(it.price));
  foot.appendChild(price);
  card.appendChild(foot);

  if (state.editing) {
    if (it.hasImg) {
      const overlay = document.createElement('div');
      overlay.className = 'editbtn';
      overlay.textContent = '换图';
      wrap.appendChild(overlay);
    }
    wrap.addEventListener('click', () => pickImage(it));

    const del = document.createElement('div');
    del.className = 'delbtn';
    del.textContent = '×';
    card.appendChild(del);
    del.addEventListener('click', (e) => { e.stopPropagation(); askDeleteItem(it); });

    price.classList.add('editable');
    price.addEventListener('click', () => editPrice(it));
  } else {
    bindPress(card, it);
  }

  return card;
}

/* 单击 +1，长按 0.55 秒 -1 */
function bindPress(card, it) {
  let timer = null;

  const down = () => {
    if (state.editing) return;
    timer = setTimeout(() => {
      timer = null;
      changeCount(it, -1);
    }, 550);
  };
  const up = () => {
    if (state.editing) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
      changeCount(it, +1);
    }
  };
  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  card.addEventListener('pointerdown', down);
  card.addEventListener('pointerup', up);
  card.addEventListener('pointercancel', cancel);
  card.addEventListener('pointerleave', cancel);
  card.addEventListener('contextmenu', (e) => e.preventDefault());
}

function changeCount(it, delta) {
  if (!it.hasImg && !(it.price > 0)) {
    if (delta > 0) toast('这格还没设置，点右上角「编辑」加图片和价格');
    return;
  }
  const cur = state.counts[it.id] || 0;
  const next = Math.max(0, cur + delta);
  if (next === cur) return;
  state.counts[it.id] = next;
  updateCardVisual(it.id, next);
  updateSummary();
}

function updateCardVisual(id, n) {
  const card = el.grid.querySelector('.card[data-id="' + id + '"]');
  if (!card) return;
  card.classList.toggle('sel', n > 0);
  const badge = card.querySelector('.badge');
  badge.textContent = n;
  const minus = card.querySelector('.minus');
  if (minus) minus.classList.toggle('off', n === 0);
  if (n > 0) {
    badge.classList.remove('bump');
    void badge.offsetWidth;
    badge.classList.add('bump');
  }
}

/* ==================== 编辑模式 ==================== */
function setEditing(on) {
  state.editing = on;
  document.body.classList.toggle('editing', on);
  el.btnEdit.textContent = on ? '完成' : '编辑';
  el.editBanner.classList.toggle('hidden', !on);
  renderGrid();
}

async function addItem() {
  if (state.items.length >= MAX_ITEMS) {
    toast('最多 ' + MAX_ITEMS + ' 格');
    return;
  }
  state.items.push({ id: uid(), price: 0, hasImg: false });
  await persistItems();
  renderGrid();
  el.grid.scrollTop = el.grid.scrollHeight;
}

function askDeleteItem(it) {
  const idx = state.items.indexOf(it);
  openConfirmModal({
    title: '删除 ' + (idx + 1) + ' 号格？',
    text: '这一格的图片和价格会一起删掉。',
    okText: '删除',
    danger: true,
    onOk: async () => {
      const url = state.imgURLs.get(it.id);
      if (url) { URL.revokeObjectURL(url); state.imgURLs.delete(it.id); }
      delete state.counts[it.id];
      state.items = state.items.filter((x) => x.id !== it.id);
      try { await NienieDB.delImage(it.id); } catch (e) {}
      await persistItems();
      renderGrid();
      updateSummary();
    },
  });
}

function pickImage(it) {
  pendingItemId = it.id;
  el.filePicker.value = '';
  el.filePicker.click();
}

async function onFilePicked() {
  const file = el.filePicker.files && el.filePicker.files[0];
  el.filePicker.value = '';
  if (!file) return;
  const it = state.items.find((x) => x.id === pendingItemId);
  pendingItemId = null;
  if (!it) return;

  toast('正在处理图片…');
  try {
    const blob = await compressImage(file);
    await NienieDB.putImage(it.id, blob);
    const old = state.imgURLs.get(it.id);
    if (old) URL.revokeObjectURL(old);
    state.imgURLs.set(it.id, URL.createObjectURL(blob));
    it.hasImg = true;
    await persistItems();
    renderGrid();
  } catch (e) {
    toast('这张图没读成功，换一张试试');
  }
}

function editPrice(it) {
  openInputModal({
    title: '改价（元）',
    value: it.price ? String(it.price) : '',
    placeholder: '如 28',
    inputMode: 'decimal',
    onOk: async (val) => {
      const p = parseFloat(val);
      if (isNaN(p) || p < 0 || p > 99999) {
        toast('价格填个数字，如 28');
        return false;
      }
      it.price = Math.round(p * 100) / 100;
      await persistItems();
      renderGrid();
      updateSummary();
    },
  });
}

/* ==================== 本单操作 ==================== */
async function saveOrder() {
  const t = totals();
  if (t.n === 0) {
    toast('还没选商品');
    return;
  }
  const rec = {
    id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts: Date.now(),
    no: el.customerNo.value.trim(),
    items: state.items
      .map((it, i) => ({ no: i + 1, price: it.price || 0, count: state.counts[it.id] || 0 }))
      .filter((x) => x.count > 0),
    total: t.c,
    count: t.n,
  };
  state.records.unshift(rec);
  if (state.records.length > MAX_RECORDS) state.records.length = MAX_RECORDS;
  try { await NienieDB.set(META_RECORDS, state.records); } catch (e) {}

  state.counts = {};
  el.customerNo.value = '';
  renderGrid();
  updateSummary();

  toast('已保存 ¥' + fmtMoney(rec.total));
}

function clearOrder() {
  const t = totals();
  if (t.n === 0 && !el.customerNo.value.trim()) {
    state.counts = {};
    renderGrid();
    updateSummary();
    return;
  }
  openConfirmModal({
    title: '清空本单？',
    text: '已选 ' + t.n + ' 件，合计 ¥' + fmtMoney(t.c),
    okText: '清空',
    onOk: () => {
      state.counts = {};
      el.customerNo.value = '';
      renderGrid();
      updateSummary();
    },
  });
}

/* ==================== 记录 ==================== */
function openRecords() {
  renderRecords();
  el.recordsView.classList.remove('hidden');
}

function closeRecords() {
  el.recordsView.classList.add('hidden');
}

function renderRecords() {
  const list = el.recordsList;
  list.innerHTML = '';
  if (!state.records.length) {
    const e = document.createElement('div');
    e.className = 'records-empty';
    e.textContent = '还没有保存过单子';
    list.appendChild(e);
    return;
  }
  for (const r of state.records) {
    const card = document.createElement('div');
    card.className = 'record';

    const top = document.createElement('div');
    top.className = 'r-top';
    const no = document.createElement('span');
    no.className = 'r-no' + (r.no ? '' : ' muted');
    no.textContent = r.no ? ('顾客 ' + r.no) : '未填编号';
    const time = document.createElement('span');
    time.className = 'r-time';
    time.textContent = fmtTime(r.ts);
    top.append(no, time);

    const items = document.createElement('div');
    items.className = 'r-items';
    items.textContent = r.items.map((x) => x.no + '号×' + x.count).join(' + ') + '（共 ' + r.count + ' 件）';

    const total = document.createElement('div');
    total.className = 'r-total';
    total.textContent = '¥' + fmtMoney(r.total);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'r-del';
    del.textContent = '删除';
    del.addEventListener('click', () => {
      openConfirmModal({
        title: '删除这条记录？',
        okText: '删除',
        danger: true,
        onOk: async () => {
          state.records = state.records.filter((x) => x.id !== r.id);
          try { await NienieDB.set(META_RECORDS, state.records); } catch (e) {}
          renderRecords();
        },
      });
    });

    card.append(top, items, total, del);
    list.appendChild(card);
  }
}

/* ==================== 备份 ==================== */
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataURL) {
  return fetch(dataURL).then((r) => r.blob());
}

async function exportBackup() {
  try {
    toast('正在打包备份…');
    const images = {};
    for (const it of state.items) {
      if (!it.hasImg) continue;
      const blob = await NienieDB.getImage(it.id);
      if (blob) images[it.id] = await blobToDataURL(blob);
    }
    const data = {
      app: 'nienie-calculator',
      version: 1,
      exportedAt: new Date().toISOString(),
      items: state.items,
      records: state.records,
      images,
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const d = new Date();
    a.download = '捏捏乐备份-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    setTimeout(() => toast('备份文件已生成，存到「文件」里保管好'), 700);
  } catch (e) {
    toast('导出没成功，稍后再试');
  }
}

async function onImportPicked() {
  const file = el.importPicker.files && el.importPicker.files[0];
  el.importPicker.value = '';
  if (!file) return;

  let data = null;
  try { data = JSON.parse(await file.text()); } catch (e) {}
  if (!data || data.app !== 'nienie-calculator' || !Array.isArray(data.items)) {
    toast('这不是捏捏乐备份文件');
    return;
  }

  openConfirmModal({
    title: '导入备份？',
    text: '会覆盖当前全部商品设置和记录，恢复成备份里的样子。',
    okText: '导入并覆盖',
    danger: true,
    onOk: async () => {
      try {
        await NienieDB.clearAll();
        for (const k of state.imgURLs.keys()) URL.revokeObjectURL(state.imgURLs.get(k));
        state.imgURLs.clear();
        state.counts = {};

        state.items = data.items.map((it) => ({
          id: String(it.id || uid()),
          price: Number(it.price) || 0,
          hasImg: !!it.hasImg,
        }));
        state.records = Array.isArray(data.records) ? data.records : [];
        await persistItems();
        await NienieDB.set(META_RECORDS, state.records);

        const images = data.images || {};
        for (const it of state.items) {
          const durl = images[it.id];
          if (it.hasImg && durl) {
            const blob = await dataURLToBlob(durl);
            await NienieDB.putImage(it.id, blob);
            state.imgURLs.set(it.id, URL.createObjectURL(blob));
          } else {
            it.hasImg = false;
          }
        }
        await persistItems();

        renderGrid();
        updateSummary();
        renderRecords();
        toast('已从备份恢复');
      } catch (e) {
        toast('导入出错了，数据可能没恢复完整');
      }
    },
  });
}

/* ==================== 图片压缩 ==================== */
function compressImage(file, maxSide = 900, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        if (!iw || !ih) throw new Error('bad image');
        const scale = Math.min(1, maxSide / Math.max(iw, ih));
        const w = Math.max(1, Math.round(iw * scale));
        const h = Math.max(1, Math.round(ih * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error('toBlob failed'));
        }, 'image/jpeg', quality);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load failed')); };
    img.src = url;
  });
}

/* ==================== 初始化 ==================== */
function makeDefaultItems() {
  return Array.from({ length: DEFAULT_ITEMS }, () => ({ id: uid(), price: 0, hasImg: false }));
}

async function persistItems() {
  try { await NienieDB.set(META_ITEMS, state.items); } catch (e) {}
}

async function loadConfig() {
  let saved = null;
  try { saved = await NienieDB.get(META_ITEMS); } catch (e) {}

  if (Array.isArray(saved) && saved.length) {
    state.items = saved.map((it) => ({
      id: String(it.id || uid()),
      price: Number(it.price) || 0,
      hasImg: !!it.hasImg,
    }));
  } else {
    state.items = makeDefaultItems();
    await persistItems();
  }

  for (const it of state.items) {
    if (!it.hasImg) continue;
    try {
      const blob = await NienieDB.getImage(it.id);
      if (blob) state.imgURLs.set(it.id, URL.createObjectURL(blob));
      else it.hasImg = false;
    } catch (e) {
      it.hasImg = false;
    }
  }
}

function bindUI() {
  el.btnEdit.addEventListener('click', () => setEditing(!state.editing));
  el.btnEditDone.addEventListener('click', () => setEditing(false));
  el.btnRecords.addEventListener('click', openRecords);
  el.btnSave.addEventListener('click', saveOrder);
  el.btnClear.addEventListener('click', clearOrder);
  el.btnAddItem.addEventListener('click', addItem);
  el.btnRecordsBack.addEventListener('click', closeRecords);
  el.btnExport.addEventListener('click', exportBackup);
  el.btnImport.addEventListener('click', () => { el.importPicker.value = ''; el.importPicker.click(); });
  el.filePicker.addEventListener('change', onFilePicked);
  el.importPicker.addEventListener('change', onImportPicked);
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const doRegister = () => navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (document.readyState === 'complete') doRegister();
  else window.addEventListener('load', doRegister);
}

async function init() {
  await loadConfig();
  try { state.records = (await NienieDB.get(META_RECORDS)) || []; } catch (e) {}
  if (!Array.isArray(state.records)) state.records = [];

  renderGrid();
  updateSummary();
  bindUI();

  const blankShop = state.items.every((it) => !it.hasImg && !(it.price > 0));
  if (blankShop) setEditing(true);

  registerSW();
}

init();
