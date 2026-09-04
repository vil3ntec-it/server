// ---------------------------------------------------------------------------
//  تعمیرِ خودکارِ آدرسِ ثابت — بدونِ هیچ پرسشی
//
//  چرا این فایل هست: هر بار که آدرسِ ثابت می‌خوابید (Error 1033 یا NXDOMAIN)،
//  علتش یکی از پنج چیزِ زیر بود و هیچ‌کدام خودشان را نشان نمی‌دادند. فایل‌های
//  قبلی نشانی و نامِ کاربری و رمز می‌پرسیدند؛ این‌جا هیچ‌کدام لازم نیست —
//  همه‌چیز از روی خودِ نصب خوانده می‌شود.
//
//  پنج خرابیِ شناخته‌شده:
//    ۱) tunnel_mode در دیتابیس روی «quick» مانده ⇒ پنل config.yml را اصلاً
//       نگاه نمی‌کند و تونلِ سریع بالا می‌آید. رکوردِ DNS به تونلی اشاره
//       می‌کند که کسی پشتش نیست ⇒ Error 1033.
//    ۲) شناسهٔ تونلِ داخلِ config.yml دیگر در حساب وجود ندارد (تونل پاک شده
//       یا حساب عوض شده) ⇒ باز هم ۱۰۳۳.
//    ۳) فایلِ اعتبارِ تونل (<uuid>.json) جابه‌جا یا گم شده ⇒ cloudflared
//       بی‌صدا با کدِ ۱ می‌میرد.
//    ۴) زیردامنه‌ها فقط در config.yml هستند و در دیتابیس نه ⇒ اولین
//       بازنویسیِ پنل می‌اندازدشان.
//    ۵) رکوردِ DNS ساخته نشده یا به تونلِ دیگری اشاره می‌کند.
//
//  ⚠️ نکتهٔ اصلی: config.yml را دستی درست کردن فایده ندارد. پنل آن فایل را از
//  روی دیتابیسِ خودش می‌سازد و در هر راه‌اندازی بازنویسی‌اش می‌کند. پس اصلِ
//  تعمیر روی دیتابیس است و فایل فقط برای همین یک بار هم‌راست می‌شود.
//
//  اجرا:  node auto-fix.mjs [--server <پوشهٔ server>] [--dry]
//  خروجی: خط‌های پیشرفت روی stderr، و در آخر یک خطِ JSON روی stdout با
//         پیشوندِ ##RESULT## تا پوستهٔ PowerShell بتواند بخواندش.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawnSync } from 'node:child_process';

const WIN = process.platform === 'win32';
const EXE = WIN ? '.exe' : '';
const DEFAULT_TUNNEL_NAME = 'control-center';

const steps = [];   // آنچه واقعاً عوض شد
const notes = [];   // آنچه فقط دیده شد
const blockers = []; // آنچه از دستِ ما خارج است

/** خط‌های پیشرفت روی stderr می‌روند تا stdout فقط JSON بماند */
function say(line) { process.stderr.write(`${line}\n`); }

// ---------------------------------------------------------------------------
//  پیدا کردنِ نصب
// ---------------------------------------------------------------------------

/** پوشهٔ server — از آرگومان، از متغیرِ محیطی، یا از جاهای همیشگی */
export function findServerDir(hint = '') {
  const tries = [];
  if (hint) tries.push(hint);
  if (process.env.HLP_SERVER_DIR) tries.push(process.env.HLP_SERVER_DIR);

  // کنارِ خودِ همین فایل: desktop → homelab-panel → server
  tries.push(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'server'));

  const home = os.homedir();
  const roots = [home, path.join(home, 'Desktop'), path.join(home, 'Documents'), 'C:\\', 'D:\\', 'E:\\'];
  for (const root of roots) {
    tries.push(path.join(root, 'PumpServer', 'homelab-panel', 'server'));
    tries.push(path.join(root, 'homelab-panel', 'server'));
  }

  for (const dir of tries) {
    try {
      if (dir && fs.existsSync(path.join(dir, 'src', 'index.js'))) return path.resolve(dir);
    } catch { /* مسیرِ بی‌معنی روی این سیستم — بعدی */ }
  }
  return '';
}

/** پوشهٔ داده — server\data مگر .env جای دیگری گفته باشد */
export function dataDirOf(serverDir) {
  try {
    const env = fs.readFileSync(path.join(serverDir, '.env'), 'utf8');
    const m = env.match(/^\s*HLP_DATA_DIR\s*=\s*(.+)$/m);
    if (m) {
      const value = m[1].trim().replace(/^["']|["']$/g, '');
      if (value) return path.isAbsolute(value) ? value : path.resolve(serverDir, value);
    }
  } catch { /* .env نیست یا خوانده نشد — همان پیش‌فرض */ }
  return path.join(serverDir, 'data');
}

/** cloudflared کجاست؟ اول همان‌جایی که پنل خودش دانلودش کرده */
export function findBinary(dataDir) {
  const tries = [
    process.env.HLP_CF_BIN || '',
    path.join(dataDir, 'bin', `cloudflared${EXE}`),
    path.join(os.homedir(), '.cloudflared', `cloudflared${EXE}`),
  ];
  if (WIN) {
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (root) tries.push(path.join(root, 'cloudflared', 'cloudflared.exe'));
    }
  }
  for (const bin of tries) {
    try { if (bin && fs.existsSync(bin)) return bin; } catch { /* بعدی */ }
  }
  // شاید در PATH باشد
  const which = spawnSync(WIN ? 'where' : 'which', ['cloudflared'], { encoding: 'utf8' });
  const first = String(which.stdout || '').split(/\r?\n/).find(Boolean);
  return first ? first.trim() : '';
}

// ---------------------------------------------------------------------------
//  خواندنِ config.yml
// ---------------------------------------------------------------------------

export function parseConfig(text) {
  const src = String(text || '');
  const id = src.match(/^tunnel:\s*(\S+)/m);
  const cred = src.match(/^credentials-file:\s*(.+)$/m);
  const hosts = [];
  const re = /^\s*-\s*hostname:\s*(\S+)\s*\n\s*service:\s*https?:\/\/[^:\s]+:(\d+)/gm;
  for (const m of src.matchAll(re)) hosts.push({ hostname: m[1], port: Number(m[2]) });
  return { id: id ? id[1] : '', cred: cred ? cred[1].trim() : '', hosts };
}

/**
 * شناسهٔ تونل از خروجیِ «tunnel list».
 *
 * ⚠️ خروجیِ cloudflared با خط‌های لاگ قاطی است و آن خط‌ها هم «[» دارند. پس
 * از هر کروشه‌ای امتحان می‌شود تا یکی JSONِ درست از آب دربیاید، و اگر هیچ‌کدام
 * نشد، جدولِ متنی خوانده می‌شود.
 */
export function tunnelIdFrom(output, name) {
  const text = String(output || '');
  for (let at = text.indexOf('['); at !== -1; at = text.indexOf('[', at + 1)) {
    let rows;
    try { rows = JSON.parse(text.slice(at)); } catch { continue; }
    if (!Array.isArray(rows)) continue;
    const row = rows.find((t) => t && t.name === name);
    if (row?.id) return row.id;
  }
  for (const line of text.split(/\r?\n/)) {
    if (name && !line.includes(name)) continue;
    const m = line.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (m) return m[0];
  }
  return '';
}

/** همهٔ شناسه‌های تونلِ داخلِ خروجی — برای «آیا این شناسه هنوز هست؟» */
export function allTunnelIds(output) {
  const found = String(output || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  return [...new Set((found || []).map((x) => x.toLowerCase()))];
}

// ---------------------------------------------------------------------------
//  تنظیماتِ پنل — مستقیم روی همان دیتابیس
// ---------------------------------------------------------------------------

/**
 * لایهٔ نازکی روی جدولِ settings.
 *
 * ⚠️ مقدارها JSON هستند، نه متنِ خام. اگر «named» را بدونِ گیومه بنویسیم،
 * getSetting پنل آن را نمی‌فهمد و همه‌چیز سرِ جای اولش می‌ماند.
 */
export async function openSettings(dbFile) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  return {
    get(key, fallback = null) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      if (!row) return fallback;
      try { return JSON.parse(row.value); } catch { return row.value; }
    },
    set(key, value) {
      db.prepare(
        'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(key, JSON.stringify(value));
    },
    close() { try { db.close(); } catch { /* بسته بود */ } },
  };
}

// ---------------------------------------------------------------------------
//  تعمیر
// ---------------------------------------------------------------------------

function runCf(bin, args, { cert, timeout = 60000 } = {}) {
  const env = { ...process.env };
  if (cert) env.TUNNEL_ORIGIN_CERT = cert;
  const out = spawnSync(bin, args, { encoding: 'utf8', timeout, env });
  return {
    code: out.status,
    stdout: String(out.stdout || ''),
    output: `${String(out.stdout || '')}\n${String(out.stderr || '')}`,
  };
}

/** فایلِ اعتبارِ تونل را پیدا یا دوباره می‌گیرد */
function ensureCred(bin, cfDir, uuid, name, cert) {
  const target = path.join(cfDir, `${uuid}.json`);
  if (fs.existsSync(target)) return target;

  for (const candidate of [
    path.join(os.homedir(), '.cloudflared', `${uuid}.json`),
    path.join(path.dirname(cfDir), `${uuid}.json`),
  ]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      fs.mkdirSync(cfDir, { recursive: true });
      fs.copyFileSync(candidate, target);
      steps.push(`فایلِ اعتبارِ تونل از ${candidate} برگردانده شد`);
      return target;
    } catch { return candidate; }
  }

  // تونل از قبل ساخته شده و فایلش گم شده — دوباره از Cloudflare می‌گیریم
  if (bin) {
    fs.mkdirSync(cfDir, { recursive: true });
    runCf(bin, ['tunnel', 'token', '--cred-file', target, name || uuid], { cert });
    if (fs.existsSync(target)) {
      steps.push('فایلِ اعتبارِ تونل دوباره از Cloudflare گرفته شد');
      return target;
    }
  }
  return '';
}

/**
 * آیا کسی روی این پورت گوش می‌دهد؟
 *
 * ⚠️ اگر تونل بالا باشد ولی پشتش هیچ‌کس نباشد، Cloudflare خطای ۵۰۲ می‌دهد و
 * کاربر همان «کار نمی‌کند» را می‌بیند. تفاوتش با ۱۰۳۳ از بیرون معلوم نیست،
 * پس این‌جا از خودِ کامپیوتر پرسیده می‌شود.
 */
function portOpen(port, timeout = 1500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeout);
    sock.on('connect', () => done(true));
    sock.on('timeout', () => done(false));
    sock.on('error', () => done(false));
  });
}

/**
 * تونل را خودمان چند ثانیه اجرا می‌کنیم و حرفِ خودش را می‌شنویم.
 *
 * ⚠️ چرا این مهم‌ترین بخش است: تا امروز وقتی آدرس بالا نمی‌آمد، هیچ‌جا معلوم
 * نبود چرا. پنل فقط می‌گفت «بالا نیامد» و Cloudflare فقط می‌گفت ۱۰۳۳. خودِ
 * cloudflared دلیلش را می‌گوید — ولی حرفش داخلِ لاگِ پنل گم می‌شد.
 *
 * @returns {{connected:boolean, lines:string[]}}
 */
function probeTunnel(bin, configFile, cert, seconds = 25) {
  if (!bin || !fs.existsSync(configFile)) return { connected: false, lines: [] };
  const env = { ...process.env };
  if (cert) env.TUNNEL_ORIGIN_CERT = cert;
  const out = spawnSync(bin, ['tunnel', '--no-autoupdate', '--config', configFile, 'run'], {
    encoding: 'utf8',
    timeout: seconds * 1000,
    env,
  });
  const text = `${out.stdout || ''}\n${out.stderr || ''}`;
  const connected = /Registered tunnel connection|Connection [0-9a-f-]+ registered/i.test(text);
  // فقط خط‌هایی که به درد می‌خورند — لاگِ کامل چند صد خط است
  const lines = text
    .split(/\r?\n/)
    .filter((l) => /ERR|error|failed|unable|cannot|Registered tunnel connection|Starting tunnel/i.test(l))
    .map((l) => l.trim().slice(0, 220))
    .slice(-6);
  return { connected, lines };
}

/**
 * همهٔ کار: می‌بیند، تصمیم می‌گیرد، درست می‌کند.
 *
 * @param {{serverDir?:string, dry?:boolean}} options
 */
export async function autoFix({ serverDir = '', dry = false } = {}) {
  const server = findServerDir(serverDir);
  if (!server) {
    blockers.push('پوشهٔ نصبِ سرور پیدا نشد.');
    return finish({ found: false });
  }
  say(`server: ${server}`);

  const dataDir = dataDirOf(server);
  const cfDir = path.join(dataDir, 'cloudflared');
  const configFile = path.join(cfDir, 'config.yml');
  const certFile = path.join(cfDir, 'cert.pem');
  const dbFile = path.join(dataDir, 'panel.db');

  if (!fs.existsSync(dbFile)) {
    blockers.push(`دیتابیسِ پنل پیدا نشد: ${dbFile}`);
    return finish({ found: true, server, dataDir });
  }

  const bin = findBinary(dataDir);
  const cert = fs.existsSync(certFile) ? certFile
    : (fs.existsSync(path.join(os.homedir(), '.cloudflared', 'cert.pem'))
      ? path.join(os.homedir(), '.cloudflared', 'cert.pem') : '');
  const cfg = fs.existsSync(configFile)
    ? parseConfig(fs.readFileSync(configFile, 'utf8'))
    : { id: '', cred: '', hosts: [] };

  const settings = await openSettings(dbFile);
  try {
    const mode = settings.get('tunnel_mode', 'quick');
    const name = settings.get('tunnel_name', null) || DEFAULT_TUNNEL_NAME;
    let hostname = settings.get('tunnel_hostname', null) || cfg.hosts[0]?.hostname || '';

    say(`mode=${mode} host=${hostname || '-'} tunnel=${cfg.id || '-'}`);

    if (!cfg.id || !hostname) {
      // هنوز آدرسِ ثابتی ساخته نشده — این‌جا چیزی برای تعمیر نیست
      blockers.push('هنوز آدرسِ ثابتی ساخته نشده. در پنل، بخشِ «آدرس ثابت» را یک بار بزنید.');
      return finish({ found: true, server, dataDir, hostname, mode });
    }
    if (!cert) {
      blockers.push('به حسابِ Cloudflare وارد نشده‌اید (cert.pem نیست). در پنل «ورود به Cloudflare» را بزنید.');
    }

    // ── خرابیِ ۲: آیا شناسهٔ داخلِ فایل هنوز در حساب هست؟ ────────────────
    let uuid = cfg.id;
    if (bin && cert) {
      const listed = runCf(bin, ['tunnel', 'list', '--output', 'json'], { cert, timeout: 45000 });
      const ids = allTunnelIds(listed.output);
      if (ids.length && !ids.includes(uuid.toLowerCase())) {
        const live = tunnelIdFrom(listed.stdout, name) || tunnelIdFrom(listed.output, name);
        if (live) {
          steps.push(`تونلِ داخلِ پیکربندی (${uuid.slice(0, 8)}…) دیگر در حساب نبود — به ${live.slice(0, 8)}… برگشت`);
          uuid = live;
        } else {
          blockers.push('تونلِ این سرور در حسابِ Cloudflare پیدا نشد — باید یک بار دوباره ساخته شود.');
        }
      } else if (ids.length) {
        notes.push('شناسهٔ تونل با حسابِ Cloudflare می‌خواند.');
      }
    } else if (!bin) {
      notes.push('cloudflared روی این کامپیوتر پیدا نشد — بررسیِ حساب انجام نشد.');
    }

    // ── خرابیِ ۳: فایلِ اعتبار ─────────────────────────────────────────
    //  ⚠️ فایلِ اعتبار مالِ یک تونلِ مشخص است، نه مالِ «تونل» به‌طورِ کلی. اگر
    //  بالاتر شناسه عوض شده باشد و ما همان فایلِ قدیمی را نگه داریم، پیکربندی
    //  می‌شود «تونلِ تازه + کلیدِ تونلِ مرده» و cloudflared بالا نمی‌آید — یعنی
    //  همان ۱۰۳۳، فقط این بار با دستِ خودمان. پس نامِ فایل باید با شناسه بخواند.
    const credFits = cfg.cred && cfg.cred.includes(uuid) && fs.existsSync(cfg.cred);
    let cred = credFits ? cfg.cred : '';
    if (!cred && !dry) cred = ensureCred(bin, cfDir, uuid, name, cert);
    if (!cred && !dry) {
      blockers.push(
        `فایلِ اعتبارِ تونل (${uuid.slice(0, 8)}…) پیدا نشد. در پنل، بخشِ «آدرس ثابت» را یک بار بزنید `
        + 'تا تونل دوباره ساخته شود — بقیهٔ تنظیمات همین حالا درست شد.'
      );
    }

    // ── خرابیِ ۴: زیردامنه‌هایی که فقط در فایل هستند ─────────────────────
    const extras = settings.get('tunnel_hostnames', []) || [];
    const known = new Set([hostname, ...extras.map((x) => x?.hostname)]);
    const missing = cfg.hosts.filter((r) => !known.has(r.hostname));
    if (missing.length && !dry) {
      settings.set('tunnel_hostnames', [...extras, ...missing]);
      steps.push(`زیردامنه‌ها به تنظیمات اضافه شدند: ${missing.map((x) => x.hostname).join('، ')}`);
    }

    /*
     *  ── خرابیِ ۶: تونل عمداً خاموش شده ─────────────────────────────────
     *
     *  ⚠️ ساکت‌ترین خرابیِ همهٔ این‌ها. دکمهٔ «خاموش کردنِ تونل» در پنل فقط
     *  tunnel_autostart را false می‌کند. بعد از آن، هرچه config.yml و شناسه و
     *  رکوردِ DNS درست باشد فرقی نمی‌کند: پنل موقعِ راه‌اندازی اصلاً سراغِ تونل
     *  نمی‌رود. از بیرون دقیقاً شکلِ ۱۰۳۳ است و هیچ‌جا هم نوشته نمی‌شود.
     *  «دیروز کار می‌کرد، امروز نه» بیشتر وقت‌ها همین است.
     */
    if (settings.get('tunnel_autostart', true) === false) {
      if (!dry) settings.set('tunnel_autostart', true);
      steps.push('تونل در پنل خاموش شده بود (دکمهٔ خاموش/روشن) — دوباره روشن شد');
    }

    /*
     *  همان چیز، این بار از راهِ فایلِ .env. اگر HLP_TUNNEL=0 باشد، تنظیمِ
     *  دیتابیس هم کاری از پیش نمی‌برد — متغیرِ محیطی زورش بیشتر است.
     */
    const envFile = path.join(server, '.env');
    if (fs.existsSync(envFile)) {
      let envText = fs.readFileSync(envFile, 'utf8');
      let touched = false;
      for (const key of ['HLP_TUNNEL', 'HLP_SITESYNC']) {
        const re = new RegExp(`^\\s*${key}\\s*=\\s*0\\s*$`, 'm');
        if (!re.test(envText)) continue;
        envText = envText.replace(re, `# $&   ← این خط تونل را خاموش می‌کرد`);
        touched = true;
        steps.push(`در فایلِ .env خطِ ${key}=0 تونل را خاموش می‌کرد — غیرفعال شد`);
      }
      if (touched && !dry) fs.writeFileSync(envFile, envText, 'utf8');
    }

    // ── خرابیِ ۱: حالتِ تونل ───────────────────────────────────────────
    if (mode !== 'named') {
      if (!dry) {
        settings.set('tunnel_mode', 'named');
        settings.set('tunnel_name', name);
        if (!settings.get('tunnel_hostname', null)) settings.set('tunnel_hostname', hostname);
      }
      steps.push('حالتِ تونل از «سریع» به «آدرسِ ثابت» برگشت — علتِ اصلیِ خطای ۱۰۳۳ همین است');
    } else {
      notes.push('حالتِ تونل درست بود.');
    }
    if (!settings.get('tunnel_hostname', null) && !dry) settings.set('tunnel_hostname', hostname);
    hostname = settings.get('tunnel_hostname', null) || hostname;

    // ── فایل را همین یک بار هم‌راست می‌کنیم تا تا راه‌اندازیِ بعدی درست باشد ──
    if (!dry && cred && (uuid !== cfg.id || cfg.cred !== cred)) {
      const lines = [`tunnel: ${uuid}`, `credentials-file: ${cred.replaceAll('\\', '/')}`, 'ingress:'];
      const all = cfg.hosts.length ? cfg.hosts : [{ hostname, port: 4700 }];
      for (const r of all) {
        lines.push(`  - hostname: ${r.hostname}`, `    service: http://127.0.0.1:${r.port}`);
      }
      lines.push('  - service: http_status:404', '');
      fs.mkdirSync(cfDir, { recursive: true });
      fs.writeFileSync(configFile, lines.join('\n'), 'utf8');
      steps.push('پیکربندیِ تونل بازنویسی شد');
    }

    // ── خرابیِ ۵: رکوردِ DNS ───────────────────────────────────────────
    if (bin && cert && !dry) {
      for (const host of new Set([hostname, ...cfg.hosts.map((x) => x.hostname)])) {
        if (!host) continue;
        const routed = runCf(bin, ['tunnel', 'route', 'dns', '--overwrite-dns', uuid, host], { cert });
        if (routed.code === 0) steps.push(`رکوردِ DNS برای ${host} به همین تونل وصل شد`);
        else notes.push(`رکوردِ DNS برای ${host}: ${routed.output.trim().split(/\r?\n/).pop() || 'بی‌پاسخ'}`);
      }
    }

    /*
     *  ── شواهد ──────────────────────────────────────────────────────────
     *  تا این‌جا تنظیمات درست شد. حالا به‌جای اینکه بگوییم «امیدواریم کار کند»،
     *  دو چیز واقعاً امتحان می‌شود: کسی پشتِ پورت هست؟ و خودِ تونل بالا می‌آید؟
     */
    const mainPort = cfg.hosts.find((r) => r.hostname === hostname)?.port || cfg.hosts[0]?.port || 4701;
    if (!(await portOpen(mainPort))) {
      notes.push(`هیچ‌کس روی پورتِ ${mainPort} گوش نمی‌دهد — سرور خاموش است یا پورتش فرق دارد.`);
    } else {
      notes.push(`پورتِ ${mainPort} باز است.`);
    }

    let probe = { connected: false, lines: [] };
    if (!dry && bin && cred) {
      say('probing the tunnel (about 25 seconds) ...');
      probe = probeTunnel(bin, configFile, cert);
      if (probe.connected) notes.push('تونل با همین تنظیمات به Cloudflare وصل شد ✅');
      else if (probe.lines.length) blockers.push(`تونل وصل نشد. حرفِ خودِ cloudflared: ${probe.lines.join(' | ')}`);
    }

    return finish({ found: true, server, dataDir, hostname, tunnelId: uuid, mode, port: mainPort, probe });
  } finally {
    settings.close();
  }
}

function finish(extra) {
  return {
    ok: blockers.length === 0,
    changed: steps.length > 0,
    steps,
    notes,
    blockers,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
//  اجرا از خطِ فرمان
// ---------------------------------------------------------------------------
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--server');
  const result = await autoFix({
    serverDir: at !== -1 ? argv[at + 1] || '' : '',
    dry: argv.includes('--dry'),
  });
  for (const s of result.steps) say(`  + ${s}`);
  for (const b of result.blockers) say(`  ! ${b}`);
  process.stdout.write(`##RESULT##${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
