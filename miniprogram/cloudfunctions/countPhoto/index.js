const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const md5 = (s) => crypto.createHash('md5').update(String(s)).digest('hex');

/* 单张即时数数的结果暂存（提交时由 report 云函数按照片取用、取完即删），
   这样「建议数量」是服务端算的，前端伪造不了 */
async function cacheCount(fileID, count) {
  const id = 'ai_' + md5(fileID);
  const data = { fileID, count, ts: Date.now() };
  try {
    await db.collection('wl_aicounts').doc(id).set({ data });
  } catch (e) {
    try {
      await db.createCollection('wl_aicounts');
      await db.collection('wl_aicounts').doc(id).set({ data });
    } catch (e2) {}
  }
}

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
  const mime = /\.png$/i.test(fileID) ? 'image/png' : 'image/jpeg';
  const body = {
    model: ai.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } },
      ],
    }],
    /* 推理型多模态模型（如 MiniMax M3.x）需要足够输出预算，否则思考段就把额度吃完了 */
    max_tokens: 512,
  };
  const res = await postJson(ai.base_url, key, body);
  const msg = (((res || {}).choices || [{}])[0].message) || {};
  const raw = String(msg.content || msg.reasoning_content || '');
  /* 思考段混在正文里时先剥掉（<think>...</think>），剥完没数字再用原文兜底 */
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, ' ').replace(/<\/?think>/gi, ' ');
  const m = cleaned.match(/\d+/) || raw.match(/\d+/);
  if (!m) throw new Error('模型没返回数字：' + raw.slice(0, 80));
  return Math.max(0, Math.min(9999, parseInt(m[0], 10)));
}

/* 处理一批待数数的报工照片（定时触发，或在「异常复核」页手动刷新） */
exports.main = async (event) => {
  const cfg = await getCfg();

  /* 心跳：每次被调用（含定时器自动触发）都记一笔，用来确认定时器还活着 */
  try {
    await db.collection('wl_config').doc('main').update({
      data: { cp_hb: Date.now(), cp_hb_src: process.env.TRIGGER_SRC || 'api' },
    });
  } catch (e) {}

  const ai = cfg.ai || {};

  /* 单张即时数数（报工页拍完照立刻调）：只数不落库，结果放缓存供提交时取用 */
  if (event.fileID) {
    if (!ai.enabled) return { ok: false, err: 'AI 数数未开启' };
    try {
      const count = await countOne(ai, String(event.fileID));
      await cacheCount(String(event.fileID), count);
      return { ok: true, count };
    } catch (e) {
      return { ok: false, err: String((e && e.message) || e).slice(0, 120) };
    }
  }

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
