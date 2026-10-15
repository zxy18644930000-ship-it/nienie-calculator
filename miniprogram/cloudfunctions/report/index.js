const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

const TZ = 8 * 3600 * 1000;
const todayStr = () => new Date(Date.now() + TZ).toISOString().slice(0, 10);
const dayStr = (ts) => new Date(ts + TZ).toISOString().slice(0, 10);
const timeText = (ts) => new Date(ts + TZ).toISOString().slice(11, 16);
const moneyText = (c) => {
  const v = (Number(c) || 0) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

async function getCfg() {
  try {
    const r = await db.collection('wl_config').doc('main').get();
    return r.data || {};
  } catch (e) {
    return {};
  }
}

async function getUser(openid) {
  try {
    const r = await db.collection('wl_users').where({ openid }).limit(1).get();
    return r.data[0] || null;
  } catch (e) {
    return null;
  }
}

function roleOf(openid, cfg, user) {
  if ((cfg.admin_openids || []).indexOf(openid) >= 0) return 'admin';
  if (user && user.active === false) return 'blocked';
  return user && user.name ? 'worker' : 'guest';
}

/* 首页数据：工序列表 + 我今天的产值 */
async function home(openid) {
  const cfg = await getCfg();
  const user = await getUser(openid);
  const role = roleOf(openid, cfg, user);
  const t = todayStr();

  const procs = await db.collection('wl_processes')
    .where({ active: true }).orderBy('cts', 'asc').limit(50).get();
  const processes = (procs.data || []).map((p) => ({
    id: p._id, name: p.name, price_text: moneyText(p.price_c),
  }));

  const agg = await db.collection('wl_reports').aggregate()
    .match({ openid, date: t })
    .group({ _id: { pid: '$process_id', pname: '$process_name' }, qty: $.sum('$qty'), amount_c: $.sum('$amount_c') })
    .end();

  let qty = 0;
  let amount_c = 0;
  const list = (agg.list || []).map((g) => {
    qty += g.qty;
    amount_c += g.amount_c;
    return { id: g._id.pid, name: g._id.pname, qty: g.qty, amount_text: moneyText(g.amount_c) };
  });
  list.sort((a, b) => b.qty - a.qty);

  return {
    ok: true,
    openid,
    role,
    name: user ? user.name : '',
    processes,
    today: { date: t, qty, amount_text: moneyText(amount_c), list },
  };
}

/* 首次使用填写姓名（之后可改名） */
async function setName(openid, event) {
  const name = String(event.name || '').trim();
  if (!name || name.length > 10) return { ok: false, err: '姓名请填 1~10 个字' };
  const user = await getUser(openid);
  if (user) {
    await db.collection('wl_users').doc(user._id).update({ data: { name, uts: Date.now() } });
  } else {
    await db.collection('wl_users').add({ data: { openid, name, active: true, cts: Date.now(), uts: Date.now() } });
  }
  return { ok: true };
}

/* 提交一条报工 */
async function submit(openid, event) {
  const cfg = await getCfg();
  const user = await getUser(openid);
  const role = roleOf(openid, cfg, user);
  if (role === 'blocked') return { ok: false, err: '账号已停用，请联系老板' };
  if (!user || !user.name) return { ok: false, err: '请先回首页填一下姓名' };

  const qty = Math.floor(Number(event.qty));
  if (!(qty >= 1) || qty > 9999) return { ok: false, err: '数量请填 1~9999' };

  const photo = String(event.photo || '');
  if (photo.indexOf('cloud://') !== 0) return { ok: false, err: '照片没上传成功，请重拍' };

  const pid = String(event.process_id || '');
  let proc = null;
  try {
    const r = await db.collection('wl_processes').doc(pid).get();
    proc = r.data;
  } catch (e) {
    proc = null;
  }
  if (!proc || proc.active === false) return { ok: false, err: '这个工序不存在或已停用' };

  /* 防重复：同一张照片不能提交两次 */
  const dup = await db.collection('wl_reports').where({ photo }).limit(1).get();
  if (dup.data.length) return { ok: false, err: '这张照片已经提交过了' };

  const t = todayStr();

  /* 防刷：2 秒内不重复提交；单人单日最多 300 条 */
  const recent = await db.collection('wl_reports').where({ openid }).orderBy('ts', 'desc').limit(1).get();
  const lastTs = recent.data.length ? recent.data[0].ts : 0;
  if (Date.now() - lastTs < 2000) return { ok: false, err: '提交太快了，稍等一下' };
  const cnt = await db.collection('wl_reports').where({ openid, date: t }).count();
  if (cnt.total >= 300) return { ok: false, err: '今天提交次数太多啦，找老板看看' };

  const amount_c = proc.price_c * qty;
  const ts = Date.now();
  await db.collection('wl_reports').add({
    data: {
      openid,
      worker_name: user.name,
      process_id: pid,
      process_name: proc.name,
      price_c: proc.price_c,
      qty,
      amount_c,
      photo,
      date: t,
      ts,
      ai_status: cfg.ai && cfg.ai.enabled ? 'pending' : 'off',
      ai_count: null,
      ai_flag: false,
      review: 'none',
    },
  });

  const agg = await db.collection('wl_reports').aggregate()
    .match({ openid, date: t, process_id: pid })
    .group({ _id: null, qty: $.sum('$qty') })
    .end();
  const today_qty = (agg.list && agg.list[0] && agg.list[0].qty) || 0;

  return { ok: true, today_qty, amount_text: moneyText(amount_c) };
}

/* 我的记录（按天分组） */
async function mine(openid, event) {
  const days = Math.min(Math.max(Number(event.days) || 14, 1), 31);
  const cutoff = dayStr(Date.now() - (days - 1) * 86400 * 1000);
  const r = await db.collection('wl_reports')
    .where({ openid, date: _.gte(cutoff) })
    .orderBy('ts', 'desc').limit(500).get();

  const map = {};
  (r.data || []).forEach((it) => {
    const d = map[it.date] || (map[it.date] = { date: it.date, qty: 0, amount_c: 0, items: [] });
    d.qty += it.qty;
    d.amount_c += it.amount_c;
    d.items.push({
      id: it._id,
      process_name: it.process_name,
      qty: it.qty,
      amount_text: moneyText(it.amount_c),
      time_text: timeText(it.ts),
      photo: it.photo,
      ai_flag: !!it.ai_flag,
    });
  });

  const list = Object.keys(map).sort().reverse().map((k) => {
    const d = map[k];
    return { date: d.date, qty: d.qty, amount_text: moneyText(d.amount_c), items: d.items };
  });
  return { ok: true, days: list };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    if (event.action === 'setName') return await setName(OPENID, event);
    if (event.action === 'submit') return await submit(OPENID, event);
    if (event.action === 'mine') return await mine(OPENID, event);
    return await home(OPENID);
  } catch (e) {
    const msg = String((e && (e.errMsg || e.message)) || e);
    if (msg.indexOf('not exist') >= 0 || msg.indexOf('COLLECTION') >= 0 || msg.indexOf('collection') >= 0) {
      return { ok: false, err: '云开发还没初始化：管理员先点底部「管理员入口」完成初始化' };
    }
    return { ok: false, err: '服务出错了，请重试' };
  }
};
