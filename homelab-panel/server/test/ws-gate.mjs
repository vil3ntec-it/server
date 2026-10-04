// ---------------------------------------------------------------------------
//  شورا، پ۳ — درِ ارتقای وب‌سوکت (ممیزی M10)
//      node test/ws-gate.mjs
//
//  دفترِ واقعیِ پمپ‌ها (‎createStations‎) پشتِ یک سرورِ HTTPِ واقعی، و مشتریِ
//  ‎ws‎ِ واقعی:
//    ۱) رمزِ درست ⇒ وصل و ‎sub‎ جواب می‌دهد
//    ۲) رمزِ غلطِ زیرِ سقف ⇒ همان ‎{op:'error'}‎ (برنامه‌ها «رمز غلط» را می‌فهمند)
//    ۳) بیستمین حدسِ <b>متفاوت</b> به بعد ⇒ ۴۲۹ِ HTTP <b>بی ارتقا</b>
//    ۴) همان رمزِ غلطِ تکراری یک حدس است (گوشیِ کلیدمرده خودش را بیرون نمی‌گذارد)
//    ۵) رمزِ درست حتی پس از سقف وصل می‌شود
//  روی کدِ پیشین بندِ ۳ سرخ است: هیچ تلاشی ۴۲۹ نمی‌گرفت.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';
import { createStations } from '../src/stations/index.js';

let pass = 0, fail = 0;
const ok = (c, m, d = '') => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m + (d ? ' — ' + d : '')); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-gate-'));
const stations = createStations({ dataDir: dir, enroll: 'lan' });
const en = await stations.enroll({ code: 'pgate', name: 'آزمون', local: true });
const token = en.token;
const server = http.createServer((_q, r) => r.end());
server.on('upgrade', (req, socket, head) => stations.handleUpgrade(req, socket, head));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

/** یک تلاش: ‎'open'‎ با پیامِ نخست، یا ‎status:<کد>‎ وقتی ارتقا رد شد */
function attempt(tok) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/station?station=pgate&token=${encodeURIComponent(tok)}`);
    const done = (v) => { try { ws.terminate(); } catch { /* */ } resolve(v); };
    ws.on('unexpected-response', (_q, res) => done({ status: res.statusCode, retry: res.headers['retry-after'] }));
    ws.on('open', () => ws.send(JSON.stringify({ op: 'sub', path: 'live', id: 1 })));
    ws.on('message', (m) => { let j = {}; try { j = JSON.parse(String(m)); } catch { /* */ } done({ open: true, msg: j }); });
    ws.on('error', () => {});
    ws.on('close', () => done({ closed: true }));
    setTimeout(() => done({ timeout: true }), 4000);
  });
}

console.log('── ۱) رمزِ درست');
let r = await attempt(token);
ok(r.open && r.msg.op !== 'error', 'رمزِ درست وصل می‌شود', JSON.stringify(r));

console.log('── ۲) رمزِ غلطِ زیرِ سقف ⇒ همان پیامِ خطا');
r = await attempt('wrong-0');
ok(r.open && r.msg.op === 'error' && r.msg.msg === 'auth_failed', 'برنامه «رمز غلط» را می‌فهمد', JSON.stringify(r));

console.log('── ۴) یک رمزِ غلطِ تکراری یک حدس است');
for (let i = 0; i < 30; i++) r = await attempt('wrong-0');
ok(r.open && r.msg.op === 'error', 'سی بار همان رمزِ کهنه ⇒ هنوز پیامِ خطا، نه ۴۲۹', JSON.stringify(r));

console.log('── ۳) حدس‌های متفاوت سقف دارند — پیش از ارتقا');
let firstBlocked = -1;
for (let i = 1; i <= 25; i++) {
  r = await attempt('wrong-' + i);
  if (r.status === 429 && firstBlocked < 0) firstBlocked = i;
}
ok(firstBlocked === 20, 'بیستمین حدسِ متفاوت ۴۲۹ می‌گیرد (۱۹ تای قبلی + wrong-0)', 'نخستین ۴۲۹: ' + firstBlocked);
ok(r.status === 429 && Number(r.retry) > 0, '۴۲۹ِ HTTP با Retry-After، بی هیچ وب‌سوکتی', JSON.stringify(r));

console.log('── ۵) صاحبِ رمز هرگز بیرون نمی‌ماند');
r = await attempt(token);
ok(r.open && r.msg.op !== 'error', 'رمزِ درست پس از سقف هم وصل می‌شود', JSON.stringify(r));

server.close();
try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
console.log(`\n${pass} موفق، ${fail} ناموفق`);
process.exit(fail ? 1 : 0);
