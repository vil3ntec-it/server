// ---------------------------------------------------------------------------
//  C-04 و C-05 (۱.۵۳.۳) — کلیدِ برنامه‌ها و رمزِ موضوع‌های اعلان روی دیسک فقط هش‌اند
//      node test/app-key-at-rest.mjs
//
//  هر دو «فقط سنجیدنی»اند (برنامه کلید را می‌فرستد، پنل می‌سنجد؛ هیچ مسیری خامِ آن‌ها را بعداً لازم ندارد)، پس
//  `sha256:` ِ جداشده با برچسب و مقایسهٔ ثابت‌زمان. روی سرورِ واقعی و ردیفِ واقعیِ ‎panel.db‎:
//   ۱) ساختنِ برنامه (هر دو دفتر) و چرخاندن: کلیدِ خام فقط همان یک پاسخ؛ فهرست فقط نشانه (پیشوند)؛ در دیتابیس فقط هش؛
//      همان کلید روی هر دو مسیرِ ورود؛ کلیدِ غلط و کلیدِ پیش از چرخاندن ⇒ ۴۰۱
//   ۲) رمزِ نوشتن/خواندنِ موضوع: خام فقط یک بار، در دیتابیس هش؛ فرستادن و خواندن با خام کار می‌کند، با هشِ خودِ ردیف نه؛
//      فرستادنِ مدیر از پنل (درِ مطمئن) کار می‌کند
//   ۳) ردیف‌های خامِ نسخهٔ پیشین با مهاجرتِ ۰۱۶/۰۱۷ در جا هش می‌شوند و همان کلید/رمز بی صدورِ دوباره کار می‌کند
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.TEST_PORT || 4831);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-appkey-rest-'));
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};
/** فقط شکل، هرگز خودِ مقدار */
const shape = (v) => (v == null || v === '' ? 'empty' : String(v).startsWith('sha256:') ? 'sha256' : 'raw');

const ENV = {
  ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: tmp, HLP_SITES_ROOT: path.join(tmp, 'sites'),
  HLP_TUNNEL: '0', HLP_DISCOVERY: '0', HLP_AGENT: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_RATE_LOGIN: '1000',
};
let child = null;
let out = '';
async function start() {
  out = '';
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
    { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch { /* */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
async function stop() {
  if (!child) return;
  const c = child; child = null;
  const gone = new Promise((r) => c.once('exit', r));
  c.kill('SIGTERM');
  await Promise.race([gone, new Promise((r) => setTimeout(r, 5000))]);
}
let admin = '';
async function call(method, url, body, { token = admin, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    if (raw) { h['Content-Type'] = 'text/plain'; payload = String(body); } else { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  }
  const r = await fetch(BASE + url, { method, headers: h, body: payload });
  let json = null;
  try { json = await r.json(); } catch { /* */ }
  return { status: r.status, json };
}
const withDb = (fn) => {
  const d = new DatabaseSync(path.join(tmp, 'panel.db'));
  try { d.exec('PRAGMA busy_timeout = 5000'); return fn(d); } finally { d.close(); }
};
const keysOf = (slug) => withDb((d) => ({
  code: d.prepare('SELECT api_key FROM code_apps WHERE slug = ?').get(slug)?.api_key ?? null,
  client: d.prepare('SELECT api_key FROM app_clients WHERE slug = ?').get(slug)?.api_key ?? null,
}));
const topicOf = (name) => withDb((d) => d.prepare('SELECT write_token, read_token FROM ntf_topics WHERE name = ?').get(name) || {});
const codeReq = (slug, key) => call('POST', '/api/codes/request', { app: slug, email: 'ali@example.com', userId: 'U-1' },
  { token: '', headers: key ? { 'X-Api-Key': key } : {} });
const authReq = (slug, key) => call('POST', '/api/app/auth/request-code', { email: 'shopper@example.com', app: slug, ...(key ? { key } : {}) }, { token: '' });
const bad = (r, code) => r.status === 401 && r.json?.error === code;

try {
  check('سرور بالا آمد', await start(), out.slice(-400));
  const setup = await call('POST', '/api/auth/setup', { username: 'admin', password: 'Passw0rd!xyz' }, { token: '' });
  check('مدیر ساخته شد', setup.status === 200 && setup.json?.token, JSON.stringify(setup.json));
  admin = setup.json.token;

  console.log('── ۱) C-04: کلیدِ برنامه ──');
  const made = await call('POST', '/api/codes-admin/apps', { slug: 'app-fuel', name: 'پمپ', kind: 'app' });
  const key1 = made.json?.app?.apiKey;
  check('ساختن: کلیدِ خام همان یک بار (code_ + ۴۰ hex)', made.status === 200 && /^code_[0-9a-f]{40}$/.test(String(key1)), JSON.stringify(made.json).slice(0, 160));
  let k = keysOf('app-fuel');
  check('⛔ در دیتابیس فقط هش (هر دو دفتر، یکسان)', shape(k.code) === 'sha256' && k.code === k.client && !String(k.code).includes(String(key1)),
    `${shape(k.code)}/${shape(k.client)}`);
  const list = await call('GET', '/api/codes-admin/apps');
  const row = list.json?.apps?.find((a) => a.slug === 'app-fuel');
  check('⛔ فهرست کلید را دیگر نشان نمی‌دهد، فقط نشانه', row && !row.apiKey && String(key1).startsWith(String(row.keyHint || '-')) && row.hasKey === true,
    JSON.stringify(row).slice(0, 160));
  const clients = await call('GET', '/api/app-admin/clients');
  const crow = clients.json?.clients?.find((c) => c.slug === 'app-fuel');
  check('⛔ دفترِ ورود هم کلید را نشان نمی‌دهد', crow && !crow.apiKey && crow.hasKey === true, JSON.stringify(crow).slice(0, 160));
  check('کلیدِ غلط ⇒ ۴۰۱', bad(await codeReq('app-fuel', 'code_' + '0'.repeat(40)), 'bad_key'));
  check('⛔ هشِ خودِ ردیف به‌جای کلید ⇒ ۴۰۱', bad(await codeReq('app-fuel', k.code), 'bad_key'));
  const ok1 = await codeReq('app-fuel', key1);
  check('کلیدِ خام روی مسیرِ کدها کار می‌کند', ok1.status !== 401, JSON.stringify(ok1.json).slice(0, 160));
  await call('PUT', '/api/app-admin/clients/app-fuel', { requireKey: true });
  check('مسیرِ ورود: کلیدِ غلط ⇒ ۴۰۱', bad(await authReq('app-fuel', 'nope'), 'bad_api_key'));
  const ok2 = await authReq('app-fuel', key1);
  check('همان کلید روی مسیرِ ورود هم کار می‌کند', ok2.status !== 401, JSON.stringify(ok2.json).slice(0, 160));

  const rot = await call('POST', '/api/codes-admin/apps/app-fuel/key');
  const key2 = rot.json?.app?.apiKey;
  check('چرخاندن: کلیدِ تازهٔ خام همان یک بار', /^code_[0-9a-f]{40}$/.test(String(key2)) && key2 !== key1);
  check('⛔ کلیدِ پیشین دیگر کار نمی‌کند', bad(await codeReq('app-fuel', key1), 'bad_key'));
  check('کلیدِ تازه روی هر دو مسیر', (await codeReq('app-fuel', key2)).status !== 401 && (await authReq('app-fuel', key2)).status !== 401);
  const rotC = await call('POST', '/api/app-admin/clients/app-fuel/key');
  const key3 = rotC.json?.client?.apiKey;
  k = keysOf('app-fuel');
  check('چرخاندن از دفترِ ورود: یک کلید برای هر دو دفتر', /^(code|hlp)_[0-9a-f]{32,40}$/.test(String(key3)) && k.code === k.client
    && (await codeReq('app-fuel', key3)).status !== 401 && bad(await codeReq('app-fuel', key2), 'bad_key'));
  const mc = await call('POST', '/api/app-admin/clients', { slug: 'web-shop', name: 'فروشگاه', kind: 'web' });
  const key4 = mc.json?.client?.apiKey;
  k = keysOf('web-shop');
  check('ساختن از دفترِ ورود: خام یک بار، هر دو دفتر همان هش', /^(code|hlp)_[0-9a-f]{32,40}$/.test(String(key4)) && shape(k.code) === 'sha256'
    && k.code === k.client && (await codeReq('web-shop', key4)).status !== 401, JSON.stringify(mc.json).slice(0, 160));

  console.log('── ۲) C-05: رمزِ موضوعِ اعلان ──');
  const wt = (await call('POST', '/api/notify-admin/private-alerts/token', {})).json?.token;
  const rt = (await call('POST', '/api/notify-admin/private-alerts/read-token', {})).json?.token;
  const tr = topicOf('private-alerts');
  check('رمزِ نوشتن و خواندن یک بار برگشت', Boolean(wt) && Boolean(rt));
  check('⛔ در دیتابیس فقط هش', shape(tr.write_token) === 'sha256' && shape(tr.read_token) === 'sha256'
    && !String(tr.write_token).includes(wt) && !String(tr.read_token).includes(rt), `${shape(tr.write_token)}/${shape(tr.read_token)}`);
  check('بی رمز ⇒ ۴۰۳', (await call('POST', '/api/notify/private-alerts', 'x', { token: '', raw: true })).status === 403);
  check('⛔ هشِ خودِ ردیف به‌جای رمز ⇒ ۴۰۳', (await call('POST', '/api/notify/private-alerts', 'x', { token: tr.write_token, raw: true })).status === 403);
  const sent = await call('POST', '/api/notify/private-alerts', 'با رمز', { token: wt, raw: true });
  check('با رمزِ خام فرستاده می‌شود', sent.json?.ok === true, JSON.stringify(sent.json));
  const readNo = await call('GET', '/api/notify/private-alerts/json', undefined, { token: '' });
  const readYes = await call('GET', `/api/notify/private-alerts/json?key=${encodeURIComponent(rt)}`, undefined, { token: '' });
  check('خواندن: بی رمز نه، با رمزِ خام بله', readNo.status === 403 && readYes.status === 200, `${readNo.status}/${readYes.status}`);
  const adminSend = await call('POST', '/api/notify-admin/private-alerts/send', { title: 'پنل', message: 'از پنل' });
  check('فرستادنِ مدیر از پنل (درِ مطمئن) کار می‌کند', adminSend.json?.ok === true, JSON.stringify(adminSend.json));
  await stop();

  console.log('── ۳) ردیف‌های خامِ نسخهٔ پیشین ⇒ مهاجرت ──');
  const legacyKey = `code_${crypto.randomBytes(20).toString('hex')}`;
  const legacyW = crypto.randomBytes(12).toString('base64url');
  const legacyR = crypto.randomBytes(12).toString('base64url');
  withDb((d) => {
    d.prepare("UPDATE code_apps SET api_key = ?, api_key_hint = NULL WHERE slug = 'app-fuel'").run(legacyKey);
    d.prepare("UPDATE app_clients SET api_key = ?, api_key_hint = NULL WHERE slug = 'app-fuel'").run(legacyKey);
    d.prepare("UPDATE ntf_topics SET write_token = ?, read_token = ? WHERE name = 'private-alerts'").run(legacyW, legacyR);
    d.exec('DELETE FROM schema_migrations WHERE version IN (16, 17)');
  });
  check('ردیف‌های کهنه خام‌اند (پیش از مهاجرت)', shape(keysOf('app-fuel').code) === 'raw' && shape(topicOf('private-alerts').write_token) === 'raw');
  check('سرور دوباره بالا آمد', await start(), out.slice(-400));
  admin = (await call('POST', '/api/auth/login', { username: 'admin', password: 'Passw0rd!xyz' }, { token: '' })).json?.token || '';
  k = keysOf('app-fuel');
  const t2 = topicOf('private-alerts');
  check('⛔ مهاجرت در جا هش کرد (کلیدِ برنامه، هر دو دفتر)', shape(k.code) === 'sha256' && k.code === k.client && !String(k.code).includes(legacyKey));
  check('⛔ مهاجرت در جا هش کرد (رمزِ موضوع)', shape(t2.write_token) === 'sha256' && shape(t2.read_token) === 'sha256');
  const left = withDb((d) => d.prepare(`SELECT
      (SELECT COUNT(*) FROM code_apps WHERE api_key IS NOT NULL AND api_key <> '' AND api_key NOT LIKE 'sha256:%')
    + (SELECT COUNT(*) FROM app_clients WHERE api_key IS NOT NULL AND api_key <> '' AND api_key NOT LIKE 'sha256:%')
    + (SELECT COUNT(*) FROM ntf_topics WHERE (write_token IS NOT NULL AND write_token <> '' AND write_token NOT LIKE 'sha256:%')
                                        OR (read_token IS NOT NULL AND read_token <> '' AND read_token NOT LIKE 'sha256:%')) AS n`).get().n);
  check('هیچ کلید/رمزِ خامی نماند', Number(left) === 0, String(left));
  check('همان کلیدِ کهنه بی صدورِ دوباره کار می‌کند (هر دو مسیر)', (await codeReq('app-fuel', legacyKey)).status !== 401
    && (await authReq('app-fuel', legacyKey)).status !== 401);
  const hint = (await call('GET', '/api/codes-admin/apps')).json?.apps?.find((a) => a.slug === 'app-fuel');
  check('نشانهٔ کلیدِ کهنه پس از مهاجرت', hint && !hint.apiKey && legacyKey.startsWith(String(hint.keyHint || '-')), JSON.stringify(hint).slice(0, 120));
  check('همان رمزِ کهنهٔ موضوع کار می‌کند', (await call('POST', '/api/notify/private-alerts', 'کهنه', { token: legacyW, raw: true })).json?.ok === true
    && (await call('GET', `/api/notify/private-alerts/json?key=${encodeURIComponent(legacyR)}`, undefined, { token: '' })).status === 200);
} finally {
  await stop();
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${passed} درست، ${failed} نادرست`);
process.exit(failed ? 1 : 0);
