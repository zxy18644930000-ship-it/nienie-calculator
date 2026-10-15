const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

const TZ = 8 * 3600 * 1000;
const todayStr = () => new Date(Date.now() + TZ).toISOString().slice(0, 10);
const timeText = (ts) => new Date(ts + TZ).toISOString().slice(11, 16);
const moneyText = (c) => {
  const v = (Number(c) || 0) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};
const toCents = (yuan) => Math.round((Number(yuan) || 0) * 100);

async function getCfg() {
  try {
    const r = await db.collection('wl_config').doc('main').get();
    return r.data || {};
  } catch (e) {
    return {};
  }
}

async function nameMap() {
  const users = (await db.collection('wl_users').limit(200).get()).data || [];
  const m = {};
  users.forEach((u) => { m[u.openid] = u.name || '未命名'; });
  return m;
}

/* 服务端换临时链接：默认存储权限下，管理员客户端直接拿不到别人上传的照片，必须由云函数代换 */
async function tempUrls(fileIDs) {
  const ids = (fileIDs || []).filter((x) => x && String(x).indexOf('cloud://') === 0);
  if (!ids.length) return {};
  try {
    const r = await cloud.getTempFileURL({ fileList: ids });
    const m = {};
    (r.fileList || []).forEach((f) => { if (f.tempFileURL) m[f.fileID] = f.tempFileURL; });
    return m;
  } catch (e) {
    return {};
  }
}

const COLLECTIONS = ['wl_users', 'wl_processes', 'wl_reports', 'wl_summary', 'wl_config', 'wl_aicounts'];

async function ensureCollections() {
  for (const name of COLLECTIONS) {
    try { await db.createCollection(name); } catch (e) { /* 已存在则忽略 */ }
  }
}

/* 管理员口令认领。
   首次运行（还没有 wl_config/main）时：这次输入的口令就直接成为管理口令，
   同时自动建好全部数据库集合 —— 老板点一次「管理员入口」即完成初始化。 */
async function claim(openid, event) {
  const pass = String(event.pass || '').trim();
  if (pass.length < 4) return { ok: false, err: '口令至少 4 个字' };

  let cfg = null;
  try {
    const r = await db.collection('wl_config').doc('main').get();
    cfg = r.data || null;
  } catch (e) {
    cfg = null;
  }

  if (!cfg) {
    await ensureCollections();
    try {
      await db.collection('wl_config').add({
        data: {
          _id: 'main',
          admin_openids: [openid],
          admin_pass: pass,
          ai: { enabled: false, flag_ratio: 0.3, base_url: '', model: '', key_env: 'VLM_API_KEY' },
          cts: Date.now(),
        },
      });
    } catch (e) {
      return { ok: false, err: '初始化失败：' + String((e && (e.errMsg || e.message)) || e).slice(0, 80) };
    }
    return { ok: true, initialized: true };
  }

  if (!cfg.admin_pass) {
    return { ok: false, err: '配置里没有管理口令：把数据库 wl_config 里的 main 删掉，再点一次「管理员入口」重新初始化' };
  }
  if (pass !== String(cfg.admin_pass)) return { ok: false, err: '口令不对' };

  const admins = cfg.admin_openids || [];
  if (admins.indexOf(openid) < 0) admins.push(openid);
  await db.collection('wl_config').doc('main').update({ data: { admin_openids: admins } });
  return { ok: true };
}

async function processList() {
  const r = await db.collection('wl_processes').orderBy('cts', 'asc').limit(100).get();
  return {
    ok: true,
    list: (r.data || []).map((p) => ({
      id: p._id, name: p.name, price_text: moneyText(p.price_c), active: p.active !== false,
    })),
  };
}

async function processSave(event) {
  if (event.id) {
    const data = {};
    if (event.name !== undefined) {
      const name = String(event.name).trim();
      if (!name || name.length > 20) return { ok: false, err: '工序名请填 1~20 个字' };
      data.name = name;
    }
    if (event.unit_price !== undefined) {
      const c = toCents(event.unit_price);
      if (!(c >= 0) || c > 999999) return { ok: false, err: '单价填 0~9999 元' };
      data.price_c = c;
    }
    if (event.active !== undefined) data.active = !!event.active;
    if (!Object.keys(data).length) return { ok: false, err: '没有要保存的内容' };
    await db.collection('wl_processes').doc(String(event.id)).update({ data });
    return { ok: true };
  }
  const name = String(event.name || '').trim();
  const c = toCents(event.unit_price);
  if (!name || name.length > 20) return { ok: false, err: '工序名请填 1~20 个字' };
  if (!(c >= 0) || c > 999999) return { ok: false, err: '单价填 0~9999 元' };
  await db.collection('wl_processes').add({ data: { name, price_c: c, active: true, cts: Date.now() } });
  return { ok: true };
}

async function workerList() {
  const t = todayStr();
  const users = (await db.collection('wl_users').orderBy('cts', 'asc').limit(200).get()).data || [];
  const agg = await db.collection('wl_reports').aggregate()
    .match({ date: t })
    .group({ _id: '$openid', qty: $.sum('$qty'), amount_c: $.sum('$amount_c') })
    .end();
  const stat = {};
  (agg.list || []).forEach((g) => { stat[g._id] = g; });
  return {
    ok: true,
    list: users.map((u) => ({
      id: u._id,
      openid: u.openid,
      name: u.name || '',
      active: u.active !== false,
      today_qty: stat[u.openid] ? stat[u.openid].qty : 0,
      today_amount_text: moneyText(stat[u.openid] ? stat[u.openid].amount_c : 0),
    })),
  };
}

async function workerSave(event) {
  if (!event.id) return { ok: false, err: '缺少工人' };
  const data = {};
  if (event.name !== undefined) {
    const name = String(event.name).trim();
    if (!name || name.length > 10) return { ok: false, err: '姓名请填 1~10 个字' };
    data.name = name;
  }
  if (event.active !== undefined) data.active = !!event.active;
  if (!Object.keys(data).length) return { ok: false, err: '没有要保存的内容' };
  await db.collection('wl_users').doc(String(event.id)).update({ data });
  return { ok: true };
}

/* 某天的全员汇总（按人聚合）+ AI 对账（自报 vs AI 数） */
async function dailyGet(event) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(event.date || '')) ? String(event.date) : todayStr();
  const agg = await db.collection('wl_reports').aggregate()
    .match({ date })
    .group({ _id: { openid: '$openid', pid: '$process_id' }, qty: $.sum('$qty'), amount_c: $.sum('$amount_c') })
    .end();

  /* AI 侧的合计：只统计数成功的记录；AI 金额=各条 ai_count×单价 */
  const aiAgg = await db.collection('wl_reports').aggregate()
    .match({ date, ai_status: 'done' })
    .group({
      _id: '$openid',
      ai_qty: $.sum('$ai_count'),
      ai_amount_c: $.sum($.multiply(['$ai_count', '$price_c'])),
      ai_records: $.sum(1),
    })
    .end();
  const cntAgg = await db.collection('wl_reports').aggregate()
    .match({ date })
    .group({ _id: '$openid', records: $.sum(1) })
    .end();
  const aiBy = {};
  (aiAgg.list || []).forEach((g) => { aiBy[g._id] = g; });
  const cntBy = {};
  (cntAgg.list || []).forEach((g) => { cntBy[g._id] = g.records; });

  const names = await nameMap();
  const procs = (await db.collection('wl_processes').limit(100).get()).data || [];
  const pname = {};
  procs.forEach((p) => { pname[p._id] = p.name; });

  const byWorker = {};
  (agg.list || []).forEach((g) => {
    const oid = g._id.openid;
    const w = byWorker[oid] || (byWorker[oid] = {
      openid: oid, name: names[oid] || '未命名', qty: 0, amount_c: 0, items: [],
    });
    w.qty += g.qty;
    w.amount_c += g.amount_c;
    w.items.push({ name: pname[g._id.pid] || '（已删工序）', qty: g.qty, amount_text: moneyText(g.amount_c) });
  });

  const list = Object.keys(byWorker).map((k) => {
    const w = byWorker[k];
    w.items.sort((a, b) => b.qty - a.qty);
    const a = aiBy[k] || {};
    const records = cntBy[k] || 0;
    const ai_records = a.ai_records || 0;
    return {
      openid: w.openid,
      name: w.name,
      qty: w.qty,
      amount_text: moneyText(w.amount_c),
      items: w.items,
      ai_qty: a.ai_qty || 0,
      ai_amount_text: moneyText(a.ai_amount_c || 0),
      ai_missing: Math.max(0, records - ai_records),
    };
  });
  list.sort((a, b) => Number(b.amount_text) - Number(a.amount_text));

  const total_qty = list.reduce((s, w) => s + w.qty, 0);
  let total_c = 0;
  list.forEach((w) => { total_c += Math.round(Number(w.amount_text) * 100); });

  return { ok: true, date, list, total_qty, total_text: moneyText(total_c) };
}

/* 某天某人的明细（含照片） */
async function dayDetail(event) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(event.date || '')) ? String(event.date) : todayStr();
  const openid = String(event.openid || '');
  if (!openid) return { ok: false, err: '缺少工人' };
  const r = await db.collection('wl_reports').where({ date, openid })
    .orderBy('ts', 'asc').limit(300).get();
  const rows = r.data || [];
  const urls = await tempUrls(rows.map((x) => x.photo));
  return {
    ok: true,
    list: rows.map((it) => ({
      id: it._id,
      process_name: it.process_name,
      qty: it.qty,
      amount_text: moneyText(it.amount_c),
      time_text: timeText(it.ts),
      photo: it.photo,
      photo_url: urls[it.photo] || '',
      ai_flag: !!it.ai_flag,
      ai_count: it.ai_count === undefined ? null : it.ai_count,
      ai_status: it.ai_status || 'off',
      ai_err: String(it.ai_err || '').slice(0, 120),
      review: it.review || 'none',
    })),
  };
}

/* AI 数数对不上的记录清单 */
async function reviewList(event, cfg) {
  const status = event.status === 'done' ? 'done' : 'pending';
  const where = status === 'pending'
    ? { ai_flag: true, review: 'none' }
    : { ai_flag: true, review: _.neq('none') };
  const r = await db.collection('wl_reports').where(where).orderBy('ts', 'desc').limit(100).get();
  const names = await nameMap();
  const rows = r.data || [];
  const urls = await tempUrls(rows.map((x) => x.photo));
  return {
    ok: true,
    flag_ratio_text: String(Math.round(((cfg.ai && cfg.ai.flag_ratio) || 0.3) * 100)),
    list: rows.map((it) => {
      const ai = it.ai_count === undefined ? null : it.ai_count;
      const dev = ai === null ? null : Math.round(((ai - it.qty) / Math.max(it.qty, 1)) * 100);
      return {
        id: it._id,
        date: it.date,
        worker: names[it.openid] || it.worker_name || '未命名',
        process_name: it.process_name,
        qty: it.qty,
        ai_count: ai,
        dev_text: dev === null ? '' : (dev > 0 ? '+' : '') + dev + '%',
        time_text: it.date + ' ' + timeText(it.ts),
        photo: it.photo,
        photo_url: urls[it.photo] || '',
        review: it.review || 'none',
      };
    }),
  };
}

async function reviewMark(event) {
  if (!event.id) return { ok: false, err: '缺少记录' };
  const review = event.review === 'follow' ? 'follow' : 'ok';
  await db.collection('wl_reports').doc(String(event.id)).update({ data: { review } });
  return { ok: true };
}

/* 删除一条报工（工人报错了/误报时用），照片一并删掉 */
async function reportDelete(event) {
  const id = String(event.id || '');
  if (!id) return { ok: false, err: '缺少记录' };
  let photo = '';
  try {
    const r = await db.collection('wl_reports').doc(id).get();
    photo = (r.data && r.data.photo) || '';
  } catch (e) {
    return { ok: false, err: '这条记录不存在' };
  }
  await db.collection('wl_reports').doc(id).remove();
  if (photo.indexOf('cloud://') === 0) {
    try { await cloud.deleteFile({ fileList: [photo] }); } catch (e) {}
  }
  return { ok: true };
}

const HANDLERS = {
  processList,
  processSave,
  workerList,
  workerSave,
  dailyGet,
  dayDetail,
  reviewList,
  reviewMark,
  reportDelete,
};

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    if (event.action === 'claim') return await claim(OPENID, event);
    const cfg = await getCfg();
    if ((cfg.admin_openids || []).indexOf(OPENID) < 0) return { ok: false, err: '没有管理权限' };
    const fn = HANDLERS[event.action];
    if (!fn) return { ok: false, err: '未知操作' };
    return await fn(event, cfg);
  } catch (e) {
    const msg = String((e && (e.errMsg || e.message)) || e);
    if (msg.indexOf('not exist') >= 0 || msg.indexOf('COLLECTION') >= 0 || msg.indexOf('collection') >= 0) {
      return { ok: false, err: '云开发还没初始化：先在「报工」首页点底部「管理员入口」完成初始化' };
    }
    return { ok: false, err: '服务出错了，请重试' };
  }
};
