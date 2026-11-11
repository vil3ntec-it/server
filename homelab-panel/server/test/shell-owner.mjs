// ---------------------------------------------------------------------------
//  آزمونِ «پوسته فقط برای مالک» (S19 ِ ممیزی؛ ۱.۵۰.۷۳ گزینه، ۱.۵۰.۸۶ همیشه)
//      node test/shell-owner.mjs
//
//  نقشِ `admin` ِ پنل هم‌ارزِ کامپیوتر است: ترمینال، «فرمانِ اجرا» و متغیرهای محیطیِ سایت، ریشه‌های فایل‌منیجر
//  (ریشهٔ افزوده، پوشهٔ سایت‌ها، کتابخانه، ریشهٔ سایتِ بیرون از پوشهٔ سایت‌ها)، به‌روزرسان و انبار.
//
//  تصمیم‌های صاحب محصول ۱۴۰۵/۰۸/۲۰:
//    • ۲-۲۶ پرسشِ ۲ «الف»: همهٔ این درها **همیشه** فقط مالک (قدیمی‌ترین مدیرِ فعال) و کلیدِ محلیِ همین کامپیوتر —
//      بی کلید، و `HLP_SHELL_OWNER_ONLY=0` هم بازشان نمی‌کند. مالک هرگز بیرون نمی‌ماند.
//    • ۲-۱۱ «الف»: نوشتنِ فایل در پوشهٔ سایت (و فضای کاریِ سایت، که env ِ سایت در آن است) و روشن/دوباره‌روشن
//      کردنِ سایت هم همین مرز.
//    • ۲-۲۶ پرسشِ ۱ «ب»: بازگرداندنِ پشتیبانِ خودِ پنل همیشه فقط مالک.
//    • ۲-۲۶ پرسشِ ۳ «الف»: منبعِ به‌روزرسانی فقط مخزنِ رسمی؛ مخزنِ دیگر فقط با ‎HLP_UPDATE_REPO‎ در ‎.env‎ ِ ماشین.
//    • ۲-۲۶ پرسشِ ۵ «الف»: زیرِ admin فقط نامِ متغیرهای سایت، نه مقدار (رابط و فایل‌منیجر).
//    • هر حالت: کارگزار از «وارد کردنِ سایت‌های پیداشده» فرمانِ اجرا یا ریشهٔ بیرونی نمی‌گذارد (۱.۵۰.۷۳).
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
  /* ══════════════ ۱) بی کلید (پیش‌فرض): همه فقط مالک ══════════════ */
  console.log('── بی کلید: ترمینال، فرمانِ اجرا، متغیرِ محیطی، ریشه‌ها، به‌روزرسان، نوشتن در پوشهٔ سایت و روشن کردنِ سایت فقط مالک ──');
  {
    const s = await boot(BASE_PORT, {});
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

      //  ⛔ (۱.۵۰.۸۳) فرمانِ مؤثرِ سایت از پوشه: operator با پوشه‌ای که `package.json` با `npm start` دارد سایت نمی‌سازد
      const nodeDir = path.join(s.sitesRoot, 'node-app');
      fs.mkdirSync(nodeDir, { recursive: true });
      fs.writeFileSync(path.join(nodeDir, 'package.json'), JSON.stringify({ name: 'n', scripts: { start: 'node server.js' } }));
      const nodeAsOper = await s.call('POST', '/api/sites', { path: nodeDir, name: 'node-app', port: 18071 }, p.oper);
      check('⛔ operator سایتِ با فرمانِ مؤثرِ پوشه (npm start) نمی‌سازد (۴۰۳ admin)', nodeAsOper.status === 403 && nodeAsOper.json?.needed === 'admin', JSON.stringify(nodeAsOper.json));
      const impNode = await s.call('POST', '/api/sites/discover/import', { items: [{ path: nodeDir, name: 'node-app', port: 18072 }] }, p.oper);
      check('⛔ و از discover/import هم نه (فرمان از پوشه خوانده می‌شود، نه از بدنه)', impNode.status === 403 && impNode.json?.needed === 'admin', JSON.stringify(impNode.json));
      const nodeAsAdmin2 = await s.call('POST', '/api/sites', { path: nodeDir, name: 'node-app', port: 18073 }, p.admin2);
      check('⛔ مدیرِ دوم هم همان سایت را نمی‌سازد (فرمانِ مؤثر = پوسته)', ownerOnly(nodeAsAdmin2), JSON.stringify(nodeAsAdmin2.json));
      const nodeAsOwner = await s.call('POST', '/api/sites', { path: nodeDir, name: 'node-app', port: 18073 }, p.owner);
      check('مالک همان سایت را می‌سازد', nodeAsOwner.status === 200, JSON.stringify(nodeAsOwner.json));
      const envAsOper = await s.call('PUT', `/api/sites/${p.siteId}/config`, { env: { NODE_OPTIONS: '--import data:text/javascript,0' } }, p.oper);
      check('⛔ operator متغیرِ محیطیِ سایت را عوض نمی‌کند (۴۰۳ admin)', envAsOper.status === 403 && envAsOper.json?.needed === 'admin', JSON.stringify(envAsOper.json));

      console.log('── ⛔ کارگزار از «وارد کردنِ پیداشده‌ها» پوسته نمی‌گیرد ──');
      const imp = await s.call('POST', '/api/sites/discover/import', { items: [{ path: path.join(s.sitesRoot, 'site-c'), name: 'c', port: 18083, startCommand: 'sh -c id' }] }, p.oper);
      check('⛔ کارگزار + فرمانِ اجرا در ‎discover/import‎ ⇒ ۴۰۳ (همان قاعدهٔ ‎POST /api/sites‎)', imp.status === 403 && imp.json?.needed === 'admin', JSON.stringify(imp.json));
      const impOut = await s.call('POST', '/api/sites/discover/import', { items: [{ path: path.join(s.tmp, 'outside'), name: 'outside', port: 18084 }] }, p.oper);
      check('⛔ کارگزار + ریشهٔ بیرون از پوشهٔ سایت‌ها ⇒ ۴۰۳', impOut.status === 403, JSON.stringify(impOut.json));
      const impData = await s.call('POST', '/api/sites/discover/import', { items: [{ path: s.dataDir, name: 'data', port: 18085 }] }, p.owner);
      check('⛔ پوشهٔ دادهٔ پنل برای هیچ‌کس ریشهٔ سایت نیست (مالک هم) ⇒ ۴۰۰ bad_root', impData.status === 400 && impData.json?.error === 'bad_root', JSON.stringify(impData.json));
      const noPath = await s.call('POST', '/api/sites', { name: 'no-path', port: 18089 }, p.oper);
      const listed = await s.call('GET', '/api/sites', undefined, p.owner);
      check('⛔ سایتِ بی مسیر ساخته نمی‌شود (پیش‌تر ریشه‌اش پوشهٔ کاریِ خودِ سرور می‌شد)', noPath.status === 400 && noPath.json?.error === 'path_required'
        && !(listed.json?.sites || []).some((x) => /^no-path/.test(x.name || x.slug || '')), `${noPath.status} ${JSON.stringify(noPath.json)}`);
      const impOk = await s.call('POST', '/api/sites/discover/import', { items: [{ path: path.join(s.sitesRoot, 'site-d'), name: 'd', port: 18086 }] }, p.oper);
      check('کارگزار سایتِ ساده‌ی زیرِ پوشهٔ سایت‌ها را هنوز وارد می‌کند', impOk.status === 200 && impOk.json?.added?.length === 1, JSON.stringify(impOk.json));

      const cmdO = await s.call('PUT', `/api/sites/${p.siteId}`, { startCommand: 'node server.js' }, p.owner);
      check('مالک «فرمانِ اجرا» را عوض می‌کند', cmdO.status === 200, JSON.stringify(cmdO.json));
      const envO = await s.call('PUT', `/api/sites/${p.siteId}/config`, { env: { DB_PASSWORD: 'p4ss-1405', A: '1' } }, p.owner);
      check('مالک متغیرِ محیطی را عوض می‌کند', envO.status === 200, JSON.stringify(envO.json));
      const rootsO = await s.call('PUT', '/api/settings', { extraFileRoots: [path.join(s.tmp, 'extra')] }, p.owner);
      check('مالک ریشهٔ افزوده می‌گذارد', rootsO.status === 200, JSON.stringify(rootsO.json));
      const libO = await s.call('POST', '/api/storage/setup', { root: path.join(s.tmp, 'lib') }, p.owner);
      check('مالک کتابخانه را می‌گذارد', libO.status === 200, JSON.stringify(libO.json));
      const impO = await s.call('POST', '/api/sites/discover/import', { items: [{ path: path.join(s.sitesRoot, 'site-c'), name: 'c', port: 18083, startCommand: 'node c.js' }] }, p.owner);
      check('مالک با فرمانِ اجرا وارد می‌کند', impO.status === 200 && impO.json?.added?.length === 1, JSON.stringify(impO.json));

      //  ⛔ (۱.۵۰.۸۳) «مرتب کردنِ» کتابخانه هم نوشتن روی دیسک است ⇒ فقط مالک
      const orgA = await s.call('POST', '/api/storage/organize/apply', { items: [{ path: path.join(s.sitesRoot, 'site-a'), name: 'a', branch: 'Sites' }] }, p.admin2);
      check('⛔ مدیرِ دوم پوشه‌ها را مرتب (جابه‌جا) نمی‌کند', ownerOnly(orgA), JSON.stringify(orgA.json));
      const orgO = await s.call('POST', '/api/storage/organize/apply', { items: [{ path: path.join(s.sitesRoot, 'site-a'), name: 'a', branch: 'Sites' }] }, p.owner);
      check('مالک مرتب می‌کند (هرگز بیرون نمی‌ماند)', !ownerOnly(orgO), JSON.stringify(orgO.json));

      const localKey = fs.readFileSync(path.join(s.dataDir, 'local-admin.key'), 'utf8').trim();
      const cmdL = await s.call('PUT', `/api/sites/${p.siteId}`, { startCommand: 'node local.js' }, null, { 'X-Local-Key': localKey });
      check('کلیدِ محلیِ همین کامپیوتر بسته نشد (دسترسیِ ماشین خودش مجوز است)', cmdL.status === 200, JSON.stringify(cmdL.json));

      //  ⛔ S19 (۱.۵۰.۸۳): به‌روزرسانی = انتخاب و اجرای کد روی میزبان ⇒ فقط مالک
      const updSet2 = await s.call('POST', '/api/control/update/settings', { repo: 'evil/evil' }, p.admin2);
      check('⛔ مدیرِ دوم تنظیماتِ به‌روزرسانی را عوض نمی‌کند', ownerOnly(updSet2), JSON.stringify(updSet2.json));
      const updIns = await s.call('POST', '/api/control/update/install', { confirm: true, force: true }, p.admin2);
      check('⛔ مدیرِ دوم نصبِ به‌روزرسانی را نمی‌زند (پیش از هر دانلود)', ownerOnly(updIns), JSON.stringify(updIns.json));
      const updAcc = await s.call('POST', '/api/account-server/update', {}, p.admin2);
      check('⛔ مدیرِ دوم بستهٔ سرورِ حساب را به‌روز نمی‌کند', ownerOnly(updAcc), JSON.stringify(updAcc.json));
      const updSetO = await s.call('POST', '/api/control/update/settings', { autoCheck: true }, p.owner);
      check('مالک تنظیماتِ به‌روزرسانی را عوض می‌کند (هرگز بیرون نمی‌ماند)', updSetO.status === 200, JSON.stringify(updSetO.json));

      console.log('── ۲-۲۶ پرسشِ ۳: منبعِ به‌روزرسانی فقط مخزنِ رسمی ──');
      const evilO = await s.call('POST', '/api/control/update/settings', { repo: 'evil/evil', autoCheck: false }, p.owner);
      check('⛔ حتی مالک منبع را از پنل به مخزنِ دیگر نمی‌برد (۴۰۰ repo_locked)', evilO.status === 400 && evilO.json?.error === 'repo_locked', JSON.stringify(evilO.json));
      const updStat = await s.call('GET', '/api/control/update', undefined, p.owner);
      check('⛔ و منبع همان مخزنِ رسمی ماند، بی هیچ تغییرِ دیگری از همان درخواست', updStat.json?.status?.repo === 'vil3ntec-it/server'
        && updStat.json?.status?.repoLocked === true && updStat.json?.status?.autoCheck === true, JSON.stringify(updStat.json?.status).slice(0, 200));
      const sameO = await s.call('POST', '/api/control/update/settings', { repo: 'vil3ntec-it/server', autoCheck: true }, p.owner);
      check('همان مخزنِ رسمی ⇒ بی اثر و پذیرفته (رابطِ کهنه نمی‌شکند)', sameO.status === 200, JSON.stringify(sameO.json));

      console.log('── ۲-۱۱: نوشتن در پوشهٔ سایت و روشن کردنِ سایت ──');
      fs.writeFileSync(path.join(s.sitesRoot, 'site-a', 'index.html'), '<h1>a</h1>');
      const wr2 = await s.call('PUT', '/api/files/write', { path: path.join(s.sitesRoot, 'site-a', 'server.js'), content: 'require("child_process")' }, p.admin2);
      check('⛔ مدیرِ دوم در پوشهٔ سایت فایل نمی‌نویسد (owner_only)', ownerOnly(wr2) && !fs.existsSync(path.join(s.sitesRoot, 'site-a', 'server.js')), JSON.stringify(wr2.json));
      const wrOp = await s.call('PUT', '/api/files/write', { path: path.join(s.sitesRoot, 'site-a', 'index.html'), content: 'x' }, p.oper);
      check('⛔ کارگزار هم نه (پیش‌تر هر operator)', ownerOnly(wrOp) && fs.readFileSync(path.join(s.sitesRoot, 'site-a', 'index.html'), 'utf8') === '<h1>a</h1>', JSON.stringify(wrOp.json));
      const ws = path.join(s.dataDir, 'sites');
      const slugA = fs.readdirSync(ws).find((d) => fs.existsSync(path.join(ws, d, 'config.json')) && fs.readFileSync(path.join(ws, d, 'config.json'), 'utf8').includes('DB_PASSWORD'));
      const cfgPath = slugA ? path.join(ws, slugA, 'config.json') : path.join(ws, 'missing', 'config.json');
      const wrCfg = await s.call('PUT', '/api/files/write', { path: cfgPath, content: JSON.stringify({ env: { NODE_OPTIONS: '--import data:text/javascript,0' } }) }, p.oper);
      check('⛔ کارگزار env ِ سایت را از فایل‌منیجر (‎data/sites/<نام>/config.json‎) نمی‌نویسد', Boolean(slugA) && ownerOnly(wrCfg)
        && !fs.readFileSync(cfgPath, 'utf8').includes('NODE_OPTIONS'), `${slugA} ${JSON.stringify(wrCfg.json)}`);
      const up2 = await fetch(`http://127.0.0.1:${BASE_PORT}/api/files/upload?dir=${encodeURIComponent(path.join(s.sitesRoot, 'site-a'))}&name=evil.js`, {
        method: 'PUT', headers: { Authorization: `Bearer ${p.admin2}`, 'Content-Type': 'application/octet-stream' }, body: 'x' });
      check('⛔ بارگذاری در پوشهٔ سایت هم نه', up2.status === 403 && !fs.existsSync(path.join(s.sitesRoot, 'site-a', 'evil.js')), `${up2.status}`);
      const mk2 = await s.call('POST', '/api/files/mkdir', { path: s.sitesRoot, name: 'new-site' }, p.admin2);
      const del2 = await s.call('DELETE', `/api/files?path=${encodeURIComponent(path.join(s.sitesRoot, 'site-a', 'index.html'))}`, undefined, p.admin2);
      const ren2 = await s.call('POST', '/api/files/rename', { path: path.join(s.sitesRoot, 'site-a', 'index.html'), newName: 'index2.html' }, p.admin2);
      check('⛔ پوشهٔ تازه، حذف و تغییرِ نام در پوشهٔ سایت‌ها هم نه', ownerOnly(mk2) && ownerOnly(del2) && ownerOnly(ren2)
        && fs.existsSync(path.join(s.sitesRoot, 'site-a', 'index.html')), `${mk2.status} ${del2.status} ${ren2.status}`);
      //  ریشهٔ افزوده: نوشتنِ آزاد، مگر به سایتی برسد که داخلِ آن است (حذف/جابه‌جاییِ پوشهٔ بالاتر هم)
      const extra = path.join(s.tmp, 'extra');
      fs.mkdirSync(path.join(extra, 'group', 'inner-site'), { recursive: true });
      const inner = await s.call('POST', '/api/sites', { path: path.join(extra, 'group', 'inner-site'), name: 'inner', port: 18091 }, p.owner);
      check('مالک سایتی داخلِ ریشهٔ افزوده می‌سازد', inner.status === 200, JSON.stringify(inner.json));
      const wrX = await s.call('PUT', '/api/files/write', { path: path.join(extra, 'note.txt'), content: 'ok' }, p.oper);
      check('نوشتن در ریشهٔ افزوده (بیرون از هر سایت) آزاد ماند', wrX.status === 200 && fs.existsSync(path.join(extra, 'note.txt')), JSON.stringify(wrX.json));
      const wrLib = await s.call('PUT', '/api/files/write', { path: path.join(s.tmp, 'lib', 'note.txt'), content: 'ok' }, p.admin2);
      check('و در کتابخانه هم', wrLib.status === 200, JSON.stringify(wrLib.json));
      const delGroup = await s.call('DELETE', `/api/files?path=${encodeURIComponent(path.join(extra, 'group'))}`, undefined, p.admin2);
      const mvGroup = await s.call('POST', '/api/files/move', { from: path.join(extra, 'group'), to: path.join(s.tmp, 'lib') }, p.admin2);
      check('⛔ ولی پوشه‌ای که یک سایت داخلش است حذف یا جابه‌جا نمی‌شود', ownerOnly(delGroup) && ownerOnly(mvGroup)
        && fs.existsSync(path.join(extra, 'group', 'inner-site')), `${delGroup.status} ${mvGroup.status}`);
      const cpIn = await s.call('POST', '/api/files/copy', { from: path.join(extra, 'note.txt'), to: path.join(s.sitesRoot, 'site-a') }, p.admin2);
      const cpOut = await s.call('POST', '/api/files/copy', { from: path.join(s.sitesRoot, 'site-a', 'index.html'), to: extra }, p.admin2);
      check('⛔ کپی به پوشهٔ سایت نه؛ کپی از آن (خواندن) آزاد', ownerOnly(cpIn) && cpOut.status === 200, `${cpIn.status} ${cpOut.status}`);
      const wrOw = await s.call('PUT', '/api/files/write', { path: path.join(s.sitesRoot, 'site-a', 'index.html'), content: '<h1>owner</h1>' }, p.owner);
      check('مالک در پوشهٔ سایت می‌نویسد (هرگز بیرون نمی‌ماند)', wrOw.status === 200, JSON.stringify(wrOw.json));

      const st2 = await s.call('POST', `/api/sites/${p.siteId}/start`, {}, p.admin2);
      const rs2 = await s.call('POST', `/api/sites/${p.siteId}/restart`, {}, p.admin2);
      const rsOp = await s.call('POST', `/api/sites/${p.siteId}/restart`, {}, p.oper);
      check('⛔ مدیرِ دوم و کارگزار سایت را روشن یا دوباره‌روشن نمی‌کنند', ownerOnly(st2) && ownerOnly(rs2) && ownerOnly(rsOp), `${st2.status} ${rs2.status} ${rsOp.status}`);
      const stp2 = await s.call('POST', `/api/sites/${p.siteId}/stop`, {}, p.admin2);
      check('خاموش کردن آزاد ماند (کدی اجرا نمی‌کند)', !ownerOnly(stp2), JSON.stringify(stp2.json));
      const rsO = await s.call('POST', `/api/sites/${p.siteId}/restart`, {}, p.owner);
      const rsL = await s.call('POST', `/api/sites/${p.siteId}/stop`, {}, null, { 'X-Local-Key': localKey });
      const stL = await s.call('POST', `/api/sites/${p.siteId}/start`, {}, null, { 'X-Local-Key': localKey });
      check('مالک و کلیدِ محلی سایت را روشن می‌کنند (نه owner_only)', !ownerOnly(rsO) && !ownerOnly(stL) && !ownerOnly(rsL), `${rsO.status} ${stL.status}`);
      await s.call('POST', `/api/sites/${p.siteId}/stop`, {}, p.owner);

      console.log('── ۲-۲۶ پرسشِ ۵: مقدارِ متغیرهای سایت فقط برای admin ──');
      const cfgOp = await s.call('GET', `/api/sites/${p.siteId}`, undefined, p.oper);
      check('⛔ کارگزار فقط نامِ متغیرها را می‌بیند، نه مقدار', cfgOp.status === 200 && cfgOp.json?.config?.envMasked === true
        && Object.keys(cfgOp.json?.config?.env || {}).sort().join() === 'A,DB_PASSWORD' && !JSON.stringify(cfgOp.json).includes('p4ss-1405'), JSON.stringify(cfgOp.json?.config));
      const cfgA2 = await s.call('GET', `/api/sites/${p.siteId}`, undefined, p.admin2);
      check('admin مقدار را می‌بیند', cfgA2.json?.config?.env?.DB_PASSWORD === 'p4ss-1405' && !cfgA2.json?.config?.envMasked, JSON.stringify(cfgA2.json?.config));
      const rdOp = await s.call('GET', `/api/files/read?path=${encodeURIComponent(cfgPath)}`, undefined, p.oper);
      const dlOp = await s.call('GET', `/api/files/download?path=${encodeURIComponent(cfgPath)}`, undefined, p.oper);
      check('⛔ و از فایل‌منیجر هم نه (‎config.json‎ ِ فضای کاری ⇒ ۴۰۳ admin)', rdOp.status === 403 && rdOp.json?.needed === 'admin' && dlOp.status === 403, `${rdOp.status} ${dlOp.status}`);
      const rdA2 = await s.call('GET', `/api/files/read?path=${encodeURIComponent(cfgPath)}`, undefined, p.admin2);
      check('admin همان پرونده را می‌خواند', rdA2.status === 200 && String(rdA2.json?.content || '').includes('p4ss-1405'), `${rdA2.status}`);
      const saveOp = await s.call('PUT', `/api/sites/${p.siteId}/config`, { note: 'operator-note' }, p.oper);
      const cfgAfter = await s.call('GET', `/api/sites/${p.siteId}`, undefined, p.owner);
      check('کارگزارِ بی env هنوز بقیهٔ تنظیم را ذخیره می‌کند و env دست نمی‌خورد', saveOp.status === 200 && cfgAfter.json?.config?.env?.DB_PASSWORD === 'p4ss-1405', JSON.stringify(saveOp.json).slice(0, 160));

      console.log('── ۲-۲۶ پرسشِ ۱: بازگرداندنِ پشتیبانِ پنل همیشه فقط مالک ──');
      const rb2 = await s.call('POST', '/api/panel/v1/backups/none.db/restore', {}, p.admin2);
      const rl2 = await s.call('POST', '/api/storage/backups/restore', { path: path.join(s.tmp, 'nope') }, p.admin2);
      check('⛔ مدیرِ دوم پشتیبانِ پنل را برنمی‌گرداند (هر دو در؛ پیش از رمزِ دوباره)', ownerOnly(rb2) && ownerOnly(rl2), `${rb2.status} ${JSON.stringify(rb2.json)} ${rl2.status}`);
      const rbO = await s.call('POST', '/api/panel/v1/backups/none.db/restore', {}, p.owner);
      const rlO = await s.call('POST', '/api/storage/backups/restore', { path: path.join(s.tmp, 'nope') }, p.owner);
      check('مالک از مرزِ مالک می‌گذرد (پشتیبانِ ناموجود ⇒ ۴۰۰، نه ۴۰۳)', rbO.status === 400 && rlO.status === 400, `${rbO.status} ${rlO.status}`);

      const me2 = await s.call('GET', '/api/auth/me', undefined, p.admin2);
      check('‎/me‎ به رابط می‌گوید «فقط مالک» روشن است', me2.json?.shellOwnerOnly === true, JSON.stringify(me2.json?.shellOwnerOnly));
      const aud = await s.call('GET', '/api/audit?limit=300', undefined, p.owner);
      const audText = JSON.stringify(aud.json || '');
      check('⛔ تلاش‌های ردشده در دفترِ رخداد (panel.shell.owner_only)', (audText.match(/panel\.shell\.owner_only/g) || []).length >= 5, audText.slice(0, 300));
      check('⛔ و دفتر نامِ هر کارِ تازه را دارد (files.site، site.start، panel.backup.restore)', ['files.site', 'site.start', 'panel.backup.restore'].every((w) => audText.includes(w)), audText.slice(0, 300));
    } finally { await s.stop(); }
  }

  /* ══════════════ ۲) `HLP_SHELL_OWNER_ONLY=0` دیگر چیزی را باز نمی‌کند؛ ‎HLP_UPDATE_REPO‎ ِ ماشین منبع را عوض می‌کند ══════════════ */
  console.log('── HLP_SHELL_OWNER_ONLY=0 و HLP_UPDATE_REPO=x/y ──');
  {
    const s = await boot(BASE_PORT + 10, { HLP_SHELL_OWNER_ONLY: '0', HLP_UPDATE_REPO: 'x/y' });
    try {
      check('سرور بالا آمد', s.up, s.out().slice(-300));
      const p = await people(s);
      const so = await s.sock(p.admin2);
      const t = await s.ack(so, 'term:open');
      check('⛔ با کلیدِ «خاموش» هم مدیرِ دوم ترمینال نمی‌گیرد', t?.ok === false && t?.error === 'owner_only', JSON.stringify(t));
      so?.close();
      const cmd = await s.call('PUT', `/api/sites/${p.siteId}`, { startCommand: 'node server.js' }, p.admin2);
      const env = await s.call('PUT', `/api/sites/${p.siteId}/config`, { env: { A: '1' } }, p.admin2);
      const lib = await s.call('POST', '/api/storage/setup', { root: path.join(s.tmp, 'lib') }, p.admin2);
      check('⛔ و نه فرمانِ اجرا، env ِ سایت یا کتابخانه (رفتارِ «خاموشِ» ۱.۵۰.۸۵ برنمی‌گردد)', ownerOnly(cmd) && ownerOnly(env) && ownerOnly(lib), `${cmd.status} ${env.status} ${lib.status}`);
      const me = await s.call('GET', '/api/auth/me', undefined, p.admin2);
      check('‎/me‎ باز هم «فقط مالک»', me.json?.shellOwnerOnly === true, JSON.stringify(me.json?.shellOwnerOnly));
      const st = await s.call('GET', '/api/control/update', undefined, p.owner);
      check('‎HLP_UPDATE_REPO‎ ِ همین ماشین منبع را عوض می‌کند (و رابط می‌داند از ‎.env‎ آمده)', st.json?.status?.repo === 'x/y' && st.json?.status?.repoFromEnv === true, JSON.stringify(st.json?.status).slice(0, 200));
      const back = await s.call('POST', '/api/control/update/settings', { repo: 'vil3ntec-it/server' }, p.owner);
      check('⛔ و از پنل هم به مخزنِ رسمی برنمی‌گردد — فقط همان خط (۴۰۰ repo_locked)', back.status === 400 && back.json?.error === 'repo_locked', JSON.stringify(back.json));
    } finally { await s.stop(); }
  }
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
}
console.log(`\n${failed ? '❌' : '✅'} ${passed} سبز، ${failed} قرمز`);
process.exit(failed ? 1 : 0);
