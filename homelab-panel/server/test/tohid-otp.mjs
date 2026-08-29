// ---------------------------------------------------------------------------
//  آزمونِ واقعیِ کد ورود — ایمیل و پیامک
//      node test/tohid-otp.mjs
//
//  نه ایمیل شبیه‌سازی می‌شود نه پیامک: یک سرورِ SMTP واقعی و یک دروازهٔ
//  پیامکِ واقعی (HTTP) بالا می‌آید، کد از همان‌ها گرفته می‌شود و بعد با
//  همان کد وارد می‌شویم.
// ---------------------------------------------------------------------------
import http from 'node:http';
import tls from 'node:tls';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4831);
const SMS_PORT = PORT + 1;
const SMTP_PORT = PORT + 2;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'th-otp-'));


/** متنِ نامه base64 است؛ برای دیدنِ کد باید رمزگشایی شود */
const mailText = (raw) => {
  const at = String(raw || '').indexOf('\n\n');
  const body = at < 0 ? raw : raw.slice(at + 2);
  return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
};

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 240)}`);
};

/* ─────────── دروازهٔ پیامکِ ساختگی ولی واقعیِ HTTP ─────────── */
const smsInbox = [];
const smsGateway = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    smsInbox.push({ url: req.url, auth: req.headers.authorization || '', body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise((r) => smsGateway.listen(SMS_PORT, '127.0.0.1', r));

/* ─────────── سرورِ SMTP با TLS واقعی ───────────
   بدونِ رمزنگاری، خودِ کلاینت درست رفتار می‌کند و رمز را نمی‌فرستد؛
   پس آزمون هم باید سرورِ رمزنگاری‌شده بدهد، نه اینکه آن قاعده را دور بزند. */
const certDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'otp-cert-'));
execSync(`openssl req -x509 -newkey rsa:2048 -keyout ${certDir}/k.pem -out ${certDir}/c.pem -days 1 -nodes -subj "/CN=127.0.0.1"`, { stdio: 'ignore' });
const mailInbox = [];
const smtp = tls.createServer(
  { key: fs.readFileSync(`${certDir}/k.pem`), cert: fs.readFileSync(`${certDir}/c.pem`) },
  (sock) => {
    let buf = '', inData = false, authStep = 0, body = [];
    const say = (x) => sock.write(x + '\r\n');
    say('220 test ESMTP');
    sock.setEncoding('utf8');
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; mailInbox.push(body.join('\n')); body = []; say('250 queued'); }
          else body.push(line);
          continue;
        }
        if (/^EHLO/i.test(line)) { say('250-test'); say('250 AUTH LOGIN'); }
        else if (/^AUTH LOGIN/i.test(line)) { authStep = 1; say('334 VXNlcm5hbWU6'); }
        else if (authStep === 1) { authStep = 2; say('334 UGFzc3dvcmQ6'); }
        else if (authStep === 2) { authStep = 0; say('235 ok'); }
        else if (/^DATA/i.test(line)) { inData = true; say('354 go'); }
        else if (/^QUIT/i.test(line)) { say('221 bye'); sock.end(); }
        else say('250 ok');
      }
    });
    sock.on('error', () => {});
  },
);
await new Promise((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r));

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
         HLP_SITESYNC: '0', HLP_AI_ENABLED: '0', HLP_TUNNEL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const api = async (p, { method = 'GET', body, token } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }

  const setup = await api('/api/auth/setup', { method: 'POST', body: { username: 'admin', password: 'ControlCenter!2026' } });
  const token = setup.data.token;
  check('پنل بالا آمد', Boolean(token));

  console.log('\n── تنظیمِ دو کانال ──');
  await api('/api/control/tohid/settings', {
    method: 'PUT', token,
    body: {
      enabled: true,
      mail: { host: '127.0.0.1', port: SMTP_PORT, secure: true, user: 'u', from: 'panel@test', fromName: 'تست' },
      mailPassword: 'p',
      sms: {
        enabled: true,
        url: `http://127.0.0.1:${SMS_PORT}/send`,
        method: 'POST',
        contentType: 'json',
        headers: 'Authorization: Bearer {token}',
        body: '{"to":"{to}","message":"{text}"}',
      },
      smsToken: 'secret-token-123',
      otpMessage: 'کد ورود شما: {code} — تا {minutes} دقیقه',
    },
  });
  const st = await api('/api/control/tohid/otp', { token });
  check('ایمیل آماده است', st.data.channels?.email?.ready === true, JSON.stringify(st.data.channels));
  check('پیامک آماده است', st.data.channels?.sms?.ready === true, JSON.stringify(st.data.channels));

  console.log('\n── کدِ ایمیل ──');
  await api('/api/control/tohid/otp/test', { method: 'POST', token, body: { method: 'email', to: 'shop@example.com' } });
  await new Promise((r) => setTimeout(r, 400));
  const mailCode = (mailText(mailInbox[0]).match(/(\d{6})/) || [])[1];
  check('نامه واقعاً فرستاده شد', mailInbox.length > 0);
  check('کدِ شش‌رقمی داخلِ نامه هست', /^\d{6}$/.test(mailCode || ''), mailCode);

  console.log('\n── کدِ پیامک ──');
  await api('/api/control/tohid/otp/test', { method: 'POST', token, body: { method: 'phone', to: '0700123456' } });
  await new Promise((r) => setTimeout(r, 400));
  check('دروازهٔ پیامک صدا زده شد', smsInbox.length > 0);
  const sms = smsInbox[0] || {};
  const smsBody = JSON.parse(sms.body || '{}');
  const smsCode = (String(smsBody.message || '').match(/(\d{6})/) || [])[1];
  check('شماره درست به دروازه رفت', smsBody.to === '0700123456', sms.body);
  check('کدِ شش‌رقمی در متنِ پیامک هست', /^\d{6}$/.test(smsCode || ''), smsBody.message);
  check('متنِ دلخواه اعمال شد', String(smsBody.message).includes('کد ورود شما'), smsBody.message);
  check('توکن از گاوصندوق در سربرگ نشست', sms.auth === 'Bearer secret-token-123', sms.auth);

  console.log('\n── کدها تصادفی‌اند ──');
  const seen = new Set([mailCode, smsCode].filter(Boolean));
  for (let i = 0; i < 6; i++) {
    smsInbox.length = 0;
    // مهلتِ ارسالِ دوباره را رد کنیم: هر بار شمارهٔ دیگری
    await api('/api/control/tohid/otp/test', { method: 'POST', token, body: { method: 'phone', to: `07001234${10 + i}` } });
    await new Promise((r) => setTimeout(r, 250));
    const b = JSON.parse(smsInbox[0]?.body || '{}');
    const c = (String(b.message || '').match(/(\d{6})/) || [])[1];
    if (c) seen.add(c);
  }
  check('هشت کدِ پیاپی همه متفاوت‌اند', seen.size === 8, `${seen.size} کدِ یکتا`);
  check('همه دقیقاً شش رقم‌اند', [...seen].every((c) => /^\d{6}$/.test(c)), [...seen].join(','));

  console.log('\n── ورود با همان کد ──');
  const sent = await api('/api/control/tohid/otp/test', { method: 'POST', token, body: { method: 'email', to: 'login@example.com' } });
  check('کد فرستاده شد', sent.data.ok === true, JSON.stringify(sent.data));
  await new Promise((r) => setTimeout(r, 400));
  const code = (mailText(mailInbox[mailInbox.length - 1]).match(/(\d{6})/) || [])[1];

  const bad = await api('/api/v1/auth/otp/verify', { method: 'POST', body: { method: 'email', value: 'login@example.com', code: '000000' } });
  check('کدِ غلط رد می‌شود', bad.status >= 400, JSON.stringify(bad.data).slice(0, 100));

  const good = await api('/api/v1/auth/otp/verify', { method: 'POST', body: { method: 'email', value: 'login@example.com', code } });
  check('کدِ درست وارد می‌کند', good.status === 200 && Boolean(good.data.accessToken), JSON.stringify(good.data).slice(0, 140));

  const again = await api('/api/v1/auth/otp/verify', { method: 'POST', body: { method: 'email', value: 'login@example.com', code } });
  check('همان کد بارِ دوم کار نمی‌کند', again.status >= 400, JSON.stringify(again.data).slice(0, 100));

  console.log('\n── کد در پنل دیده نمی‌شود ──');
  await api('/api/control/tohid/otp/test', { method: 'POST', token, body: { method: 'email', to: 'secret@example.com' } });
  await new Promise((r) => setTimeout(r, 300));
  const view = await api('/api/control/tohid/otp', { token });
  const raw = JSON.stringify(view.data);
  const leaked = (mailText(mailInbox[mailInbox.length - 1]).match(/(\d{6})/) || [])[1];
  check('کدِ فرستاده‌شده در پاسخِ پنل نیست', !raw.includes(leaked), leaked);
  check('نشانی نیمه‌پوشیده است', raw.includes('•'), raw.slice(0, 200));
} catch (e) {
  fail++;
  console.log('  ❌ خطای غیرمنتظره —', e.message);
  console.log(out.slice(-1200));
} finally {
  server.kill();
  smsGateway.close();
  smtp.close();
}

console.log(`\n════════════════════════\n  موفق: ${pass}    ناموفق: ${fail}\n════════════════════════`);
process.exit(fail ? 1 : 0);
