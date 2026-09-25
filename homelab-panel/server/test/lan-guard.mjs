// ---------------------------------------------------------------------------
//  درِ پنل به شبکهٔ خانه — و فقط شبکهٔ خانه (۱۴۰۵/۰۷/۱۳)
//      node test/lan-guard.mjs
//
//  گزارشِ صاحب سامانه: «برنامهٔ پمپ به سرور نمی‌رسد و خانه‌اش سبز نمی‌شود.»
//  ریشه: مرکز فرمانِ ویندوز پنل را با ‎HLP_HOST=127.0.0.1‎ بالا می‌آورد، پس
//  برنامهٔ پمپ روی کامپیوترِ دیگر و گوشیِ کارمند هیچ‌وقت نمی‌رسیدند. این آزمون:
//    ۱) تعریفِ «شبکهٔ خانه» (خالص)
//    ۲) تصمیمِ ‎listenHost‎ — پوستهٔ کهنهٔ ویندوز ⇒ روی شبکه
//    ۳) قاعده‌های دیوارِ آتشِ ویندوز (خالص)
//    ۴) پنلِ واقعی: بیرون از شبکهٔ خانه ⇒ اتصال پیش از هر بایتی بسته؛
//       خودِ کامپیوتر همیشه باز؛ ‎HLP_PANEL_NETS‎ شبکهٔ غیرعادی را باز می‌کند؛
//       و ثبتِ پمپ همان تعریف را دارد.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { isLocalPeer, parseCidr, extraNetsFromEnv, LOCAL_NETS } from '../src/lib/lan-guard.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m + (d ? ' — ' + d : '')); } };

console.log('── ۱) «شبکهٔ خانه» یک تعریف دارد');
for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.5',
  '::ffff:192.168.1.5', '100.101.102.103', '169.254.3.4', 'fd12:3456::1', 'fe80::1']) {
  ok(isLocalPeer(a), `${a} خانه است`);
}
for (const a of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', '100.128.0.1', '2001:4860::8888', '192.0.2.2', '', 'x', '::ffff:8.8.8.8']) {
  ok(!isLocalPeer(a), `${a || '(خالی)'} خانه نیست`);
}
ok(isLocalPeer('192.0.2.2', ['192.0.2.0/24']), 'HLP_PANEL_NETS شبکهٔ غیرعادی را می‌افزاید');
ok(parseCidr('1.2.3.4/33') === null && parseCidr('nope') === null, 'CIDRِ بدشکل پذیرفته نمی‌شود');
ok(extraNetsFromEnv({ HLP_PANEL_NETS: '192.0.2.0/24, bad, 203.0.113.7' }).length === 2, 'مقدارِ بدِ HLP_PANEL_NETS دور ریخته می‌شود');
ok(LOCAL_NETS.every((c) => parseCidr(c)), 'فهرستِ پیش‌فرض همه‌اش خوانا است');

console.log('── ۲) پنل روی کدام کارت گوش می‌دهد');
const { listenHost } = await import('../src/config.js');
ok(listenHost({}) === '0.0.0.0', 'پیش‌فرض: شبکه');
ok(listenHost({ HLP_HOST: '127.0.0.1', HLP_APP_LAYOUT: 'packaged' }) === '0.0.0.0',
  '⛔ پوستهٔ کهنهٔ ویندوز ‎127.0.0.1‎ می‌گوید ⇒ سرور خودش روی شبکه باز می‌کند');
ok(listenHost({ HLP_HOST: '127.0.0.1', HLP_APP_LAYOUT: 'packaged', HLP_LAN_ACCESS: '0' }) === '127.0.0.1',
  '«نه»ی صریحِ کاربر (lanAccess=false) احترام دارد');
ok(listenHost({ HLP_HOST: '127.0.0.1' }) === '127.0.0.1', 'HLP_HOSTی که کسی خودش گذاشته (بیرونِ ویندوز) دست نمی‌خورد');
ok(listenHost({ HLP_HOST: '10.0.0.5', HLP_APP_LAYOUT: 'packaged' }) === '10.0.0.5', 'نشانیِ صریحِ دیگر دست نمی‌خورد');
const shell = fs.readFileSync(path.join(root, '..', 'desktop', 'app', 'main-impl.js'), 'utf8');
ok(!/HLP_HOST: '127\.0\.0\.1'/.test(shell), '⛔ پوستهٔ ویندوز دیگر ‎127.0.0.1‎ِ ثابت نمی‌دهد');
ok(/HLP_HOST: listenHost\(\)/.test(shell) && /HLP_LAN_ACCESS:/.test(shell), 'پوسته تصمیم را از تنظیمات می‌گیرد و «نه» را به سرور هم می‌رساند');

console.log('── ۳) دیوارِ آتشِ ویندوز');
const fw = await import('../../desktop/app/firewall.js');
const rules = fw.firewallRules({ panelPort: 4700, publicPort: 4701, discoveryPort: 4702 });
ok(rules.length === 3 && rules.some((r) => r.protocol === 'UDP' && r.port === 4702), 'سه قاعده: پنل، پورتِ عمومی، کشفِ UDP');
const cmd = fw.firewallCommand(rules);
ok(/remoteip=localsubnet/.test(cmd) && !/remoteip=any/.test(cmd), '⛔ فقط همان زیرشبکه، نه اینترنت');
ok(/profile=any/.test(cmd), 'روی وای‌فایی هم که ویندوز «عمومی» علامتش زده کار می‌کند');
ok(/^[\x20-\x7e]+$/.test(cmd), 'دستور تمام ASCII است (cmd/powershell نویسهٔ دیگر را خراب می‌کنند)');
ok((cmd.match(/delete rule/g) || []).length === 3, 'قاعدهٔ همنامِ کهنه اول پاک می‌شود (پورتِ عوض‌شده دو قاعده نمی‌سازد)');
ok(fw.rulesPresent(rules.map((r) => 'Rule Name: ' + r.name).join('\n'), rules) && !fw.rulesPresent('', rules), 'بودنِ قاعده‌ها درست خوانده می‌شود');
ok(/ensureFirewall\(/.test(shell) && /state\.firewallAsked/.test(shell), 'پوسته در هر اجرا حداکثر یک بار می‌پرسد');

console.log('── ۴) پنلِ واقعی');
const lan = Object.values(os.networkInterfaces()).flat().find((n) => n && n.family === 'IPv4' && !n.internal)?.address;
if (!lan) {
  console.log('  ⏭ کارتِ شبکه‌ای نیست — بخشِ ۴ رد شد');
} else {
  const port = 4860 + Math.floor(Math.random() * 40);
  const start = (nets) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'languard-'));
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
      cwd: root, stdio: 'ignore',
      env: { ...process.env, HLP_PORT: String(port), HLP_HOST: '0.0.0.0', HLP_DATA_DIR: path.join(tmp, 'data'),
        HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0', HLP_TUNNEL: '0', HLP_AI_ENABLED: '0',
        HLP_ACCOUNT_API: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_DISCOVERY: '0',
        HLP_PANEL_NETS: nets },
    });
    return p;
  };
  const get = async (host, pth = '/health', init) => {
    try { const r = await fetch(`http://${host}:${port}${pth}`, { ...init, signal: AbortSignal.timeout(3000) }); return r.status; }
    catch { return 0; }
  };
  const up = async () => { for (let i = 0; i < 100; i++) { if (await get('127.0.0.1')) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
  const privateLan = isLocalPeer(lan);

  let p = start('');
  ok(await up(), 'پنل روی 0.0.0.0 بالا آمد');
  ok((await get('127.0.0.1')) === 200, 'خودِ همین کامپیوتر همیشه باز است');
  if (privateLan) {
    ok((await get(lan)) === 200, `نشانیِ شبکهٔ خانه (${lan}) باز است`);
  } else {
    //  اتصالِ خام: نگهبان پیش از هر بایتی می‌بندد
    const closedFast = await new Promise((resolve) => {
      const s = net.connect(port, lan);
      let got = '';
      s.on('data', (d) => { got += d; });
      s.on('connect', () => s.write('GET /health HTTP/1.1\r\nHost: x\r\n\r\n'));
      s.on('close', () => resolve(got.length === 0));
      s.on('error', () => resolve(true));
      setTimeout(() => { s.destroy(); resolve(false); }, 3000);
    });
    ok(closedFast, `⛔ ${lan} شبکهٔ خانه نیست ⇒ اتصال پیش از هر بایتی بسته شد`);
    const enroll = await get(lan, '/api/stations/enroll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"code":"x1"}' });
    ok(enroll === 0, 'و ثبتِ پمپ هم از همان در نمی‌رسد', String(enroll));
  }
  p.kill(); await new Promise((r) => p.once('exit', r));

  if (!privateLan) {
    p = start(`${lan}/32`);
    ok(await up(), 'پنل با HLP_PANEL_NETS بالا آمد');
    ok((await get(lan)) === 200, `HLP_PANEL_NETS ⇒ ${lan} باز است`);
    const r = await fetch(`http://${lan}:${port}/api/stations/enroll`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'lan-guard-1', name: 'آزمون' }), signal: AbortSignal.timeout(4000),
    }).catch(() => null);
    const body = r ? await r.json().catch(() => ({})) : {};
    ok(r?.ok && body.token, '⛔ ثبتِ پمپ همان تعریفِ «شبکهٔ خانه» را دارد (دو فهرست نیست)', r ? `${r.status} ${JSON.stringify(body).slice(0, 120)}` : 'بی جواب');
    p.kill(); await new Promise((r2) => p.once('exit', r2));
  }
}

console.log(`\n${fail ? '❌' : '✅'} ${pass} موفق، ${fail} ناموفق`);
process.exit(fail ? 1 : 0);
