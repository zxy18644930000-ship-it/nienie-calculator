const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/* 触发器修复工具：只有一个用途 —— 在云函数里用运行时自带的腾讯云临时凭证
   调 SCF（云函数）服务的 CreateTrigger API，把两个定时触发器建出来。
   （微信开发者工具 CLI 部署不会带 config.json 里的 triggers，GUI 右键才会。） */

const ENV_ID = 'cloud1-d4gl6b3jtdd092de3';

const TRIGGERS = [
  { FunctionName: 'countPhoto', Name: 'wlCountPhotoTimer', Config: '0 */5 * * * * *' },
  { FunctionName: 'summarize', Name: 'wlSummarizeTimer', Config: '0 58 23 * * * *' },
];

const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest();

function scfRequest(secretId, secretKey, token, region, action, body) {
  return new Promise((resolve, reject) => {
    const host = 'scf.tencentcloudapi.com';
    const ts = Math.floor(Date.now() / 1000);
    const date = new Date(ts * 1000).toISOString().slice(0, 10);
    const payload = JSON.stringify(body);
    const canonical = [
      'POST', '/', '',
      'content-type:application/json; charset=utf-8',
      'host:' + host, '',
      'content-type;host',
      sha256hex(payload),
    ].join('\n');
    const scope = date + '/scf/tc3_request';
    const stringToSign = ['TC3-HMAC-SHA256', ts, scope, sha256hex(canonical)].join('\n');
    const kDate = hmac('TC3' + secretKey, date);
    const kService = hmac(kDate, 'scf');
    const kSigning = hmac(kService, 'tc3_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const auth = 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + scope +
      ', SignedHeaders=content-type;host, Signature=' + signature;
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      Authorization: auth,
      'X-TC-Action': action,
      'X-TC-Version': '2018-04-16',
      'X-TC-Region': region,
      'X-TC-Timestamp': String(ts),
      'Content-Length': Buffer.byteLength(payload),
    };
    if (token) headers['X-TC-Token'] = token;
    const req = https.request({ hostname: host, method: 'POST', path: '/', headers, timeout: 2400 }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { resolve({ raw: String(buf).slice(0, 200) }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('tcb api 超时')));
    req.on('error', (e) => reject(e));
    req.write(payload);
    req.end();
  });
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  let cfg = {};
  try { cfg = (await db.collection('wl_config').doc('main').get()).data || {}; } catch (e) {}
  if ((cfg.admin_openids || []).indexOf(OPENID) < 0) return { ok: false, err: '没有管理权限' };

  const sid = process.env.TENCENTCLOUD_SECRETID;
  const skey = process.env.TENCENTCLOUD_SECRETKEY;
  const token = process.env.TENCENTCLOUD_SESSIONTOKEN;
  if (!sid || !skey) {
    return {
      ok: false,
      err: '运行时没有腾讯云临时凭证',
      probe: Object.keys(process.env).filter((k) => /TENCENT|SCF_|CLOUD/i.test(k)),
    };
  }
  const region = String(event.region || process.env.TENCENTCLOUD_REGION || 'ap-shanghai');

  /* 只建一个（这次调用传哪个建哪个），保证单次调用远小于 3 秒超时 */
  const target = TRIGGERS.find((t) => !event.name || t.Name === event.name);
  if (!target) return { ok: false, err: '未知触发器名' };

  const namespace = String(event.namespace || process.env.SCF_NAMESPACE || 'default');

  /* action=list：列出 SCF 层真实存在的触发器（控制台面板可能不显示命令行创建的） */
  if (event.action === 'list') {
    const out = {};
    for (const t of TRIGGERS) {
      try {
        const resp = await scfRequest(sid, skey, token, region, 'ListTriggers', {
          FunctionName: t.FunctionName,
          Namespace: namespace,
          Limit: 20,
        });
        const r = resp.Response || resp;
        out[t.FunctionName] = r.Error ? r.Error : (r.Triggers || []).map((x) => ({
          name: x.TriggerName, type: x.Type, desc: x.TriggerDesc, enable: x.Enable,
        }));
      } catch (e) {
        out[t.FunctionName] = String((e && e.message) || e);
      }
    }
    return { ok: true, region, namespace, triggers: out };
  }

  /* action=hb：读 countPhoto 写入的心跳（判断定时器是否在自动触发） */
  if (event.action === 'hb') {
    let doc = null;
    try { doc = (await db.collection('wl_config').doc('main').get()).data || {}; } catch (e) {}
    return {
      ok: true,
      now: Date.now(),
      cp_hb: (doc && doc.cp_hb) || null,
      cp_hb_src: (doc && doc.cp_hb_src) || null,
      age_s: doc && doc.cp_hb ? Math.round((Date.now() - doc.cp_hb) / 1000) : null,
    };
  }

  const cronExpr = target.Config;

  /* 官方文档：timer 的 TriggerDesc 直接填 Cron 表达式；其余候选格式纯属兜底 */
  const candidates = [
    { tag: 'raw-cron', desc: cronExpr },
    { tag: 'json-cron-argument-empty', desc: JSON.stringify({ cron: cronExpr, argument: '' }) },
    { tag: 'json-cron-argument-object', desc: JSON.stringify({ cron: cronExpr, argument: '{}' }) },
    { tag: 'json-cron-only', desc: JSON.stringify({ cron: cronExpr }) },
    { tag: 'kv', desc: 'cron=' + cronExpr },
  ];

  const attempts = [];
  for (const c of candidates) {
    try {
      const resp = await scfRequest(sid, skey, token, region, 'CreateTrigger', {
        FunctionName: target.FunctionName,
        TriggerName: target.Name,
        Type: 'timer',
        TriggerDesc: c.desc,
        Namespace: namespace,
        Enable: 'OPEN',
      });
      const r = (resp && resp.Response) || resp;
      const err = r && r.Error ? (r.Error.Code + ': ' + r.Error.Message) : null;
      attempts.push({ tag: c.tag, err });
      if (!err) return { ok: true, region, namespace, usedFormat: c.tag, resp: r };
      if (/exist|存在|InUse|重复/i.test(String(err))) {
        return { ok: true, region, namespace, alreadyExists: target.Name, usedFormat: c.tag };
      }
    } catch (e) {
      attempts.push({ tag: c.tag, err: String((e && e.message) || e) });
    }
  }
  return { ok: false, region, namespace, err: '所有候选格式都失败', attempts };
};
