// ---------------------------------------------------------------------------
//  S11 «هم‌ترازی با ‎/admin/‎» در پل (۱.۵۰.۸۰، ممیزی §۹ ردیفِ ۱.۵۰.۷۹) — درهایی که تا امروز فقط کنسولِ وبِ سرورِ حساب داشت
//      node test/console-parity.mjs
//
//  سرورِ حسابِ ساختگی **به شکلِ main ِ shop** (‎28f6acc29‎):
//    ‎GET|PUT /api/admin/release/beta‎ (‎routes/admin-release.js‎: فقط ارشد؛ ‎parse‎ ِ شناسه، ‎bad_release_id‎ / ‎too_many_ids‎ / ‎bad_body‎؛
//      هر کلیدِ عوض‌شده نسخهٔ scope ِ ‎release‎ را یکی بالا می‌برد — ‎lib/live-config.js‎)
//    ‎GET /api/downloads‎ (عمومی، ‎portal.downloadsOf‎) · ‎PUT /api/admin/downloads‎ (‎admin-sales.js‎: فقط ارشد؛ ‎bad_version‎ / ‎min_above_latest‎)
//    ‎GET /api/admin/system/notify-usage?days=‎ (‎lib/notify-usage.js‎) · ‎GET /api/admin/accounts/:app/:tenantId/backups?limit=‎ (‎admin-platform.js‎)
//  سنجیده می‌شود: مرزِ نقش (نوشتن admin، خواندن viewer+)، **همهٔ** ورودیِ بد پیش از پل، پاسخ فقط فیلدهای شناخته (فیلدِ ناشناختهٔ
//  بالادست، شماره، مسیرِ دیسک نمی‌رسند)، یک‌باره با کلیدِ پنجره (این دو درِ بالادست ‎Idempotency-Key‎ ندارند ⇒ یادِ پل، هیچ سرآیند)،
//  نسخهٔ کهنهٔ فهرستِ آزمایشی ⇒ ‎409‎ بی نوشتن، «نامعلوم» ِ مهلت بی درخواستِ دوم و با ردیفِ دفتر، سقفِ نرخِ هر کاربر، و دفترِ پنل بی کلید.
//  ⛔ ‎DELETE‎ ِ پشتیبانِ مشتری ساخته نمی‌شود (تصمیمِ مالک) — سنجیده می‌شود که «نیست» و به سرورِ حساب نمی‌رسد.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4983);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-parity-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 500)}`);
};

/* ───────────── سرورِ حسابِ ساختگی (شکلِ main ِ shop) ───────────── */
const NOW = Date.now();
const DAY = 86400e3;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const VERSION_RE = /^\d+(\.\d+){1,3}$/;
const validV = (s) => { const x = String(s ?? '').trim().replace(/^v/i, ''); return VERSION_RE.test(x) ? x : ''; };
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; } return 0; };
const seen = [];
const held = new Set();
let beta = { shops: ['s1', 'shop-old'], devices: ['dev-1'], version: 4, updatedAt: NOW - DAY, updatedBy: 'boss' };
let cfg = {
  download_url_shop: 'https://dl.vill3n.top/shop-2.14.5.apk', latest_version_shop: '2.14.5', release_notes_shop: 'رفعِ خطا', min_app_version_shop: '2.10.0',
  download_url_pump: '', latest_version_pump: '1.4.0', release_notes_pump: '', min_app_version_pump: '',
};
const hang = new Set();          //  «نوشته شد، پاسخ گم شد»
const downloadsOf = (app = '') => ({
  downloads: ['shop', 'pump'].filter((a) => !app || a === app).map((a) => ({
    app: a, title: a === 'shop' ? 'برنامهٔ دکان' : 'برنامهٔ پمپ', url: cfg[`download_url_${a}`] || '', version: cfg[`latest_version_${a}`] || '',
    notes: cfg[`release_notes_${a}`] || '', minVersion: validV(cfg[`min_app_version_${a}`]), internalKey: `cfg:${a}`,
  })),
  apps: [{ slug: 'site', title: 'سایت', kind: 'web', url: 'https://vill3n.top' }],
});

const fake = http.createServer((req, res) => {
  held.add(res);
  res.on('close', () => held.delete(res));
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const raw = Buffer.concat(chunks).toString();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const j = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const err = (code, c, message) => j(code, { error: { code: c, message } });
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    //  ⛔ `idempotent-writes.v1` اعلام است — ولی این درها کلید را نمی‌شناسند (‎lib/admin-write-once.js‎ فقط دستگاه، بانکِ عکس و ‎POST /backups‎)
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: ['actor.v1', 'idempotent-writes.v1'], serverTime: NOW });
    seen.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body, idem: String(req.headers['idempotency-key'] || '') });

    if (p === '/api/admin/release/beta') {
      const current = () => ({ shops: { ids: beta.shops, updatedAt: beta.updatedAt, updatedBy: beta.updatedBy },
        devices: { ids: beta.devices, updatedAt: 0, updatedBy: '' }, version: beta.version, internal: 'live_config:release' });
      if (req.method === 'GET') return j(200, current());
      if (req.method === 'PUT') {
        const parse = (input) => {
          if (input === undefined) return undefined;
          const r = Array.isArray(input) ? input : String(input ?? '').split(/[\s,،]+/);
          const ids = [...new Set(r.map((x) => String(x).trim()).filter(Boolean))];
          if (ids.some((x) => !ID.test(x))) throw ['bad_release_id', 'شناسهٔ نامعتبر'];
          if (ids.length > 200) throw ['too_many_ids', 'حداکثر ۲۰۰ شناسه'];
          return ids;
        };
        let want;
        try { want = { shops: parse(body?.shops), devices: parse(body?.devices) }; } catch ([c, m]) { return err(400, c, m); }
        if (want.shops === undefined && want.devices === undefined) return err(400, 'bad_body', 'فهرستِ دکان‌ها یا دستگاه‌ها لازم است');
        const changed = [];
        for (const f of ['shops', 'devices']) {
          if (want[f] === undefined) continue;
          if (JSON.stringify(want[f]) === JSON.stringify(beta[f])) continue;
          beta[f] = want[f];
          beta.version += 1;
          if (f === 'shops') { beta.updatedAt = Date.now(); beta.updatedBy = 'boss'; }
          changed.push(f);
        }
        if (hang.has('beta')) { hang.delete('beta'); return; }
        return j(200, { ok: true, changed, ...current() });
      }
    }
    if (p === '/api/downloads' && req.method === 'GET') return j(200, { ...downloadsOf(u.searchParams.get('app') || ''), serverTime: NOW });
    if (p === '/api/admin/downloads' && req.method === 'PUT') {
      const aliases = { shop: 'shop', pump: 'pump', station: 'pump' };
      const app = aliases[String(body?.app || '').toLowerCase()] || 'shop';
      let min;
      if (body?.minVersion !== undefined) {
        const r = String(body.minVersion).trim().slice(0, 32);
        min = validV(r);
        if (r && !min) return err(400, 'bad_version', 'حداقل نسخه باید مثلِ 2.14.2 باشد');
        const latest = validV(body?.version !== undefined ? body.version : cfg[`latest_version_${app}`]);
        if (min && latest && cmp(min, latest) > 0) return err(400, 'min_above_latest', 'حداقل نسخه از آخرین نسخهٔ منتشرشده بالاتر است');
      }
      for (const [k, key] of [['url', 'download_url'], ['version', 'latest_version'], ['notes', 'release_notes']]) {
        if (body?.[k] !== undefined) cfg[`${key}_${app}`] = typeof body[k] === 'string' ? body[k].trim() : '';
      }
      if (min !== undefined) cfg[`min_app_version_${app}`] = min;
      if (hang.has('downloads')) { hang.delete('downloads'); return; }
      return j(200, downloadsOf(app));
    }
    if (p === '/api/admin/system/notify-usage' && req.method === 'GET') {
      const n = Number(u.searchParams.get('days'));
      const days = Number.isInteger(n) && n >= 1 && n <= 31 ? n : 7;
      return j(200, {
        days, since: NOW - days * DAY, checkedAt: NOW,
        channels: [{ channel: 'sms', unitMicros: 446000, capMicros: 2230000 }, { channel: 'push', unitMicros: 0, capMicros: 1000000 }, { channel: 'Bad Channel!', unitMicros: 1, capMicros: 1 }],
        totals: { sent: 5, costMicros: 892000, costCap: 1, rateLimited: 2, shops: 2 },
        shops: [
          { shopId: 's1', name: 'دکانِ <b>یک</b>', sent: 3, costMicros: 892000, phone: '+93700000001',
            byChannel: { sms: { sent: 2, costMicros: 892000, last24hMicros: 892000 }, push: { sent: 1, costMicros: 0, last24hMicros: 0 } },
            costCap: 1, rateLimited: 0, nearCap: ['sms', '<x>'] },
          { shopId: 's2', name: '', sent: 2, costMicros: 0, byChannel: { push: { sent: 2, costMicros: 0, last24hMicros: 0 } }, costCap: 0, rateLimited: 2, nearCap: [] },
        ],
        shopsTruncated: false, truncated: true,
        codes: { currency: 'AFN', unitCostMinor: 150, total: { attempts: 5, sent: 4, failed: 1, mock: 0, other: 0, parts: 4, costMinor: 600 },
          byPurpose: [{ purpose: 'login', shop: false, attempts: 3, sent: 3, failed: 0, mock: 0, other: 0, parts: 3, costMinor: 450, phone: '+93700000002' },
            { purpose: 'storefront_phone', shop: true, attempts: 2, sent: 1, failed: 1, mock: 0, other: 0, parts: 1, costMinor: 150 }] },
        rawRows: [{ phone_key: 'k1', text: 'کد ۱۲۳۴' }],
      });
    }
    const bk = /^\/api\/admin\/accounts\/([^/]+)\/([^/]+)\/backups$/.exec(p);
    if (bk && req.method === 'GET') {
      const app = bk[1];
      if (app !== 'shop' && app !== 'pump') return err(400, 'bad_app', 'بخش معتبر نیست');
      return j(200, {
        app, backups: [
          { id: 'bk_1', app, bytes: 2048, sha256: 'a'.repeat(64), label: '<img src=x>پیش از به‌روزرسانی', kind: 'auto', appVersion: '2.14.5',
            createdAt: NOW - 3600e3, name: 'shop-1405-08-20.vbk', path: `/srv/backups/accounts/${app}/${bk[2]}/bk_1.vbk`, tenant_id: bk[2] },
          { id: 'bk_0', app, bytes: 1024, sha256: 'not-a-hash', label: '', kind: 'manual', appVersion: '', createdAt: NOW - DAY, name: 'shop-old.vbk' },
        ],
        stats: { app, count: 2, usedBytes: 3072, lastAt: NOW - 3600e3, keep: 7, quotaBytes: 50e6, maxBytes: 20e6, freeBytes: 50e6 - 3072,
          paid: true, source: 'subscription', dir: `/srv/backups/accounts/${app}/${bk[2]}` },
      });
    }
    return err(404, 'route_not_found', 'نیست');
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

/* ───────────── پنلِ واقعی ───────────── */
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0',
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
         HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
         HLP_BRIDGE_TIMEOUT_MS: '800', HLP_AUTH_RATE_LIMIT: '100000', HLP_RATE_API: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, headers = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = '/api/account-admin/console';
const ups = (method, p) => seen.filter((s) => s.method === method && s.path === p);
const auditRows = async (tok, q) => ((await api('GET', `/api/control/audit?q=${encodeURIComponent(q)}&limit=100&offset=0`, undefined, { Authorization: `Bearer ${tok}` })).json?.rows || []);

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await sleep(250);
  }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Par-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Par-1405-owner');
  const H = (t) => ({ Authorization: `Bearer ${t}` });
  for (const [u, role] of [['adm1', 'admin'], ['adm2', 'admin'], ['op1', 'operator'], ['view1', 'viewer'], ['view2', 'viewer']]) {
    await api('POST', '/api/auth/users', { username: u, password: `Par-${role}-1405-${u}`, role }, H(owner));
  }
  const T = { owner, adm: await login('adm1', 'Par-admin-1405-adm1'), adm2: await login('adm2', 'Par-admin-1405-adm2'),
    op: await login('op1', 'Par-operator-1405-op1'), view: await login('view1', 'Par-viewer-1405-view1'), view2: await login('view2', 'Par-viewer-1405-view2') };
  check('شش نشست: مالک، دو admin، operator، دو viewer', Object.values(T).every(Boolean), JSON.stringify(Object.keys(T).filter((k) => !T[k])));

  /* ═════════════ ۱) کانالِ آزمایشی — ‎PUT /console/release/beta‎ ═════════════ */
  console.log('\n── کانالِ آزمایشی (‎PUT /api/admin/release/beta‎، آن‌جا فقط ارشد) ──');
  const BP = `${C}/release/beta`;
  const g0 = await api('GET', BP, undefined, H(T.adm));
  check('خواندن (admin): فقط فیلدهای شناخته — شناسه‌ها، زمان، انجام‌دهنده و نسخهٔ scope ِ ‎release‎؛ فیلدِ ناشناختهٔ بالادست نه',
    g0.status === 200 && g0.json?.version === 4 && g0.json?.shops?.ids?.join(',') === 's1,shop-old' && g0.json?.devices?.ids?.join(',') === 'dev-1'
      && g0.json?.shops?.updatedBy === 'boss' && g0.json?.internal === undefined && typeof g0.json?.fetchedAt === 'number', `${g0.status} ${g0.text.slice(0, 300)}`);
  const gv = await api('GET', BP, undefined, H(T.view));
  check('⛔ خواندن هم فقط admin (سرورِ حساب حتی خواندنش را فقط به ارشد می‌دهد)', gv.status === 403, String(gv.status));

  const bb = (k, extra = {}) => ({ shops: ['s1', 'shop-new'], devices: ['dev-1'], version: 4, reason: 'آزمونِ نسخهٔ بتا با دو دکان', confirm: true, idempotencyKey: `beta-key-${k}-0001`, ...extra });
  const nPut0 = ups('PUT', '/api/admin/release/beta').length;
  const pv = await api('PUT', BP, bb('pv'), H(T.view));
  const po = await api('PUT', BP, bb('po'), H(T.op));
  check('⛔ viewer و operator نمی‌نویسند (۴۰۳)، بی درخواست به سرورِ حساب', pv.status === 403 && po.status === 403 && ups('PUT', '/api/admin/release/beta').length === nPut0 && ups('GET', '/api/admin/release/beta').length === 1,
    `${pv.status} ${po.status}`);
  const bBad = [
    ['بی تأیید', bb('b1', { confirm: false }), 'confirm_required'],
    ['دلیلِ کوتاه', bb('b2', { reason: 'ab' }), 'reason_required'],
    ['دلیلِ بلند', bb('b3', { reason: 'د'.repeat(201) }), 'reason_required'],
    ['بی کلید', bb('b4', { idempotencyKey: undefined }), 'idempotency_key_required'],
    ['کلیدِ بد', bb('b5', { idempotencyKey: 'bad key!' }), 'bad_idempotency_key'],
    ['بی نسخه', bb('b6', { version: undefined }), 'bad_version'],
    ['نسخهٔ نادرست', bb('b7', { version: '4' }), 'bad_version'],
    ['شناسهٔ ناجور', bb('b8', { shops: ['s1', 'دکان'] }), 'bad_release_id'],
    ['شناسهٔ بلند', bb('b9', { devices: ['d'.repeat(81)] }), 'bad_release_id'],
    ['بیش از ۲۰۰', bb('b10', { shops: Array.from({ length: 201 }, (_, i) => `s${i}`) }), 'too_many_ids'],
    ['هیچ فهرست', bb('b11', { shops: undefined, devices: undefined }), 'bad_body'],
    ['فهرستِ نافهرست', bb('b12', { shops: { a: 1 } }), 'bad_body'],
    ['null', bb('b13', { devices: null }), 'bad_body'],
  ];
  const bOut = [];
  for (const [, body] of bBad) bOut.push(await api('PUT', BP, body, H(T.owner)));
  check(`⛔ ورودیِ بد ⇒ ۴۰۰ با کدِ درست، پیش از پل (${bBad.length} حالت: تأیید، دلیل، کلید، نسخه، شناسه، ۲۰۰، بدنه)`,
    bBad.every(([, , code], i) => bOut[i].status === 400 && bOut[i].json?.error === code) && ups('PUT', '/api/admin/release/beta').length === nPut0,
    bBad.map(([n, , code], i) => `${n}:${bOut[i].status}/${bOut[i].json?.error}≠${code}`).filter((_, i) => bOut[i].json?.error !== bBad[i][2]).join(' '));
  const str = await api('PUT', BP, bb('st1', { shops: ' s1, shop-new ،s1\n', devices: undefined }), H(T.adm));
  const stUp = ups('PUT', '/api/admin/release/beta').at(-1);
  check('رشته‌ای که با ویرگول/ویرگولِ فارسی/خط جدا شده ⇒ شناسه‌های بی‌تکرار (همان ‎parse‎ ِ سرورِ حساب)؛ فهرستِ نیامده دست نمی‌خورد',
    str.status === 200 && JSON.stringify(stUp?.body) === JSON.stringify({ shops: ['s1', 'shop-new'], reason: 'آزمونِ نسخهٔ بتا با دو دکان' })
      && str.json?.changed?.join(',') === 'shops' && str.json?.version === 5 && str.json?.devices?.ids?.join(',') === 'dev-1',
    `${str.status} ${str.text.slice(0, 200)} ${JSON.stringify(stUp?.body)}`);

  const nB = ups('PUT', '/api/admin/release/beta').length;
  const w1 = await api('PUT', BP, bb('w1', { shops: ['s1', 'shop-new', 'shop-3'], devices: ['dev-1', 'dev-2'], version: 5 }), H(T.adm));
  const up1 = ups('PUT', '/api/admin/release/beta').at(-1);
  check('admin ⇒ ‎200‎ ِ تأییدشده: بالادست فقط ‎{shops, devices, reason}‎ و **بی** ‎Idempotency-Key‎ (این در کلید ندارد)؛ «عوض‌شده‌ها» و نسخهٔ تازه از سرورِ حساب',
    w1.status === 200 && w1.json?.ok === true && w1.json?.changed?.join(',') === 'shops,devices' && w1.json?.version === 7
      && JSON.stringify(up1?.body) === JSON.stringify({ shops: ['s1', 'shop-new', 'shop-3'], devices: ['dev-1', 'dev-2'], reason: 'آزمونِ نسخهٔ بتا با دو دکان' })
      && up1?.idem === '' && ups('PUT', '/api/admin/release/beta').length === nB + 1 && w1.json?.internal === undefined,
    `${w1.status} ${w1.text.slice(0, 260)} ${JSON.stringify(up1)}`);
  const w2 = await api('PUT', BP, bb('w1', { shops: ['s1', 'shop-new', 'shop-3'], devices: ['dev-1', 'dev-2'], version: 5 }), H(T.adm));
  check('همان کلید ⇒ همان پاسخ (‎replayed‎) از یادِ پل، بی درخواستِ دوم (نه حتی خواندنِ نسخه)',
    w2.status === 200 && w2.json?.replayed === true && w2.json?.version === 7 && ups('PUT', '/api/admin/release/beta').length === nB + 1, `${w2.status} ${w2.text.slice(0, 160)}`);
  const w3 = await api('PUT', BP, bb('w1', { shops: ['s1'], version: 5 }), H(T.adm));
  check('همان کلید برای کارِ دیگر ⇒ ‎409 idempotency_key_reused‎', w3.status === 409 && w3.json?.error === 'idempotency_key_reused', `${w3.status} ${w3.json?.error}`);

  const nS = ups('PUT', '/api/admin/release/beta').length;
  const stale = await api('PUT', BP, bb('stale', { shops: ['s1'], version: 5 }), H(T.adm));
  check('⛔ نسخهٔ کهنه (کسِ دیگری در این میان نوشت: ۵ ⇐ ۷) ⇒ ‎409 beta_version‎ و **هیچ** نوشتن — نه رونویسیِ بی‌صدای فهرستِ تازه',
    stale.status === 409 && stale.json?.error === 'beta_version' && ups('PUT', '/api/admin/release/beta').length === nS && beta.shops.length === 3,
    `${stale.status} ${stale.text.slice(0, 200)}`);
  const same = await api('PUT', BP, bb('same', { shops: ['s1', 'shop-new', 'shop-3'], devices: ['dev-1', 'dev-2'], version: 7 }), H(T.adm));
  check('همان فهرست ⇒ ‎changed: []‎ ِ سرورِ حساب، نسخه همان', same.status === 200 && Array.isArray(same.json?.changed) && same.json.changed.length === 0 && same.json?.version === 7,
    `${same.status} ${same.text.slice(0, 160)}`);

  hang.add('beta');
  const h1 = await api('PUT', BP, bb('h1', { shops: ['s1'], version: 7 }), H(T.adm));
  const nH = ups('PUT', '/api/admin/release/beta').length;
  const h2 = await api('PUT', BP, bb('h1', { shops: ['s1'], version: 7 }), H(T.adm));
  check('پاسخِ گم‌شده ⇒ ‎504 outcome_unknown‎؛ ⛔ همان کلید ⇒ همان «نامعلوم» بی درخواستِ دوم',
    h1.status === 504 && h1.json?.outcome === 'unknown' && h2.status === 504 && h2.json?.outcome === 'unknown' && ups('PUT', '/api/admin/release/beta').length === nH,
    `${h1.status} ${h2.status} ${h1.text.slice(0, 120)}`);

  const bRows = (await auditRows(T.owner, 'account.release_beta')).filter((r) => r.action === 'account.release_beta.updated');
  check('دفترِ پنل: یک ردیف برای هر نوشتنِ تأییدشده (۳: رشته، دو فهرست، همان فهرست) با دلیل، نسخه و «افزوده/برداشته» — نه برای رد، بازپخش، کهنه یا نامعلوم',
    bRows.length === 3 && bRows.every((r) => r.actor === 'adm1') && bRows.some((r) => String(r.detail).includes('"version":7') && String(r.detail).includes('shop-3'))
      && bRows.every((r) => String(r.detail).includes('آزمونِ نسخهٔ بتا')), JSON.stringify(bRows.map((r) => r.detail)).slice(0, 500));
  const unk = (await auditRows(T.owner, 'outcome_unknown')).filter((r) => r.action === 'account.bridge.outcome_unknown' && String(r.detail).includes('/api/admin/release/beta'));
  check('«نامعلوم» ردیفِ خودش را دارد (چه کسی، کدام در، با چه مهلتی)', unk.length === 1 && unk[0].actor === 'adm1' && unk[0].result === 'unknown', JSON.stringify(unk).slice(0, 300));

  /* ═════════════ ۲) دانلودِ برنامه‌ها — ‎GET /console/downloads‎ · ‎PUT /console/downloads‎ ═════════════ */
  console.log('\n── نشانیِ دانلود و نسخه (‎GET /api/downloads‎ ِ عمومی · ‎PUT /api/admin/downloads‎، آن‌جا فقط ارشد) ──');
  const DP = `${C}/downloads`;
  const dg = await api('GET', DP, undefined, H(T.view));
  const dShop = dg.json?.downloads?.find((d) => d.app === 'shop');
  check('خواندن (viewer هم): هر دو برنامه با نشانی، نسخه، یادداشت و حداقل — فیلدِ ناشناخته و فهرستِ برنامه‌های دیگر نه',
    dg.status === 200 && dg.json?.downloads?.length === 2 && dShop?.url === cfg.download_url_shop && dShop?.version === '2.14.5' && dShop?.minVersion === '2.10.0'
      && dShop?.notes === 'رفعِ خطا' && dShop?.internalKey === undefined && dg.json?.apps === undefined && ups('GET', '/api/downloads').length === 1,
    `${dg.status} ${dg.text.slice(0, 300)}`);
  const db = (k, extra = {}) => ({ app: 'shop', url: 'https://dl.vill3n.top/shop-2.14.6.apk', version: '2.14.6', reason: 'انتشارِ ۲.۱۴.۶', confirm: true, idempotencyKey: `dl-key-${k}-0001`, ...extra });
  const nD0 = ups('PUT', '/api/admin/downloads').length;
  const dv = await api('PUT', DP, db('dv'), H(T.view));
  const dop = await api('PUT', DP, db('do'), H(T.op));
  check('⛔ viewer و operator نشانیِ دانلود را عوض نمی‌کنند (۴۰۳)، بی درخواست', dv.status === 403 && dop.status === 403 && ups('PUT', '/api/admin/downloads').length === nD0, `${dv.status} ${dop.status}`);
  const dBad = [
    ['بی تأیید', db('d1', { confirm: undefined }), 'confirm_required'],
    ['بی دلیل', db('d2', { reason: '' }), 'reason_required'],
    ['کلیدِ بد', db('d3', { idempotencyKey: 'x' }), 'bad_idempotency_key'],
    ['برنامهٔ ناشناخته', db('d4', { app: 'market' }), 'bad_app'],
    ['نشانیِ javascript', db('d5', { url: 'javascript:alert(1)' }), 'bad_url'],
    ['نشانیِ data', db('d6', { url: 'data:text/html,<b>x</b>' }), 'bad_url'],
    ['نشانیِ نسبی', db('d7', { url: '/shop.apk' }), 'bad_url'],
    ['نشانی با فاصله', db('d8', { url: 'https://dl.vill3n.top/a b.apk' }), 'bad_url'],
    ['نشانیِ بلند', db('d9', { url: `https://dl.vill3n.top/${'a'.repeat(290)}` }), 'bad_url'],
    ['نشانیِ نامتن', db('d10', { url: 5 }), 'bad_field'],
    ['نسخهٔ بلند', db('d11', { version: '1'.repeat(33) }), 'bad_field'],
    ['یادداشتِ بلند', db('d12', { notes: 'ن'.repeat(1001) }), 'bad_field'],
    ['حداقلِ نادرست', db('d13', { minVersion: '2.x' }), 'bad_version'],
    ['هیچ فیلد', { app: 'shop', reason: 'هیچ چیز', confirm: true, idempotencyKey: 'dl-key-d14-0001' }, 'bad_body'],
  ];
  const dOut = [];
  for (const [, body] of dBad) dOut.push(await api('PUT', DP, body, H(T.owner)));
  check(`⛔ ورودیِ بد ⇒ ۴۰۰ با کدِ درست، پیش از پل (${dBad.length} حالت؛ نشانی فقط ‎http(s)‎ ِ کامل — به دستِ همهٔ مشتری‌ها می‌رسد)`,
    dBad.every(([, , code], i) => dOut[i].status === 400 && dOut[i].json?.error === code) && ups('PUT', '/api/admin/downloads').length === nD0,
    dBad.map(([n, , code], i) => `${n}:${dOut[i].status}/${dOut[i].json?.error}≠${code}`).filter((_, i) => dOut[i].json?.error !== dBad[i][2]).join(' '));
  const dw = await api('PUT', DP, db('w1', { notes: '  رفعِ خطای\nچاپ\u0007  ' }), H(T.adm));
  const dUp = ups('PUT', '/api/admin/downloads').at(-1);
  check('admin ⇒ ‎200‎ ِ تأییدشده: بالادست فقط فیلدهای داده‌شده + ‎app‎ (یادداشت: خط و نویسهٔ کنترلی ⇒ فاصله، نه چسبیدنِ دو واژه)، بی کلید؛ پاسخ همان برنامه',
    dw.status === 200 && dw.json?.ok === true && dw.json?.download?.version === '2.14.6' && dw.json?.download?.url === 'https://dl.vill3n.top/shop-2.14.6.apk'
      && JSON.stringify(dUp?.body) === JSON.stringify({ app: 'shop', url: 'https://dl.vill3n.top/shop-2.14.6.apk', version: '2.14.6', notes: 'رفعِ خطای چاپ' })
      && dUp?.idem === '' && dw.json?.download?.internalKey === undefined && dw.json?.apps === undefined,
    `${dw.status} ${dw.text.slice(0, 260)} ${JSON.stringify(dUp?.body)}`);
  const dr = await api('PUT', DP, db('w1', { notes: '  رفعِ خطای\nچاپ\u0007  ' }), H(T.adm));
  check('همان کلید ⇒ ‎replayed‎ بی درخواستِ دوم', dr.status === 200 && dr.json?.replayed === true && ups('PUT', '/api/admin/downloads').length === nD0 + 1, `${dr.status}`);
  const dMin = await api('PUT', DP, { app: 'shop', minVersion: '2.15.0', reason: 'حداقلِ تازه', confirm: true, idempotencyKey: 'dl-key-min1-0001' }, H(T.adm));
  check('حداقلِ بالاتر از آخرین نسخهٔ ذخیره‌شده ⇒ ‎400 min_above_latest‎ ِ خودِ سرورِ حساب همان‌طور (نه «انجام شد»)',
    dMin.status === 400 && dMin.json?.error === 'min_above_latest' && cfg.min_app_version_shop === '2.10.0', `${dMin.status} ${dMin.text.slice(0, 160)}`);
  const dMin2 = await api('PUT', DP, { app: 'shop', minVersion: 'v2.12.0', reason: 'حداقلِ تازه', confirm: true, idempotencyKey: 'dl-key-min1-0001' }, H(T.adm));
  check('⛔ شکستِ روشن کلید را آزاد می‌کند: همان پنجره با حداقلِ درست ⇒ ‎200‎ (‎v‎ ِ پیشوند همان‌جا برداشته می‌شود)',
    dMin2.status === 200 && dMin2.json?.download?.minVersion === '2.12.0' && cfg.min_app_version_shop === '2.12.0', `${dMin2.status} ${dMin2.text.slice(0, 160)}`);
  const dClear = await api('PUT', DP, { app: 'pump', url: '', notes: '', reason: 'پاک کردنِ نشانیِ کهنه', confirm: true, idempotencyKey: 'dl-key-clr1-0001' }, H(T.adm));
  check('رشتهٔ خالی = پاک کردن (همان قراردادِ سرورِ حساب)؛ برنامهٔ دوم همان در', dClear.status === 200 && dClear.json?.download?.app === 'pump'
    && JSON.stringify(ups('PUT', '/api/admin/downloads').at(-1)?.body) === JSON.stringify({ app: 'pump', url: '', notes: '' }), `${dClear.status} ${dClear.text.slice(0, 160)}`);
  hang.add('downloads');
  const dh = await api('PUT', DP, db('h1', { version: '2.14.7', url: undefined }), H(T.adm));
  const nDH = ups('PUT', '/api/admin/downloads').length;
  const dh2 = await api('PUT', DP, db('h1', { version: '2.14.7', url: undefined }), H(T.adm));
  check('پاسخِ گم‌شده ⇒ ‎504 outcome_unknown‎؛ همان کلید ⇒ همان «نامعلوم» بی درخواستِ دوم',
    dh.status === 504 && dh.json?.outcome === 'unknown' && dh2.status === 504 && ups('PUT', '/api/admin/downloads').length === nDH, `${dh.status} ${dh2.status}`);
  const dRows = (await auditRows(T.owner, 'account.downloads')).filter((r) => r.action === 'account.downloads.updated');
  check('دفترِ پنل: یک ردیف برای هر نوشتنِ تأییدشده (۳) با برنامه، دلیل، فیلدهای عوض‌شده و نشانیِ تازه — نه برای رد/بازپخش/نامعلوم',
    dRows.length === 3 && dRows.some((r) => String(r.detail).includes('shop-2.14.6.apk') && String(r.detail).includes('"fields":["url","version","notes"]'))
      && dRows.some((r) => String(r.detail).includes('"app":"pump"')), JSON.stringify(dRows.map((r) => r.detail)).slice(0, 500));

  /* ═════════════ ۳) مصرف و هزینهٔ پیام — ‎GET /console/system/notify-usage‎ ═════════════ */
  console.log('\n── مصرف و هزینهٔ پیام (‎GET /api/admin/system/notify-usage‎) ──');
  const NU = `${C}/system/notify-usage`;
  const nu = await api('GET', `${NU}?days=14`, undefined, H(T.view));
  const s1 = nu.json?.shops?.find((s) => s.shopId === 's1');
  check('خواندن (viewer هم): بازه به سرورِ حساب می‌رود؛ دکان، کانال، هزینه، سقف و نشانه‌ها',
    nu.status === 200 && nu.json?.days === 14 && ups('GET', '/api/admin/system/notify-usage').at(-1)?.query?.days === '14' && nu.json?.totals?.costMicros === 892000
      && s1?.byChannel?.sms?.costMicros === 892000 && s1?.nearCap?.join(',') === 'sms' && nu.json?.codes?.total?.costMinor === 600 && nu.json?.codes?.byPurpose?.length === 2
      && nu.json?.truncated === true && nu.json?.channels?.length === 2, `${nu.status} ${nu.text.slice(0, 400)}`);
  check('⛔ فقط فیلدهای شناخته: هیچ شماره، کلیدِ شماره یا متنِ پیام (فیلدِ ناشناختهٔ بالادست) به پنل نمی‌رسد؛ کانالِ ناجور کنار',
    !nu.text.includes('+93') && !nu.text.includes('"phone"') && !nu.text.includes('phone_key') && !nu.text.includes('rawRows') && !nu.text.includes('Bad Channel') && !nu.text.includes('<x>'), nu.text.slice(0, 300));
  const nuD = await api('GET', NU, undefined, H(T.view));
  check('بی بازه ⇒ پیش‌فرضِ سرورِ حساب (۷)، چیزی ساخته نمی‌شود', nuD.status === 200 && nuD.json?.days === 7 && ups('GET', '/api/admin/system/notify-usage').at(-1)?.query?.days === undefined,
    `${nuD.status} ${JSON.stringify(ups('GET', '/api/admin/system/notify-usage').at(-1)?.query)}`);
  const nBadOut = [];
  const nNU = ups('GET', '/api/admin/system/notify-usage').length;
  for (const d of ['0', '32', 'abc', '7.5', '-1']) nBadOut.push((await api('GET', `${NU}?days=${d}`, undefined, H(T.view))).json?.error);
  check('⛔ بازهٔ نادرست (۰، ۳۲، متن، اعشار، منفی) ⇒ ‎400 bad_days‎ پیش از پل — نه پیش‌فرضِ بی‌صدا', nBadOut.every((e) => e === 'bad_days') && ups('GET', '/api/admin/system/notify-usage').length === nNU,
    nBadOut.join(','));
  let lim = 0;
  for (let i = 0; i < 70; i++) { const r = await api('GET', `${NU}?days=1`, undefined, H(T.view2)); if (r.status === 429) { lim = i; break; } }
  const other = await api('GET', `${NU}?days=1`, undefined, H(T.view));
  check('⛔ سقفِ نرخِ هر کاربر روی این گزارشِ پرهزینه (۶۰ در ده دقیقه) — کاربرِ دیگر دست نمی‌خورد', lim === 60 && other.status === 200, `${lim} ${other.status}`);

  /* ═════════════ ۴) پشتیبان‌های هر دکان/پمپ — ‎GET /console/accounts/:app/:tenantId/backups‎ ═════════════ */
  console.log('\n── پشتیبان‌های یک حساب (‎GET /api/admin/accounts/:app/:tenantId/backups‎، فقط فهرست) ──');
  const BK = (app, t, q = '') => `${C}/accounts/${app}/${t}/backups${q}`;
  const bk = await api('GET', BK('shop', 's1', '?limit=20'), undefined, H(T.view));
  const b1 = bk.json?.backups?.[0];
  check('خواندن (viewer هم): فهرست و سهمِ همان حساب؛ ‎limit‎ به سرورِ حساب می‌رود',
    bk.status === 200 && bk.json?.app === 'shop' && bk.json?.backups?.length === 2 && b1?.id === 'bk_1' && b1?.bytes === 2048 && b1?.sha256 === 'a'.repeat(64)
      && bk.json?.stats?.count === 2 && bk.json?.stats?.paid === true && bk.json?.stats?.source === 'subscription'
      && ups('GET', '/api/admin/accounts/shop/s1/backups').at(-1)?.query?.limit === '20', `${bk.status} ${bk.text.slice(0, 300)}`);
  check('⛔ فقط فیلدهای شناخته: مسیرِ دیسکِ سرورِ حساب و شناسهٔ خامِ حساب نمی‌رسند؛ هشِ نادرست «—»؛ برچسب متن می‌ماند',
    !bk.text.includes('/srv/backups') && b1?.path === undefined && b1?.tenant_id === undefined && bk.json?.stats?.dir === undefined
      && bk.json?.backups?.[1]?.sha256 === '' && b1?.label === '<img src=x>پیش از به‌روزرسانی', bk.text.slice(0, 300));
  const bkp = await api('GET', BK('pump', 'st_9'), undefined, H(T.view));
  check('بخشِ دوم همان در؛ بی ‎limit‎ ⇒ پیش‌فرضِ سرورِ حساب', bkp.status === 200 && bkp.json?.app === 'pump' && ups('GET', '/api/admin/accounts/pump/st_9/backups').at(-1)?.query?.limit === undefined,
    `${bkp.status}`);
  const nBK = seen.filter((s) => s.path.includes('/accounts/')).length;
  const bkBad = [];
  for (const [u, code] of [[BK('market', 's1'), 'bad_app'], [BK('shop', 'a.b'), 'bad_tenant'], [BK('shop', 'x'.repeat(65)), 'bad_tenant'],
    [BK('shop', 's1', '?limit=0'), 'bad_limit'], [BK('shop', 's1', '?limit=501'), 'bad_limit'], [BK('shop', 's1', '?limit=ab'), 'bad_limit']]) {
    const r = await api('GET', u, undefined, H(T.view));
    bkBad.push(`${r.status}/${r.json?.error}=${code}`);
  }
  check('⛔ بخش، شناسه و ‎limit‎ ِ نادرست ⇒ ۴۰۰ پیش از پل (همان قاعدهٔ ‎safeTenant‎ و ‎1..500‎ ِ سرورِ حساب)',
    bkBad.every((x) => { const [a, b] = x.split('='); return a === `400/${b}`; }) && seen.filter((s) => s.path.includes('/accounts/')).length === nBK, bkBad.join(' '));
  const del = await api('DELETE', `${BK('shop', 's1')}/bk_1`, undefined, H(T.owner));
  const dl = await api('GET', `${BK('shop', 's1')}/bk_1`, undefined, H(T.owner));
  check('⛔ حذف و دانلودِ پشتیبانِ مشتری از پنل نیست (تصمیمِ مالک: «بایگانی به‌جای حذف»؛ خروجیِ دادهٔ خصوصی) ⇒ ۴۰۴، بی درخواست',
    del.status === 404 && dl.status === 404 && seen.filter((s) => s.path.includes('/accounts/')).length === nBK && !seen.some((s) => s.method === 'DELETE'), `${del.status} ${dl.status}`);

  /* ═════════════ ۵) راز و دفتر ═════════════ */
  const all = await auditRows(T.owner, 'account.');
  check('⛔ هیچ کلیدِ یکتایی در دفترِ پنل نیست', !all.some((r) => /beta-key|dl-key/.test(String(r.detail))), '');
  check('⛔ ربات تلگرامِ پمپ (‎PUT /api/admin/telegram‎) از این پل نوشته نمی‌شود — بیرون از این کار (پمپ)',
    (await api('PUT', `${C}/telegram`, { token: '123:abc', confirm: true }, H(T.owner))).status === 404 && !seen.some((s) => s.path === '/api/admin/telegram'));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  for (const r of held) r.destroy();
  fake.close();
  await sleep(400);
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
