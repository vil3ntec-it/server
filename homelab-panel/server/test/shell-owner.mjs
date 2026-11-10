// ---------------------------------------------------------------------------
//  آزمونِ «پوسته فقط برای مالک» (S19 ِ ممیزی، ۱.۵۰.۷۳)
//      node test/shell-owner.mjs
//
//  نقشِ `admin` ِ پنل هم‌ارزِ کامپیوتر است: ترمینال، «فرمانِ اجرا» و متغیرهای محیطیِ سایت، و ریشه‌های
//  فایل‌منیجر (ریشهٔ افزوده، پوشهٔ سایت‌ها، کتابخانه، ریشهٔ سایتِ بیرون از پوشهٔ سایت‌ها). تصمیمش با صاحب
//  محصول است، پس فقط **گزینه** ساخته شد: `HLP_SHELL_OWNER_ONLY=1` (پیش‌فرض خاموش).
//
//    • خاموش ⇒ رفتارِ پیشین، بی کم و زیاد (مدیرِ دوم همهٔ این‌ها را دارد).
//    • روشن ⇒ همه فقط مالک (قدیمی‌ترین مدیرِ فعال) و کلیدِ محلیِ همین کامپیوتر؛ مالک هرگز بیرون نمی‌ماند.
//    • هر دو حالت: کارگزار از «وارد کردنِ سایت‌های پیداشده» فرمانِ اجرا یا ریشهٔ بیرونی نمی‌گذارد
//      (تا ۱.۵۰.۷۲ آن در `guardSite` را دور می‌زد).
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient } from 'socket.io-client';

const BASE_PORT = Number(process.env.TEST_PORT || 4871);
let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(port, env) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-shell-owner-'));
  const dataDir = path.join(tmp, 'data');
  const sitesRoot = path.join(tmp, 'sites');
  fs.mkdirSync(sitesRoot, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'outside'), { recursive: true });
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
    env: {
      ...process.env, HLP_PORT: String(port), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: dataDir, HLP_SITES_ROOT: sitesRoot,
      HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_DISCOVERY: '0', HLP_AGENT: '0', HLP_ACCOUNT_AUTOSTART: '0',
      HLP_SITESYNC_PORT: String(port + 1), HLP_DISCOVERY_PORT: String(port + 2), HLP_RATE_LOGIN: '1000', HLP_AUTH_RATE_LIMIT: '100000',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const BASE = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try { up = (await fetch(`${BASE}/health`)).ok; } catch { /* هنوز */ }
    if (!up) await wait(250);
  }
  const call = async (method, url, body, token, headers = {}) => {
    const h = { 'Content-Type': 'application/json', ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    const r = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await r.json(); } catch { /* */ }
    return { status: r.status, json };
  };
  const sock = (token) => new Promise((resolve) => {
    const so = ioClient(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
    so.on('connect', () => resolve(so));
    so.on('connect_error', () => { so.close(); resolve(null); });
    setTimeout(() => resolve(so.connected ? so : null), 4000);
  });
  const ack = (so, ev, payload = {}) => new Promise((resolve) => {
    if (!so) return resolve({ ok: false, error: 'no_socket' });
    const t = setTimeout(() => resolve({ ok: false, error: 'no_ack' }), 4000);
    so.emit(ev, payload, (r) => { clearTimeout(t); resolve(r); });
  });
  const stop = async () => {
    child.kill('SIGTERM');
    await wait(300);
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  };
  return { up, out: () => out, call, sock, ack, stop, dataDir, sitesRoot, tmp };
}

/** مالک + مدیرِ دوم + کارگزار، و یک سایت زیرِ پوشهٔ سایت‌ها */
async function people(s) {
  const owner = (await s.call('POST', '/api/auth/setup', { username: 'owner', password: 'Owner-Pass-2026' })).json?.token;
  await s.call('POST', '/api/auth/users', { username: 'admin2', password: 'Admin2-Pass-2026', role: 'admin' }, owner);
  await s.call('POST', '/api/auth/users', { username: 'oper1', password: 'Oper1-Pass-2026', role: 'operator' }, owner);
  const admin2 = (await s.call('POST', '/api/auth/login', { username: 'admin2', password: 'Admin2-Pass-2026' })).json?.token;
  const oper = (await s.call('POST', '/api/auth/login', { username: 'oper1', password: 'Oper1-Pass-2026' })).json?.token;
  for (const d of ['site-a', 'site-b', 'site-c', 'site-d', 'site-e']) fs.mkdirSync(path.join(s.sitesRoot, d), { recursive: true });
  const site = await s.call('POST', '/api/sites', { path: path.join(s.sitesRoot, 'site-a'), name: 'site-a', port: 18081 }, owner);
  return { owner, admin2, oper, siteId: site.json?.site?.id };
}

const ownerOnly = (r) => r.status === 403 && r.json?.error === 'owner_only';

try {
  /* ══════════════ ۱) پیش‌فرض: گزینه خاموش ⇒ رفتارِ پیشین ══════════════ */
  console.log('── HLP_SHELL_OWNER_ONLY خاموش (پیش‌فرض): رفتارِ پیشین ──');
  {
    const s = await boot(BASE_PORT, {});
    try {
      check('سرور بالا آمد', s.up, s.out().slice(-300));
      const p = await people(s);
      check('مالک، مدیرِ دوم، کارگزار و یک سایت', Boolean(p.owner && p.admin2 && p.oper && p.siteId));
      const so = await s.sock(p.admin2);
      const t = await s.ack(so, 'term:open');
      check('مدیرِ دوم ترمینال باز می‌کند', t?.ok === true, JSON.stringify(t));
      so?.close();
      const cmd = await s.call('PUT', `/api/sites/${p.siteId}`, { startCommand: 'node server.js' }, p.admin2);
      check('مدیرِ دوم «فرمانِ اجرا» را عوض می‌کند', cmd.status === 200, JSON.stringify(cmd.json));
      const add = await s.call('POST', '/api/sites', { path: path.join(s.sitesRoot, 'site-b'), name: 'site-b', port: 18082, startCommand: 'node b.js' }, p.admin2);
      check('مدیرِ دوم سایت با فرمانِ اجرا می‌سازد', add.status === 200, JSON.stringify(add.json));
      const env = await s.call('PUT', `/api/sites/${p.siteId}/config`, { env: { A: '1' } }, p.admin2);
      check('مدیرِ دوم متغیرِ محیطیِ سایت را عوض می‌کند', env.status === 200, JSON.stringify(env.json));
      const roots = await s.call('PUT', '/api/settings', { extraFileRoots: [path.join(s.tmp, 'extra')] }, p.admin2);
      check('مدیرِ دوم ریشهٔ افزودهٔ فایل‌منیجر می‌گذارد', roots.status === 200, JSON.stringify(roots.json));
      const lib = await s.call('POST', '/api/storage/setup', { root: path.join(s.tmp, 'lib') }, p.admin2);
      check('مدیرِ دوم کتابخانه (ریشهٔ فایل‌منیجر) را می‌گذارد', lib.status === 200, JSON.stringify(lib.json));
      const me = await s.call('GET', '/api/auth/me', undefined, p.admin2);
      check('‎/me‎ می‌گوید گزینه خاموش است (رابط ترمینال را پنهان نمی‌کند)', me.json?.shellOwnerOnly === false, JSON.stringify(me.json?.shellOwnerOnly));

      console.log('── ⛔ هر دو حالت: کارگزار از «وارد کردنِ پیداشده‌ها» پوسته نمی‌گیرد ──');
      const imp = await s.call('POST', '/api/sites/discover/import', { items: [{ path: path.join(s.sitesRoot, 'site-c'), name: 'c', port: 18083, startCommand: 'sh -c id' }] }, p.oper);
      check('⛔ کارگزار + فرمانِ اجرا در ‎discover/import‎ ⇒ ۴۰۳ (همان قاعدهٔ ‎POST /api/sites‎)', imp.status === 403 && imp.json?.needed === 'admin', JSON.stringify(imp.json));
      const impOut = await s.call('POST', '/api/sites/discover/import', { items: [{ path: path.join(s.tmp, 'outside'), name: 'outside', port: 18084 }] }, p.oper);
      check('⛔ کارگزار + ریشهٔ بیرون از پوشهٔ سایت‌ها ⇒ ۴۰۳', impOut.status === 403, JSON.stringify(impOut.json));
      const impData = await s.call('POST', '/api/sites/discover/import', { items: [{ path: s.dataDir, name: 'data', port: 18085 }] }, p.owner);
      check('⛔ پوشهٔ دادهٔ پنل برای هیچ‌کس ریشهٔ سایت نیست (مالک هم) ⇒ ۴۰۰ bad_root', impData.status === 400 && impData.json?.error === 'bad_root', JSON.stringify(impData.json));
      const noPath = await s.call('POST', '/api/sites', { name: 'no-path', port: 18089 }, p.oper);
      const noPathImp = await s.call('POST', '/api/sites/discover/import', { items: [{ name: 'no-path2', port: 18090 }] }, p.oper);
      const listed = await s.call('GET', '/api/sites', undefined, p.owner);
      check('⛔ سایتِ بی مسیر ساخته نمی‌شود (پیش‌تر ریشه‌اش پوشهٔ کاریِ خودِ سرور می‌شد)', noPath.status === 400 && noPath.json?.error === 'path_required'
        && !(listed.json?.sites || []).some((x) => /^no-path/.test(x.name || x.slug || '')), `${noPath.status} ${JSON.stringify(noPath.json)} | ${noPathImp.status}`);
      const impOk = await s.call('POST', '/api/sites/discover/import', { items: [{ path: path.join(s.sitesRoot, 'site-d'), name: 'd', port: 18086 }] }, p.oper);
      check('کارگزار سایتِ ساده‌ی زیرِ پوشهٔ سایت‌ها را هنوز وارد می‌کند', impOk.status === 200 && impOk.json?.added?.length === 1, JSON.stringify(impOk.json));
      const impAdmin = await s.call('POST', '/api/sites/discover/import', { items: [{ path: path.join(s.sitesRoot, 'site-e'), name: 'e', port: 18087, startCommand: 'node e.js' }] }, p.admin2);
      check('مدیر (گزینه خاموش) با فرمانِ اجرا وارد می‌کند', impAdmin.status === 200 && impAdmin.json?.added?.length === 1, JSON.stringify(impAdmin.json));
    } finally { await s.stop(); }
  }

  /* ══════════════ ۲) گزینه روشن: فقط مالک ══════════════ */
  console.log('── HLP_SHELL_OWNER_ONLY=1: ترمینال، فرمانِ اجرا، متغیرِ محیطی و ریشه‌ها فقط مالک ──');
  {
    const s = await boot(BASE_PORT + 10, { HLP_SHELL_OWNER_ONLY: '1' });
    try {
      check('سرور بالا آمد', s.up, s.out().slice(-300));
      const p = await people(s);
      check('مالک، مدیرِ دوم، کارگزار و یک سایت', Boolean(p.owner && p.admin2 && p.oper && p.siteId));

      const so2 = await s.sock(p.admin2);
      const t2 = await s.ack(so2, 'term:open');
      check('⛔ مدیرِ دوم ترمینال نمی‌گیرد (owner_only)', t2?.ok === false && t2?.error === 'owner_only', JSON.stringify(t2));
      const r2 = await s.ack(so2, 'term:run', { command: 'echo nope' });
      check('⛔ و فرمانی هم اجرا نمی‌کند', r2?.ok !== true, JSON.stringify(r2));
      so2?.close();
      const soO = await s.sock(p.owner);
      const tO = await s.ack(soO, 'term:open');
      check('مالک ترمینال دارد (هرگز بیرون نمی‌ماند)', tO?.ok === true, JSON.stringify(tO));
      const rO = await s.ack(soO, 'term:run', { command: 'echo owner-here' });
      check('و فرمان اجرا می‌کند', rO?.ok === true, JSON.stringify(rO).slice(0, 200));
      soO?.close();
      const soOp = await s.sock(p.oper);
      const tOp = await s.ack(soOp, 'term:open');
      check('کارگزار همان «forbidden» ِ پیشین (نقش اول سنجیده می‌شود)', tOp?.ok === false && tOp?.error === 'forbidden', JSON.stringify(tOp));
      soOp?.close();

      const cmd2 = await s.call('PUT', `/api/sites/${p.siteId}`, { startCommand: 'sh -c id' }, p.admin2);
      check('⛔ مدیرِ دوم «فرمانِ اجرا» را عوض نمی‌کند', ownerOnly(cmd2), JSON.stringify(cmd2));
      const name2 = await s.call('PUT', `/api/sites/${p.siteId}`, { name: 'site-a2' }, p.admin2);
      check('ولی نامِ سایت را عوض می‌کند (فقط پوسته بسته شد)', name2.status === 200, JSON.stringify(name2.json));
      const add2 = await s.call('POST', '/api/sites', { path: path.join(s.sitesRoot, 'site-b'), name: 'site-b', port: 18082, startCommand: 'sh -c id' }, p.admin2);
      check('⛔ مدیرِ دوم سایت با فرمانِ اجرا نمی‌سازد', ownerOnly(add2), JSON.stringify(add2));
      const addOut = await s.call('POST', '/api/sites', { path: path.join(s.tmp, 'outside'), name: 'outside', port: 18088 }, p.admin2);
      check('⛔ مدیرِ دوم ریشهٔ سایتِ بیرون از پوشهٔ سایت‌ها نمی‌گذارد', ownerOnly(addOut), JSON.stringify(addOut));
      const imp2 = await s.call('POST', '/api/sites/discover/import', { items: [{ path: path.join(s.sitesRoot, 'site-c'), name: 'c', port: 18083, startCommand: 'sh -c id' }] }, p.admin2);
      check('⛔ مدیرِ دوم از «وارد کردنِ پیداشده‌ها» هم فرمان نمی‌گذارد', ownerOnly(imp2), JSON.stringify(imp2));
      const env2 = await s.call('PUT', `/api/sites/${p.siteId}/config`, { env: { NODE_OPTIONS: '--import data:text/javascript,0' } }, p.admin2);
      check('⛔ مدیرِ دوم متغیرِ محیطیِ سایت را عوض نمی‌کند (NODE_OPTIONS = اجرای کد)', ownerOnly(env2), JSON.stringify(env2));
      const roots2 = await s.call('PUT', '/api/settings', { serverName: 'x-by-admin2', extraFileRoots: ['/'] }, p.admin2);
      check('⛔ مدیرِ دوم ریشهٔ افزودهٔ فایل‌منیجر نمی‌گذارد', ownerOnly(roots2), JSON.stringify(roots2));
      const after = await s.call('GET', '/api/settings', undefined, p.owner);
      check('⛔ و از همان درخواست هیچ چیز ننشست (نامِ سرور هم نه)', !JSON.stringify(after.json).includes('x-by-admin2')
        && !(after.json?.settings?.extraFileRoots || []).includes('/'), JSON.stringify(after.json?.settings || after.json).slice(0, 200));
      const sr2 = await s.call('PUT', '/api/settings', { sitesRoot: path.join(s.tmp, 'other-sites') }, p.admin2);
      check('⛔ مدیرِ دوم پوشهٔ سایت‌ها را جابه‌جا نمی‌کند', ownerOnly(sr2), JSON.stringify(sr2));
      const lib2 = await s.call('POST', '/api/storage/setup', { root: path.join(s.tmp, 'lib') }, p.admin2);
      check('⛔ مدیرِ دوم کتابخانه را نمی‌گذارد', ownerOnly(lib2), JSON.stringify(lib2));
      const name2s = await s.call('PUT', '/api/settings', { serverName: 'admin2-may' }, p.admin2);
      check('ولی بقیهٔ تنظیمات (نامِ سرور) را هنوز عوض می‌کند', name2s.status === 200, JSON.stringify(name2s.json));

      const cmdO = await s.call('PUT', `/api/sites/${p.siteId}`, { startCommand: 'node server.js' }, p.owner);
      check('مالک «فرمانِ اجرا» را عوض می‌کند', cmdO.status === 200, JSON.stringify(cmdO.json));
      const envO = await s.call('PUT', `/api/sites/${p.siteId}/config`, { env: { A: '1' } }, p.owner);
      check('مالک متغیرِ محیطی را عوض می‌کند', envO.status === 200, JSON.stringify(envO.json));
      const rootsO = await s.call('PUT', '/api/settings', { extraFileRoots: [path.join(s.tmp, 'extra')] }, p.owner);
      check('مالک ریشهٔ افزوده می‌گذارد', rootsO.status === 200, JSON.stringify(rootsO.json));
      const libO = await s.call('POST', '/api/storage/setup', { root: path.join(s.tmp, 'lib') }, p.owner);
      check('مالک کتابخانه را می‌گذارد', libO.status === 200, JSON.stringify(libO.json));
      const impO = await s.call('POST', '/api/sites/discover/import', { items: [{ path: path.join(s.sitesRoot, 'site-c'), name: 'c', port: 18083, startCommand: 'node c.js' }] }, p.owner);
      check('مالک با فرمانِ اجرا وارد می‌کند', impO.status === 200 && impO.json?.added?.length === 1, JSON.stringify(impO.json));

      const localKey = fs.readFileSync(path.join(s.dataDir, 'local-admin.key'), 'utf8').trim();
      const cmdL = await s.call('PUT', `/api/sites/${p.siteId}`, { startCommand: 'node local.js' }, null, { 'X-Local-Key': localKey });
      check('کلیدِ محلیِ همین کامپیوتر بسته نشد (دسترسیِ ماشین خودش مجوز است)', cmdL.status === 200, JSON.stringify(cmdL.json));

      const me2 = await s.call('GET', '/api/auth/me', undefined, p.admin2);
      check('‎/me‎ به رابط می‌گوید «فقط مالک» روشن است', me2.json?.shellOwnerOnly === true, JSON.stringify(me2.json?.shellOwnerOnly));
      const aud = await s.call('GET', '/api/audit?limit=200', undefined, p.owner);
      const audText = JSON.stringify(aud.json || '');
      check('⛔ تلاش‌های ردشده در دفترِ رخداد (panel.shell.owner_only)', (audText.match(/panel\.shell\.owner_only/g) || []).length >= 5, audText.slice(0, 300));
    } finally { await s.stop(); }
  }
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
}
console.log(`\n${failed ? '❌' : '✅'} ${passed} سبز، ${failed} قرمز`);
process.exit(failed ? 1 : 0);
