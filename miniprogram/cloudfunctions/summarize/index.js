const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const $ = db.command.aggregate;

const TZ = 8 * 3600 * 1000;
const todayStr = () => new Date(Date.now() + TZ).toISOString().slice(0, 10);
const moneyText = (c) => {
  const v = (Number(c) || 0) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

/* 生成某天的产值快照（每天 23:58 自动跑一次，也可手动补跑） */
exports.main = async (event) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String((event && event.date) || ''))
    ? String(event.date) : todayStr();

  const agg = await db.collection('wl_reports').aggregate()
    .match({ date })
    .group({ _id: { openid: '$openid', pid: '$process_id' }, qty: $.sum('$qty'), amount_c: $.sum('$amount_c') })
    .end();

  const users = (await db.collection('wl_users').limit(200).get()).data || [];
  const names = {};
  users.forEach((u) => { names[u.openid] = u.name || '未命名'; });
  const procs = (await db.collection('wl_processes').limit(100).get()).data || [];
  const pname = {};
  procs.forEach((p) => { pname[p._id] = p.name; });

  const byWorker = {};
  (agg.list || []).forEach((g) => {
    const oid = g._id.openid;
    const w = byWorker[oid] || (byWorker[oid] = { openid: oid, name: names[oid] || '未命名', qty: 0, amount_c: 0, items: [] });
    w.qty += g.qty;
    w.amount_c += g.amount_c;
    w.items.push({ name: pname[g._id.pid] || '（已删工序）', qty: g.qty, amount_c: g.amount_c });
  });

  const workers = Object.keys(byWorker).map((k) => byWorker[k]);
  workers.sort((a, b) => b.amount_c - a.amount_c);
  const total_qty = workers.reduce((s, w) => s + w.qty, 0);
  const total_c = workers.reduce((s, w) => s + w.amount_c, 0);

  await db.collection('wl_summary').doc(date).set({
    data: {
      date,
      workers: workers.map((w) => ({ ...w, amount_text: moneyText(w.amount_c) })),
      total_qty,
      total_c,
      total_text: moneyText(total_c),
      gen_ts: Date.now(),
    },
  });

  return { ok: true, date, worker_count: workers.length, total_qty, total_text: moneyText(total_c) };
};
