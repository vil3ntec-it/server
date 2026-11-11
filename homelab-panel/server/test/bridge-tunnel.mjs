// ---------------------------------------------------------------------------
//  پاسخِ تونل روی نوشتنِ پل (۱.۵۰.۸۷، تصمیمِ ۳-۱۵ پرسشِ ۱ «الف»؛ ممیزی §۹ «۱.۵۰.۷۷ (شکافِ شناخته)»)
//      node test/bridge-tunnel.mjs
//
//  نوشتنی که به‌جای پاسخِ خودِ سرورِ حساب صفحهٔ خطای تونل را گرفت:
//    • ‎502/504/520/524‎ (رسید یا مبهم) ⇒ «نامعلوم»: ‎502 outcome_unknown‎ + ‎outcome: 'unknown'‎ + ‎upstreamStatus‎ + ردیفِ دفتر؛
//      همان کلیدِ پنجره دوباره به سرورِ حساب فرستاده نمی‌شود (پیش از تکرار ببینید)
//    • ‎521/522/523/525/526‎ (نرسیدهٔ روشن) ⇒ «شکست»: ‎502 tunnel_not_delivered‎ بی «نامعلوم» — و همان کلید **دوباره** فرستاده می‌شود
//    • JSON ِ خودِ سرورِ حساب با همان وضعیت‌ها همان‌طور می‌ماند؛ خواندن‌ها هرگز «نامعلوم» نیستند
//    • بارگذاریِ بایت (رسانهٔ پشتیبانی، `cloudRawBytes`) همان قاعده
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4979);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'bridge-tunnel-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/* ───────────── سرورِ حسابِ ساختگی پشتِ «تونلِ» ساختگی ───────────── */
const NOW = Date.now();
const seen = [];
let tunnel = 0;          //  وضعیتی که «تونل» به‌جای سرورِ حساب برمی‌گرداند (۰ ⇒ سرورِ حساب خودش)
let ownJson = 0;         //  سرورِ حساب خودش این وضعیت را با JSON ِ خطا می‌دهد
const html = (code) => `<!DOCTYPE html><html><head><title>${code}: A timeout occurred</title></head><body>cloudflare ${code}</body></html>`;
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const p = new URL(req.url, 'http://x').pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: ['actor.v1', 'ops.v1'], serverTime: NOW });
    seen.push({ method: req.method, path: p });
    if (tunnel) { res.writeHead(tunnel, { 'content-type': 'text/html; charset=UTF-8' }); return void res.end(html(tunnel)); }
    if (ownJson) return j(ownJson, { error: { code: 'smtp_down', message: 'سرویسِ ایمیلِ سرورِ حساب جواب نداد' } });
    if (p === '/api/admin/ops/incidents') return j(200, { incidents: [], total: 0, limit: 200, offset: 0, counts: {} });
    if (/\/notes$/.test(p)) return j(201, { ok: true });
    { const m = /^\/api\/admin\/shops\/s1\/staff-perms\/devices\/([^/]+)\/disable$/.exec(p); if (m) return j(200, { id: m[1], disabledAt: NOW, sessionsRevoked: 1 }); }
    if (/^\/api\/admin\/support\/threads\/[^/]+\/media$/.test(p)) return j(201, { mediaId: 'md1', mime: 'image/png' });
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${fake.address().port}`;

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0',
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
         HLP_ACCOUNT_API: FAKE_URL, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
         HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, headers = {}, raw = null) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': raw ? raw.type : 'application/json', ...headers },
    body: raw ? raw.body : body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}
const count = (m, p) => seen.filter((s) => s.method === m && s.path === p).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await sleep(250);
  }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Tun-1405-owner' });
  const owner = (await api('POST', '/api/auth/login', { username: 'owner', password: 'Tun-1405-owner' })).json?.token;
  const H = { Authorization: `Bearer ${owner}` };
  const warm = await api('GET', '/api/account-admin/console/ops/incidents', undefined, H);
  check('پیش‌زمینه: پل سالم کار می‌کند', warm.status === 200, `${warm.status} ${warm.text.slice(0, 200)}`);

  let k = 0;
  const key = () => `tunnel-key-${String(++k).padStart(6, '0')}`;
  const note = (id, idem) => api('POST', `/api/account-admin/console/ops/incidents/${id}/notes`, { note: 'یادداشتِ آزمون', idempotencyKey: idem }, H);
  //  درِ «یک بار» ِ پنل (`makeIdemOnce`؛ سرورِ حسابِ بی `idempotent-writes.v1`): ازکارانداختنِ دستگاهِ کارمند
  const disable = (did, idem) => api('POST', `/api/account-admin/console/shops/s1/staff/devices/${did}/disable`, { reason: 'آزمونِ تونل', confirm: true, idempotencyKey: idem }, H);
  const devPath = (did) => `/api/admin/shops/s1/staff-perms/devices/${did}/disable`;

  console.log('\n── رسیده یا مبهم ⇒ «نامعلوم» ──');
  for (const code of [502, 504, 520, 524]) {
    tunnel = code;
    const r = await note(`inc_u${code}`, key());
    check(`⛔ نوشتن + صفحهٔ ${code} ِ تونل ⇒ ‎502 outcome_unknown‎ و ‎outcome: "unknown"‎ (نه «شکست»)`,
      r.status === 502 && r.json?.error === 'outcome_unknown' && r.json?.outcome === 'unknown' && r.json?.message?.includes('معلوم نیست'), `${r.status} ${r.text.slice(0, 200)}`);
    const did = `du${code}`;
    const idem = key();
    const d1 = await disable(did, idem);
    tunnel = 0;
    const again = await disable(did, idem);
    check(`⛔ ${code}: همان کلیدِ پنجره دوباره به سرورِ حساب نمی‌رود (پیش از تکرار ببینید)`,
      d1.json?.outcome === 'unknown' && count('POST', devPath(did)) === 1 && again.json?.outcome === 'unknown', `${count('POST', devPath(did))} ${d1.text.slice(0, 100)} | ${again.text.slice(0, 100)}`);
  }

  console.log('\n── نرسیدهٔ روشن ⇒ «شکست» ──');
  for (const code of [521, 522, 523, 525, 526]) {
    tunnel = code;
    const r = await note(`inc_f${code}`, key());
    check(`⛔ نوشتن + صفحهٔ ${code} ِ تونل ⇒ ‎502 tunnel_not_delivered‎، بی «نامعلوم»`,
      r.status === 502 && r.json?.error === 'tunnel_not_delivered' && r.json?.outcome === undefined, `${r.status} ${r.text.slice(0, 200)}`);
    const did = `df${code}`;
    const idem = key();
    const d1 = await disable(did, idem);
    tunnel = 0;
    const again = await disable(did, idem);
    check(`${code}: همان کلید آزاد است ⇒ دوباره فرستاده و این بار انجام شد`,
      d1.json?.error === 'tunnel_not_delivered' && again.status === 200 && again.json?.ok === true && count('POST', devPath(did)) === 2,
      `${again.status} ${count('POST', devPath(did))} ${again.text.slice(0, 160)}`);
  }

  console.log('\n── آن‌چه دست نخورد ──');
  ownJson = 502;
  const own = await note('inc_own', key());
  ownJson = 0;
  check('JSON ِ خطای خودِ سرورِ حساب (۵۰۲) همان‌طور می‌ماند — کدِ خودش، بی «نامعلوم»', own.status === 502 && own.json?.error === 'smtp_down' && own.json?.outcome === undefined, own.text.slice(0, 200));
  tunnel = 524;
  const rd = await api('GET', '/api/account-admin/console/ops/incidents', undefined, H);
  tunnel = 0;
  check('خواندن با ۵۲۴ ِ تونل «نامعلوم» نیست (خواندن تکرارپذیر است)', rd.status === 524 && rd.json?.outcome === undefined && rd.json?.error !== 'outcome_unknown', `${rd.status} ${rd.text.slice(0, 200)}`);
  tunnel = 404;
  const nf = await note('inc_404', key());
  tunnel = 0;
  check('صفحهٔ ۴۰۴ ِ HTML «نامعلوم» نیست (وضعیت خودش گفت نرسید/نبود)', nf.status === 404 && nf.json?.outcome === undefined, `${nf.status} ${nf.text.slice(0, 160)}`);

  console.log('\n── بارگذاریِ بایت (رسانهٔ پشتیبانی) ──');
  tunnel = 524;
  const up = await api('POST', '/api/account-admin/support/threads/t1/media?name=a.png', undefined, H, { type: 'image/png', body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
  tunnel = 522;
  const up2 = await api('POST', '/api/account-admin/support/threads/t2/media?name=a.png', undefined, H, { type: 'image/png', body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
  tunnel = 0;
  check('⛔ بارگذاری + ۵۲۴ ⇒ «نامعلوم»؛ + ۵۲۲ ⇒ «شکست»', up.json?.outcome === 'unknown' && up.json?.error === 'outcome_unknown' && up2.json?.error === 'tunnel_not_delivered' && up2.json?.outcome === undefined,
    `${up.status} ${up.text.slice(0, 120)} | ${up2.status} ${up2.text.slice(0, 120)}`);

  const aud = await api('GET', '/api/control/audit?q=account.bridge.outcome_unknown&limit=50&offset=0', undefined, H);
  const rows = (aud.json?.rows || []).filter((r) => r.action === 'account.bridge.outcome_unknown');
  check('⛔ هر «نامعلوم» ِ تونل یک ردیفِ دفتر (۴ یادداشت + ۴ دستگاه + ۱ بارگذاری؛ بازپخشِ همان کلید نه)، «شکست»‌ها نه', rows.length === 9, `${rows.length} ${JSON.stringify(rows.map((r) => r.entity_id))}`);
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  fake.close();
  await sleep(300);
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
