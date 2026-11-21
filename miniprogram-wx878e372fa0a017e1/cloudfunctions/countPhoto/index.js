const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const md5 = (s) => crypto.createHash('md5').update(String(s)).digest('hex');

/* 单张即时数数的结果暂存（提交时由 report 云函数按照片取用、取完即删），
   这样「建议数量」是服务端算的，前端伪造不了 */
async function cacheCount(fileID, count, raw, votes) {
  const id = 'ai_' + md5(fileID);
  const data = { fileID, count, ts: Date.now(), raw: String(raw || '').slice(0, 200), votes: votes || [] };
  try {
    await db.collection('wl_aicounts').doc(id).set({ data });
  } catch (e) {
    try {
      await db.createCollection('wl_aicounts');
      await db.collection('wl_aicounts').doc(id).set({ data });
    } catch (e2) {}
  }
}

/* 注意：提示词里不要出现工人报的数量，避免模型被“带偏”直接复读报数。
   提示词要一次说清「什么算一件」：成品有带包装袋的、也有裸的（如画画工序），
   袋子/标签都不单独计数——含糊会让推理模型陷入纠结把额度耗尽。 */
const PROMPT = '数一数这张照片里有几个独立的成品（一件件分开、能数出来的成品；有的带塑料袋包装，有的没有包装，都算）。每个成品外部的塑料袋、挂着的标签卡片不算单独一件。只输出一行：答案：<数字>。看不清就输出：答案：0。';

/* 解析模型输出：优先「答案：N」标记；没标记就取最后一个数字（防止分辨率/尺寸之类的数字排前面被误抓） */
function parseCount(text) {
  const strip = (s) => String(s || '').replace(/<think>[\s\S]*?<\/think>/gi, ' ').replace(/<\/?think>/gi, ' ');
  const s = strip(text);
  const marked = s.match(/答案\s*[:：]\s*(\d{1,4})/);
  if (marked) return parseInt(marked[1], 10);
  const all = s.match(/\d{1,4}/g);
  if (all && all.length) return parseInt(all[all.length - 1], 10);
  return null;
}

async function getCfg() {
  try {
    const r = await db.collection('wl_config').doc('main').get();
    return r.data || {};
  } catch (e) {
    return {};
  }
}

function postJson(urlStr, key, body, timeoutMs) {
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
      timeout: timeoutMs || 26000,
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

async function askOnce(ai, key, b64, mime, timeoutMs) {
  const body = {
    model: ai.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } },
      ],
    }],
    /* 推理型多模态模型思考很费时间：实测真照片默认模式要 29 秒，low 模式 4 秒且答案一致 */
    max_tokens: 8192,
    reasoning_effort: 'low',
  };
  const res = await postJson(ai.base_url, key, body, timeoutMs);
  const ch = (((res || {}).choices || [{}])[0]) || {};
  const msg = ch.message || {};
  const content = String(msg.content || '');
  const reasoning = String(msg.reasoning_content || '');
  let n = content ? parseCount(content) : null;
  if (n === null && !content) {
    /* 正文为空（多为思考被截断）：只在思考里找到明确的「答案：N」才敢用，
       否则宁可报错也绝不从思考文本里随便抓数字——曾把图片分辨率 1080 抓成件数 */
    const m = String(reasoning).match(/答案\s*[:：]\s*(\d{1,4})/);
    if (m) n = parseInt(m[1], 10);
  }
  if (n === null) {
    throw new Error('模型没数出来（' + (ch.finish_reason || '') + '）：' + (content || reasoning).slice(0, 80));
  }
  return Math.max(0, Math.min(9999, n));
}

/* 多数投票：并行数两遍（≈ 一遍的等待时间）；两遍不一致再补第三遍取多数；
   三个都不同取中位数。实测同一张照片偶发抖动（17×5 里偶尔冒一个 18），投票能把这种压掉。 */
async function countVote(ai, fileID) {
  const keyEnv = ai.key_env || 'VLM_API_KEY';
  const key = process.env[keyEnv];
  if (!key) throw new Error('云函数环境变量 ' + keyEnv + ' 还没配置');
  if (!ai.base_url || !ai.model) throw new Error('wl_config.ai 里还没填 base_url / model');

  const dl = await cloud.downloadFile({ fileID });
  const b64 = dl.fileContent.toString('base64');
  const mime = /\.png$/i.test(fileID) ? 'image/png' : 'image/jpeg';

  const TMO = 20000;
  const votes = [];
  const picks = await Promise.all([
    askOnce(ai, key, b64, mime, TMO).catch(() => null),
    askOnce(ai, key, b64, mime, TMO).catch(() => null),
  ]);
  picks.forEach((v) => { if (v !== null) votes.push(v); });
  if (!votes.length) throw new Error('接口超时/失败（两次都没数出来）');
  if (votes.length === 2 && votes[0] !== votes[1]) {
    const third = await askOnce(ai, key, b64, mime, TMO).catch(() => null);
    if (third !== null) votes.push(third);
  }
  const cnt = {};
  votes.forEach((v) => { cnt[v] = (cnt[v] || 0) + 1; });
  let best = votes[0];
  let bestN = 0;
  Object.keys(cnt).forEach((k) => { if (cnt[k] > bestN) { bestN = cnt[k]; best = Number(k); } });
  if (bestN === 1 && votes.length === 3) best = votes.slice().sort((a, b) => a - b)[1];
  return { count: best, votes };
}

/* 数数失败的记号（count=-1）：让失败可查、可回溯 */
async function cacheFail(fileID, err) {
  const id = 'ai_' + md5(fileID);
  const data = { fileID, count: -1, err: String(err || '').slice(0, 160), ts: Date.now() };
  try {
    await db.collection('wl_aicounts').doc(id).set({ data });
  } catch (e) {
    try {
      await db.createCollection('wl_aicounts');
      await db.collection('wl_aicounts').doc(id).set({ data });
    } catch (e2) {}
  }
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

  /* 单张即时数数（报工页拍完照立刻调）：多数投票后放缓存供提交时取用 */
  if (event.fileID) {
    if (!ai.enabled) return { ok: false, err: 'AI 数数未开启' };
    const fid = String(event.fileID);
    try {
      const r = await countVote(ai, fid);
      await cacheCount(fid, r.count, '', r.votes);
      return { ok: true, count: r.count, votes: r.votes };
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 120);
      console.log('[countPhoto] 单张失败 fileID=' + fid + ' err=' + msg);
      await cacheFail(fid, msg);
      return { ok: false, err: msg };
    }
  }

  if (!ai.enabled) return { ok: true, skipped: 'AI 数数未开启（wl_config.ai.enabled=false）' };

  /* 批量补数：pending=新提交的；off=AI 开启前的老照片；retryErrors=手动重试判死的。
     自适应时间预算：单次调用总耗时控制在 42 秒内，数不完的留给下一轮（每 5 分钟一轮）。
     失败不清零：回到 pending 下轮再试，连败 4 次才标 error。 */
  const maxCount = Math.min(Math.max(Number((event && event.batch) || 10), 1), 30);
  const statuses = event.retryErrors ? ['pending', 'off', 'error'] : ['pending', 'off'];
  const r = await db.collection('wl_reports')
    .where({ ai_status: _.in(statuses) }).orderBy('ts', 'asc').limit(maxCount).get();
  const list = r.data || [];
  const started = Date.now();

  let done = 0;
  let failed = 0;
  for (const it of list) {
    if (Date.now() - started > 30000) break;
    try {
      const rr = await countVote(ai, it.photo);
      const count = rr.count;
      const dev = Math.abs(count - it.qty) / Math.max(it.qty, 1);
      await db.collection('wl_reports').doc(it._id).update({
        data: { ai_status: 'done', ai_count: count, ai_flag: dev > (ai.flag_ratio || 0.3), ai_tries: 0, ai_votes: rr.votes },
      });
      done++;
    } catch (e) {
      const baseTries = (event.retryErrors && it.ai_status === 'error') ? 0 : (it.ai_tries || 0);
      const tries = baseTries + 1;
      await db.collection('wl_reports').doc(it._id).update({
        data: {
          ai_status: tries >= 4 ? 'error' : 'pending',
          ai_tries: tries,
          ai_err: String((e && e.message) || e).slice(0, 180),
        },
      });
      failed++;
    }
  }
  return { ok: true, done, failed, processed: done + failed, budget_ms: Date.now() - started };
};
