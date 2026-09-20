// ---------------------------------------------------------------------------
//  آزمونِ خودترمیمی — بندِ ۱۰.۳ی پرامپت
//      node test/selfheal.mjs
//
//  دو نیمه:
//    ۱) خودِ منطق، در همین فرآیند: checkDependencies شکلِ درستی برمی‌گرداند،
//       هر چیزِ نبوده را **نبوده** می‌شمارد (نه یک «سالم»ِ دروغ)، اختیاری را
//       از اجباری جدا می‌کند، و repair آن‌چه را خودش می‌تواند درست می‌کند و
//       بقیه را به نصب‌کننده می‌سپارد — بی آن‌که install.sh را صدا بزند.
//    ۲) مسیرِ API روی سرورِ واقعی: خواندن برای هر واردشده، **تعمیر فقط برای
//       admin**، و هر تعمیری در دفترِ کارهای حساس می‌نشیند.
//
//  ⚠️ سرویس‌های systemd این‌جا سنجیده نمی‌شوند: سندباکس systemd ندارد و
//  `systemctl is-active` روی هر ماشینی جوابِ دیگری می‌دهد. آن‌چه سنجیده
//  می‌شود شکل و ثباتِ نتیجه است، نه حالِ سرویسِ همین ماشین.
//  ⚠️ «vill3n نصب نیست» به‌عنوان نمونهٔ ابزارِ نبوده به کار می‌رود — ابزاری
//  که هیچ سیستمی از پیش ندارد. اگر روی ماشینی واقعاً در PATH باشد، همان یک
//  سنجه معنایش عوض می‌شود.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vill3n-selfheal-'));
const ROOT = path.join(tmp, 'srv');
const FAKE_BIN = path.join(tmp, 'fakebin');

//  ⚠️ پیش از اولین import از src/ — config.js و selfheal.js محیط را سرِ بار شدن می‌خوانند
process.env.VILL3N_ROOT = ROOT;
process.env.HLP_DATA_DIR = path.join(tmp, 'data');
process.env.HLP_SITES_ROOT = path.join(tmp, 'sites');
process.env.HLP_LIBRARY_ROOT = path.join(tmp, 'library');
process.env.HLP_TUNNEL = '0';
process.env.HLP_AI_ENABLED = '0';

const selfheal = await import('../src/platform/selfheal.js');

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const byName = (items, kind, name) => items.find((i) => i.kind === kind && i.name === name);

try {
  /* ═════════════ ۱) شکلِ نتیجه روی ریشهٔ خالی ═════════════ */
  console.log('\n۱) بررسیِ وابستگی‌ها روی ریشه‌ای که هنوز چیزی در آن نیست');
  check('روی لینوکس معنا دارد', selfheal.applicable() === (process.platform === 'linux'));
  check('ریشه از VILL3N_ROOT می‌آید', selfheal.root() === ROOT, selfheal.root());

  const empty = await selfheal.checkDependencies();
  check('کلیدهای نتیجه: applicable · root · ok · items · missing · hardMissing · checkedAt',
    ['applicable', 'root', 'ok', 'items', 'missing', 'hardMissing', 'checkedAt'].every((k) => k in empty)
      && Array.isArray(empty.items) && Array.isArray(empty.missing) && typeof empty.ok === 'boolean',
    Object.keys(empty).join(','));
  check('هر قلم kind · name · ok · what دارد', empty.items.every((i) => typeof i.kind === 'string' && typeof i.name === 'string' && typeof i.ok === 'boolean' && typeof i.what === 'string'));
  check('هر قلمِ نبوده راهِ درست شدنش را هم می‌گوید (fix)', empty.missing.every((i) => ['mkdir', 'chmod', 'installer', 'systemctl'].includes(i.fix)), empty.missing.map((i) => `${i.name}:${i.fix}`).join(','));
  check('missing دقیقاً همان قلم‌های ok=false است', empty.missing.length === empty.items.filter((i) => !i.ok).length);
  check('hardMissing فقط اجباری‌ها را می‌شمارد', empty.hardMissing === empty.missing.filter((i) => !i.optional).length);
  check('ok فقط وقتی راست است که هیچ اجباری‌ای کم نباشد', empty.ok === (empty.hardMissing === 0));

  check('هر هجده پوشهٔ ساختارِ بندِ ۳ سنجیده می‌شود', selfheal.LAYOUT.every((rel) => byName(empty.items, 'folder', rel)), String(selfheal.LAYOUT.length));
  check('روی ریشهٔ خالی همهٔ پوشه‌ها «نیست» علامت می‌خورند', selfheal.LAYOUT.every((rel) => byName(empty.items, 'folder', rel).ok === false));
  check('پوشهٔ رازها «نیست» و راهش chmod/mkdir است', byName(empty.items, 'perm', 'secrets/').ok === false);
  check('core.envِ نبوده کارِ نصب‌کننده است، نه chmod', byName(empty.items, 'secret', 'secrets/core.env')?.fix === 'installer');
  check('کدِ پنل «نیست» علامت می‌خورد', byName(empty.items, 'code', 'core/panel')?.ok === false);
  check('ریشهٔ خالی ⇒ ok=false (وگرنه خودترمیمی هیچ‌وقت کاری نمی‌کرد)', empty.ok === false);

  console.log('\n۱ب) ابزارها — اختیاری و اجباری از هم جدا');
  for (const t of selfheal.TOOLS) {
    const item = byName(empty.items, 'tool', t.name);
    if (!item) { check(`ابزارِ ${t.name} در فهرست هست`, false); break; }
  }
  check('هر ابزارِ فهرستِ TOOLS یک قلم دارد', selfheal.TOOLS.every((t) => byName(empty.items, 'tool', t.name)));
  check('ابزارِ نبوده fix=installer می‌گیرد', empty.items.filter((i) => i.kind === 'tool' && !i.ok).every((i) => i.fix === 'installer'));
  check('اختیاری بودن از خودِ فهرست می‌آید (cloudflared · tailscale · ollama · docker اختیاری‌اند)',
    ['cloudflared', 'tailscale', 'ollama', 'docker', 'sensors', 'smartctl'].every((n) => byName(empty.items, 'tool', n).optional === true)
      && ['node', 'git', 'curl', 'caddy', 'ufw', 'fail2ban-client'].every((n) => !byName(empty.items, 'tool', n).optional));
  check('node که همین حالا داریمش «هست» علامت می‌خورد و مسیرش می‌آید',
    byName(empty.items, 'tool', 'node').ok === true && typeof byName(empty.items, 'tool', 'node').path === 'string');
  check('دستورِ vill3n روی نصبِ نبوده «نیست» است', byName(empty.items, 'tool', 'vill3n').ok === false);

  //  ابزارِ نبوده را واقعاً پیدا می‌کند؟ یک caddyِ ساختگی جلوی PATH می‌گذاریم
  const before = byName(empty.items, 'tool', 'caddy').ok;
  await fsp.mkdir(FAKE_BIN, { recursive: true });
  await fsp.writeFile(path.join(FAKE_BIN, 'caddy'), '#!/bin/sh\necho caddy\n', { mode: 0o755 });
  const realPath = process.env.PATH;
  process.env.PATH = `${FAKE_BIN}${path.delimiter}${realPath}`;
  const withCaddy = await selfheal.checkDependencies();
  process.env.PATH = realPath;
  check('ابزاری که سرِ راه بیاید همان لحظه «هست» می‌شود و مسیرش درست است',
    byName(withCaddy.items, 'tool', 'caddy').ok === true && byName(withCaddy.items, 'tool', 'caddy').path === path.join(FAKE_BIN, 'caddy'),
    `پیش از این: ${before}`);

  console.log('\n۱ج) سرویس‌ها');
  const units = empty.items.filter((i) => i.kind === 'unit');
  check('سرویسِ خودِ پنل همیشه سنجیده می‌شود', !!byName(units, 'unit', 'vill3n-panel'));
  check('سرویسی که ابزارش نصب نیست اصلاً سنجیده نمی‌شود', !byName(units, 'unit', 'cloudflared') && !byName(units, 'unit', 'ollama'));
  check('هر سرویس حالِ active/enabled را همراه دارد', units.every((u) => u.state && 'active' in u.state && 'enabled' in u.state));

  /* ═════════════ ۲) تعمیر ═════════════ */
  console.log('\n۲) تعمیر — آن‌چه پنل خودش می‌تواند');
  const fixed = await selfheal.repair({ runInstaller: false });
  check('همهٔ پوشه‌های ساختار ساخته شدند', selfheal.LAYOUT.every((rel) => fs.existsSync(path.join(ROOT, rel))));
  check('پوشهٔ رازها با ۷۰۰ ساخته شد', (fs.statSync(path.join(ROOT, 'secrets')).mode & 0o777) === 0o700);
  check('هر کدام در repaired با راهش گزارش شد', fixed.repaired.length >= selfheal.LAYOUT.length && fixed.repaired.every((r) => r.name && r.how));
  check('نصب‌کننده با runInstaller:false اصلاً صدا نشد', fixed.installer === null);
  check('ابزارها و کدِ پنل به نصب‌کننده سپرده شدند، نه بی‌صدا رها', fixed.skipped.some((s) => s.why === 'کارِ نصب‌کننده است'));
  check('نتیجهٔ تعمیر حالِ **بعد** از تعمیر را می‌گوید', fixed.items.filter((i) => i.kind === 'folder').every((i) => i.ok));
  check('و کم‌وکسریِ پیش از تعمیر را هم نگه می‌دارد', fixed.before?.hardMissing === empty.hardMissing);

  const after = await selfheal.checkDependencies();
  check('بررسیِ دوباره: هیچ پوشه‌ای کم نیست', after.items.filter((i) => i.kind === 'folder').every((i) => i.ok));
  check('ولی هنوز ok نیست، چون ابزارها و core.env کارِ نصب‌کننده‌اند', after.ok === false && after.hardMissing > 0);

  //  دسترسیِ خراب — همان چیزی که با یک کپیِ بی‌دقت پیش می‌آید
  await fsp.chmod(path.join(ROOT, 'secrets'), 0o755);
  await fsp.writeFile(path.join(ROOT, 'secrets', 'core.env'), 'HLP_PORT=4700\n', { mode: 0o644 });
  const loose = await selfheal.checkDependencies();
  check('۷۵۵ روی پوشهٔ رازها ایراد شمرده می‌شود', byName(loose.items, 'perm', 'secrets/').ok === false && byName(loose.items, 'perm', 'secrets/').actual === '755');
  check('۶۴۴ روی core.env ایراد است و راهش chmod', byName(loose.items, 'secret', 'secrets/core.env').ok === false && byName(loose.items, 'secret', 'secrets/core.env').fix === 'chmod');
  await selfheal.repair({ runInstaller: false });
  check('تعمیر دسترسی‌ها را به ۷۰۰ و ۶۰۰ برمی‌گرداند',
    (fs.statSync(path.join(ROOT, 'secrets')).mode & 0o777) === 0o700
      && (fs.statSync(path.join(ROOT, 'secrets', 'core.env')).mode & 0o777) === 0o600);
  check('و محتوای رازها را دست نمی‌زند', fs.readFileSync(path.join(ROOT, 'secrets', 'core.env'), 'utf8') === 'HLP_PORT=4700\n');

  //  دستورِ vill3n وقتی زیرِ <ریشه>/bin باشد پیدا می‌شود
  await fsp.mkdir(path.join(ROOT, 'bin'), { recursive: true });
  await fsp.writeFile(path.join(ROOT, 'bin', 'vill3n'), '#!/bin/sh\n', { mode: 0o755 });
  const withCli = await selfheal.checkDependencies();
  check('vill3nِ زیرِ <ریشه>/bin دیده می‌شود (لازم نیست در PATH باشد)', byName(withCli.items, 'tool', 'vill3n').ok === true);

  /* ═════════════ ۳) API: خواندن برای همه، تعمیر فقط admin ═════════════ */
  console.log('\n۳) مسیرِ API روی سرورِ واقعی');
  const PORT = Number(process.env.TEST_PORT || 4812);
  const BASE = `http://127.0.0.1:${PORT}`;
  const srvData = path.join(tmp, 'srvdata');
  const srvRoot = path.join(tmp, 'srv-api');
  const server = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
    {
      env: {
        ...process.env,
        HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
        HLP_DATA_DIR: srvData, HLP_SITES_ROOT: path.join(tmp, 'sites2'),
        HLP_SITESYNC: '0', HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0',
        HLP_BACKUP_SCHEDULE: '0',
        //  ریشهٔ جدا و خالی: تعمیر باید کاری برای انجام دادن داشته باشد
        VILL3N_ROOT: srvRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let srvOut = '';
  server.stdout.on('data', (d) => (srvOut += d));
  server.stderr.on('data', (d) => (srvOut += d));

  const tokens = {};
  async function api(method, url, body, who = 'admin') {
    const headers = {};
    if (who === 'local') headers['X-Local-Key'] = fs.readFileSync(path.join(srvData, 'local-admin.key'), 'utf8').trim();
    else if (tokens[who]) headers.Authorization = `Bearer ${tokens[who]}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* متن */ }
    return { status: res.status, json, text };
  }

  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try { up = (await fetch(`${BASE}/health`)).ok; } catch { /* هنوز */ }
      if (!up) await wait(250);
    }
    check('پنل بالا آمد', up, srvOut.slice(-400));

    let r = await api('GET', '/api/platform/selfheal', undefined, 'none');
    check('بی ورود، خواندن هم بسته است (۴۰۱)', r.status === 401, r.text);
    r = await api('POST', '/api/platform/selfheal/repair', { installer: false }, 'none');
    check('بی ورود، تعمیر بسته است (۴۰۱)', r.status === 401, r.text);

    tokens.admin = (await api('POST', '/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' }, 'none')).json?.token;
    check('مدیر ساخته شد', Boolean(tokens.admin));
    let s = await api('POST', '/api/auth/users', { username: 'op1', password: 'Operator!2026', role: 'operator' }, 'admin');
    check('کاربرِ operator ساخته شد', s.status === 201, s.text);
    s = await api('POST', '/api/auth/users', { username: 'view1', password: 'Viewer!2026', role: 'viewer' }, 'admin');
    check('کاربرِ viewer ساخته شد', s.status === 201, s.text);
    tokens.operator = (await api('POST', '/api/auth/login', { username: 'op1', password: 'Operator!2026' }, 'none')).json?.token;
    tokens.viewer = (await api('POST', '/api/auth/login', { username: 'view1', password: 'Viewer!2026' }, 'none')).json?.token;

    r = await api('GET', '/api/platform/selfheal', undefined, 'viewer');
    check('viewer وضعیتِ وابستگی‌ها را می‌بیند (دیدن قفل نیست)', r.status === 200 && Array.isArray(r.json?.items), r.text);
    check('و همان شکلِ داخلی از API هم برمی‌گردد', typeof r.json?.ok === 'boolean' && typeof r.json?.hardMissing === 'number' && r.json?.root === srvRoot, r.text.slice(0, 200));

    r = await api('POST', '/api/platform/selfheal/repair', { installer: false }, 'viewer');
    check('viewer تعمیر نمی‌کند (۴۰۳)', r.status === 403 && r.json?.error === 'forbidden' && r.json?.needed === 'admin', r.text);
    r = await api('POST', '/api/platform/selfheal/repair', { installer: false }, 'operator');
    check('operator هم تعمیر نمی‌کند — فقط admin (۴۰۳)', r.status === 403 && r.json?.needed === 'admin', r.text);
    check('و هیچ پوشه‌ای از تلاشِ آن‌ها ساخته نشد', !fs.existsSync(path.join(srvRoot, 'secrets')));

    r = await api('POST', '/api/platform/selfheal/repair', { installer: false }, 'admin');
    check('admin تعمیر می‌کند', r.status === 200 && r.json?.ok !== undefined && Array.isArray(r.json?.repaired), r.text.slice(0, 300));
    check('تعمیر واقعاً ساختار را ساخت', fs.existsSync(path.join(srvRoot, 'backups', 'offsite-queue')) && (fs.statSync(path.join(srvRoot, 'secrets')).mode & 0o777) === 0o700);
    check('نصب‌کننده از راهِ API خودسرانه اجرا نشد', r.json?.installer === null);

    r = await api('POST', '/api/platform/backup', { note: 'آزمون' }, 'viewer');
    check('پشتیبان‌گیری از همین مسیر هم فقط admin است', r.status === 403 && r.json?.needed === 'admin', r.text);

    //  دفترِ کارهای حساس — مستقیم از دیتابیسِ همان سرور خوانده می‌شود
    await wait(300);
    const audit = new DatabaseSync(path.join(srvData, 'panel.db'), { readOnly: true });
    const rows = audit.prepare('SELECT actor, action, ok FROM audit_log WHERE action = ? ORDER BY id').all('selfheal.repair');
    audit.close();
    check('تعمیرِ موفق در دفترِ کارهای حساس نشست', rows.length === 1, JSON.stringify(rows));
    check('و نامِ کسی که زده در آن هست', rows[0]?.actor === 'panel:admin', JSON.stringify(rows[0]));
    check('تلاشِ ردشدهٔ viewer/operator در دفتر ننشست (۴۰۳ پیش از audit)', rows.filter((x) => /op1|view1/.test(x.actor)).length === 0);

    //  برنامهٔ روی همین کامپیوتر (کلیدِ محلی) خودش admin شمرده می‌شود — همان راهی که vill3n می‌رود
    r = await api('POST', '/api/platform/selfheal/repair', { installer: false }, 'local');
    check('کلیدِ محلی تعمیر می‌کند (دستورِ vill3n از همین در می‌آید)', r.status === 200, r.text.slice(0, 200));
    await wait(300);
    const audit2 = new DatabaseSync(path.join(srvData, 'panel.db'), { readOnly: true });
    const rows2 = audit2.prepare('SELECT actor FROM audit_log WHERE action = ? ORDER BY id').all('selfheal.repair');
    audit2.close();
    check('کارِ برنامهٔ محلی هم با نامِ خودش در دفتر می‌نشیند', rows2.length === 2 && rows2[1].actor === 'local-app', JSON.stringify(rows2));
  } finally {
    server.kill('SIGTERM');
    await wait(600);
    server.kill('SIGKILL');
  }
} finally {
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n  ${passed} سبز، ${failed} سرخ\n`);
process.exit(failed ? 1 : 0);
