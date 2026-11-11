// ---------------------------------------------------------------------------
//  ۳-۹ «الف» (۱.۵۰.۸۸): بارگذاری، ورودِ گروهی (CSV) و ویرایشِ کالای بانکِ عکس از پنلِ مرکزی
//      node test/console-image-bank-write.mjs
//
//  پنلِ واقعی + سرورِ حسابِ ساختگی با همان درهای ‎routes/admin-image-bank.js‎ ِ shop (ضبطِ هر درخواست با بدنه و سرآیند):
//    • هر نوشتن فقط admin ِ پنل؛ viewer و operator ۴۰۳ و **هیچ** درخواستی به سرورِ حساب
//    • کالا: نام لازم، نام‌های همان سرورِ حساب (alt_names، size_value، pack_count…)، کلیدِ یکتایی ⇒ کلیکِ دوم کالای دوم نمی‌سازد
//    • تک‌عکس: نوع از روی بایت (SVG/HTML نه)، سقفِ ۲ مگابایت، بایتِ دست‌نخورده + ‎X-Content-SHA256‎ ِ پل، sha ِ نادرستِ مرورگر ⇒ ۴۰۰،
//      نقش/مجوزِ ناشناخته ⇒ ۴۰۰، همان کلید ⇒ یک بارگذاری
//    • دسته: ساخت، فایل با نامِ فارسی، CSV ِ آزمایشی و واقعی، سقفِ ۱۰۰۰ ردیف، لغو با تأیید و دلیل، گزارشِ JSON و CSV
//    • پرچمِ خاموش ⇒ همان ‎403 image_bank_disabled‎ ِ سرورِ حساب؛ ردیف‌های دفترِ پنل
// ---------------------------------------------------------------------------
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4969);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ib-write-'));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

const NOW = Date.now();
const seen = [];
let bankOn = true;
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const raw = Buffer.concat(chunks);
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: ['actor.v1', 'image-bank.v1'], serverTime: NOW });
    let body = null;
    if (/json/.test(String(req.headers['content-type'] || ''))) { try { body = JSON.parse(raw.toString()); } catch { body = null; } }
    seen.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body, raw, type: req.headers['content-type'] || '', sha: req.headers['x-content-sha256'] || '' });
    if (!p.startsWith('/api/admin/image-bank')) return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
    const sub = p.slice('/api/admin/image-bank'.length);
    if (sub === '/status') return j(200, { enabled: bankOn, rows_max: 1000, roles: ['main', 'back'], licenses: ['unknown', 'licensed'], resume: true });
    if (!bankOn) return j(403, { error: { code: 'image_bank_disabled', message: 'بانکِ مرکزیِ تصاویر روشن نیست' } });
    if (sub === '/products' && req.method === 'POST') return j(201, { id: `bp_${seen.length}` });
    if (/^\/products\/[^/]+$/.test(sub) && req.method === 'PATCH') return j(200, { id: sub.split('/')[2] });
    if (sub === '/images' && req.method === 'POST') return j(201, { id: `img_${seen.length}`, status: 'NEEDS_REVIEW', width: 1, height: 1, quality_flags: ['low_resolution'], duplicate_of: [] });
    if (/^\/images\/[^/]+$/.test(sub) && req.method === 'PATCH') return j(200, { id: sub.split('/')[2], bank_product_id: body?.bank_product_id ?? 'bp_1', match_status: body?.bank_product_id ? 'exact' : 'unconfirmed', license_status: body?.license_status || 'unknown', commercial_use: body?.commercial_use ?? false });
    if (sub === '/batches' && req.method === 'POST') return j(201, { id: 'ibt_1', status: 'open', license: {} });
    if (sub === '/batches' && req.method === 'GET') return j(200, { items: [{ id: 'ibt_1', status: 'open', license_source: 'خودم', license_status: 'licensed', commercial_use: true, note: '', created_at: NOW, updated_at: NOW, files: 1, files_failed: 0, rows: 2, rows_failed: 1, rows_ambiguous: 0 }] });
    const fm = /^\/batches\/ibt_1\/files\/(.+)$/.exec(sub);
    if (fm && req.method === 'PUT') return j(200, { name: decodeURIComponent(fm[1]), status: 'ok', error: '', quality_flags: [], sha256: crypto.createHash('sha256').update(raw).digest('hex') });
    if (sub === '/batches/ibt_1/files' && req.method === 'GET') return j(200, { items: [{ name: 'شکر.png', status: 'ok', error: '', sha256: 'ab'.repeat(32), quality_flags: [] }], next_after: null });
    if (sub === '/batches/ibt_1/rows' && req.method === 'POST') return j(200, { batch_id: 'ibt_1', dry_run: body?.dry_run === true, counts: { ok: 1, failed: 1 }, rows: [{ row_no: 1, status: 'ok', image_id: 'img_9', product_id: 'bp_1', candidates: [] }, { row_no: 2, status: 'failed', error: 'file_missing', candidates: [] }] });
    if (sub === '/batches/ibt_1/status' && req.method === 'POST') return j(200, { id: 'ibt_1', status: body?.status, rejected: body?.status === 'cancelled' ? 3 : 0 });
    if (sub === '/batches/ibt_1/report') {
      if (u.searchParams.get('format') === 'csv') { res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' }); return void res.end('﻿row_no,status,error\r\n2,failed,file_missing\r\n'); }
      return j(200, { id: 'ibt_1', status: 'open', counts: { ok: 1, failed: 1 }, files: { counts: { ok: 1 }, failed: [] }, rows: [{ row_no: 2, status: 'failed', error: 'file_missing', candidates: [] }] });
    }
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${fake.address().port}`;

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_SITESYNC: '0', HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
    HLP_ACCOUNT_API: FAKE_URL, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
    HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));
const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, token, raw = null, headers = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': raw ? raw.type : 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw ? raw.body : body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, type: res.headers.get('content-type') || '' };
}
const ups = (m, re) => seen.filter((s) => s.method === m && re.test(s.path)).length;
const last = (m, re) => seen.filter((s) => s.method === m && re.test(s.path)).at(-1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IB = '/api/account-admin/console/image-bank';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(200)]);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ } await sleep(250); }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Ibw-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Ibw-1405-owner');
  for (const [u, role] of [['op1', 'operator'], ['view1', 'viewer']]) await api('POST', '/api/auth/users', { username: u, password: `Ibw-${role}-1405`, role }, owner);
  const op = await login('op1', 'Ibw-operator-1405');
  const viewer = await login('view1', 'Ibw-viewer-1405');
  check('سه نشست', Boolean(owner && op && viewer));

  console.log('\n── ⛔ نقش: هر نوشتن فقط admin ──');
  const before = seen.length;
  const denied = [];
  for (const t of [op, viewer]) {
    denied.push((await api('POST', `${IB}/products`, { name: 'شکر', idempotencyKey: 'ibw-role-000001' }, t)).status);
    denied.push((await api('PATCH', `${IB}/products/bp_1`, { name: 'شکر' }, t)).status);
    denied.push((await api('POST', `${IB}/images?idempotencyKey=ibw-role-000002`, undefined, t, { type: 'image/png', body: PNG })).status);
    denied.push((await api('PATCH', `${IB}/images/img_1`, { role: 'main' }, t)).status);
    denied.push((await api('POST', `${IB}/batches`, { note: 'x', idempotencyKey: 'ibw-role-000003' }, t)).status);
    denied.push((await api('PUT', `${IB}/batches/ibt_1/files/a.png`, undefined, t, { type: 'image/png', body: PNG })).status);
    denied.push((await api('POST', `${IB}/batches/ibt_1/rows`, { csv: 'name,image_path\nشکر,a.png' }, t)).status);
    denied.push((await api('POST', `${IB}/batches/ibt_1/status`, { status: 'paused', confirm: true }, t)).status);
  }
  check('⛔ operator و viewer هر هشت نوشتن را ۴۰۳ می‌گیرند و هیچ درخواستی به سرورِ حساب نمی‌رسد', denied.every((s) => s === 403) && seen.length === before, `${denied.join(' ')} · ${seen.length - before}`);
  const vList = await api('GET', `${IB}/batches`, undefined, viewer);
  check('viewer فهرستِ دسته‌ها را می‌بیند (ماژولِ «بانکِ عکس»)', vList.status === 200 && vList.json?.items?.[0]?.id === 'ibt_1' && vList.json.items[0].rowsFailed === 1, vList.text.slice(0, 200));

  console.log('\n── کالای بانک ──');
  const noName = await api('POST', `${IB}/products`, { gtin: '6260000000000', idempotencyKey: 'ibw-prod-000001' }, owner);
  const noKey = await api('POST', `${IB}/products`, { name: 'شکر' }, owner);
  const badPc = await api('POST', `${IB}/products`, { name: 'شکر', packCount: -1, idempotencyKey: 'ibw-prod-000002' }, owner);
  check('⛔ بی نام / بی کلیدِ یکتایی / شمارِ بستهٔ نادرست ⇒ ۴۰۰، پیش از سرورِ حساب', noName.status === 400 && noName.json?.error === 'name_required'
    && noKey.status === 400 && badPc.status === 400 && ups('POST', /\/products$/) === 0, `${noName.status} ${noKey.status} ${noKey.json?.error} ${badPc.status}`);
  const pr = await api('POST', `${IB}/products`, { name: ' شکرِ سفید ', gtin: '6260-0000-00000', sku: 'SUG-1', altNames: ['بوره', ' ', 'sugar'], brand: 'برند', sizeValue: '1', sizeUnit: 'kg', packCount: 1, packaging: 'کیسه', evil: 'x', idempotencyKey: 'ibw-prod-000003' }, owner);
  const upP = last('POST', /\/products$/);
  check('ساختِ کالا ⇒ همان نام‌های سرورِ حساب، فقط فیلدهای شناخته', pr.status === 200 && pr.json?.id && upP?.body?.name === 'شکرِ سفید' && upP.body.gtin === '6260000000000'
    && JSON.stringify(upP.body.alt_names) === '["بوره","sugar"]' && upP.body.size_value === '1' && upP.body.size_unit === 'kg' && upP.body.pack_count === 1 && !('evil' in upP.body), `${pr.text.slice(0, 120)} ${JSON.stringify(upP?.body)}`);
  const pr2 = await api('POST', `${IB}/products`, { name: ' شکرِ سفید ', gtin: '6260-0000-00000', sku: 'SUG-1', altNames: ['بوره', ' ', 'sugar'], brand: 'برند', sizeValue: '1', sizeUnit: 'kg', packCount: 1, packaging: 'کیسه', evil: 'x', idempotencyKey: 'ibw-prod-000003' }, owner);
  check('⛔ همان کلید ⇒ همان پاسخ، کالای دوم ساخته نمی‌شود', pr2.json?.id === pr.json?.id && ups('POST', /\/products$/) === 1, `${ups('POST', /\/products$/)}`);
  const pp = await api('PATCH', `${IB}/products/bp_1`, { name: 'شکر', category: 'خوراکی' }, owner);
  check('ویرایشِ کالا ⇒ ‎PATCH /api/admin/image-bank/products/bp_1‎', pp.status === 200 && last('PATCH', /\/products\/bp_1$/)?.body?.category === 'خوراکی', pp.text.slice(0, 160));

  console.log('\n── تک‌عکس ──');
  const svg = await api('POST', `${IB}/images?idempotencyKey=ibw-img-0000001`, undefined, owner, { type: 'image/png', body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>') });
  const html = await api('POST', `${IB}/images?idempotencyKey=ibw-img-0000002`, undefined, owner, { type: 'image/jpeg', body: Buffer.from('<!doctype html><script>x</script>') });
  check('⛔ SVG/HTML با سرآیندِ عکس ⇒ ‎400 bad_media‎ (نوع از روی بایت) و هیچ بارگذاری', svg.status === 400 && svg.json?.error === 'bad_media' && html.status === 400 && ups('POST', /\/images$/) === 0, `${svg.status} ${html.status}`);
  const big = await api('POST', `${IB}/images?idempotencyKey=ibw-img-0000003`, undefined, owner, { type: 'image/png', body: Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]) });
  check('⛔ بیش از ۲ مگابایت ⇒ ۴۱۳', big.status === 413 && ups('POST', /\/images$/) === 0, `${big.status}`);
  const badRole = await api('POST', `${IB}/images?idempotencyKey=ibw-img-0000004&role=evil`, undefined, owner, { type: 'image/png', body: PNG });
  const badSha = await api('POST', `${IB}/images?idempotencyKey=ibw-img-0000005`, undefined, owner, { type: 'image/png', body: PNG }, { 'x-content-sha256': 'ab'.repeat(32) });
  check('⛔ نقشِ ناشناخته و sha256 ِ نادرستِ مرورگر ⇒ ۴۰۰', badRole.status === 400 && badRole.json?.error === 'bad_role' && badSha.status === 400 && badSha.json?.error === 'digest_mismatch' && ups('POST', /\/images$/) === 0, `${badRole.status} ${badSha.status}`);
  const up = await api('POST', `${IB}/images?idempotencyKey=ibw-img-0000006&role=main&bankProductId=bp_1&licenseStatus=licensed&commercialUse=true&licenseSource=${encodeURIComponent('عکاسِ خودم')}`, undefined, owner,
    { type: 'application/octet-stream', body: PNG }, { 'x-content-sha256': sha(PNG) });
  const upI = last('POST', /\/images$/);
  check('بارگذاری ⇒ بایتِ دست‌نخورده، نوعِ سنجیده، ‎X-Content-SHA256‎ ِ پل و پارامترهای همان سرورِ حساب', up.status === 200 && up.json?.id && up.json.status === 'NEEDS_REVIEW'
    && upI?.raw.equals(PNG) && upI.type === 'image/png' && upI.sha === sha(PNG) && upI.query.role === 'main' && upI.query.bank_product_id === 'bp_1'
    && upI.query.license_status === 'licensed' && upI.query.commercial_use === 'true' && upI.query.license_source === 'عکاسِ خودم' && !('idempotencyKey' in upI.query), `${up.text.slice(0, 160)} ${JSON.stringify(upI?.query)}`);
  const upAgain = await api('POST', `${IB}/images?idempotencyKey=ibw-img-0000006&role=main&bankProductId=bp_1&licenseStatus=licensed&commercialUse=true&licenseSource=${encodeURIComponent('عکاسِ خودم')}`, undefined, owner, { type: 'image/png', body: PNG });
  check('⛔ همان کلید ⇒ یک بارگذاری', upAgain.json?.id === up.json?.id && ups('POST', /\/images$/) === 1, `${ups('POST', /\/images$/)}`);
  const ed = await api('PATCH', `${IB}/images/img_1`, { bankProductId: '', licenseStatus: 'restricted', commercialUse: false, role: 'back' }, owner);
  const edI = last('PATCH', /\/images\/img_1$/);
  check('ویرایشِ عکسِ pending ⇒ جداکردنِ کالا («») و مجوز', ed.status === 200 && edI?.body?.bank_product_id === '' && edI.body.license_status === 'restricted' && edI.body.commercial_use === false && edI.body.role === 'back', `${ed.text.slice(0, 160)} ${JSON.stringify(edI?.body)}`);
  const edEmpty = await api('PATCH', `${IB}/images/img_1`, {}, owner);
  check('⛔ ویرایشِ بی هیچ تغییر ⇒ ۴۰۰ و بی درخواست', edEmpty.status === 400 && ups('PATCH', /\/images\/img_1$/) === 1, `${edEmpty.status}`);

  console.log('\n── ورودِ گروهی ──');
  const bc = await api('POST', `${IB}/batches`, { licenseSource: 'خودم', licenseStatus: 'licensed', commercialUse: true, note: 'دستهٔ نوروز', role: 'main', idempotencyKey: 'ibw-batch-000001' }, owner);
  const bcI = last('POST', /\/batches$/);
  check('ساختِ دسته ⇒ مجوزِ دسته و یادداشت (نه نقش)', bc.status === 200 && bc.json?.id === 'ibt_1' && bcI?.body?.license_status === 'licensed' && bcI.body.note === 'دستهٔ نوروز' && !('role' in bcI.body), JSON.stringify(bcI?.body));
  const fileName = 'شکر.png';
  const pf = await api('PUT', `${IB}/batches/ibt_1/files/${encodeURIComponent(fileName)}`, undefined, owner, { type: 'image/png', body: PNG });
  const pfI = last('PUT', /\/batches\/ibt_1\/files\//);
  check('فایلِ دسته با نامِ فارسی ⇒ همان نام و همان بایت، با sha256', pf.status === 200 && pf.json?.name === fileName && pfI && decodeURIComponent(pfI.path.split('/').pop()) === fileName && pfI.raw.equals(PNG) && pfI.sha === sha(PNG), `${pf.status} ${pf.text.slice(0, 160)}`);
  const pfHtml = await api('PUT', `${IB}/batches/ibt_1/files/x.png`, undefined, owner, { type: 'image/png', body: Buffer.from('<html>no</html>') });
  const pfDot = await api('PUT', `${IB}/batches/ibt_1/files/${encodeURIComponent('..')}`, undefined, owner, { type: 'image/png', body: PNG });
  check('⛔ فایلِ HTML و نامِ «..» ⇒ ۴۰۰ و بی درخواست', pfHtml.status === 400 && (pfDot.status === 400 || pfDot.status === 404) && ups('PUT', /\/batches\/ibt_1\/files\//) === 1, `${pfHtml.status} ${pfDot.status}`);
  const files = await api('GET', `${IB}/batches/ibt_1/files`, undefined, owner);
  check('فایل‌های رسیده (برای ادامهٔ بارگذاری پس از قطع)', files.status === 200 && files.json?.items?.[0]?.name === 'شکر.png' && files.json.items[0].sha256.length === 64, files.text.slice(0, 160));
  const csv = 'name,barcode,image_path\nشکر,6260000000000,شکر.png\nبرنج,,missing.png';
  const dry = await api('POST', `${IB}/batches/ibt_1/rows`, { csv, dryRun: true }, owner);
  check('CSV ِ آزمایشی ⇒ ‎dry_run: true‎ و شمارِ هر وضعیت، ردیف به ردیف', dry.status === 200 && last('POST', /\/rows$/)?.body?.dry_run === true && last('POST', /\/rows$/).body.csv === csv
    && dry.json?.counts?.failed === 1 && dry.json.rows?.[1]?.error === 'file_missing', dry.text.slice(0, 200));
  const real = await api('POST', `${IB}/batches/ibt_1/rows`, { rows: [{ name: 'شکر', image_path: 'شکر.png', row_no: 1, evil: 'x' }] }, owner);
  check('ردیف‌های JSON ⇒ فقط ستون‌های شناخته', real.status === 200 && last('POST', /\/rows$/)?.body?.dry_run === false && !('evil' in (last('POST', /\/rows$/).body.rows?.[0] || {})) && last('POST', /\/rows$/).body.rows[0].row_no === 1, JSON.stringify(last('POST', /\/rows$/)?.body));
  const many = await api('POST', `${IB}/batches/ibt_1/rows`, { rows: Array.from({ length: 1001 }, () => ({ name: 'x' })) }, owner);
  const none = await api('POST', `${IB}/batches/ibt_1/rows`, { csv: '  ' }, owner);
  check('⛔ بیش از ۱۰۰۰ ردیف و CSV ِ خالی ⇒ ۴۰۰', many.status === 400 && many.json?.error === 'too_many_rows' && none.status === 400, `${many.status} ${none.status}`);
  const noConf = await api('POST', `${IB}/batches/ibt_1/status`, { status: 'paused' }, owner);
  const noWhy = await api('POST', `${IB}/batches/ibt_1/status`, { status: 'cancelled', confirm: true }, owner);
  const badSt = await api('POST', `${IB}/batches/ibt_1/status`, { status: 'evil', confirm: true }, owner);
  check('⛔ وضعیت بی تأیید / لغو بی دلیل / وضعیتِ ناشناخته ⇒ ۴۰۰ و بی درخواست', noConf.status === 400 && noWhy.status === 400 && noWhy.json?.error === 'reason_required' && badSt.status === 400 && ups('POST', /\/status$/) === 0, `${noConf.status} ${noWhy.status} ${badSt.status}`);
  const cancel = await api('POST', `${IB}/batches/ibt_1/status`, { status: 'cancelled', confirm: true, reason: 'فهرستِ اشتباه' }, owner);
  check('لغو با تأیید و دلیل ⇒ سرورِ حساب و شمارِ ردشده‌ها', cancel.status === 200 && cancel.json?.rejected === 3 && last('POST', /\/status$/)?.body?.status === 'cancelled', cancel.text.slice(0, 160));
  const rep = await api('GET', `${IB}/batches/ibt_1/report`, undefined, viewer);
  const repCsv = await api('GET', `${IB}/batches/ibt_1/report?format=csv`, undefined, owner);
  check('گزارش: JSON برای viewer؛ CSV با ‎text/csv‎ و پیوستِ دانلود', rep.status === 200 && rep.json?.rows?.[0]?.error === 'file_missing' && rep.json.files?.counts?.ok === 1
    && repCsv.status === 200 && /text\/csv/.test(repCsv.type) && repCsv.text.includes('file_missing'), `${rep.text.slice(0, 120)} ${repCsv.type}`);

  console.log('\n── پرچمِ خاموش و دفتر ──');
  bankOn = false;
  const off = await api('POST', `${IB}/products`, { name: 'x', idempotencyKey: 'ibw-prod-000009' }, owner);
  bankOn = true;
  check('⛔ پرچمِ خاموش ⇒ همان ‎403 image_bank_disabled‎ ِ سرورِ حساب (نه «انجام شد»)', off.status === 403 && off.json?.error === 'image_bank_disabled', off.text.slice(0, 160));
  const aud = await api('GET', '/api/control/audit?q=account.image_bank&limit=50&offset=0', undefined, owner);
  const acts = (aud.json?.rows || []).map((r) => r.action);
  check('دفترِ پنل: کالا، بارگذاری، ویرایش، دسته، ردیف‌ها و لغو — ردشده‌ها نه', ['account.image_bank.product_created', 'account.image_bank.product_updated', 'account.image_bank.uploaded',
    'account.image_bank.edited', 'account.image_bank.batch_created', 'account.image_bank.batch_rows', 'account.image_bank.batch_status'].every((a) => acts.includes(a))
    && acts.filter((a) => a === 'account.image_bank.uploaded').length === 1 && acts.filter((a) => a === 'account.image_bank.batch_rows').length === 1, acts.join(' '));
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
