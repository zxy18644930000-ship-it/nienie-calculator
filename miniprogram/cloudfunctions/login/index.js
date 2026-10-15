const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

async function getCfg() {
  try {
    const r = await db.collection('wl_config').doc('main').get();
    return r.data || {};
  } catch (e) {
    return null;
  }
}

/* 识别当前微信身份：admin（管理员）/ worker（已登记工人）/ guest（首次使用）/ blocked（已停用） */
exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const cfg = await getCfg();
  if (!cfg) return { ok: false, err: '云开发还没初始化：管理员先点底部「管理员入口」完成初始化' };
  if ((cfg.admin_openids || []).indexOf(OPENID) >= 0) {
    return { ok: true, openid: OPENID, role: 'admin', name: '' };
  }
  let user = null;
  try {
    const r = await db.collection('wl_users').where({ openid: OPENID }).limit(1).get();
    user = r.data[0] || null;
  } catch (e) {
    return { ok: false, err: '数据集合还没建好，见部署手册' };
  }
  if (user && user.active === false) {
    return { ok: true, openid: OPENID, role: 'blocked', name: user.name || '' };
  }
  return {
    ok: true,
    openid: OPENID,
    role: user && user.name ? 'worker' : 'guest',
    name: user ? user.name : '',
  };
};
