// ---------------------------------------------------------------------------
//  نسخه‌های Node.js (و پایتون) روی این ماشین
//
//  پنل از قبل پروسهٔ هر سایت را بالا می‌آورد و می‌خواباند (sites/process.js).
//  چیزی که نبود این است: «این پروژه با کدام Node اجرا شود؟»
//
//  ── چرا nvm صدا زده نمی‌شود ──────────────────────────────────────────────
//  nvm یک تابعِ پوسته است، نه یک برنامه؛ از داخلِ Node قابلِ فراخوانی نیست
//  مگر با بالا آوردنِ یک پوستهٔ لاگین که خودش هزار عارضه دارد. به‌جایش
//  نسخه‌ها را همان‌جایی که nvm و fnm و volta می‌گذارند پیدا می‌کنیم و مستقیم
//  به فایلِ اجراییِ node اشاره می‌کنیم. نتیجه یکی است و وابستگی‌اش صفر.
//
//  ── نصبِ نسخهٔ تازه ──────────────────────────────────────────────────────
//  بستهٔ رسمیِ nodejs.org دانلود و در پوشهٔ دادهٔ پنل باز می‌شود. هیچ‌چیزِ
//  سیستمی دست نمی‌خورد و برای همین به root نیاز ندارد — همان دلیلی که کلِ
//  این پنل بدونِ root کار می‌کند.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../lib/exec.js';
import { config } from '../config.js';

const T_VERSION = 6000;

/** جایی که پنل نسخه‌های خودش را نگه می‌دارد */
export function runtimeRoot() {
  return path.join(config.dataDir, 'runtimes', 'node');
}

/**
 * نسخهٔ Node معتبر: v22.13.0 یا 22.13.0
 * سخت‌گیری لازم است چون این رشته وارد مسیرِ فایل و آدرسِ دانلود می‌شود.
 */
const VERSION_RE = /^v?(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function normalizeVersion(value) {
  const m = VERSION_RE.exec(String(value ?? '').trim());
  return m ? `v${m[1]}.${m[2]}.${m[3]}` : null;
}

function fail(code, detail = null) {
  return { ok: false, error: code, detail };
}

/* -------------------------------------------------------------------------- */
/*  پیدا کردنِ نسخه‌های موجود                                                  */
/* -------------------------------------------------------------------------- */

const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);

/** مسیرهایی که ابزارهای رایج نسخه‌های Node را آن‌جا می‌گذارند */
function candidateRoots() {
  const home = os.homedir() || '';
  return [
    { root: runtimeRoot(), source: 'panel' },
    { root: path.join(home, '.nvm', 'versions', 'node'), source: 'nvm' },
    { root: path.join(home, '.local', 'share', 'fnm', 'node-versions'), source: 'fnm' },
    { root: path.join(home, '.volta', 'tools', 'image', 'node'), source: 'volta' },
  ];
}

/** فایلِ اجراییِ node داخلِ یک پوشهٔ نسخه، هرجا که باشد */
function binaryIn(dir) {
  const options = [
    path.join(dir, 'bin', exe('node')),        // لینوکس/مک، و nvm
    path.join(dir, exe('node')),               // ویندوز
    path.join(dir, 'installation', 'bin', exe('node')), // fnm
    path.join(dir, 'installation', exe('node')),
  ];
  return options.find((p) => fs.existsSync(p)) || null;
}

async function versionOf(binary) {
  const res = await run(binary, ['--version'], { timeout: T_VERSION });
  return res.ok ? res.stdout.trim() : null;
}

/**
 * همهٔ نسخه‌هایی که روی این ماشین در دسترس‌اند — به‌اضافهٔ همانی که خودِ
 * پنل با آن اجرا می‌شود (که همیشه هست و هرگز حذف نمی‌شود).
 */
export async function listNode() {
  const found = new Map(); // version -> row

  // ۱) نسخه‌ای که همین حالا پنل را می‌چرخاند
  found.set(process.version, {
    version: process.version,
    binary: process.execPath,
    source: 'system',
    removable: false,
    current: true,
  });

  // ۲) نسخه‌ای که در PATH است (ممکن است با بالایی فرق کند)
  const inPath = await run(exe('node'), ['--version'], { timeout: T_VERSION });
  if (inPath.ok) {
    const v = inPath.stdout.trim();
    if (!found.has(v)) {
      found.set(v, { version: v, binary: 'node', source: 'path', removable: false, current: false });
    }
  }

  // ۳) پوشه‌های ابزارهای مدیریتِ نسخه
  for (const { root, source } of candidateRoots()) {
    let entries;
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      continue; // این ابزار روی ماشین نیست
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const binary = binaryIn(path.join(root, entry.name));
      if (!binary) continue;
      const version = normalizeVersion(entry.name) || (await versionOf(binary));
      if (!version || found.has(version)) continue;
      found.set(version, {
        version,
        binary,
        source,
        removable: source === 'panel', // فقط چیزی که خودمان نصب کرده‌ایم
        current: false,
      });
    }
  }

  const items = [...found.values()].sort((a, b) => {
    const pa = (a.version.replace('v', '').split('.').map(Number));
    const pb = (b.version.replace('v', '').split('.').map(Number));
    return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2];
  });

  return { ok: true, items };
}

/** نسخهٔ npm کنارِ یک باینریِ node */
export async function npmVersionFor(binary) {
  const dir = path.dirname(binary === 'node' ? process.execPath : binary);
  const candidates = [
    path.join(dir, process.platform === 'win32' ? 'npm.cmd' : 'npm'),
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ];
  for (const npm of candidates) {
    const res = await run(npm, ['--version'], { timeout: T_VERSION });
    if (res.ok) return res.stdout.trim();
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  نصبِ نسخهٔ تازه                                                            */
/* -------------------------------------------------------------------------- */

function platformSlug() {
  const arch =
    process.arch === 'x64' ? 'x64'
      : process.arch === 'arm64' ? 'arm64'
        : process.arch === 'arm' ? 'armv7l'
          : null;
  if (!arch) return null;

  if (process.platform === 'linux') return { os: 'linux', arch, ext: 'tar.gz' };
  if (process.platform === 'darwin') return { os: 'darwin', arch, ext: 'tar.gz' };
  if (process.platform === 'win32') return { os: 'win', arch, ext: 'zip' };
  return null;
}

export function downloadUrlFor(version) {
  const v = normalizeVersion(version);
  const slug = platformSlug();
  if (!v || !slug) return null;
  return `https://nodejs.org/dist/${v}/node-${v}-${slug.os}-${slug.arch}.${slug.ext}`;
}

/**
 * نصب: دانلود، باز کردن، و اطمینان از اینکه واقعاً اجرا می‌شود.
 *
 * اگر هر مرحله شکست بخورد، پوشهٔ نیمه‌کاره پاک می‌شود — وگرنه دفعهٔ بعد
 * فهرست یک نسخهٔ خرابِ غیرقابلِ‌اجرا نشان می‌داد.
 */
export async function installNode(version, { onProgress } = {}) {
  const v = normalizeVersion(version);
  if (!v) return fail('invalid_version');

  const url = downloadUrlFor(v);
  if (!url) return fail('unsupported_platform', `${process.platform}/${process.arch}`);

  const root = runtimeRoot();
  const target = path.join(root, v);
  if (fs.existsSync(path.join(target, 'bin', exe('node'))) || fs.existsSync(path.join(target, exe('node')))) {
    return fail('already_installed');
  }

  await fsp.mkdir(root, { recursive: true });
  const archive = path.join(root, `.${v}.download`);

  try {
    onProgress?.({ phase: 'download', version: v });
    const res = await fetch(url);
    if (!res.ok) return fail('download_failed', `HTTP ${res.status}`);
    await fsp.writeFile(archive, Buffer.from(await res.arrayBuffer()));

    onProgress?.({ phase: 'extract', version: v });
    await fsp.mkdir(target, { recursive: true });

    // tar و unzip روی هر سیستمِ هدف موجودند؛ باز کردن با --strip-components
    // پوشهٔ اضافیِ «node-v22.13.0-linux-x64» را حذف می‌کند
    const extracted = process.platform === 'win32'
      ? await run('powershell.exe', ['-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${target}' -Force`], { timeout: 180000 })
      : await run('tar', ['-xzf', archive, '-C', target, '--strip-components=1'], { timeout: 180000 });

    if (!extracted.ok) return fail('extract_failed', extracted.stderr.slice(0, 300));

    // ویندوز: Expand-Archive پوشهٔ داخلی را نگه می‌دارد، پس یک سطح بالا می‌آوریم
    if (process.platform === 'win32' && !fs.existsSync(path.join(target, exe('node')))) {
      const inner = (await fsp.readdir(target)).find((d) => d.startsWith('node-'));
      if (inner) {
        const from = path.join(target, inner);
        for (const item of await fsp.readdir(from)) {
          await fsp.rename(path.join(from, item), path.join(target, item));
        }
        await fsp.rm(from, { recursive: true, force: true });
      }
    }

    const binary = binaryIn(target);
    if (!binary) return fail('extract_failed', 'باینریِ node پیدا نشد');

    const check = await versionOf(binary);
    if (!check) return fail('verify_failed');

    onProgress?.({ phase: 'done', version: v });
    return { ok: true, version: check, binary, source: 'panel' };
  } catch (e) {
    return fail('install_failed', String(e?.message || e).slice(0, 300));
  } finally {
    await fsp.rm(archive, { force: true }).catch(() => {});
    // پوشهٔ نیمه‌کاره نباید بماند
    if (!binaryIn(target)) await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
  }
}

export async function removeNode(version) {
  const v = normalizeVersion(version);
  if (!v) return fail('invalid_version');

  // فقط نسخه‌های خودِ پنل — nvm و سیستم مالِ ما نیستند
  const target = path.join(runtimeRoot(), v);
  if (!fs.existsSync(target)) return fail('not_found');

  await fsp.rm(target, { recursive: true, force: true });
  return { ok: true, version: v };
}

/* -------------------------------------------------------------------------- */
/*  پایتون                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * پایتون فقط خوانده می‌شود، نصب نمی‌شود.
 *
 * چرا: ساختِ پایتون از منبع یا نصبِ سیستمی هر دو به ابزارِ ساخت و root نیاز
 * دارند. نشان دادنِ نسخه‌های موجود و ساختِ venv برای پروژه‌ها بدونِ آن ممکن
 * است، و همان کاری است که واقعاً لازم می‌شود.
 */
export async function listPython() {
  const names = process.platform === 'win32'
    ? ['python.exe', 'python3.exe']
    : ['python3', 'python', 'python3.12', 'python3.11', 'python3.10'];

  const found = new Map();
  for (const name of names) {
    const res = await run(name, ['--version'], { timeout: T_VERSION });
    if (!res.ok) continue;
    const version = `${res.stdout}${res.stderr}`.trim().replace(/^Python\s+/i, '');
    if (!version || found.has(version)) continue;

    const where = await run(process.platform === 'win32' ? 'where' : 'which', [name], { timeout: T_VERSION });
    found.set(version, {
      version,
      binary: where.ok ? where.stdout.trim().split('\n')[0] : name,
      command: name,
    });
  }
  return { ok: true, items: [...found.values()] };
}

/** ساختِ محیطِ مجازی برای یک پوشهٔ پروژه */
export async function createVenv(pythonBinary, projectDir, { name = '.venv' } = {}) {
  if (!path.isAbsolute(projectDir)) return fail('invalid_path');
  if (!fs.existsSync(projectDir)) return fail('not_found');
  // نامِ venv وارد مسیر می‌شود، پس نباید از پوشه بیرون بزند
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) return fail('invalid_name');

  const target = path.join(projectDir, name);
  const res = await run(pythonBinary, ['-m', 'venv', target], { timeout: 180000 });
  if (!res.ok) return fail('venv_failed', `${res.stderr}`.trim().slice(0, 300) || null);
  return { ok: true, path: target };
}
