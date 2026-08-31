// ---------------------------------------------------------------------------
//  فرستادنِ ایمیل بدون هیچ کتابخانهٔ اضافه — یک کلاینتِ کوچکِ SMTP
//
//  چرا خودمان نوشتیم: تا نصبِ سرور همان «یک npm install» بماند و روی کامپیوترِ
//  بدونِ اینترنتِ آزاد هم چیزی کم نداشته باشد.
//
//  با جی‌میل: host=smtp.gmail.com  port=465  secure=true
//  و به‌جای رمزِ حساب، «App Password» بسازید (رمزِ ۱۶ حرفیِ گوگل).
// ---------------------------------------------------------------------------
import net from 'node:net';
import tls from 'node:tls';

const CRLF = '\r\n';

/** یک گفت‌وگوی SMTP: خط می‌فرستیم، کدِ سه‌رقمی می‌گیریم */
function talk(socket, timeoutMs) {
  let buffer = '';
  let waiter = null;

  const flush = () => {
    if (!waiter) return;
    // پاسخِ کامل: آخرین خط باید «کد + فاصله» باشد، نه «کد + خط تیره»
    const lines = buffer.split(/\r?\n/).filter(Boolean);
    const last = lines[lines.length - 1] || '';
    if (!/^\d{3} /.test(last)) return;
    const text = buffer;
    buffer = '';
    const { resolve } = waiter;
    waiter = null;
    resolve({ code: Number(last.slice(0, 3)), text });
  };

  // عمداً setEncoding نمی‌گذاریم: اگر پورت ۵۸۷ باشد همین سوکت بعداً به TLS
  // ارتقا پیدا می‌کند و TLS باید بایتِ خام بگیرد، نه رشته.
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    flush();
  });

  return {
    read() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = null;
          reject(new Error('پاسخی از سرورِ ایمیل نیامد (timeout)'));
        }, timeoutMs);
        waiter = {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
        };
        flush();
      });
    },
    /** خط را می‌فرستد و پاسخ را برمی‌گرداند؛ اگر کد آن‌چه انتظار داریم نبود، خطا */
    async send(line, expect = [250]) {
      socket.write(line + CRLF);
      const reply = await this.read();
      if (expect.length && !expect.includes(reply.code)) {
        const shown = line.startsWith('AUTH') || /^[A-Za-z0-9+/=]+$/.test(line) ? '(رمز)' : line;
        throw new Error(`سرورِ ایمیل قبول نکرد — ${shown} → ${reply.text.trim()}`);
      }
      return reply;
    },
  };
}

function connect({ host, port, secure, rejectUnauthorized, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const options = { host, port, servername: host, rejectUnauthorized };
    const ready = () => {
      // مهلت فقط برای «وصل شدن» است؛ بعد از آن مهلتِ خواندن کار می‌کند
      socket.setTimeout(0);
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
      socket.on('error', () => { /* در ادامه با خطای خواندن معلوم می‌شود */ });
      resolve(socket);
    };
    const onError = (e) => reject(new Error(`به ${host}:${port} وصل نشد — ${e.message}`));
    const onTimeout = () => {
      socket.destroy();
      reject(new Error(`به ${host}:${port} وصل نشد (timeout)`));
    };
    const socket = secure ? tls.connect(options, ready) : net.connect(options, ready);
    socket.setTimeout(timeoutMs);
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
  });
}

/** متنِ فارسی در ایمیل: هدرها base64 و بدنه هم base64 — همه‌جا درست دیده می‌شود */
const mime = (value) => `=?UTF-8?B?${Buffer.from(String(value), 'utf8').toString('base64')}?=`;

function buildMessage({ from, fromName, to, subject, text, html }) {
  const boundary = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const head = [
    `From: ${fromName ? `${mime(fromName)} ` : ''}<${from}>`,
    `To: <${to}>`,
    `Subject: ${mime(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Message-ID: <${boundary}@${from.split('@')[1] || 'localhost'}>`,
  ];

  const b64 = (v) => Buffer.from(String(v), 'utf8').toString('base64').replace(/(.{76})/g, `$1${CRLF}`);

  if (!html) {
    return [
      ...head,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(text),
    ].join(CRLF);
  }

  return [
    ...head,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html),
    `--${boundary}--`,
  ].join(CRLF);
}

/**
 * یک ایمیل می‌فرستد. اگر نرفت، خطا با متنِ فارسیِ قابل‌فهم بالا می‌آید.
 */
export async function sendMail({
  host,
  port = 465,
  secure = port === 465,
  username = '',
  password = '',
  from,
  fromName = '',
  to,
  subject,
  text,
  html = '',
  rejectUnauthorized = true,
  timeoutMs = 20000,
}) {
  if (!host) throw new Error('آدرسِ سرورِ ایمیل (SMTP host) خالی است');
  if (!from) throw new Error('آدرسِ فرستنده خالی است');

  let socket = await connect({ host, port, secure, rejectUnauthorized, timeoutMs });
  let smtp = talk(socket, timeoutMs);

  try {
    const hello = await smtp.read();
    if (hello.code !== 220) throw new Error(`سرورِ ایمیل آماده نبود: ${hello.text.trim()}`);

    const me = 'homelab-panel';
    let ehlo = await smtp.send(`EHLO ${me}`, [250]);

    // پورت ۵۸۷ و ۲۵ اول ساده‌اند و بعد رمزنگاری می‌شوند
    if (!secure && /STARTTLS/i.test(ehlo.text)) {
      await smtp.send('STARTTLS', [220]);
      socket.removeAllListeners('data');
      socket.removeAllListeners('error');
      socket = tls.connect({ socket, servername: host, rejectUnauthorized });
      await new Promise((resolve, reject) => {
        socket.once('secureConnect', resolve);
        socket.once('error', reject);
      });
      smtp = talk(socket, timeoutMs);
      ehlo = await smtp.send(`EHLO ${me}`, [250]);
    }

    if (username) {
      const b64 = (v) => Buffer.from(String(v), 'utf8').toString('base64');
      if (/AUTH[^\r\n]*PLAIN/i.test(ehlo.text)) {
        await smtp.send(`AUTH PLAIN ${b64(`\0${username}\0${password}`)}`, [235]);
      } else {
        await smtp.send('AUTH LOGIN', [334]);
        await smtp.send(b64(username), [334]);
        await smtp.send(b64(password), [235]);
      }
    }

    await smtp.send(`MAIL FROM:<${from}>`, [250]);
    await smtp.send(`RCPT TO:<${to}>`, [250, 251]);
    await smtp.send('DATA', [354]);

    const message = buildMessage({ from, fromName, to, subject, text, html })
      // خطی که با نقطه شروع شود باید دو نقطه شود، وگرنه پیام نصفه می‌رود
      .replace(/^\./gm, '..');
    socket.write(message + CRLF + '.' + CRLF);
    const stored = await smtp.read();
    if (stored.code !== 250) throw new Error(`ایمیل ذخیره نشد: ${stored.text.trim()}`);

    try {
      await smtp.send('QUIT', []);
    } catch { /* بستنِ مؤدبانه مهم نیست */ }

    return { ok: true, response: stored.text.trim() };
  } finally {
    try {
      socket.destroy();
    } catch { /* بسته شده */ }
  }
}
