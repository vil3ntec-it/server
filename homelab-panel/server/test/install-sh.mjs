// ---------------------------------------------------------------------------
//  آزمونِ نصب‌کنندهٔ یک‌دستوره (install.sh) و دستورِ vill3n
//      node test/install-sh.mjs
//
//  چه چیزی سنجیده می‌شود (بی root، بی apt — با VILL3N_SKIP_SYSTEM=1):
//    • bash -n، --list-steps، پرسش از /dev/tty
//    • قطعِ وسطِ کار (VILL3N_STOP_AFTER) و ادامه: مرحله‌های قبلی تکرار نمی‌شوند
//    • نصبِ کامل: ساختارِ پوشه‌ها، secrets/core.env با ۶۰۰، کد کپی شده، CLI،
//      لاگ، و گزارشِ پایانی (با فهرستِ هر چیزی که نصب شد یا رد شد)
//    • اجرای دوباره: هیچ مرحله‌ای دوباره نمی‌دود و هیچ فایلی عوض نمی‌شود
//    • --repair: همهٔ مرحله‌ها دوباره، بی خرابی و بی بازنویسیِ رازها
//    • «vill3n status | backup | agent | repair» علیهِ پنلی که با همان
//      core.envِ نصب‌کننده بالا آمده
//
//  ⚠️ مسیرِ واقعیِ apt/systemd/ufw/caddy/ollama این‌جا سنجیدنی نیست (نه root
//  داریم نه اینترنتِ آزاد)؛ آن مسیر فقط bash -n و بازبینیِ خطی دارد. هر
//  مرحله‌ای که رد شده در گزارش «⏭ رد شد» می‌آید و همین آزمون می‌سنجدش، تا
//  «رد شد» هیچ‌وقت با «انجام شد» قاطی نشود.
// ---------------------------------------------------------------------------
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const INSTALLER = path.join(REPO, 'install.sh');
const PORT = Number(process.env.TEST_PORT || 4810);
const PUBLIC_PORT = PORT + 1;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vill3n-install-'));
const ROOT = path.join(tmp, 'srv');
//  ریشهٔ دومِ یک‌بارمصرف: «قطع وسطِ کار» باید روی نصبِ دست‌نخورده سنجیده شود،
//  وگرنه گزارشِ نصبِ اصلی آمیخته‌ای از «قبلاً» و «تازه» می‌شود و چیزی را ثابت نمی‌کند
const ROOT_RESUME = path.join(tmp, 'srv-resume');
const FAKE_SHOP = path.join(tmp, 'fake-shop');

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

// سرورِ حسابِ ساختگی — فقط شکلِ پوشه (src/index.js + node_modules + package.json) مهم است
fs.mkdirSync(path.join(FAKE_SHOP, 'server', 'src'), { recursive: true });
fs.mkdirSync(path.join(FAKE_SHOP, 'server', 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(FAKE_SHOP, 'server', 'src', 'index.js'), 'console.log("fake account server")\n');
fs.writeFileSync(path.join(FAKE_SHOP, 'server', 'package.json'), '{"name":"fake-account-server"}\n');

const baseEnv = {
  ...process.env,
  VILL3N_ROOT: ROOT,
  VILL3N_SKIP_SYSTEM: '1',
  VILL3N_PANEL_SRC: REPO,
  VILL3N_ACCOUNT_SRC: FAKE_SHOP,
  VILL3N_ADMIN_EMAIL: 'owner@example.com',
  VILL3N_DOMAIN: 'Example.COM',
  VILL3N_PANEL_PORT: String(PORT),
  VILL3N_PUBLIC_PORT: String(PUBLIC_PORT),
  VILL3N_RETRY_BASE: '0',
};

function runInstaller(extraEnv = {}, args = ['--non-interactive']) {
  const r = spawnSync('/bin/bash', [INSTALLER, ...args], { env: { ...baseEnv, ...extraEnv }, encoding: 'utf8', timeout: 300_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** درختِ پوشه با mtime — برای سنجشِ «هیچ‌چیز عوض نشد» (لاگ‌ها جدا) */
async function snapshot(dir, rel = '') {
  const out = {};
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (r === 'logs') continue;
    const full = path.join(dir, e.name);
    const st = await fsp.lstat(full);
    out[r] = `${st.isDirectory() ? 'd' : st.isSymbolicLink() ? 'l' : 'f'}:${st.mode & 0o777}:${st.isFile() ? st.size : 0}:${Math.floor(st.mtimeMs)}`;
    if (e.isDirectory() && !['node_modules', '.git'].includes(e.name)) Object.assign(out, await snapshot(full, r));
  }
  return out;
}

const countStarts = (log) => (log.match(/▶ /g) || []).length;
const diffOf = (a, b) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]);

try {
  console.log('\n۱) شکلِ اسکریپت');
  const syntax = spawnSync('/bin/bash', ['-n', INSTALLER], { encoding: 'utf8' });
  check('bash -n install.sh', syntax.status === 0, syntax.stderr);
  const list = spawnSync('/bin/bash', [INSTALLER, '--list-steps'], { encoding: 'utf8', env: baseEnv });
  const STEPS = list.stdout.trim().split(/\s+/);
  check('--list-steps فهرستِ مرحله‌ها را می‌دهد', STEPS.length >= 20 && STEPS[0] === 'detect_system', list.stdout);
  check('install.sh سرِ پرسش‌ها از /dev/tty می‌خواند، نه stdin (curl | bash)', /\/dev\/tty/.test(fs.readFileSync(INSTALLER, 'utf8')));

  console.log('\n۲) قطع وسطِ کار و ادامه (ریشهٔ جدا، نصبِ دست‌نخورده)');
  const resumeEnv = { VILL3N_ROOT: ROOT_RESUME };
  const cut = runInstaller({ ...resumeEnv, VILL3N_STOP_AFTER: 'gen_secrets' });
  check('با VILL3N_STOP_AFTER با کدِ ۷۵ بیرون می‌آید', cut.code === 75, `code=${cut.code}\n${cut.out.slice(-600)}`);
  const stateAfterCut = fs.readFileSync(path.join(ROOT_RESUME, '.install-state'), 'utf8').trim().split('\n');
  check('مرحله‌ها تا gen_secrets ثبت شده‌اند', stateAfterCut.at(-1) === 'gen_secrets' && stateAfterCut.length === STEPS.indexOf('gen_secrets') + 1, stateAfterCut.join(','));
  check('مرحلهٔ بعدی (کدِ پنل) هنوز نیامده', !fs.existsSync(path.join(ROOT_RESUME, 'core', 'panel', 'homelab-panel')));
  const cutEnvFile = path.join(ROOT_RESUME, 'secrets', 'core.env');
  const cutSecrets = fs.readFileSync(cutEnvFile, 'utf8');

  const resumed = runInstaller(resumeEnv);
  check('اجرای دوباره از همان‌جا کامل می‌شود', resumed.code === 0, resumed.out.slice(-800));
  check('مرحله‌های پیش از قطع تکرار نشدند',
    countStarts(cut.out) + countStarts(resumed.out) === STEPS.length
      && /gen_secrets — از قبل انجام شده/.test(resumed.out)
      && /detect_system — از قبل انجام شده/.test(resumed.out),
    `اول ${countStarts(cut.out)} + دوم ${countStarts(resumed.out)} ≠ ${STEPS.length}`);
  const stateResumed = fs.readFileSync(path.join(ROOT_RESUME, '.install-state'), 'utf8').trim().split('\n');
  check('فایلِ حالت همهٔ مرحله‌ها را دارد، به ترتیبِ --list-steps', stateResumed.join(' ') === STEPS.join(' '), stateResumed.join(' '));
  check('رازهای پیش از قطع دست نخوردند', fs.readFileSync(cutEnvFile, 'utf8') === cutSecrets);
  await fsp.rm(ROOT_RESUME, { recursive: true, force: true });

  console.log('\n۳) نصبِ کامل روی ریشهٔ خالی');
  const fresh = runInstaller();
  check('نصب با کدِ صفر تمام شد', fresh.code === 0, fresh.out.slice(-900));
  check('همهٔ مرحله‌ها یک بار دویدند', countStarts(fresh.out) === STEPS.length, String(countStarts(fresh.out)));
  for (const rel of ['core', 'sites/clients', 'apps', 'desktop-apps', 'shared', 'data/core', 'backups/daily', 'backups/weekly', 'backups/monthly', 'backups/offsite-queue', 'logs/core/install', 'secrets', 'docs']) {
    check(`پوشهٔ ${rel}`, fs.existsSync(path.join(ROOT, rel)) && fs.statSync(path.join(ROOT, rel)).isDirectory());
  }
  const envFile = path.join(ROOT, 'secrets', 'core.env');
  check('secrets/ با ۷۰۰', (fs.statSync(path.join(ROOT, 'secrets')).mode & 0o777) === 0o700);
  check('core.env با ۶۰۰', (fs.statSync(envFile).mode & 0o777) === 0o600);
  const envBefore = fs.readFileSync(envFile, 'utf8');
  const env = Object.fromEntries(envBefore.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  check('HLP_SECRET_KEY تصادفی (۶۴ hex)', /^[0-9a-f]{64}$/.test(env.HLP_SECRET_KEY || ''));
  check('رمزِ مدیرِ اولیه تصادفی و بلند', (env.HLP_ADMIN_PASSWORD || '').length >= 16 && env.HLP_ADMIN_USER === 'admin');
  check('دامنه پاک‌سازی شده (کوچک، بی www)', env.HLP_DOMAIN === 'example.com', env.HLP_DOMAIN);
  check('HLP_DATA_DIR · HLP_PORT · HLP_SITESYNC_PORT · HLP_TRUST_PROXY · HLP_ACCOUNT_DIR · HLP_OLLAMA_URL · HLP_BACKUP_ROOT',
    env.HLP_DATA_DIR === path.join(ROOT, 'data', 'core') && env.HLP_PORT === String(PORT) && env.HLP_SITESYNC_PORT === String(PUBLIC_PORT)
      && env.HLP_TRUST_PROXY === 'true' && env.HLP_ACCOUNT_DIR === path.join(ROOT, 'core', 'account-server', 'server')
      && env.HLP_OLLAMA_URL === 'http://127.0.0.1:11434' && env.HLP_BACKUP_ROOT === path.join(ROOT, 'backups'));
  check('مدلِ هوش مصنوعی از روی سخت‌افزار انتخاب شده', /^qwen2\.5:(1\.5b|3b|7b|14b)$/.test(env.HLP_AGENT_MODEL || ''), env.HLP_AGENT_MODEL);
  check('کدِ پنل کپی شده (بی .git)', fs.existsSync(path.join(ROOT, 'core', 'panel', 'homelab-panel', 'server', 'src', 'index.js')) && !fs.existsSync(path.join(ROOT, 'core', 'panel', '.git')));
  check('سرورِ حساب در core/account-server/server', fs.existsSync(path.join(ROOT, 'core', 'account-server', 'server', 'src', 'index.js')));
  const shim = path.join(ROOT, 'bin', 'vill3n');
  check('CLI زیرِ <ریشه>/bin نصب شده و اجرایی است', fs.existsSync(shim) && (fs.statSync(shim).mode & 0o111) !== 0);
  check('شیمِ CLI به bin/vill3n.mjs همین نصب اشاره می‌کند و VILL3N_ROOT را می‌برد',
    /bin\/vill3n\.mjs/.test(fs.readFileSync(shim, 'utf8')) && new RegExp(`VILL3N_ROOT="\\$\\{VILL3N_ROOT:-${ROOT}\\}"`).test(fs.readFileSync(shim, 'utf8')));
  check('لاگِ نصب در logs/core/install', fs.readdirSync(path.join(ROOT, 'logs', 'core', 'install')).some((f) => /^install-\d{8}-\d{6}\.log$/.test(f)));
  check('گزارشِ پایانی: پنل، نامِ کاربری، محلِ رمزِ اولیه و لاگ',
    /نصبِ VILL3N تمام شد/.test(fresh.out) && /نامِ کاربری:\s+admin/.test(fresh.out)
      && /HLP_ADMIN_PASSWORD/.test(fresh.out) && /لاگِ نصب:/.test(fresh.out) && /admin\.example\.com/.test(fresh.out));
  check('گزارش می‌گوید چه چیزی تازه نصب شد', /نصب شد\s+secrets/.test(fresh.out) && /نصب شد\s+panel/.test(fresh.out));
  check('و چه چیزی رد شد — هر هفت مرحلهٔ سیستمی',
    ['install_base', 'install_node', 'install_caddy', 'setup_systemd', 'setup_firewall', 'pull_model', 'start_panel']
      .every((s) => new RegExp(`رد شد\\s+${s}\\s+VILL3N_SKIP_SYSTEM=1`).test(fresh.out)));
  check('فایلِ گزارش کنارِ حالت نشست', fs.existsSync(path.join(ROOT, '.install-report')));

  console.log('\n۴) اجرای دوباره = هیچ کاری');
  const treeAfterFresh = await snapshot(ROOT);
  await new Promise((r) => setTimeout(r, 1100));
  const second = runInstaller();
  check('اجرای دوم موفق', second.code === 0, second.out.slice(-400));
  check('اجرای دوم هیچ مرحله‌ای را دوباره اجرا نکرد', countStarts(second.out) === 0);
  check('اجرای دوم همهٔ مرحله‌ها را «از قبل انجام شده» دید', (second.out.match(/از قبل انجام شده/g) || []).length === STEPS.length);
  //  تنها فایلی که مجاز است عوض شود .install-report است: متنش «این بار چه شد»
  //  را می‌گوید (تازه نصب شد ⇄ قبلاً انجام شده)، پس اجرای اول و دوم عمداً فرق دارند
  const afterSecond = await snapshot(ROOT);
  const changedBySecond = diffOf(treeAfterFresh, afterSecond);
  check('اجرای دوم جز گزارش هیچ فایلی را عوض یا اضافه نکرد', changedBySecond.every((k) => k === '.install-report'), changedBySecond.slice(0, 8).join(', '));
  check('رازها در اجرای دوم بازنویسی نشدند', fs.readFileSync(envFile, 'utf8') === envBefore);
  await new Promise((r) => setTimeout(r, 1100));
  const third = runInstaller();
  check('اجرای سوم موفق', third.code === 0, third.out.slice(-400));
  const afterThird = await snapshot(ROOT);
  const changedByThird = diffOf(afterSecond, afterThird);
  check('بینِ دو اجرای پیاپیِ «همه‌چیز از قبل هست» ذره‌ای عوض نمی‌شود (mtime هم)', changedByThird.length === 0, changedByThird.slice(0, 8).join(', '));

  console.log('\n۵) --repair همهٔ مرحله‌ها را دوباره می‌گذراند، بی خرابی');
  const repair = runInstaller({}, ['--repair', '--non-interactive']);
  check('--repair موفق', repair.code === 0, repair.out.slice(-400));
  check('در تعمیر همهٔ مرحله‌ها اجرا شدند', countStarts(repair.out) === STEPS.length);
  check('رازها در تعمیر هم دست نخورد', fs.readFileSync(envFile, 'utf8') === envBefore);
  check('کدِ کپی‌شده در تعمیر دوباره کپی نشد (present)', /هست\s+panel/.test(repair.out));

  console.log('\n۶) vill3n علیهِ پنلِ واقعی با همان core.env');
  const panelEnv = {
    ...process.env, ...env,
    HLP_HOST: '127.0.0.1', HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0',
    HLP_METRICS_INTERVAL: '900', HLP_BACKUP_CIPHER: 'aes',
  };
  const serverPath = path.join(ROOT, 'core', 'panel', 'homelab-panel', 'server', 'src', 'index.js');
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', serverPath], { env: panelEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let panelOut = '';
  child.stdout.on('data', (d) => (panelOut += d));
  child.stderr.on('data', (d) => (panelOut += d));
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${PORT}/health`)).ok; } catch { /* */ }
    if (!up) await new Promise((r) => setTimeout(r, 250));
  }
  check('پنل با core.envِ نصب‌کننده بالا آمد', up, panelOut.slice(-500));
  try {
    const r = await fetch(`http://127.0.0.1:${PUBLIC_PORT}/install.sh`);
    const text = await r.text();
    check('پورتِ عمومی /install.sh را می‌دهد (همان فایل)', r.ok && text === fs.readFileSync(INSTALLER, 'utf8') && /shellscript/.test(r.headers.get('content-type') || ''));

    const login = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: env.HLP_ADMIN_USER, password: env.HLP_ADMIN_PASSWORD }) });
    check('مدیرِ اولیه از HLP_ADMIN_USER/PASSWORD ساخته شده و وارد می‌شود', login.ok, String(login.status));

    const cli = (argv) => spawnSync('/bin/bash', [shim, ...argv], { encoding: 'utf8', env: { ...process.env, VILL3N_SKIP_SYSTEM: '1' }, timeout: 120_000 });
    const st = cli(['status', '--root', ROOT, '--json']);
    check('vill3n status اجرا می‌شود', st.status === 0, st.stdout.slice(-400) + st.stderr);
    check('status: پنل، پورتِ عمومی، رمزنگاری و وابستگی‌ها را می‌گوید', /پنل جواب می‌دهد/.test(st.stdout) && /پورتِ عمومی/.test(st.stdout) && /رمزنگاریِ پشتیبان/.test(st.stdout) && /وابستگی‌ها/.test(st.stdout));
    const jsonPart = st.stdout.slice(st.stdout.indexOf('{'));
    let report = null;
    try { report = JSON.parse(jsonPart); } catch { /* */ }
    check('--json خروجیِ ماشینی دارد', report?.panel?.ok === true && report?.detail?.backups?.encryption?.method === 'aes');

    const bk = cli(['backup', '--root', ROOT]);
    check('vill3n backup پشتیبان می‌گیرد', bk.status === 0 && /کتابخانه: backup-/.test(bk.stdout), bk.stdout + bk.stderr);
    check('پشتیبان در <ریشه>/backups/manual نشست', fs.readdirSync(path.join(ROOT, 'backups', 'manual')).some((f) => f.startsWith('backup-')));
    check('آرشیوِ رمزشده در backups/offsite-queue', fs.readdirSync(path.join(ROOT, 'backups', 'offsite-queue')).some((f) => f.endsWith('.zip.enc')));
    check('کلیدِ رمزنگاری در secrets/ با ۶۰۰', (fs.statSync(path.join(ROOT, 'secrets', 'backup.aes.key')).mode & 0o777) === 0o600);

    const ag = cli(['agent', 'off', '--root', ROOT]);
    check('vill3n agent off', ag.status === 0 && /خاموش شد/.test(ag.stdout), ag.stdout + ag.stderr);
    const rp = cli(['repair', '--root', ROOT]);
    check('vill3n repair: پنل و نصب‌کننده هر دو می‌دوند', rp.status === 0 && /نصب‌کننده همهٔ مرحله‌ها را دوباره گذراند/.test(rp.stdout), rp.stdout.slice(-600) + rp.stderr);
    const bad = cli(['nope', '--root', ROOT]);
    check('دستورِ ناشناخته کدِ ۲', bad.status === 2);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 800));
    child.kill('SIGKILL');
  }
} finally {
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n  ${passed} سبز، ${failed} سرخ\n`);
process.exit(failed ? 1 : 0);
