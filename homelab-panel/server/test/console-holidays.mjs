// ---------------------------------------------------------------------------
//  LOC-04 در پل — جدولِ تعطیلاتِ رسمی در «تنظیماتِ مرکزی»، با و بی `holidays.v1` (۱.۵۰.۷۸)
//      node test/console-holidays.mjs
//
//  سرورِ حسابِ ساختگی به شکلِ ‎routes/admin-calendar.js‎ و ‎lib/holidays.js‎ ِ shop ‎claude/loc-04‎:
//    GET ⇒ ‎{version, updatedAt, holidays:[{date, name:{fa,en,ps}}]}‎ · PUT ‎{holidays, version, reason}‎ (ارشد + دلیل) ⇒ نسخهٔ تازه،
//    همان جدول ⇒ ‎unchanged: true‎ (با هر نسخه)، نسخهٔ کهنه ⇒ ‎409 holiday_version‎، ردیفِ بد ⇒ ‎400 holiday_invalid‎.
//  سنجیده می‌شود: بی توانایی ⇒ «در دسترس نیست» (نه جدولِ ساختگی) و نوشتن ‎501‎ بی درخواست به سرورِ حساب؛ با توانایی ⇒ خواندن
//  فقط فیلدهای شناخته، نوشتن فقط admin با دلیل + تأیید + کلید، **همان** سنجشِ تاریخ و نامِ سرورِ حساب پیش از پل (بردارِ
//  مشترک پایین)، ‎409‎ ِ نسخهٔ کهنه همان‌طور، یک‌باره با کلید، «نامعلوم» بی درخواستِ دوم، و ردیفِ دفترِ پنل بی کلید.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4975);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-holidays-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/*
 *  بردارِ تاریخ — همان `isDate` ِ shop (‎lib/holidays.js‎ + ‎jdnOfIso‎ ِ ‎calendar-core.js‎): میلادیِ واقعیِ ‎YYYY-MM-DD‎ در
 *  ۲۰۰۰-۰۱-۰۱ تا ۲۱۹۹-۱۲-۳۱. (روی ‎claude/loc-04‎ با خودِ آن تابع یکی سنجیده شد: ۱.۵۰.۷۸.)
 */
export const DATE_VECTORS = [
  ['2026-03-21', true], ['2000-01-01', true], ['2199-12-31', true], ['2028-02-29', true], ['2000-02-29', true],
  ['1999-12-31', false], ['2200-01-01', false], ['2026-02-29', false], ['2100-02-29', false], ['2026-02-30', false],
  ['2026-04-31', false], ['2026-13-01', false], ['2026-00-10', false], ['2026-01-00', false], ['1405-01-01', false],
  ['2026-1-01', false], ['2026/03/21', false], ['20260321', false], ['', false], ['2026-03-21T00:00', false],
];

/* ───────────── سرورِ حسابِ ساختگی ───────────── */
const NOW = Date.now();
let caps = ['actor.v1'];
const seen = [];
const held = new Set();
let doc = { version: 3, updatedAt: NOW - 86400e3, holidays: [
  { date: '2026-03-21', name: { fa: 'نوروز', en: 'Nowruz', ps: 'نوروز' } },
  { date: '2026-03-30', name: { fa: '<img src=x onerror=alert(1)>', en: 'Eid\u0007' } },
  { date: '2026-02-30', name: { fa: 'تاریخِ خراب' } },
  { date: '2026-03-21', name: { fa: 'تکراری' } },
] };
let hangNext = false;
let staleNext = false;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const fake = http.createServer((req, res) => {
  held.add(res);
  res.on('close', () => held.delete(res));
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const p = new URL(req.url, 'http://x').pathname;
    const raw = Buffer.concat(chunks).toString();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const j = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    seen.push({ method: req.method, path: p, body, idem: String(req.headers['idempotency-key'] || '') });
    if (p === '/api/admin/calendar/holidays') {
      if (!caps.includes('holidays.v1')) return j(401, { error: { code: 'invalid_token', message: 'نشست' } });   //  سرورِ کهنه: مسیر نیست
      if (req.method === 'GET') return j(200, doc);
      if (req.method === 'PUT') {
        if (String(body?.reason || '').trim().length < 3) return j(400, { error: { code: 'reason_required', message: 'دلیل' } });
        const list = body?.holidays;
        if (same(doc.holidays.filter((h) => h.date !== '2026-02-30').filter((h, i, a) => a.findIndex((x) => x.date === h.date) === i), list)) {
          return j(200, { ...doc, unchanged: true });
        }
        if (staleNext || body?.version !== doc.version) {
          staleNext = false;
          return j(409, { error: { code: 'holiday_version', message: 'جدولِ تعطیلات در این میان عوض شده است؛ دوباره بخوانید و بنویسید' } });
        }
        doc = { version: doc.version + 1, updatedAt: Date.now(), holidays: list };
        if (hangNext) { hangNext = false; return; }   //  نوشته شد، پاسخ گم شد
        return j(200, { ...doc, unchanged: false });
      }
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
const HP = '/api/account-admin/console/calendar/holidays';
const puts = () => seen.filter((s) => s.method === 'PUT' && s.path === '/api/admin/calendar/holidays');
const auditRows = async (tok) => ((await api('GET', '/api/control/audit?q=account.holidays&limit=50&offset=0', undefined, { Authorization: `Bearer ${tok}` })).json?.rows || [])
  .filter((r) => r.action === 'account.holidays.updated');

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await sleep(250);
  }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Hol-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Hol-1405-owner');
  const H = (t) => ({ Authorization: `Bearer ${t}` });
  for (const [u, role] of [['adm1', 'admin'], ['op1', 'operator'], ['view1', 'viewer']]) {
    await api('POST', '/api/auth/users', { username: u, password: `Hol-${role}-1405-${u}`, role }, H(owner));
  }
  const T = { owner, adm: await login('adm1', 'Hol-admin-1405-adm1'), op: await login('op1', 'Hol-operator-1405-op1'), view: await login('view1', 'Hol-viewer-1405-view1') };
  const NEW = [{ date: '2026-03-21', name: { fa: 'نوروز', en: 'Nowruz', ps: 'نوروز' } }, { date: '2026-04-01', name: { fa: 'روزِ جمهوری' } }];
  const pb = (k, extra = {}) => ({ holidays: NEW, version: 3, reason: 'اعلامِ رسمیِ امسال', confirm: true, idempotencyKey: `hol-key-${k}-0001`, ...extra });

  console.log('\n── بی `holidays.v1` (سرورِ حسابِ کهنه) ──');
  const g0 = await api('GET', HP, undefined, H(T.view));
  check('خواندن ⇒ «در دسترس نیست» با نامِ توانایی و درِ لازم — نه جدولِ ساختگی، بی پرسش از سرورِ حساب',
    g0.status === 200 && g0.json?.available === false && g0.json?.capability === 'holidays.v1' && /calendar\/holidays/.test(g0.json?.needs || '')
      && g0.json?.holidays === undefined && !seen.some((s) => s.path.includes('/calendar/')), `${g0.status} ${g0.text.slice(0, 200)}`);
  const p0 = await api('PUT', HP, pb('p0'), H(T.adm));
  check('نوشتن ⇒ ‎501 capability_missing‎، بی درخواست به سرورِ حساب', p0.status === 501 && p0.json?.error === 'capability_missing' && puts().length === 0, `${p0.status} ${p0.text.slice(0, 160)}`);

  caps = ['actor.v1', 'holidays.v1'];
  console.log('\n── با `holidays.v1` (shop ‎claude/loc-04‎) ──');
  const g1 = await api('GET', HP, undefined, H(T.view));
  check('خواندن (viewer هم): نسخه، زمان و روزهای درست — ردیفِ تاریخِ خراب و تاریخِ تکراری کنار، نویسهٔ کنترلی برداشته، حدها',
    g1.status === 200 && g1.json?.available === true && g1.json?.version === 3 && g1.json?.holidays?.length === 2 && g1.json?.max === 500 && g1.json?.nameMax === 80
      && g1.json.holidays[1].name.en === 'Eid' && g1.json.holidays[0].name.fa === 'نوروز', `${g1.status} ${g1.text.slice(0, 300)}`);
  check('⛔ نامِ HTML همان متن می‌ماند (پل HTML نمی‌سازد و دست‌کاری‌اش هم نمی‌کند؛ رابط متن نشان می‌دهد)', g1.json?.holidays?.[1]?.name?.fa === '<img src=x onerror=alert(1)>');

  const n0 = puts().length;
  const pv = await api('PUT', HP, pb('pv'), H(T.view));
  const po = await api('PUT', HP, pb('po'), H(T.op));
  check('⛔ viewer و operator نمی‌نویسند (۴۰۳)، بی درخواست به سرورِ حساب', pv.status === 403 && po.status === 403 && puts().length === n0, `${pv.status} ${po.status}`);
  const bads = [
    ['بی تأیید', pb('b1', { confirm: false }), 'confirm_required'],
    ['دلیلِ کوتاه', pb('b2', { reason: 'ab' }), 'reason_required'],
    ['کلیدِ بد', pb('b3', { idempotencyKey: 'bad key!' }), 'bad_idempotency_key'],
    ['بی نسخه', pb('b4', { version: undefined }), 'bad_version'],
    ['نسخهٔ منفی', pb('b5', { version: -1 }), 'bad_version'],
    ['جدولِ نافهرست', pb('b6', { holidays: { date: '2026-03-21' } }), 'holiday_invalid'],
    ['تاریخِ تکراری', pb('b7', { holidays: [NEW[0], { ...NEW[0], name: { fa: 'باز' } }] }), 'holiday_invalid'],
    ['بی نامِ دری', pb('b8', { holidays: [{ date: '2026-03-21', name: { en: 'Nowruz' } }] }), 'holiday_invalid'],
    ['نامِ بلندتر از ۸۰', pb('b9', { holidays: [{ date: '2026-03-21', name: { fa: 'ن'.repeat(81) } }] }), 'holiday_invalid'],
    ['نامِ نامتن', pb('b10', { holidays: [{ date: '2026-03-21', name: { fa: 'نوروز', en: 5 } }] }), 'holiday_invalid'],
    ['بیش از ۵۰۰ روز', pb('b11', { holidays: Array.from({ length: 501 }, (_, i) => ({ date: `${2001 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`, name: { fa: 'روز' } })) }), 'holiday_invalid'],
  ];
  const bOut = [];
  for (const [, body] of bads) bOut.push(await api('PUT', HP, body, H(T.adm)));
  check('⛔ ورودیِ بد ⇒ ۴۰۰ با کدِ درست، پیش از پل (بی تأیید، دلیل، کلید، نسخه، فهرست، تکراری، نامِ دری، ۸۰ نویسه، نامتن، ۵۰۰)',
    bads.every(([, , code], i) => bOut[i].status === 400 && bOut[i].json?.error === code) && puts().length === n0,
    bads.map(([n, , code], i) => `${n}:${bOut[i].status}/${bOut[i].json?.error}≠${code}`).filter((_, i) => bOut[i].json?.error !== bads[i][2]).join(' '));
  const dv = [];
  for (const [d, ok] of DATE_VECTORS) {
    //  (مالک، نه adm1: سقفِ نرخِ نوشتنِ هر کاربر ۳۰ در ده دقیقه است و ردِ ۴۰۰ هم شمرده می‌شود)
    const r = await api('PUT', HP, pb(`dv${dv.length}`, { holidays: [{ date: d, name: { fa: 'روزِ آزمون' } }], reason: 'سنجشِ تاریخ', version: 999 }), H(T.owner));
    //  تاریخِ درست ⇒ از سنجشِ پل گذشت و به سرورِ حساب رسید (آن‌جا با نسخهٔ ۹۹۹ ِ کهنه ۴۰۹)؛ نادرست ⇒ ۴۰۰ پیش از پل
    dv.push({ d, ok, got: r.status === 409 ? true : r.status === 400 && r.json?.error === 'holiday_invalid' ? false : `?${r.status}` });
  }
  check(`⛔ همان سنجشِ تاریخِ سرورِ حساب (${DATE_VECTORS.length} بردار: کبیسه، ۳۰ ِ فوریه، ۲۰۰۰ تا ۲۱۹۹، سالِ خورشیدی، شکلِ نادرست)`,
    dv.every((x) => x.got === x.ok), JSON.stringify(dv.filter((x) => x.got !== x.ok)));
  const trimmed = await api('PUT', HP, pb('tr', { holidays: [{ date: ' 2026-05-01 ', name: { fa: '  روزِ کارگر\u0007 ' } }], version: 999 }), H(T.adm));
  const trUp = puts().at(-1);
  check('تاریخ و نام بریده و پاک به سرورِ حساب می‌روند (همان ‎trim‎ و برداشتنِ نویسهٔ کنترلیِ آن‌جا)', trimmed.status === 409
    && JSON.stringify(trUp?.body?.holidays) === JSON.stringify([{ date: '2026-05-01', name: { fa: 'روزِ کارگر' } }]), JSON.stringify(trUp?.body));

  const nBefore = puts().length;
  const w1 = await api('PUT', HP, pb('w1', { holidays: [NEW[1], NEW[0]] }), H(T.adm));
  const up1 = puts().at(-1);
  check('admin ⇒ ‎200‎ با نسخهٔ تازه از سرورِ حساب؛ بالادست فقط ‎{holidays (مرتب), version, reason}‎، بی کلیدِ یکتایی',
    w1.status === 200 && w1.json?.ok === true && w1.json?.version === 4 && w1.json?.unchanged === false && w1.json?.holidays?.length === 2
      && JSON.stringify(up1?.body) === JSON.stringify({ holidays: NEW, version: 3, reason: 'اعلامِ رسمیِ امسال' }) && up1?.idem === '' && puts().length === nBefore + 1,
    `${w1.status} ${w1.text.slice(0, 200)} ${String(JSON.stringify(up1?.body ?? null)).slice(0, 200)}`);
  const w2 = await api('PUT', HP, pb('w1', { holidays: [NEW[1], NEW[0]] }), H(T.adm));
  check('همان کلید ⇒ همان پاسخ (‎replayed‎) از یادِ پل، بی درخواستِ دوم', w2.status === 200 && w2.json?.replayed === true && w2.json?.version === 4 && puts().length === nBefore + 1,
    `${w2.status} ${w2.text.slice(0, 160)}`);
  const w3 = await api('PUT', HP, pb('w1', { reason: 'دلیلِ دیگر برای همین کلید' }), H(T.adm));
  check('همان کلید برای کارِ دیگر ⇒ ‎409 idempotency_key_reused‎', w3.status === 409 && w3.json?.error === 'idempotency_key_reused', `${w3.status} ${w3.json?.error}`);

  const st = await api('PUT', HP, pb('st', { holidays: [NEW[0]], version: 3 }), H(T.adm));
  check('⛔ نسخهٔ کهنه (کسِ دیگری در این میان نوشت) ⇒ ‎409 holiday_version‎ ِ سرورِ حساب همان‌طور — نه رونویسی',
    st.status === 409 && st.json?.error === 'holiday_version' && doc.version === 4 && doc.holidays.length === 2, `${st.status} ${st.text.slice(0, 160)}`);
  const un = await api('PUT', HP, pb('un', { version: 3 }), H(T.adm));
  check('همان جدول با کلیدِ تازه (حتی با نسخهٔ کهنه) ⇒ ‎unchanged: true‎ ِ سرورِ حساب، نسخه همان', un.status === 200 && un.json?.unchanged === true && un.json?.version === 4,
    `${un.status} ${un.text.slice(0, 160)}`);

  hangNext = true;
  const h1 = await api('PUT', HP, pb('h1', { holidays: [NEW[0]], version: 4 }), H(T.adm));
  const nH = puts().length;
  const h2 = await api('PUT', HP, pb('h1', { holidays: [NEW[0]], version: 4 }), H(T.adm));
  check('پاسخِ گم‌شده ⇒ ‎504 outcome_unknown‎؛ ⛔ همان کلید ⇒ همان «نامعلوم» بی درخواستِ دوم',
    h1.status === 504 && h1.json?.outcome === 'unknown' && h2.status === 504 && h2.json?.outcome === 'unknown' && puts().length === nH, `${h1.status} ${h2.status} n=${puts().length - nH}`);

  const rows = await auditRows(T.owner);
  check('دفترِ پنل: یک ردیف برای هر نوشتنِ تأییدشده (تازه و «بی‌تغییر»)، با دلیل و نسخه — نه برای رد، بازپخش یا نامعلوم',
    rows.length === 2 && rows.every((r) => r.actor === 'adm1') && rows.some((r) => String(r.detail).includes('"unchanged":false') && String(r.detail).includes('"version":4'))
      && rows.some((r) => String(r.detail).includes('"unchanged":true')), JSON.stringify(rows.map((r) => r.detail)).slice(0, 400));
  check('⛔ کلیدِ یکتایی در دفتر نیست', !rows.some((r) => String(r.detail).includes('hol-key')));
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
