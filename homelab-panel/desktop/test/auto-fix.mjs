// ---------------------------------------------------------------------------
//  آزمونِ تعمیرِ خودکار — با یک نصبِ ساختگی و یک cloudflaredِ قلابی
//      node test/auto-fix.mjs          (داخل پوشهٔ desktop)
//
//  هر خرابیِ شناخته‌شده یک نصبِ تازه می‌گیرد، تعمیر روی همان اجرا می‌شود و
//  بعد دیتابیس و config.yml خوانده می‌شود تا ببینیم واقعاً عوض شده یا نه.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MOD = new URL('../auto-fix.mjs', import.meta.url);

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 300)}`);
};

const LIVE = 'eeb76414-1111-2222-3333-444455556666';
const DEAD = 'aa3c0363-9999-8888-7777-666655554444';

/**
 * یک نصبِ کاملِ ساختگی می‌سازد: پوشهٔ server، دیتابیس، config.yml، فایلِ
 * اعتبار، و یک cloudflaredِ قلابی که همان چیزی را چاپ می‌کند که خواسته‌ایم.
 */
function makeInstall({ mode = 'quick', tunnelId = LIVE, cred = true, hosts = null, listed = [LIVE],
                      autostart = null, env = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autofix-'));
  const server = path.join(root, 'homelab-panel', 'server');
  const data = path.join(server, 'data');
  const cf = path.join(data, 'cloudflared');
  fs.mkdirSync(path.join(server, 'src'), { recursive: true });
  fs.mkdirSync(path.join(data, 'bin'), { recursive: true });
  fs.mkdirSync(cf, { recursive: true });
  fs.writeFileSync(path.join(server, 'src', 'index.js'), '// fake\n');

  const ingress = hosts || [{ hostname: 'api.vill3n.top', port: 4700 }, { hostname: 'sync.vill3n.top', port: 4700 }];
  const credFile = path.join(cf, `${tunnelId}.json`);
  if (cred) fs.writeFileSync(credFile, '{"AccountTag":"x"}');
  fs.writeFileSync(path.join(cf, 'cert.pem'), 'fake-cert');
  fs.writeFileSync(
    path.join(cf, 'config.yml'),
    [
      `tunnel: ${tunnelId}`,
      `credentials-file: ${credFile.replaceAll('\\', '/')}`,
      'ingress:',
      ...ingress.flatMap((r) => [`  - hostname: ${r.hostname}`, `    service: http://127.0.0.1:${r.port}`]),
      '  - service: http_status:404',
      '',
    ].join('\n')
  );

  const db = new DatabaseSync(path.join(data, 'panel.db'));
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  const put = (k, v) => db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k, JSON.stringify(v));
  put('tunnel_mode', mode);
  put('tunnel_name', 'control-center');
  if (mode === 'named') put('tunnel_hostname', 'api.vill3n.top');
  if (autostart !== null) put('tunnel_autostart', autostart);
  db.close();
  if (env) fs.writeFileSync(path.join(server, '.env'), env, 'utf8');

  // cloudflaredِ قلابی: خروجیِ «tunnel list» را با خط‌های لاگ قاطی می‌کند،
  // چون واقعی‌اش هم همین کار را می‌کند و همان چیزی بود که parser را شکست
  const rows = JSON.stringify(listed.map((id) => ({ id, name: 'control-center' })));
  const bin = path.join(data, 'bin', 'cloudflared');
  fs.writeFileSync(
    bin,
    `#!/bin/sh
if [ "$2" = "list" ]; then
  echo "2026-09-04T00:00:00Z INF Using [config] file" >&2
  echo '${rows}'
  exit 0
fi
if [ "$2" = "route" ]; then echo "added route" ; exit 0 ; fi
if [ "$2" = "token" ]; then
  for a in "$@"; do
    case "$prev" in --cred-file) echo '{"AccountTag":"regenerated"}' > "$a" ;; esac
    prev="$a"
  done
  exit 0
fi
exit 0
`,
    { mode: 0o755 }
  );
  return { root, server, data, cf, dbFile: path.join(data, 'panel.db'), bin };
}

function settingsOf(dbFile) {
  const db = new DatabaseSync(dbFile);
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[row.key] = JSON.parse(row.value); } catch { out[row.key] = row.value; }
  }
  db.close();
  return out;
}

/** هر اجرا در یک ماژولِ تازه، وگرنه steps از آزمونِ قبلی می‌ماند */
async function run(install, opts = {}) {
  process.env.HLP_CF_BIN = install.bin;
  const mod = await import(`${MOD.href}?t=${Math.random()}`);
  return mod.autoFix({ serverDir: install.server, ...opts });
}

console.log('\n🔧 تعمیرِ خودکارِ آدرسِ ثابت\n');

// ── ۱: حالت روی «سریع» مانده — علتِ خطای ۱۰۳۳ ────────────────────────────
{
  const inst = makeInstall({ mode: 'quick' });
  const r = await run(inst);
  const s = settingsOf(inst.dbFile);
  check('حالتِ «سریع» به «آدرسِ ثابت» برمی‌گردد', s.tunnel_mode === 'named', s.tunnel_mode);
  check('آدرسِ اصلی از پیکربندی برداشته می‌شود', s.tunnel_hostname === 'api.vill3n.top', s.tunnel_hostname);
  check('گزارش می‌گوید چیزی عوض شد', r.changed === true);
  check('بدونِ مانع تمام می‌شود', r.ok === true, r.blockers.join(' | '));
}

// ── ۲: زیردامنه‌ها فقط در فایل بودند ─────────────────────────────────────
{
  const inst = makeInstall({ mode: 'quick' });
  await run(inst);
  const hosts = (settingsOf(inst.dbFile).tunnel_hostnames || []).map((x) => x.hostname);
  check('زیردامنه‌ها وارد تنظیمات می‌شوند', hosts.includes('sync.vill3n.top'), hosts.join(','));
}

// ── ۳: تونلِ داخلِ فایل دیگر در حساب نیست ─────────────────────────────────
{
  const inst = makeInstall({ mode: 'named', tunnelId: DEAD, listed: [LIVE] });
  const r = await run(inst);
  const cfg = fs.readFileSync(path.join(inst.cf, 'config.yml'), 'utf8');
  check('به تونلِ زنده برمی‌گردد', r.tunnelId === LIVE, r.tunnelId);
  check('پیکربندی با شناسهٔ تازه نوشته می‌شود', cfg.includes(`tunnel: ${LIVE}`));
  check('زیردامنه‌ها در پیکربندی می‌مانند', cfg.includes('sync.vill3n.top'));
}

// ── ۳ب: فایلِ اعتبار باید با شناسهٔ تازه بخواند ──────────────────────────
//  در اجرای واقعی همین‌جا گیر کرد: شناسه به تونلِ زنده برگشت ولی
//  credentials-file هنوز فایلِ تونلِ مرده بود ⇒ cloudflared بالا نمی‌آمد.
{
  const inst = makeInstall({ mode: 'named', tunnelId: DEAD, listed: [LIVE] });
  await run(inst);
  const cfg = fs.readFileSync(path.join(inst.cf, 'config.yml'), 'utf8');
  const cred = cfg.match(/^credentials-file:\s*(.+)$/m)?.[1] || '';
  check('فایلِ اعتبار هم با تونلِ تازه عوض می‌شود', cred.includes(LIVE) && !cred.includes(DEAD), cred);
  check('و روی دیسک هم واقعاً هست', fs.existsSync(path.join(inst.cf, `${LIVE}.json`)));
}

// ── ۴: تونلِ سالم دست نمی‌خورد ───────────────────────────────────────────
{
  const inst = makeInstall({ mode: 'named', tunnelId: LIVE, listed: [LIVE, DEAD] });
  const r = await run(inst);
  check('شناسهٔ درست عوض نمی‌شود', r.tunnelId === LIVE, r.tunnelId);
}

// ── ۵: فایلِ اعتبار گم شده ───────────────────────────────────────────────
{
  const inst = makeInstall({ mode: 'named', cred: false });
  const r = await run(inst);
  check('فایلِ اعتبار دوباره گرفته می‌شود', fs.existsSync(path.join(inst.cf, `${LIVE}.json`)), r.blockers.join(' | '));
}

// ── ۶: --dry هیچ‌چیز را عوض نمی‌کند ──────────────────────────────────────
{
  const inst = makeInstall({ mode: 'quick' });
  await run(inst, { dry: true });
  check('حالتِ آزمایشی دیتابیس را دست نمی‌زند', settingsOf(inst.dbFile).tunnel_mode === 'quick');
}

// ── ۷: هنوز آدرسِ ثابتی ساخته نشده ───────────────────────────────────────
{
  const inst = makeInstall({ mode: 'quick' });
  fs.rmSync(path.join(inst.cf, 'config.yml'));
  const r = await run(inst);
  check('نبودِ پیکربندی را با زبانِ آدمیزاد می‌گوید', /آدرسِ ثابتی ساخته نشده/.test(r.blockers.join(' ')), r.blockers.join(' | '));
  check('و بی‌خود چیزی را عوض نمی‌کند', settingsOf(inst.dbFile).tunnel_mode === 'quick');
}

// ── ۸: خواندنِ خروجیِ قاطیِ cloudflared ───────────────────────────────────
{
  const mod = await import(`${MOD.href}?t=parse`);
  const noisy = `2026-09-04 INF flags [config] parsed\n[{"id":"${LIVE}","name":"control-center"}]`;
  check('شناسه از خروجیِ پر از لاگ درمی‌آید', mod.tunnelIdFrom(noisy, 'control-center') === LIVE);
  check('جدولِ متنی هم خوانده می‌شود',
    mod.tunnelIdFrom(`ID NAME\n${LIVE} control-center`, 'control-center') === LIVE);
  const cfg = mod.parseConfig(`tunnel: ${LIVE}\ncredentials-file: /a/b.json\ningress:\n  - hostname: x.ir\n    service: http://127.0.0.1:9\n`);
  check('پیکربندی درست خوانده می‌شود', cfg.id === LIVE && cfg.hosts[0].hostname === 'x.ir' && cfg.hosts[0].port === 9);
}

// ── ۹: تونل در پنل خاموش شده بود ────────────────────────────────────────
//  ساکت‌ترین خرابی: همه‌چیز درست است ولی پنل اصلاً سراغِ تونل نمی‌رود.
{
  const inst = makeInstall({ mode: 'named', autostart: false });
  const r = await run(inst);
  check('تونلِ خاموش‌شده دوباره روشن می‌شود', settingsOf(inst.dbFile).tunnel_autostart === true);
  check('و می‌گوید چرا', /خاموش شده بود/.test(r.steps.join(' ')), r.steps.join(' | '));
}

// ── ۱۰: HLP_TUNNEL=0 در فایلِ .env ──────────────────────────────────────
{
  const inst = makeInstall({ mode: 'named', env: 'HLP_PORT=4700\nHLP_TUNNEL=0\n' });
  await run(inst);
  const envText = fs.readFileSync(path.join(inst.server, '.env'), 'utf8');
  check('خطِ HLP_TUNNEL=0 غیرفعال می‌شود', /^#\s*HLP_TUNNEL=0/m.test(envText), envText);
  check('بقیهٔ .env دست نمی‌خورد', /^HLP_PORT=4700$/m.test(envText), envText);
}

// ── ۱۱: خطِ سالمِ .env نباید دست بخورد ───────────────────────────────────
{
  const inst = makeInstall({ mode: 'named', env: 'HLP_TUNNEL=1\n' });
  await run(inst);
  check('HLP_TUNNEL=1 دست‌نخورده می‌ماند',
    fs.readFileSync(path.join(inst.server, '.env'), 'utf8').trim() === 'HLP_TUNNEL=1');
}

console.log(`\n  ${fail ? '❌' : '✅'} ${pass} تایید، ${fail} خطا\n`);
process.exit(fail ? 1 : 0);
