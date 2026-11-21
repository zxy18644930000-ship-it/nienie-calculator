const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/* 算价数据云端同步（老板专用）：本地优先，这里只负责存取
   kinds: items=商品格 / discounts=满减 / records=订单记录 / recDel=已删记录墓碑 */

const KINDS = ['items', 'discounts', 'records', 'recDel'];
const COL = 'wl_calc';

async function getCfg() {
  try {
    const r = await db.collection('wl_config').doc('main').get();
    return r.data || {};
  } catch (e) {
    return {};
  }
}

async function readDoc(kind) {
  try {
    const r = await db.collection(COL).doc(kind).get();
    return r.data || null;
  } catch (e) {
    return null;
  }
}

async function writeDoc(kind, data, rev) {
  const payload = { kind, data, rev, updatedAt: Date.now() };
  try {
    await db.collection(COL).doc(kind).set({ data: payload });
  } catch (e) {
    try {
      await db.createCollection(COL);
      await db.collection(COL).doc(kind).set({ data: payload });
    } catch (e2) {
      throw e2;
    }
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    const cfg = await getCfg();
    if ((cfg.admin_openids || []).indexOf(OPENID) < 0) return { ok: false, err: '没有权限' };

    if (event.action === 'loadAll') {
      const docs = {};
      for (const k of KINDS) {
        const d = await readDoc(k);
        docs[k] = d ? { rev: d.rev || 0, updatedAt: d.updatedAt || 0, data: d.data } : null;
      }
      return { ok: true, docs };
    }

    if (event.action === 'save') {
      const kind = String(event.kind || '');
      if (KINDS.indexOf(kind) < 0) return { ok: false, err: '未知类型' };
      const payloadStr = JSON.stringify(event.data === undefined ? null : event.data);
      if (payloadStr.length > 900 * 1024) return { ok: false, err: '数据太大（>900KB），暂不支持同步' };
      const doc = await readDoc(kind);
      const serverRev = doc ? (doc.rev || 0) : 0;
      const expectRev = Number(event.rev || 0);
      if (expectRev !== serverRev) {
        return { ok: false, conflict: true, serverRev, serverUpdatedAt: doc ? (doc.updatedAt || 0) : 0 };
      }
      const rev = serverRev + 1;
      await writeDoc(kind, event.data === undefined ? null : event.data, rev);
      return { ok: true, rev };
    }

    if (event.action === 'clear') {
      const out = {};
      for (const k of KINDS) {
        try {
          await db.collection(COL).doc(k).remove();
          out[k] = 'removed';
        } catch (e) {
          out[k] = 'none';
        }
      }
      return { ok: true, out };
    }

    return { ok: false, err: '未知操作' };
  } catch (e) {
    return { ok: false, err: '服务出错了，请重试' };
  }
};
