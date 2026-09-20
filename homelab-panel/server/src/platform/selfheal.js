// ---------------------------------------------------------------------------
//  خودترمیمی — بندِ ۱۰.۳ی پرامپت: «سرویسِ مانیتورینگ هر روز چک کند همهٔ
//  وابستگی‌ها سالم‌اند؛ اگر چیزی حذف یا خراب شده بود، خودش دوباره نصب کند و به
//  من خبر دهد.»
//
//  دو تابع، بی هیچ زمان‌بندی (موتورِ اتوماسیون این را job می‌کند):
//      checkDependencies()  فهرستِ هر چیزی که نصبِ لینوکس لازم دارد، با ok/missing
//      repair()             آن‌چه پنل خودش می‌تواند (پوشه، دسترسی) همین‌جا درست
//                           می‌کند؛ ابزار و سرویسِ سیستمی را به install.sh
//                           می‌سپارد (`vill3n repair` = همان اسکریپت با --repair)
//
//  ⚠️ فقط لینوکس. روی ویندوز هیچ‌کدام از این‌ها معنا ندارد (نصب با فایلِ
//  نصبی است) و فهرست «not applicable» برمی‌گردد، نه یک ردیف قرمزِ دروغ.
//  ⚠️ ریشه از VILL3N_ROOT (پیش‌فرض /srv/vill3n) — همان که install.sh می‌نویسد.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { logEvent } from '../db.js';
import { raiseAlert, clearAlert } from '../control/alerts.js';

export const DEFAULT_ROOT = '/srv/vill3n';

/** ساختارِ بندِ ۳ی پرامپت — همان فهرستی که install.sh می‌سازد */
export const LAYOUT = [
  'core', 'sites', 'sites/clients', 'apps', 'desktop-apps', 'shared', 'data', 'data/core',
  'backups', 'backups/daily', 'backups/weekly', 'backups/monthly', 'backups/offsite-queue',
  'logs', 'logs/core', 'logs/core/install', 'secrets', 'docs',
];

/** ابزارهایی که نصب‌کننده می‌گذارد؛ «optional» یعنی نبودش هشدار است نه خرابی */
export const TOOLS = [
  { name: 'node', what: 'Node.js — خودِ پنل' },
  { name: 'git', what: 'به‌روزرسانی از مخزن' },
  { name: 'curl', what: 'دانلودها' },
  { name: 'caddy', what: 'HTTPS و مسیرِ دامنه' },
  { name: 'cloudflared', what: 'تونلِ Cloudflare', optional: true },
  { name: 'tailscale', what: 'دسترسیِ مدیریتیِ امن', optional: true },
  { name: 'ollama', what: 'مغزِ دستیارِ هوشمند', optional: true },
  { name: 'ufw', what: 'فایروال' },
  { name: 'fail2ban-client', what: 'Fail2ban' },
  { name: 'docker', what: 'Docker', optional: true },
  { name: 'sensors', what: 'lm-sensors — دما', optional: true },
  { name: 'smartctl', what: 'smartmontools — سلامتِ دیسک', optional: true },
];

/** سرویس‌های systemd؛ فقط آن‌هایی که ابزارشان هست سنجیده می‌شوند */
export const UNITS = [
  { name: 'vill3n-panel', what: 'خودِ پنل', tool: null },
  { name: 'caddy', what: 'Caddy', tool: 'caddy' },
  { name: 'fail2ban', what: 'Fail2ban', tool: 'fail2ban-client' },
  { name: 'cloudflared', what: 'تونل', tool: 'cloudflared', optional: true },
  { name: 'ollama', what: 'Ollama', tool: 'ollama', optional: true },
];

export function root() {
  return path.resolve(process.env.VILL3N_ROOT || DEFAULT_ROOT);
}

export function applicable() {
  return process.platform === 'linux';
}

function which(cmd) {
  for (const d of String(process.env.PATH || '').split(path.delimiter)) {
    try {
      const p = path.join(d, cmd);
      if (fs.statSync(p).isFile()) return p;
    } catch { /* بعدی */ }
  }
  for (const d of ['/usr/local/bin', '/usr/bin', '/usr/sbin', '/sbin', '/snap/bin']) {
    try {
      const p = path.join(d, cmd);
      if (fs.statSync(p).isFile()) return p;
    } catch { /* بعدی */ }
  }
  return null;
}

function run(cmd, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() });
    });
  });
}

async function unitState(name) {
  const systemctl = which('systemctl');
  if (!systemctl) return { known: false, active: null, enabled: null };
  const active = await run(systemctl, ['is-active', name]);
  const enabled = await run(systemctl, ['is-enabled', name]);
  const missing = /not-found|could not be found|No such file/i.test(`${active.stderr} ${enabled.stderr} ${enabled.stdout}`);
  return { known: !missing, active: active.stdout || 'unknown', enabled: enabled.stdout || 'unknown' };
}

function modeOf(p) {
  try { return fs.statSync(p).mode & 0o777; } catch { return null; }
}

/**
 * @returns {{ applicable: boolean, root: string, ok: boolean, items: object[], missing: object[] }}
 */
export async function checkDependencies() {
  const base = root();
  if (!applicable()) {
    return {
      applicable: false, root: base, ok: true, items: [], missing: [],
      note: 'خودترمیمیِ وابستگی‌ها فقط روی نصبِ لینوکس معنا دارد؛ روی این سیستم نصب با فایلِ نصبی است.',
    };
  }
  const items = [];
  const add = (item) => items.push(item);

  // ۱) پوشه‌ها
  for (const rel of LAYOUT) {
    const p = path.join(base, rel);
    add({ kind: 'folder', name: rel, path: p, ok: fs.existsSync(p), fix: 'mkdir', what: 'ساختارِ پوشه‌ها' });
  }
  // ۲) دسترسی‌ها
  const secretsMode = modeOf(path.join(base, 'secrets'));
  add({ kind: 'perm', name: 'secrets/', path: path.join(base, 'secrets'), ok: secretsMode === 0o700, expected: '700', actual: secretsMode == null ? null : secretsMode.toString(8), fix: 'chmod', what: 'پوشهٔ رازها' });
  const envFile = path.join(base, 'secrets', 'core.env');
  const envMode = modeOf(envFile);
  add({ kind: 'secret', name: 'secrets/core.env', path: envFile, ok: envMode != null && envMode === 0o600, expected: '600', actual: envMode == null ? null : envMode.toString(8), fix: envMode == null ? 'installer' : 'chmod', what: 'رازهای پنل' });
  // ۳) ابزارها
  for (const t of TOOLS) {
    const found = which(t.name);
    add({ kind: 'tool', name: t.name, ok: !!found, path: found, optional: !!t.optional, fix: 'installer', what: t.what });
  }
  // ۴) سرویس‌ها
  for (const u of UNITS) {
    if (u.tool && !which(u.tool)) continue;
    const st = await unitState(u.name);
    add({ kind: 'unit', name: u.name, ok: st.known && st.active === 'active', state: st, optional: !!u.optional, fix: st.known ? 'systemctl' : 'installer', what: u.what });
  }
  // ۵) خودِ کدِ پنل و CLI
  const panelDir = path.join(base, 'core', 'panel', 'homelab-panel', 'server');
  add({ kind: 'code', name: 'core/panel', path: panelDir, ok: fs.existsSync(path.join(panelDir, 'src', 'index.js')), fix: 'installer', what: 'کدِ پنل' });
  add({ kind: 'tool', name: 'vill3n', ok: !!which('vill3n') || fs.existsSync(path.join(base, 'bin', 'vill3n')), fix: 'installer', what: 'دستورِ vill3n' });

  const missing = items.filter((i) => !i.ok);
  const hard = missing.filter((i) => !i.optional);
  return { applicable: true, root: base, ok: hard.length === 0, items, missing, hardMissing: hard.length, checkedAt: Date.now() };
}

/** install.sh کجاست؟ (کنارِ کدِ پنل، همان‌جا که کلون شده) */
export function installerPath() {
  const base = root();
  for (const p of [
    path.join(base, 'core', 'panel', 'install.sh'),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..', 'install.sh'),
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * تعمیر. پوشه و دسترسی همین‌جا؛ ابزار/سرویس ⇒ install.sh --repair (root لازم).
 * @param {{ runInstaller?: boolean }} opts
 */
export async function repair({ runInstaller = true } = {}) {
  const before = await checkDependencies();
  if (!before.applicable) return { ...before, repaired: [], skipped: [], installer: null };

  const repaired = [];
  const skipped = [];
  const base = root();

  for (const item of before.missing) {
    try {
      if (item.kind === 'folder') {
        await fsp.mkdir(item.path, { recursive: true });
        repaired.push({ name: item.name, how: 'mkdir' });
      } else if (item.kind === 'perm') {
        await fsp.mkdir(item.path, { recursive: true });
        await fsp.chmod(item.path, 0o700);
        repaired.push({ name: item.name, how: 'chmod 700' });
      } else if (item.kind === 'secret' && item.fix === 'chmod') {
        await fsp.chmod(item.path, 0o600);
        repaired.push({ name: item.name, how: 'chmod 600' });
      } else if (item.kind === 'unit' && item.fix === 'systemctl') {
        const systemctl = which('systemctl');
        const r = systemctl ? await run(systemctl, ['restart', item.name], 30_000) : { ok: false, stderr: 'systemctl نیست' };
        if (r.ok) repaired.push({ name: item.name, how: 'systemctl restart' });
        else skipped.push({ name: item.name, why: r.stderr || 'restart نشد (root لازم است؟)' });
      } else {
        skipped.push({ name: item.name, why: 'کارِ نصب‌کننده است' });
      }
    } catch (e) {
      skipped.push({ name: item.name, why: e.message });
    }
  }

  // چیزهایی که فقط نصب‌کننده می‌تواند: یک بار، همه با هم
  let installer = null;
  const needsInstaller = skipped.some((s) => s.why === 'کارِ نصب‌کننده است');
  if (needsInstaller && runInstaller) {
    const script = installerPath();
    if (!script) installer = { ran: false, why: 'install.sh پیدا نشد' };
    else if (process.getuid && process.getuid() !== 0) installer = { ran: false, why: 'root لازم است — روی سرور «sudo vill3n repair» را بزنید', script };
    else installer = await runInstaller_(script, base);
  }

  const after = await checkDependencies();
  const result = { ...after, repaired, skipped, installer, before: { hardMissing: before.hardMissing } };
  if (repaired.length || installer?.ran) {
    const text = `خودترمیمی: ${repaired.length} مورد درست شد${installer?.ran ? ' + نصب‌کننده دوباره دوید' : ''}${after.hardMissing ? `؛ ${after.hardMissing} مورد هنوز مانده` : ''}`;
    try { logEvent(after.hardMissing ? 'warn' : 'info', 'selfheal', text); } catch { /* */ }
    try {
      raiseAlert({ key: 'selfheal', kind: 'selfheal', severity: after.hardMissing ? 'warn' : 'info', title: text, detail: repaired.map((r) => `${r.name} (${r.how})`).join('، ').slice(0, 900) });
      if (!after.hardMissing) clearAlert('selfheal');
    } catch { /* */ }
  }
  return result;
}

function runInstaller_(script, base) {
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', [script, '--repair', '--non-interactive'], {
      env: { ...process.env, VILL3N_ROOT: base },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 45 * 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ran: true, ok: code === 0, code, script, tail: out.split('\n').slice(-20).join('\n') });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ran: false, why: e.message, script });
    });
  });
}
