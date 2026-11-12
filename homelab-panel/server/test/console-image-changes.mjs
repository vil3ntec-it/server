// ---------------------------------------------------------------------------
//  IMG-PRO-17 در پل — دسته‌های «تغییرِ دسته‌ایِ عکس» ِ یک دکان و برگرداندن، با و بی `image-changes.v1` (۱.۵۰.۹۶)
//      node test/console-image-changes.mjs
//
//  سرورِ حسابِ ساختگی به شکلِ ‎routes/admin-image-changes.js‎ ِ shop ‎claude/e-rows-13x‎:
//    GET ⇒ ‎{shopId, enabled, changes}‎ · GET ‎/:cid‎ ⇒ ‎{shopId, change (+items)}‎ · POST ‎/:cid/rollback‎ ‎{reason}‎ + ‎Idempotency-Key‎
//    ⇒ ‎{change, already}‎؛ همان کلید ⇒ همان پاسخ با ‎Idempotent-Replayed‎؛ ‎409 changed_since {products}‎؛ ‎403 grant_required‎.
//  سنجیده می‌شود: بی توانایی ⇒ «در دسترس نیست» و نوشتن ‎501‎ بی درخواست به سرورِ حساب؛ با توانایی ⇒ فقط فیلدهای شناخته،
//  limit ِ بد ‎400‎ پیش از پل، نقش (viewer/operator هیچ نوشتنی به سرورِ حساب نمی‌رسانند)، دلیل/تأیید/کلید پیش از پل، کلیدِ بالادست
//  بسته به کاربرِ پنل، ‎409 changed_since‎ با نامِ کالاها و بی ردیفِ دفتر، «نامعلوم» ⇒ همان کلید ⇒ ردیفِ ‎resolved‎، سقفِ نرخ.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4963);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-image-changes-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/* ───────────── سرورِ حسابِ ساختگی ───────────── */
const NOW = Date.now();
let caps = ['actor.v1'];
const seen = [];
const held = new Set();
let grantMode = '';                 //  'detail' ⇒ جزئیات ‎403 grant_required‎؛ 'rollback' ⇒ برگرداندن همان
let hangNext = false;               //  برگرداندن انجام می‌شود، پاسخ گم می‌شود
const idem = new Map();             //  کلید ⇒ { body, response }
const sel = (id) => ({ source: 'shop', image_id: id, version: 1, match_status: 'confirmed', confirmed_by: 'usr_secret', central_image_id: '',
  central_version: 0, central_match: '', central_confirmed_by: '', bank_product_id: '', extra: 'x' });
const changes = {
  c1: { id: 'c1', client_key: 'k-secret', note: 'قفسهٔ چای\u0007', status: 'applied', item_count: 2, created_by: 'usr_1', created_at: NOW - 9000,
    rolled_back_by: '', rolled_back_at: null, rollback_reason: '', items: [
      { product_id: 'p1', before: sel('img_old'), after: sel('img_new') },
      { product_id: '<img src=x onerror=alert(1)>', before: null, after: sel('img_new') }] },
  c2: { id: 'c2', client_key: 'k2', note: '', status: 'applied', item_count: 1, created_by: 'usr_1', created_at: NOW - 5000,
    rolled_back_by: '', rolled_back_at: null, rollback_reason: '', items: [{ product_id: 'p1', before: sel('img_new'), after: sel('img_x') }] },
};
const strip = ({ items, ...c }) => c;

const fake = http.createServer((req, res) => {
  held.add(res);
  res.on('close', () => held.delete(res));
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    let body = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { body = null; }
    const j = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    seen.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body, idem: String(req.headers['idempotency-key'] || '') });
    const m = /^\/api\/admin\/shops\/([^/]+)\/images\/changes(?:\/([^/]+))?(\/rollback)?$/.exec(p);
    if (!m) return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
    if (!caps.includes('image-changes.v1')) return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
    const [, shop, cid, rb] = m;
    if (shop === 'nope') return j(404, { error: { code: 'shop_not_found', message: 'دکان پیدا نشد' } });
    if (shop === 'shpOff') {
      if (!cid) return j(200, { shopId: shop, enabled: false, changes: [] });
      return j(403, { error: { code: 'image_bank_disabled', message: 'بانکِ تصاویر برای این دکان روشن نیست' } });
    }
    if (req.method === 'GET' && !cid) {
      return j(200, { shopId: shop, enabled: true, changes: [strip(changes.c2), strip(changes.c1), { id: 'bad id!', status: 'applied' }, 'junk'] });
    }
    const ch = shop === 'shpA' ? changes[cid] : null;
    if (req.method === 'GET') {
      if (grantMode === 'detail') return j(403, { error: { code: 'grant_required', message: 'برای این کار اجازهٔ زندهٔ دسترسیِ پشتیبانی به همین دکان لازم است' } });
      if (!ch) return j(404, { error: { code: 'change_not_found', message: 'این دسته در این دکان پیدا نشد' } });
      return j(200, { shopId: shop, change: ch });
    }
    if (req.method === 'POST' && rb) {
      const key = String(req.headers['idempotency-key'] || '');
      const had = key ? idem.get(key) : null;
      if (had) {
        if (JSON.stringify(had.body) !== JSON.stringify({ p, body })) return j(409, { error: { code: 'idempotency_key_reused', message: 'کلید' } });
        return j(200, had.response, { 'Idempotent-Replayed': 'true' });
      }
      if (grantMode === 'rollback') return j(403, { error: { code: 'grant_required', message: 'برای این کار اجازهٔ زندهٔ دسترسیِ پشتیبانی به همین دکان لازم است' } });
      if (String(body?.reason || '').trim().length < 3) return j(400, { error: { code: 'reason_required', message: 'دلیل' } });
      if (!ch) return j(404, { error: { code: 'change_not_found', message: 'این دسته در این دکان پیدا نشد' } });
      if (cid === 'c1' && changes.c2.status === 'applied') {
        return j(409, { error: { code: 'changed_since', message: 'عکسِ بعضی کالاها پس از این دسته دوباره عوض شده است — اول همان تغییرِ تازه‌تر را برگردانید',
          products: ['p1', '<b>p9</b>', 7] } });
      }
      const already = ch.status === 'rolled_back';
      if (!already) Object.assign(ch, { status: 'rolled_back', rolled_back_by: 'admin:a1', rolled_back_at: Date.now(), rollback_reason: body.reason });
      const response = { change: ch, already };
      if (key) idem.set(key, { body: { p, body }, response });
      if (hangNext) { hangNext = false; return; }
      return j(200, response);
    }
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

/* ───────────── پنلِ واقعی ───────────── */
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0',
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
         HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
         HLP_BRIDGE_TIMEOUT_MS: '800', HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
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
const IC = (shop) => `/api/account-admin/console/shops/${shop}/images/changes`;
const ups = (re = /images\/changes/) => seen.filter((s) => re.test(s.path));
const posts = () => seen.filter((s) => s.method === 'POST' && s.path.endsWith('/rollback'));
const auditRows = async (tok) => ((await api('GET', '/api/control/audit?q=account.image_changes&limit=50&offset=0', undefined, { Authorization: `Bearer ${tok}` })).json?.rows || [])
  .filter((r) => r.action === 'account.image_changes.rolled_back');

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await sleep(250);
  }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Img-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Img-1405-owner');
  const H = (t) => ({ Authorization: `Bearer ${t}` });
  for (const [u, role] of [['adm1', 'admin'], ['adm2', 'admin'], ['op1', 'operator'], ['view1', 'viewer']]) {
    await api('POST', '/api/auth/users', { username: u, password: `Img-${role}-1405-${u}`, role }, H(owner));
  }
  const T = { owner, adm: await login('adm1', 'Img-admin-1405-adm1'), adm2: await login('adm2', 'Img-admin-1405-adm2'),
    op: await login('op1', 'Img-operator-1405-op1'), view: await login('view1', 'Img-viewer-1405-view1') };
  const rb = (k, extra = {}) => ({ reason: 'دستهٔ اشتباهِ عکس‌ها', confirm: true, idempotencyKey: `img-chg-${k}-0001`, ...extra });

  console.log('\n── بی `image-changes.v1` (سرورِ حسابِ کهنه) ──');
  const g0 = await api('GET', IC('shpA'), undefined, H(T.view));
  const d0 = await api('GET', `${IC('shpA')}/c1`, undefined, H(T.view));
  check('خواندن ⇒ «در دسترس نیست» با نامِ توانایی و درِ لازم — نه فهرستِ ساختگی، بی پرسش از سرورِ حساب',
    g0.status === 200 && g0.json?.available === false && g0.json?.capability === 'image-changes.v1' && /images\/changes/.test(g0.json?.needs || '')
      && g0.json?.changes === undefined && d0.json?.available === false && ups().length === 0, `${g0.status} ${g0.text.slice(0, 200)}`);
  const p0 = await api('POST', `${IC('shpA')}/c2/rollback`, rb('p0'), H(T.adm));
  check('برگرداندن ⇒ ‎501 capability_missing‎، بی درخواست به سرورِ حساب', p0.status === 501 && p0.json?.error === 'capability_missing' && ups().length === 0,
    `${p0.status} ${p0.text.slice(0, 160)}`);

  caps = ['actor.v1', 'image-changes.v1'];
  console.log('\n── با `image-changes.v1` (shop ‎claude/e-rows-13x‎) ──');
  const g1 = await api('GET', `${IC('shpA')}?limit=5`, undefined, H(T.view));
  const c1 = g1.json?.changes?.[1];
  check('فهرست (viewer هم): فقط دسته‌های درست، تازه‌ترین بالا، فیلدهای شناخته (بی کلیدِ دکان)، نویسهٔ کنترلی برداشته؛ limit به بالادست',
    g1.status === 200 && g1.json?.available === true && g1.json?.enabled === true && g1.json?.shopId === 'shpA' && g1.json?.changes?.length === 2
      && g1.json.changes[0].id === 'c2' && c1?.id === 'c1' && c1.note === 'قفسهٔ چای ' && c1.itemCount === 2 && c1.items === undefined
      && !('client_key' in c1) && !('key' in c1) && ups().at(-1)?.query?.limit === '5', `${g1.status} ${g1.text.slice(0, 300)}`);
  const nb = ups().length;
  const bl = [];
  for (const q of ['0', '51', 'x', '-1', '1.5', '']) bl.push(await api('GET', `${IC('shpA')}?limit=${q}`, undefined, H(T.view)));
  const bid = await api('GET', `${IC('bad%20id')}`, undefined, H(T.view));
  const bcid = await api('GET', `${IC('shpA')}/${'c'.repeat(41)}`, undefined, H(T.view));
  check('⛔ limit ِ بد ‎400 bad_limit‎ (نه بریدن)، شناسهٔ دکان/دستهٔ بد ۴۰۰ — همه پیش از پل',
    bl.every((r) => r.status === 400 && r.json?.error === 'bad_limit') && bid.json?.error === 'bad_id' && bcid.json?.error === 'bad_change_id' && ups().length === nb,
    bl.map((r) => `${r.status}/${r.json?.error}`).join(' ') + ` ${bid.json?.error} ${bcid.json?.error}`);
  const off = await api('GET', IC('shpOff'), undefined, H(T.view));
  check('بانکِ خاموشِ دکان ⇒ ‎enabled: false‎ و فهرستِ خالی (نه خطا)', off.status === 200 && off.json?.enabled === false && off.json?.changes?.length === 0, off.text.slice(0, 160));
  const nope = await api('GET', IC('nope'), undefined, H(T.view));
  check('دکانِ ناموجود ⇒ ‎404 shop_not_found‎ ِ سرورِ حساب همان‌طور', nope.status === 404 && nope.json?.error === 'shop_not_found', `${nope.status} ${nope.json?.error}`);

  const d1 = await api('GET', `${IC('shpA')}/c1`, undefined, H(T.view));
  const it = d1.json?.change?.items;
  check('جزئیات: پیش و پسِ هر کالا فقط با ستون‌های تصمیم (بی شناسهٔ تأییدکننده)؛ «بی ردیف» ⇒ null؛ شناسهٔ کالای HTML همان متن',
    d1.status === 200 && it?.length === 2 && it[0].before?.imageId === 'img_old' && it[0].after?.imageId === 'img_new' && it[0].after?.source === 'shop'
      && it[1].before === null && it[1].productId === '<img src=x onerror=alert(1)>' && !JSON.stringify(d1.json).includes('usr_secret') && !('extra' in it[0].after),
    d1.text.slice(0, 400));
  const dx = await api('GET', `${IC('shpA')}/cZ`, undefined, H(T.view));
  check('دستهٔ دکانِ دیگر/ناموجود ⇒ ‎404 change_not_found‎', dx.status === 404 && dx.json?.error === 'change_not_found', `${dx.status} ${dx.json?.error}`);
  grantMode = 'detail';
  const dg = await api('GET', `${IC('shpA')}/c1`, undefined, H(T.view));
  grantMode = '';
  check('پرچمِ اجازهٔ پشتیبانیِ روشن ⇒ ‎403 grant_required‎ ِ سرورِ حساب همان‌طور (با پیامش)', dg.status === 403 && dg.json?.error === 'grant_required' && /اجازه/.test(dg.json?.message || ''),
    `${dg.status} ${dg.text.slice(0, 160)}`);

  const n0 = posts().length;
  const pv = await api('POST', `${IC('shpA')}/c2/rollback`, rb('pv'), H(T.view));
  const po = await api('POST', `${IC('shpA')}/c2/rollback`, rb('po'), H(T.op));
  check('⛔ viewer و operator برنمی‌گردانند (۴۰۳)، بی درخواست به سرورِ حساب', pv.status === 403 && po.status === 403 && posts().length === n0, `${pv.status} ${po.status}`);
  const bads = [
    ['بی تأیید', rb('b1', { confirm: false }), 'confirm_required'],
    ['دلیلِ کوتاه', rb('b2', { reason: 'ab' }), 'reason_required'],
    ['دلیلِ بلند', rb('b3', { reason: 'د'.repeat(201) }), 'reason_required'],
    ['بی کلید', rb('b4', { idempotencyKey: undefined }), 'idempotency_key_required'],
    ['کلیدِ بد', rb('b5', { idempotencyKey: 'bad key!' }), 'bad_idempotency_key'],
  ];
  const bOut = [];
  for (const [, body] of bads) bOut.push(await api('POST', `${IC('shpA')}/c2/rollback`, body, H(T.adm)));
  check('⛔ ورودیِ بد ⇒ ۴۰۰ با کدِ درست، پیش از پل (تأیید، دلیلِ ۳ تا ۲۰۰، کلید)',
    bads.every(([, , code], i) => bOut[i].status === 400 && bOut[i].json?.error === code) && posts().length === n0,
    bads.map(([n], i) => `${n}:${bOut[i].status}/${bOut[i].json?.error}`).join(' '));

  grantMode = 'rollback';
  const pg = await api('POST', `${IC('shpA')}/c2/rollback`, rb('pg'), H(T.adm));
  grantMode = '';
  check('بی اجازهٔ زندهٔ `restore` ⇒ ‎403 grant_required‎ ِ سرورِ حساب همان‌طور', pg.status === 403 && pg.json?.error === 'grant_required', `${pg.status} ${pg.text.slice(0, 160)}`);
  const early = await api('POST', `${IC('shpA')}/c1/rollback`, rb('early'), H(T.adm));
  check('⛔ ‎409 changed_since‎ ⇒ نامِ کالاهای عوض‌شده (فقط شناسهٔ متنی) در پاسخ و پیام؛ هیچ چیز برنگشت',
    early.status === 409 && early.json?.error === 'changed_since' && JSON.stringify(early.json?.products) === JSON.stringify(['p1', '<b>p9</b>'])
      && /p1/.test(early.json?.message || '') && changes.c1.status === 'applied', `${early.status} ${early.text.slice(0, 300)}`);

  const w1 = await api('POST', `${IC('shpA')}/c2/rollback`, rb('w1'), H(T.adm));
  const up1 = posts().at(-1);
  check('admin ⇒ ‎200‎ با وضعِ «برگشته» از سرورِ حساب؛ بالادست فقط ‎{reason}‎ و کلیدِ پنجره بسته به کاربرِ پنل',
    w1.status === 200 && w1.json?.ok === true && w1.json?.already === false && w1.json?.change?.status === 'rolled_back' && w1.json?.change?.rolledBackBy === 'admin:a1'
      && JSON.stringify(up1?.body) === JSON.stringify({ reason: 'دستهٔ اشتباهِ عکس‌ها' }) && /^u\d+\.img-chg-w1-0001$/.test(up1?.idem || ''),
    `${w1.status} ${w1.text.slice(0, 200)} ${up1?.idem}`);
  const nW = posts().length;
  const w2 = await api('POST', `${IC('shpA')}/c2/rollback`, rb('w1'), H(T.adm));
  check('همان کلید ⇒ همان پاسخ با ‎replayed‎ از خودِ سرورِ حساب (کلیدِ همان کاربر)', w2.status === 200 && w2.json?.replayed === true && w2.json?.already === false
    && posts().length === nW + 1 && posts().at(-1).idem === up1.idem, `${w2.status} ${w2.text.slice(0, 160)}`);
  const w3 = await api('POST', `${IC('shpA')}/c2/rollback`, rb('w1'), H(T.adm2));
  check('⛔ همان کلیدِ رابط از کاربرِ دیگرِ پنل ⇒ کلیدِ بالادستِ دیگر (پاسخِ کسِ دیگر بازپخش نمی‌شود)',
    w3.status === 200 && w3.json?.replayed !== true && w3.json?.already === true && posts().at(-1).idem !== up1.idem, `${w3.status} ${w3.text.slice(0, 160)} ${posts().at(-1).idem}`);
  const w4 = await api('POST', `${IC('shpA')}/c1/rollback`, rb('w1'), H(T.adm));
  check('همان کلید برای دستهٔ دیگر ⇒ ‎409 idempotency_key_reused‎ ِ سرورِ حساب', w4.status === 409 && w4.json?.error === 'idempotency_key_reused', `${w4.status} ${w4.json?.error}`);

  hangNext = true;
  const h1 = await api('POST', `${IC('shpA')}/c1/rollback`, rb('h1'), H(T.adm));
  const h2 = await api('POST', `${IC('shpA')}/c1/rollback`, rb('h1'), H(T.adm));
  check('پاسخِ گم‌شده ⇒ ‎504 outcome_unknown‎؛ همان کلید ⇒ بازپخشِ سرورِ حساب: «برگشته» و یک بار',
    h1.status === 504 && h1.json?.outcome === 'unknown' && h2.status === 200 && h2.json?.replayed === true && h2.json?.change?.status === 'rolled_back'
      && changes.c1.status === 'rolled_back', `${h1.status} ${h2.status} ${h2.text.slice(0, 160)}`);

  const rows = await auditRows(T.owner);
  check('دفترِ پنل: یک ردیف برای هر برگرداندنِ تأییدشده (تازه، «از پیش برگشته»، و نامعلومی که روشن شد با ‎resolved‎) — نه برای رد، ۴۰۹ یا بازپخشِ ساده',
    rows.length === 3 && rows.filter((r) => r.actor === 'adm1').length === 2 && rows.some((r) => r.actor === 'adm2' && String(r.detail).includes('"already":true'))
      && rows.some((r) => String(r.detail).includes('"resolved":true') && String(r.detail).includes('"change":"c1"')), JSON.stringify(rows.map((r) => [r.actor, r.detail])).slice(0, 500));
  check('⛔ کلیدِ یکتایی در دفتر نیست', !rows.some((r) => String(r.detail).includes('img-chg')));

  //  سقفِ نرخِ نوشتنِ هر کاربر: ۳۰ در ده دقیقه (ردِ ۴۰۰ هم شمرده می‌شود)؛ کاربرِ دیگر جدا
  const before = posts().length;
  const lim = [];
  for (let i = 0; i < 31; i++) lim.push((await api('POST', `${IC('shpA')}/c2/rollback`, rb(`lim${i}`, { confirm: false }), H(T.adm2))).status);
  const other = await api('POST', `${IC('shpA')}/c2/rollback`, rb('lim-other', { confirm: false }), H(T.owner));
  check('سقفِ نرخِ هر کاربر: سی‌ویکمین ‎429‎؛ کاربرِ دیگر جدا؛ بی درخواست به سرورِ حساب',
    lim.slice(0, 29).every((s) => s === 400) && lim.at(-1) === 429 && other.status === 400 && posts().length === before, lim.slice(-3).join(' ') + ` ${other.status}`);
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
