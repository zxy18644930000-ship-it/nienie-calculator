const cloud = require('wx-server-sdk');
const https = require('https');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/* 注意：提示词里不要出现工人报的数量，避免模型被“带偏”直接复读报数 */
const PROMPT = '数一数这张照片里一共有几个独立的物品（一件件分得开的成品或半成品，比如玩偶、包装袋）。只输出一个阿拉伯数字，不要输出任何其他文字。如果完全看不清，输出0。';

async function getCfg() {
  try {
    const r = await db.collection('wl_config').doc('main').get();
    return r.data || {};
  } catch (e) {
    return {};
  }
}

function postJson(urlStr, key, body) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      reject(new Error('base_url 不对'));
      return;
    }
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 20000,
    }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(buf));
        } catch (e) {
          reject(new Error('接口返回看不懂：' + String(buf).slice(0, 80)));
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('接口超时')); });
    req.on('error', (e) => reject(new Error('接口请求失败：' + (e.message || e))));
    req.write(data);
    req.end();
  });
}

async function countOne(ai, fileID) {
  const keyEnv = ai.key_env || 'VLM_API_KEY';
  const key = process.env[keyEnv];
  if (!key) throw new Error('云函数环境变量 ' + keyEnv + ' 还没配置');
  if (!ai.base_url || !ai.model) throw new Error('wl_config.ai 里还没填 base_url / model');

  const dl = await cloud.downloadFile({ fileID });
  const b64 = dl.fileContent.toString('base64');
  const body = {
    model: ai.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } },
      ],
    }],
    max_tokens: 16,
    temperature: 0,
  };
  const res = await postJson(ai.base_url, key, body);
  const txt = (((res || {}).choices || [{}])[0].message || {}).content || '';
  const m = String(txt).match(/\d+/);
  if (!m) throw new Error('模型没返回数字：' + String(txt).slice(0, 60));
  return Math.max(0, Math.min(9999, parseInt(m[0], 10)));
}

/* 处理一批待数数的报工照片（定时触发，或在「异常复核」页手动刷新） */
exports.main = async (event) => {
  const cfg = await getCfg();
  const ai = cfg.ai || {};
  if (!ai.enabled) return { ok: true, skipped: 'AI 数数未开启（wl_config.ai.enabled=false）' };

  const batch = Math.min(Math.max(Number((event && event.batch) || 5), 1), 20);
  const r = await db.collection('wl_reports')
    .where({ ai_status: 'pending' }).orderBy('ts', 'asc').limit(batch).get();
  const list = r.data || [];

  let done = 0;
  let failed = 0;
  for (const it of list) {
    try {
      const count = await countOne(ai, it.photo);
      const dev = Math.abs(count - it.qty) / Math.max(it.qty, 1);
      await db.collection('wl_reports').doc(it._id).update({
        data: {
          ai_status: 'done',
          ai_count: count,
          ai_flag: dev > (ai.flag_ratio || 0.3),
        },
      });
      done++;
    } catch (e) {
      await db.collection('wl_reports').doc(it._id).update({
        data: { ai_status: 'error', ai_err: String((e && e.message) || e).slice(0, 180) },
      });
      failed++;
    }
  }
  return { ok: true, done, failed, pending_left: list.length === batch ? '还有' : '本批处理完' };
};
