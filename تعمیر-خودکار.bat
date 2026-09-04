@echo off
setlocal
title Automatic repair - server address
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=[IO.File]::ReadAllText('%~f0');$i=$c.LastIndexOf('#PSCODE#');Invoke-Expression $c.Substring($i+8)"
exit /b %ERRORLEVEL%
#PSCODE#
# ---------------------------------------------------------------------------
#  «تعمیرِ خودکار» — پوستهٔ ویندوزیِ auto-fix.mjs
#
#  هیچ پرسشی ندارد: نه نشانیِ پنل، نه نامِ کاربری، نه رمز، نه آدرسِ مقصد. همه را
#  از روی خودِ نصب پیدا می‌کند. کارش سه بخش است:
#
#     ۱) auto-fix.mjs را با Nodeِ خودِ سرور اجرا می‌کند (تشخیص و تعمیر)
#     ۲) سرور را خاموش و دوباره روشن می‌کند تا تنظیماتِ تازه سوار شود
#     ۳) خودش آدرس را از اینترنت صدا می‌زند و می‌بیند بالا آمده یا نه
#
#  در آخر یک گزارشِ فارسی روی دسکتاپ می‌سازد و در مرورگر باز می‌کند — چون
#  پنجرهٔ cmd فارسی را درست نشان نمی‌دهد و متنِ انگلیسی هم به کارِ کسی نمی‌آید.
#
#  این فایل خواندنی است؛ همین کد داخلِ «تعمیر-خودکار.bat» هم هست. اگر این‌جا را
#  عوض کردید، دوباره بسازیدش:
#
#      node homelab-panel/desktop/build-auto-fix.mjs
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Continue'
$EmbeddedBrain = @'
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

    return finish({ found: true, server, dataDir, hostname, tunnelId: uuid, mode });
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

'@

Write-Host ''
Write-Host '  =========================================================='
Write-Host '    Automatic repair - server address'
Write-Host '  =========================================================='
Write-Host ''
Write-Host '  Nothing to type. This finds the problem and fixes it.'
Write-Host ''

# ------------------------------ پیدا کردنِ نصب ------------------------------
#  ⚠️ چرا [IO.Path]::Combine و نه Join-Path:
#  Join-Path از راهِ درایوهای PowerShell می‌رود و اگر درایوی مثلِ «F:» روی این
#  کامپیوتر نباشد، خطای «A drive with the name F does not exist» می‌دهد و
#  چون خطای خاتمه‌دهنده است، کلِ جست‌وجو همان‌جا می‌ایستد. Combine فقط رشته را
#  می‌چسباند و هیچ‌وقت خطا نمی‌دهد.
function Find-ServerDir {
  $tries = @()
  foreach ($root in @($env:USERPROFILE, "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Documents",
                      'C:\', 'D:\', 'E:\', 'F:\')) {
    if (-not $root) { continue }
    $tries += [IO.Path]::Combine($root, 'PumpServer\homelab-panel\server')
    $tries += [IO.Path]::Combine($root, 'homelab-panel\server')
  }
  if ($PSScriptRoot) { $tries += [IO.Path]::Combine((Split-Path -Parent $PSScriptRoot), 'server') }
  foreach ($dir in $tries) {
    try { if (Test-Path -LiteralPath ([IO.Path]::Combine($dir, 'src\index.js'))) { return $dir } } catch { }
  }
  return ''
}

function Find-NodeExe {
  param([string]$ServerDir)
  # اول Nodeی که کنارِ خودِ سرور نصب شده، بعد Nodeی سیستم
  foreach ($guess in @(
      [IO.Path]::Combine($ServerDir, 'nodejs\node.exe'),
      [IO.Path]::Combine((Split-Path -Parent (Split-Path -Parent $ServerDir)), 'nodejs\node.exe'))) {
    try { if ($guess -and (Test-Path -LiteralPath $guess)) { return $guess } } catch { }
  }
  try {
    $cmd = Get-Command 'node' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  } catch { }
  foreach ($name in @('ProgramFiles', 'ProgramW6432', 'ProgramFiles(x86)', 'LOCALAPPDATA')) {
    $root = [Environment]::GetEnvironmentVariable($name)
    if (-not $root) { continue }
    $guess = [IO.Path]::Combine($root, 'nodejs\node.exe')
    if (Test-Path -LiteralPath $guess) { return $guess }
  }
  return ''
}

$server = Find-ServerDir
if (-not $server) {
  Write-Host '  Could not find the server folder (PumpServer).'
  Write-Host '  Install the panel first, then run this again.'
  Write-Host ''
  Read-Host '  Press Enter to close' | Out-Null
  exit 1
}
Write-Host "  Found: $server"

$node = Find-NodeExe -ServerDir $server
if (-not $node) {
  Write-Host '  Node.js was not found on this computer.'
  Write-Host '  Install it from https://nodejs.org and run this again.'
  Write-Host ''
  Read-Host '  Press Enter to close' | Out-Null
  exit 1
}

# --------------------------- مغزِ کار: auto-fix.mjs -------------------------
$brain = ''
if ($PSScriptRoot) {
  $beside = [IO.Path]::Combine($PSScriptRoot, 'auto-fix.mjs')
  if (Test-Path -LiteralPath $beside) { $brain = [IO.File]::ReadAllText($beside) }
}
if (-not $brain) { $brain = $EmbeddedBrain }
if (-not $brain) {
  Write-Host '  The repair script is missing from this file.'
  Read-Host '  Press Enter to close' | Out-Null
  exit 1
}

$work = [IO.Path]::Combine($env:TEMP, 'panel-auto-fix.mjs')
# ⚠️ بدونِ BOM — Node فایلِ ماژول را با BOM هم می‌خواند ولی برخی نسخه‌ها نه
[IO.File]::WriteAllText($work, $brain, (New-Object Text.UTF8Encoding($false)))

Write-Host ''
Write-Host '  [1/3] Looking for the problem ...'
function Invoke-Brain {
  param([string[]]$NodeArgs)
  $text = & $node @NodeArgs 2>&1 | Out-String
  $found = ($text -split "`n" | Where-Object { $_ -match '##RESULT##' } | Select-Object -Last 1)
  if ($found) {
    try { return @{ raw = $text; data = (($found -replace '^.*##RESULT##', '').Trim() | ConvertFrom-Json) } } catch { }
  }
  return @{ raw = $text; data = $null }
}

# ⚠️ --disable-warning فقط از Node 21 به بعد هست. اگر Nodeی قدیمی‌تری روی این
#    کامپیوتر جلوتر پیدا شده باشد، همان پرچم کلِ اجرا را می‌خواباند و کاربر
#    فقط یک صفحهٔ خالی می‌بیند. پس یک بار هم بدونِ پرچم امتحان می‌شود.
$run = Invoke-Brain @('--disable-warning=ExperimentalWarning', $work, '--server', $server)
if (-not $run.data) { $run = Invoke-Brain @($work, '--server', $server) }
$raw = $run.raw
$result = $run.data
if (-not $result) {
  Write-Host '  The check did not finish. Raw output:'
  Write-Host $raw
  Read-Host '  Press Enter to close' | Out-Null
  exit 1
}

foreach ($s in $result.steps)    { Write-Host "      fixed:   $s" }
foreach ($b in $result.blockers) { Write-Host "      blocked: $b" }

# ------------------------- خاموش و روشن کردنِ سرور --------------------------
Write-Host '  [2/3] Restarting the server ...'
$dataDir = [IO.Path]::Combine($server, 'data')
$pidFile = [IO.Path]::Combine($dataDir, 'panel.pid')
if (Test-Path -LiteralPath $pidFile) {
  try {
    $panelPid = ([IO.File]::ReadAllText($pidFile)).Trim()
    if ($panelPid -match '^\d+$') { Stop-Process -Id ([int]$panelPid) -Force -ErrorAction SilentlyContinue }
  } catch { }
}
Start-Sleep -Seconds 2
$quiet = [IO.Path]::Combine($server, 'run-quiet.bat')
try {
  if (Test-Path -LiteralPath $quiet) {
    Start-Process -FilePath $quiet -WorkingDirectory $server -WindowStyle Hidden | Out-Null
  } else {
    Start-Process -FilePath $node -ArgumentList @('--disable-warning=ExperimentalWarning', 'src\index.js') `
      -WorkingDirectory $server -WindowStyle Hidden | Out-Null
  }
} catch {
  Write-Host "      could not start the server: $($_.Exception.Message)"
  Write-Host '      open the panel from its desktop shortcut instead.'
}

# ------------------------------ بررسیِ نهایی -------------------------------
#  ⚠️ تونل چند ده ثانیه طول می‌کشد تا به Cloudflare وصل شود. یک بار امتحان
#  کردن همیشه «هنوز نه» می‌دهد و کاربر فکر می‌کند درست نشده.
Write-Host '  [3/3] Checking the address from the internet (up to 3 minutes) ...'
$host_ = [string]$result.hostname
$liveOk = $false
$liveMsg = ''
if ($host_) {
  # ⚠️ هر تلاشِ ناموفق هم صبر دارد هم مهلتِ اتصال. با ۲۴ تلاش و مهلتِ ۸ ثانیه،
  #    بدترین حالت پنج دقیقه می‌شد — یعنی کاربر فکر می‌کرد فایل قفل کرده.
  for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 4
    try {
      $ping = Invoke-WebRequest -Uri "https://$host_/health" -TimeoutSec 6 -UseBasicParsing
      if ($ping.StatusCode -eq 200) { $liveOk = $true; break }
      $liveMsg = "HTTP $($ping.StatusCode)"
    } catch {
      $liveMsg = $_.Exception.Message
    }
    Write-Host '      still waiting ...'
  }
}

# ------------------------------ گزارشِ فارسی -------------------------------
function Esc($t) { [Net.WebUtility]::HtmlEncode([string]$t) }

$rows = ''
foreach ($s in $result.steps)    { $rows += "<li class='fix'>$(Esc $s)</li>" }
foreach ($b in $result.blockers) { $rows += "<li class='stop'>$(Esc $b)</li>" }
foreach ($n in $result.notes)    { $rows += "<li class='note'>$(Esc $n)</li>" }
if (-not $rows) { $rows = "<li class='note'>چیزی برای تعمیر پیدا نشد.</li>" }

$verdict = if ($liveOk) { 'آدرس بالا آمد ✅' }
           elseif ($result.blockers.Count) { 'یک کارِ دستی مانده ⛔' }
           else { 'تعمیر انجام شد، ولی آدرس هنوز جواب نداد ⏳' }
$verdictClass = if ($liveOk) { 'ok' } elseif ($result.blockers.Count) { 'bad' } else { 'wait' }

$tail = if ($liveOk) {
  "<p>سرور آماده است. در برنامهٔ اندروید همین نشانی را بگذارید:</p><p class='addr'>https://$(Esc $host_)</p>"
} elseif ($result.blockers.Count) {
  "<p>هرچه بالا با ⛔ نشان داده شده، از این فایل برنمی‌آید و باید یک بار در خودِ پنل انجام شود.</p>"
} else {
  "<p>تنظیمات درست شد ولی Cloudflare هنوز جواب نمی‌دهد. پنج دقیقه صبر کنید و این نشانی را باز کنید:</p>" +
  "<p class='addr'>https://$(Esc $host_)/health</p><p>اگر باز هم نشد، همین صفحه را برای مهندس بفرستید.</p>" +
  "<p class='dim'>آخرین پاسخ: $(Esc $liveMsg)</p>"
}

$html = @"
<!doctype html><html dir="rtl" lang="fa"><meta charset="utf-8">
<title>گزارشِ تعمیرِ خودکار</title>
<style>
 body{font-family:Tahoma,'Segoe UI',sans-serif;background:#F2F5FA;color:#101A2B;margin:0;padding:32px}
 .card{max-width:640px;margin:0 auto;background:#fff;border-radius:16px;padding:28px 32px;
       box-shadow:0 8px 28px rgba(16,26,43,.08)}
 h1{font-size:20px;margin:0 0 4px}
 .verdict{font-size:17px;font-weight:bold;padding:14px 16px;border-radius:12px;margin:18px 0}
 .ok{background:#E8F6EE;color:#0B6B3A} .bad{background:#FDECEC;color:#A81E1E}
 .wait{background:#FFF6E5;color:#8A5A00}
 ul{list-style:none;padding:0;margin:0} li{padding:10px 14px;border-radius:10px;margin-bottom:8px;font-size:14px}
 .fix{background:#EAF2FF;border-right:4px solid #0F62B4}
 .stop{background:#FDECEC;border-right:4px solid #C62828}
 .note{background:#F5F7FA;border-right:4px solid #C9D2E0;color:#4A5568}
 .addr{font-family:Consolas,monospace;direction:ltr;text-align:left;background:#101A2B;color:#8FD3FF;
       padding:12px 14px;border-radius:10px;font-size:15px}
 .dim{color:#7A8699;font-size:12px}
 .meta{color:#7A8699;font-size:12px;margin-top:22px;border-top:1px solid #E4E9F2;padding-top:14px}
</style>
<div class="card">
  <h1>گزارشِ تعمیرِ خودکار</h1>
  <div class="dim">$(Get-Date -Format 'yyyy-MM-dd HH:mm')</div>
  <div class="verdict $verdictClass">$verdict</div>
  <ul>$rows</ul>
  $tail
  <div class="meta">پوشهٔ سرور: $(Esc $result.server)<br>تونل: $(Esc $result.tunnelId)</div>
</div></html>
"@

# ⚠️ اگر مسیرِ دسکتاپ خالی برگردد (پروفایلِ غیرعادی)، Combine رشتهٔ بی‌ریشه
#    می‌سازد و نوشتن می‌خورد و کاربر هیچ گزارشی نمی‌بیند. پس پوشهٔ موقت هم هست.
$desk = [Environment]::GetFolderPath('Desktop')
if (-not $desk) { $desk = $env:TEMP }
$report = [IO.Path]::Combine($desk, 'گزارش-تعمیر.html')
try {
  [IO.File]::WriteAllText($report, $html, (New-Object Text.UTF8Encoding($false)))
} catch {
  $report = ''
}
# ⚠️ باز نشدنِ مرورگر نباید گزارش را «نبود» جلوه دهد — فایل نوشته شده و مسیرش
#    باید گفته شود، وگرنه کاربر فکر می‌کند هیچ گزارشی ساخته نشده.
if ($report) { try { Start-Process $report | Out-Null } catch { } }

Write-Host ''
Write-Host '  =========================================================='
if ($liveOk) {
  Write-Host '    DONE - the address is answering.'
  Write-Host "    https://$host_"
} elseif ($result.blockers.Count) {
  Write-Host '    One step is left that must be done in the panel.'
} else {
  Write-Host '    Repaired. The address may need a few more minutes.'
}
if ($report) {
  Write-Host '    A Persian report was saved here (open it to read the details):'
  Write-Host "    $report"
}
Write-Host '  =========================================================='
Write-Host ''
Read-Host '  Press Enter to close' | Out-Null
