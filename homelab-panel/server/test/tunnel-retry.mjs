// ---------------------------------------------------------------------------
//  آزمون: تونل هیچ‌وقت نباید بی‌صدا از تلاش دست بکشد
//      node test/tunnel-retry.mjs
//
//  خرابی‌ای که این‌جا گرفته می‌شود، ساکت‌ترین حالتِ «سرور بالاست ولی به تونل
//  نمی‌رسد» بود:
//
//    ۱) cloudflared با کد ۱ می‌مرد (فایلِ اعتبار سرِ جایش نبود)
//    ۲) پنل تشخیص می‌داد که «قابلِ تعمیر» است و repairTunnel را صدا می‌زد
//    ۳) repairTunnel فایل را پیدا نمی‌کرد — ولی خطا **پرتاب نمی‌کرد**، فقط
//       {ok:false} برمی‌گرداند
//    ۴) و مسیرِ تعمیر با `return` تمام می‌شد: نه پروسه‌ای مانده بود، نه
//       تایمرِ تلاشِ دوباره‌ای گذاشته شده بود
//
//  نتیجه: تونل تا راه‌اندازیِ بعدیِ کلِ پنل مرده می‌ماند، بی‌آنکه چیزی در حالِ
//  تلاش باشد و بی‌آنکه جایی خطایی دیده شود.
//
//  سنجه: شمارندهٔ `restarts` باید بیشتر از یک بار بالا برود.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-retry-'));
const dataDir = path.join(tmp, 'data');
fs.mkdirSync(dataDir, { recursive: true });

process.env.HLP_DATA_DIR = dataDir;
process.env.HLP_SITES_ROOT = path.join(tmp, 'sites');
process.env.HLP_AI_ENABLED = '0';
// «تونلی» که فوراً با کد ۱ می‌میرد — مثلِ cloudflared وقتی اعتبار ندارد
process.env.HLP_TUNNEL_CMD = 'sh,-c,exit 1';

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const { setSetting } = await import('../src/db.js');
const { startTunnel, stopTunnel, publicState } = await import('../src/tunnel.js');

// حالتِ «آدرسِ ثابت» با فایلِ اعتباری که سرِ جایش نیست — همان چیزی که
// tunnelDiagnosis آن را «قابلِ تعمیر» می‌داند و repairTunnel از پسش برنمی‌آید.
const cfDir = path.join(dataDir, 'cloudflared');
fs.mkdirSync(cfDir, { recursive: true });
const uuid = '11111111-2222-3333-4444-555555555555';
fs.writeFileSync(
  path.join(cfDir, 'config.yml'),
  [
    `tunnel: ${uuid}`,
    `credentials-file: ${path.join(cfDir, `${uuid}.json`).replaceAll('\\', '/')}`, // وجود ندارد
    'ingress:',
    '  - hostname: api.example.test',
    '    service: http://127.0.0.1:4701',
    '  - service: http_status:404',
  ].join('\n'),
);
setSetting('tunnel_mode', 'named');
setSetting('tunnel_hostname', 'api.example.test');

console.log('\n── تونلی که می‌میرد و تعمیرش هم جواب نمی‌دهد ──');
await startTunnel({ port: 4701 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// اولین مرگ باید خیلی زود ثبت شود
let firstSeen = false;
for (let i = 0; i < 40; i++) {
  if (publicState().restarts >= 1) { firstSeen = true; break; }
  await sleep(250);
}
check('اولین بار که تونل می‌افتد ثبت می‌شود', firstSeen, `restarts=${publicState().restarts}`);

// و بعد از شکستِ تعمیر، باید دوباره تلاش شود (حلقهٔ ۱۰ ثانیه‌ای)
let retried = false;
for (let i = 0; i < 70; i++) {   // تا ~۱۷ ثانیه
  if (publicState().restarts >= 2) { retried = true; break; }
  await sleep(250);
}
check('بعد از شکستِ تعمیر، دوباره تلاش می‌کند', retried, `restarts=${publicState().restarts}`);
check('و وضعیتش «خطا» می‌ماند، نه «خاموش»', publicState().status === 'error', publicState().status);

stopTunnel();
await fsp.rm(tmp, { recursive: true, force: true });

console.log(`\n${failed ? '❌' : '✅'} ${passed} سبز، ${failed} قرمز`);
process.exit(failed ? 1 : 0);
