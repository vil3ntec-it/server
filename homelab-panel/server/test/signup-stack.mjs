// ---------------------------------------------------------------------------
//  پشتهٔ زنده برای سنجه‌های برنامهٔ پمپ — پنلِ خانگیِ واقعی + سرورِ حسابِ
//  واقعی (PGlite) + یک صندوقِ ایمیلِ کوچک که کدِ هر نامه را با گیرنده‌اش
//  می‌نویسد.
//
//      node test/signup-stack.mjs <live.json>        (تا Ctrl+C روشن می‌ماند)
//
//  ⚠️ سنجه نیست؛ همان چیزی را بالا می‌آورد که `signuptrial`ِ ریپوی پمپ
//  می‌خواهد (live.json: public · mailCodes · panel · panelToken). برنامهٔ پمپ
//  از راهِ `CloudLink.TestTransport` به همان پورتِ عمومی می‌رود که تونل
//  می‌بیند — نشانیِ قفل‌شدهٔ کد دست نمی‌خورد.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const here = import.meta.dirname;
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'pump-live.json'));
const PANEL = Number(process.env.TEST_PORT || 4931);
const PUBLIC = PANEL + 1;
const ACCOUNT_PORT = PANEL + 2;
const ACCOUNT_DIR = process.env.HLP_ACCOUNT_DIR
  || [path.resolve(here, '..', '..', '..', '..', 'shop', 'server')].find((d) => fs.existsSync(path.join(d, 'node_modules')));
if (!ACCOUNT_DIR) { console.error('کدِ سرورِ حساب پیدا نشد (HLP_ACCOUNT_DIR)'); process.exit(2); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signup-stack-'));
const mailCodes = path.join(tmp, 'mail-codes.jsonl');
const mailRaw = path.join(tmp, 'mail-raw');
fs.mkdirSync(mailRaw);

/** شش‌رقمیِ بدنهٔ نامه (سرآیندها گشته نمی‌شوند؛ بلوک‌های base64 باز می‌شوند). */
function codeOf(raw) {
  const at = raw.indexOf('\n\n');
  const body = at < 0 ? raw : raw.slice(at + 2);
  const parts = [];
  for (const m of body.matchAll(/^([A-Za-z0-9+/=]{16,})$/gm)) {
    try { parts.push(Buffer.from(m[1], 'base64').toString('utf8')); } catch { /* نه */ }
  }
  parts.push(body.replace(/=\r?\n/g, '').replace(/=3D/g, '='));
  for (const text of parts) {
    //  ⚠️ کد داخلِ خودِ نامه است، نه در پیش‌نمایشِ پنهان
    const hit = /(?:^|[^A-Za-z0-9#])(\d{6})(?:[^A-Za-z0-9]|$)/.exec(text.replace(/<div style="display:none[^]*?<\/div>/, ''));
    if (hit) return hit[1];
  }
  return '';
}

let n = 0;
const smtp = net.createServer((sock) => {
  let data = false; let auth = 0; let body = ''; let buf = ''; let to = '';
  sock.setEncoding('utf8');
  sock.write('220 fake ESMTP\r\n');
  sock.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) {
        if (line === '.') {
          data = false;
          const file = path.join(mailRaw, `${++n}.eml`);
          fs.writeFileSync(file, body);
          const subject = /^Subject: (.*)$/m.exec(body)?.[1] || '';
          fs.appendFileSync(mailCodes, JSON.stringify({ at: Date.now(), to, code: codeOf(body), subject, file }) + '\n');
          body = ''; to = '';
          sock.write('250 OK\r\n');
        } else body += line + '\n';
        continue;
      }
      if (auth) { sock.write(auth === 1 ? '334 UGFzc3dvcmQ6\r\n' : '235 ok\r\n'); auth = auth === 1 ? 2 : 0; continue; }
      if (!line) continue;
      const cmd = line.split(' ')[0].toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-fake\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 10240000\r\n');
      else if (cmd === 'AUTH') { if (/LOGIN\s*$/i.test(line)) { auth = 1; sock.write('334 VXNlcm5hbWU6\r\n'); } else sock.write('235 ok\r\n'); }
      else if (cmd === 'RCPT') { to += (/<([^>]+)>/.exec(line)?.[1] || '') + ' '; sock.write('250 OK\r\n'); }
      else if (cmd === 'DATA') { data = true; sock.write('354 go\r\n'); }
      else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 OK\r\n');
    }
  });
  sock.on('error', () => {});
});
await new Promise((r) => smtp.listen(0, '127.0.0.1', r));

const panel = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  cwd: path.resolve(here, '..'),
  env: {
    ...process.env,
    HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PUBLIC),
    HLP_TUNNEL: '0', HLP_AI_ENABLED: '0',
    HLP_ACCOUNT_API: `http://127.0.0.1:${ACCOUNT_PORT}`,
    HLP_ACCOUNT_DIR: ACCOUNT_DIR, HLP_ACCOUNT_AUTOSTART: '1',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_SECURE: 'none',
    SMTP_USER: 'stack', SMTP_PASS: 'stack', EMAIL_FROM: 'pump@example.com',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const log = fs.createWriteStream(path.join(tmp, 'panel.log'));
panel.stdout.pipe(log); panel.stderr.pipe(log);
const stop = () => { try { process.kill(-panel.pid); } catch { /* */ } try { panel.kill('SIGKILL'); } catch { /* */ } process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);

const hit = async (base, method, p, body, token) => {
  const res = await fetch(`${base}${p}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json };
};
const P = `http://127.0.0.1:${PANEL}`;
for (let i = 0; i < 200; i++) {
  const h = await hit(`http://127.0.0.1:${PUBLIC}`, 'GET', '/api/health').catch(() => null);
  if (h?.status === 200 && h.json?.server === 'online') break;
  await new Promise((r) => setTimeout(r, 500));
}
await hit(P, 'POST', '/api/auth/setup', { username: 'admin', password: 'Stack-1405-panel' });
const panelToken = (await hit(P, 'POST', '/api/auth/login', { username: 'admin', password: 'Stack-1405-panel' })).json?.token || '';
const version = (await hit(`http://127.0.0.1:${PUBLIC}`, 'GET', '/api/health')).json?.version;
fs.writeFileSync(out, JSON.stringify({ public: `http://127.0.0.1:${PUBLIC}`, panel: P, panelToken, mailCodes, mailRaw, tmp, accountVersion: version }, null, 1));
console.log(`پشته آماده است — سرورِ حساب ${version} · ${out}`);
setInterval(() => {}, 1 << 30);
