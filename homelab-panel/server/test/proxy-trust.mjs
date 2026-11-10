// ---------------------------------------------------------------------------
//  آزمونِ «سرآیندِ پراکسی فقط از خودِ پراکسی» (۱.۵۰.۸۴)
//      node test/proxy-trust.mjs
//
//  یافته (بازبینیِ خصمانهٔ استقرار): `install.sh` در هر نصبِ home/vps
//  ‎HLP_TRUST_PROXY=true‎ می‌نویسد، و با آن `clientIp` سرآیندِ ‎X-Forwarded-For‎ را
//  از **هر** همتا باور می‌کرد — در حالی که درِ پنل (۴۷۰۰) در خانه مستقیم از شبکهٔ
//  خانه باز است و هیچ پراکسی‌ای جلویش نیست. پس هر دستگاهِ همان شبکه با یک IPِ
//  ساختگیِ تازه در هر درخواست سقفِ ورود (۱۰ در ۵ دقیقه) را هرگز نمی‌دید: حدسِ
//  بی‌پایانِ رمزِ پنل، و IPِ دروغ در دفترِ رخداد. Caddy و تونلی که همان install.sh
//  می‌گذارد هر دو از لوپ‌بک می‌رسند و سرآیندشان بی این تنظیم هم باور می‌شد.
//
//  ۱) خواندنِ تنظیم (`resolveDeploy`): از کدام همتا — خالص
//  ۲) `clientIp`، ‎HSTS‎ و ‎trust proxy‎ ِ Express زیرِ هر نمایه — در پروسهٔ جدا
//  ۳) پنلِ واقعی با ‎HLP_TRUST_PROXY=true‎، ورود از نشانیِ غیرِ لوپ‌بکِ همین
//     کامپیوتر (همان «دستگاهِ شبکهٔ خانه») با ‎X-Forwarded-For‎ ِ چرخان؛ و مالک
//     از راهِ دیگر قفل نمی‌شود
// ---------------------------------------------------------------------------
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveDeploy } from '../src/deploy.js';

const SRC = path.join(import.meta.dirname, '..', 'src');
let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 400) : ''}`); }
};
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-proxy-trust-'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ─────────────────────── ۱) از کدام همتا — خالص ─────────────────────── */
console.log('── ۱) HLP_TRUST_PROXY: از کدام همتا ──');
{
  const home = resolveDeploy({});
  check('home بی تنظیم: خاموش، هیچ همتای غیرِ لوپ‌بکی', home.trustProxy === false && same(home.trustProxyFrom, []),
    JSON.stringify([home.trustProxy, home.trustProxyFrom]));
  const homeOn = resolveDeploy({ HLP_TRUST_PROXY: 'true' });
  check('⛔ home + true (همان install.sh): روشن ولی فقط پراکسیِ همین کامپیوتر (لوپ‌بک)',
    homeOn.trustProxy === true && same(homeOn.trustProxyFrom, []), JSON.stringify(homeOn.trustProxyFrom));
  const vpsOn = resolveDeploy({ HLP_DEPLOY: 'vps', HLP_TRUST_PROXY: '1', HLP_DOMAIN: 'e.com', HLP_SECRET_KEY: 'k' });
  check('⛔ vps + 1: فقط لوپ‌بک (Caddy ِ install.sh روی همین سرور است)', vpsOn.trustProxy === true && same(vpsOn.trustProxyFrom, []),
    JSON.stringify(vpsOn.trustProxyFrom));
  const list = resolveDeploy({ HLP_TRUST_PROXY: '192.168.1.10, 10.9.0.0/16' });
  check('home + فهرستِ نشانی: فقط همان پراکسی‌ها', list.trustProxy === true && same(list.trustProxyFrom, ['192.168.1.10', '10.9.0.0/16']),
    JSON.stringify(list.trustProxyFrom));
  const dk = resolveDeploy({ HLP_DEPLOY: 'docker', HLP_DOMAIN: 'e.com', HLP_SECRET_KEY: 'k' });
  check('docker پیش‌فرض: هر همتا (درِ کانتینر فقط از راهِ Caddy ِ compose می‌رسد) — بی تغییر',
    dk.trustProxy === true && dk.trustProxyFrom === 'any', JSON.stringify(dk.trustProxyFrom));
  const paas = resolveDeploy({ HLP_DEPLOY: 'paas' });
  check('paas پیش‌فرض: هر همتا (لودبالانسرِ سکو) — بی تغییر', paas.trustProxy === true && paas.trustProxyFrom === 'any');
  const dkList = resolveDeploy({ HLP_DEPLOY: 'docker', HLP_TRUST_PROXY: '172.18.0.0/16', HLP_DOMAIN: 'e.com', HLP_SECRET_KEY: 'k' });
  check('docker + فهرست: تنگ‌تر، فقط همان شبکه', same(dkList.trustProxyFrom, ['172.18.0.0/16']), JSON.stringify(dkList.trustProxyFrom));
  const off = resolveDeploy({ HLP_DEPLOY: 'docker', HLP_TRUST_PROXY: '0', HLP_DOMAIN: 'e.com', HLP_SECRET_KEY: 'k' });
  check('HLP_TRUST_PROXY=0: خاموش، هیچ همتا', off.trustProxy === false && same(off.trustProxyFrom, []));
  //  معنای قدیمِ متغیر دست نخورد (RULES: «فقط 0 خاموش است») — تنگ شدن در «از کدام همتا»ست
  check('HLP_TRUST_PROXY="" همان معنای قدیم (روشن)، و روی home باز هم فقط لوپ‌بک',
    resolveDeploy({ HLP_TRUST_PROXY: '' }).trustProxy === true && same(resolveDeploy({ HLP_TRUST_PROXY: '' }).trustProxyFrom, []));
}

/* ──────────── ۲) clientIp و HSTS و Express، زیرِ هر نمایه ──────────── */
console.log('\n── ۲) clientIp · HSTS · trust proxy ِ Express ──');
const securityUrl = pathToFileURL(path.join(SRC, 'platform', 'security.js')).href;
const expressUrl = pathToFileURL(path.join(import.meta.dirname, '..', 'node_modules', 'express', 'index.js')).href;
const PROBE = `
const { clientIp, secureHeaders, proxyTrustSetting } = await import(${JSON.stringify(securityUrl)});
const fake = (sock, h = {}) => ({ socket: { remoteAddress: sock }, headers: h, secure: false });
const hsts = (sock, h) => { const set = {}; secureHeaders(fake(sock, h), { setHeader: (k, v) => { set[k.toLowerCase()] = v; } }, () => {}); return Boolean(set['strict-transport-security']); };
const cases = JSON.parse(process.env.PROBE_CASES);
let express = null;
try {
  const { default: e } = await import(${JSON.stringify(expressUrl)});
  const app = e();
  const setting = typeof proxyTrustSetting === 'function' ? proxyTrustSetting() : true;
  app.set('trust proxy', setting);
  express = app.get('trust proxy fn');
} catch (err) { console.error(err.message); }
console.log(JSON.stringify(cases.map(([sock, h]) => ({
  ip: clientIp(fake(sock, h)), hsts: hsts(sock, h), expressTrusts: express ? express(sock.replace(/^::ffff:/, ''), 0) : null,
}))));
`;
function probe(env, cases) {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', PROBE], {
    env: {
      ...process.env, HLP_DEPLOY: '', HLP_TRUST_PROXY: undefined, HLP_DATA_DIR: path.join(tmp, 'probe-data'),
      ...env, PROBE_CASES: JSON.stringify(cases),
    },
    encoding: 'utf8', timeout: 20000,
  });
  try { return JSON.parse(String(r.stdout).trim().split('\n').pop()); } catch { return { error: (r.stderr || r.stdout || '').slice(0, 300) }; }
}
const LAN = '192.168.1.50';
const FORGED = { 'x-forwarded-for': '198.51.100.7', 'x-forwarded-proto': 'https' };
{
  const [lan, loop, cf] = probe({ HLP_TRUST_PROXY: 'true' }, [[LAN, FORGED], ['127.0.0.1', FORGED], ['::ffff:127.0.0.1', { 'cf-connecting-ip': '203.0.113.5' }]]);
  check('⛔ home + true: دستگاهِ شبکهٔ خانه با X-Forwarded-For ِ ساختگی همان IPِ خودش را دارد', lan?.ip === LAN, JSON.stringify(lan));
  check('⛔ home + true: X-Forwarded-Proto ِ ساختگی از شبکهٔ خانه HSTS نمی‌گیرد', lan?.hsts === false, JSON.stringify(lan));
  check('⛔ home + true: Express هم همتای شبکهٔ خانه را پراکسی نمی‌شمارد (req.ip/req.secure)', lan?.expressTrusts === false, JSON.stringify(lan));
  check('home + true: Caddy/تونل از لوپ‌بک — سرآیند باور می‌شود (IPِ واقعیِ کاربر)', loop?.ip === '198.51.100.7' && loop?.hsts === true && loop?.expressTrusts === true, JSON.stringify(loop));
  check('home + true: CF-Connecting-IP از لوپ‌بکِ دوپشته', cf?.ip === '203.0.113.5', JSON.stringify(cf));

  const [lan2] = probe({}, [[LAN, FORGED]]);
  check('home بی تنظیم: همان رفتارِ امروز (سرآیند از شبکهٔ خانه باور نمی‌شود)', lan2?.ip === LAN && lan2?.hsts === false, JSON.stringify(lan2));

  const [proxyPeer, other] = probe({ HLP_TRUST_PROXY: '192.168.1.10' }, [['192.168.1.10', FORGED], [LAN, FORGED]]);
  check('فهرستِ نشانی: پراکسیِ گفته‌شده باور می‌شود', proxyPeer?.ip === '198.51.100.7' && proxyPeer?.expressTrusts === true, JSON.stringify(proxyPeer));
  check('فهرستِ نشانی: همسایهٔ دیگرِ همان شبکه نه', other?.ip === LAN && other?.hsts === false && other?.expressTrusts === false, JSON.stringify(other));

  const [dk] = probe({ HLP_DEPLOY: 'docker', HLP_DOMAIN: 'e.com', HLP_SECRET_KEY: 'k' }, [['172.18.0.5', FORGED]]);
  check('docker: Caddy از شبکهٔ کانتینر — همان رفتارِ امروز (باور می‌شود)', dk?.ip === '198.51.100.7' && dk?.hsts === true && dk?.expressTrusts === true, JSON.stringify(dk));
}

/* ─────── ۳) پنلِ واقعی: حدسِ رمز از شبکهٔ خانه با IPِ چرخان ─────── */
console.log('\n── ۳) پنلِ واقعی با HLP_TRUST_PROXY=true (همان install.sh) ──');
const lanIp = Object.values(os.networkInterfaces()).flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))?.address;
check('این کامپیوتر نشانیِ غیرِ لوپ‌بک دارد (همتای «شبکهٔ خانه»)', Boolean(lanIp), 'بی کارتِ شبکه این بخش سنجیده نمی‌شود');
const PORT = Number(process.env.TEST_PORT || 4862);
const OWNER_PASS = 'Owner-Pass-2026!x';
let child = null;
let out = '';
if (lanIp) {
  fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(SRC, 'index.js')], {
    env: {
      ...process.env,
      HLP_DEPLOY: 'home', HLP_TRUST_PROXY: 'true',
      HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '0.0.0.0',
      //  نشانیِ همین کامپیوتر «شبکهٔ خانه» شمرده شود (روی CI خودش 10.x است)
      HLP_PANEL_NETS: `${lanIp}/32`,
      HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_SITESYNC: '0', HLP_DISCOVERY: '0', HLP_ACCOUNT_API: '0',
      HLP_ADMIN_USER: 'owner', HLP_ADMIN_PASSWORD: OWNER_PASS,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const login = (base, body, headers = {}) => fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
try {
  if (lanIp) {
    const LOOP = `http://127.0.0.1:${PORT}`;
    const VIA_LAN = `http://${lanIp}:${PORT}`;
    let up = false;
    for (const end = Date.now() + 25000; Date.now() < end;) {
      try { if ((await fetch(`${LOOP}/health`)).ok) { up = true; break; } } catch { /* هنوز */ }
      await wait(200);
    }
    if (!up) throw new Error(`پنل بالا نیامد:\n${out.slice(-1500)}`);
    const reach = await fetch(`${VIA_LAN}/health`).then((r) => r.ok, () => false);
    check('درِ پنل از نشانیِ شبکهٔ خانه می‌رسد (نگهبانِ LAN راه می‌دهد)', reach);

    let blocked = 0;
    for (let i = 0; i < 25; i++) {
      const r = await login(VIA_LAN, { username: 'owner', password: `guess-${i}` }, { 'x-forwarded-for': `198.51.100.${i + 1}` });
      if (r.status === 429) blocked++;
    }
    check('⛔ ۲۵ حدسِ رمز از یک دستگاهِ شبکهٔ خانه با X-Forwarded-For ِ چرخان ⇒ سقفِ ورود می‌گیرد', blocked >= 10, `${blocked} از ۲۵ مسدود`);

    const ok = await login(LOOP, { username: 'owner', password: OWNER_PASS });
    const okBody = await ok.json().catch(() => ({}));
    check('مالک از راهِ دیگر (همین کامپیوتر) قفل نشده — ورودِ درست ۲۰۰', ok.status === 200 && Boolean(okBody.token), `status ${ok.status}`);

    if (okBody.token) {
      const audit = await fetch(`${LOOP}/api/audit?source=panel&limit=100`, { headers: { authorization: `Bearer ${okBody.token}` } })
        .then((r) => r.json()).catch(() => ({}));
      const fails = (audit.rows || []).filter((r) => r.action === 'panel.login' && r.result !== 'ok');
      check('دفترِ رخداد: ورودهای ناموفق با IPِ واقعیِ دستگاه، نه IPِ ساختگی',
        fails.length > 0 && fails.every((r) => r.ip === lanIp), JSON.stringify(fails.slice(0, 3).map((r) => r.ip)));
    }
  }
} catch (e) {
  check('اجرای بخشِ ۳', false, e.message);
} finally {
  child?.kill('SIGTERM');
  await wait(300);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed ? '❌' : '✅'} proxy-trust: ${passed} درست، ${failed} نادرست`);
process.exit(failed ? 1 : 0);
