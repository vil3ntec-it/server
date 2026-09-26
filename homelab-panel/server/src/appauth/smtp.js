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
import { inlineParts } from '../emails/app-templates.js';

const CRLF = '\r\n';

/*
 *  سقفِ ایمیل روی یک اتصال.
 *
 *  ⚠️ نگه‌داشتنِ یک اتصال خوب است، ولی تا ابد نه: جیمیل روی هر اتصال
 *  تعدادِ محدودی پیام قبول می‌کند و بعدش در را می‌بندد. پیش از آن خودمان
 *  اتصالِ تازه می‌گیریم تا آن بستن وسطِ یک ایمیل نیفتد.
 */
const MAX_PER_CONNECTION = 40;

/**
 * یک پاسخِ کاملِ SMTP را از بافر برمی‌دارد و باقی‌مانده را دست‌نخورده
 * پس می‌دهد. اگر پاسخ هنوز کامل نشده، null.
 *
 * ⚠️ این تابع قلبِ یک باگِ واقعی است، پس جدا و آزمون‌پذیر نوشته شده.
 *
 * پاسخِ SMTP می‌تواند چندخطی باشد؛ خطِ آخر «کد + فاصله» است و بقیه
 * «کد + خط تیره»:
 *
 *     250-smtp.gmail.com at your service
 *     250-STARTTLS
 *     250 SMTPUTF8            ← این یعنی تمام شد
 *
 * این چند خط در شبکه لزوماً یک‌جا نمی‌رسد. نسخهٔ قبلی به «آخرین خطِ بافر»
 * نگاه می‌کرد بی‌آنکه ببیند آن خط تمام شده یا نه. اگر تکهٔ TCP وسطِ خطِ
 * آخر می‌افتاد — مثلاً «250 SMT» — همان را پاسخِ کامل می‌گرفت، بقیه را
 * دور می‌ریخت و «STARTTLS» را در فهرست نمی‌دید. بعدش روی پورت ۵۸۷
 * رمزنگاری شروع نمی‌شد و جیمیل می‌گفت «Must issue a STARTTLS command
 * first» — یعنی آن ایمیل نمی‌رفت.
 *
 * و چون هر ایمیل یک اتصالِ تازه بود، هر بار قرعه از نو کشیده می‌شد:
 * چند تا می‌رفت، چند تا نه، با همان تنظیمات و همان لحظه.
 *
 * حالا فقط خط‌های *کامل* (تا \n) خوانده می‌شوند، و به‌محضِ رسیدن به خطِ
 * پایانی همان‌قدر از بافر برداشته می‌شود — نه یک بایت بیشتر، تا اگر
 * پاسخِ بعدی هم در همان بسته آمده باشد، گم نشود.
 *
 * @param {string} buffer
 * @returns {{reply:{code:number, text:string}, rest:string}|null}
 */
export function readReply(buffer) {
  let at = 0;
  for (;;) {
    const nl = buffer.indexOf('\n', at);
    if (nl === -1) return null; // خطِ ناقص — منتظر می‌مانیم
    const line = buffer.slice(at, nl).replace(/\r$/, '');
    at = nl + 1;
    // «کد + فاصله» یا فقط «کد» = پایانِ پاسخ؛ «کد + خط تیره» = ادامه دارد
    if (/^\d{3}(?: |$)/.test(line)) {
      return {
        reply: { code: Number(line.slice(0, 3)), text: buffer.slice(0, at) },
        rest: buffer.slice(at),
      };
    }
  }
}

/** یک گفت‌وگوی SMTP: خط می‌فرستیم، کدِ سه‌رقمی می‌گیریم */
function talk(socket, timeoutMs) {
  let buffer = '';
  let waiter = null;
  /*
   *  ⚠️ اگر در بسته شود، باید همان‌جا بفهمیم.
   *
   *  پیش از این، بستنِ ناگهانی هیچ خبری نمی‌داد و کلاینت تا سر رسیدنِ
   *  مهلت (۲۰ ثانیه) منتظر می‌ماند. با چند ایمیل پشتِ هم، صف عملاً
   *  می‌خوابید — و جیمیل دقیقاً همین کار را می‌کند وقتی اتصال‌ها زیاد شود.
   */
  let dead = null;

  const flush = () => {
    if (!waiter) return;
    if (dead) {
      const { reject } = waiter;
      waiter = null;
      reject(new Error(dead));
      return;
    }
    const taken = readReply(buffer);
    if (!taken) return;
    buffer = taken.rest;
    const { resolve } = waiter;
    waiter = null;
    resolve(taken.reply);
  };

  const die = (message) => {
    if (!dead) dead = message;
    flush();
  };

  // عمداً setEncoding نمی‌گذاریم: اگر پورت ۵۸۷ باشد همین سوکت بعداً به TLS
  // ارتقا پیدا می‌کند و TLS باید بایتِ خام بگیرد، نه رشته.
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    flush();
  });
  socket.on('error', (e) => die(`ارتباط با سرورِ ایمیل قطع شد — ${e.message}`));
  socket.on('close', () => die('سرورِ ایمیل در را بست'));
  socket.on('end', () => die('سرورِ ایمیل در را بست'));

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
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
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
        const error = new Error(`سرورِ ایمیل قبول نکرد — ${shown} → ${reply.text.trim()}`);
        /*
         *  ⚠️ کدِ ۴xx یعنی «الان نه، بعداً بیا» و ۵xx یعنی «هیچ‌وقت».
         *  صف باید این دو را از هم جدا کند، وگرنه یا بی‌خود تلاش می‌کند
         *  یا بی‌خود دست می‌کشد.
         */
        error.smtpCode = reply.code;
        error.temporary = reply.code >= 400 && reply.code < 500;
        throw error;
      }
      return reply;
    },
  };
}

/*
 *  SNI فقط برای نامِ دامنه معنی دارد. اگر میزبان یک IP باشد، فرستادنش به
 *  عنوانِ servername خلافِ RFC 6066 است: Node هشدار می‌دهد و دست‌دادنِ TLS
 *  می‌تواند همان‌جا بخورد زمین — چیزی که روی سرورِ ایمیلِ داخلِ شبکه (که با
 *  IP صدا زده می‌شود) دقیقاً اتفاق می‌افتد. بررسیِ گواهی سرِ جایش می‌ماند.
 */
const isIp = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');

function connect({ host, port, secure, rejectUnauthorized, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const options = { host, port, rejectUnauthorized, ...(isIp(host) ? {} : { servername: host }) };
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

export function buildMessage({ from, fromName, to, subject, text, html }) {
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

  //  ⛔ تصویرهای قالب پیوستِ درون‌خطی‌اند (`cid:`) — جیمیل نه SVG نشان می‌دهد
  //  نه `data:`. نامه‌ای که cid دارد `multipart/related` می‌شود.
  const inline = inlineParts(html);
  const alt = inline.length ? `a${boundary}` : boundary;
  const alternative = [
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text),
    `--${alt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html),
    `--${alt}--`,
  ];
  if (!inline.length) {
    return [...head, `Content-Type: multipart/alternative; boundary="${boundary}"`, '', ...alternative].join(CRLF);
  }
  const bin = (buf) => buf.toString('base64').replace(/(.{76})/g, `$1${CRLF}`);
  const parts = [
    ...head,
    `Content-Type: multipart/related; type="multipart/alternative"; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    ...alternative,
  ];
  for (const f of inline) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${f.contentType}; name="${f.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${f.cid}>`,
      `Content-Disposition: inline; filename="${f.filename}"`,
      '',
      bin(f.data),
    );
  }
  parts.push(`--${boundary}--`);
  return parts.join(CRLF);
}

/**
 * یک اتصالِ بازِ SMTP که می‌شود چند ایمیل از آن رد کرد.
 *
 * ⚠️ چرا لازم شد — و چرا مهم‌ترین تکهٔ این فایل است:
 *
 * تا پیش از این، هر ایمیل یک اتصالِ تازه باز می‌کرد: TCP نو، دست‌دادنِ
 * TLS نو، AUTH نو. چهار کارگر هم هم‌زمان کار می‌کردند و صف هر ۱٫۵ ثانیه
 * یک دورِ تازه هم راه می‌انداخت بی‌آنکه ببیند دورِ قبلی تمام شده یا نه.
 * یعنی برای پنج ایمیل، ده‌ها اتصالِ هم‌زمان به smtp.gmail.com.
 *
 * جیمیل روی تعدادِ اتصالِ هم‌زمان سخت‌گیر است: از یک جایی به بعد یا
 * «421 Try again later» می‌دهد یا بی‌حرف در را می‌بندد. نتیجه همان چیزی
 * بود که دیدید — چند ایمیل می‌رفت و چند تا نه، بی‌آنکه چیزی عوض شده باشد.
 *
 * حالا یک اتصال باز می‌شود، یک‌بار AUTH می‌شود، و همهٔ ایمیل‌های صف از
 * همان رد می‌شوند. برای پنج ایمیل: یک اتصال، نه پنج تا.
 */
export async function openMailer({
  host,
  port = 465,
  secure = port === 465,
  username = '',
  password = '',
  rejectUnauthorized = true,
  timeoutMs = 20000,
} = {}) {
  if (!host) throw new Error('آدرسِ سرورِ ایمیل (SMTP host) خالی است');

  let socket = await connect({ host, port, secure, rejectUnauthorized, timeoutMs });
  let smtp = talk(socket, timeoutMs);
  let alive = true;
  let sentOnThisConnection = 0;

  const bury = (e) => {
    alive = false;
    return e;
  };

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
      socket.removeAllListeners('close');
      socket.removeAllListeners('end');
      socket = tls.connect({ socket, rejectUnauthorized, ...(isIp(host) ? {} : { servername: host }) });
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
  } catch (e) {
    alive = false;
    try { socket.destroy(); } catch { /* بسته شده */ }
    throw e;
  }

  return {
    /** آیا هنوز می‌شود از این اتصال استفاده کرد؟ */
    get usable() {
      return alive && sentOnThisConnection < MAX_PER_CONNECTION;
    },

    /**
     * یک ایمیل از همین اتصال.
     *
     * ⚠️ فرقِ «این گیرنده نشد» با «این اتصال مُرد» این‌جا گذاشته می‌شود:
     * اولی با RSET رد می‌شود و بقیهٔ صف از همین اتصال می‌روند؛ دومی اتصال
     * را می‌سوزاند تا صدازننده یکی تازه باز کند. بدونِ این تفکیک، یک
     * ایمیلِ اشتباه می‌توانست جلوی همهٔ ایمیل‌های بعدی را بگیرد.
     */
    async send({ from, fromName = '', to, subject, text, html = '' }) {
      if (!alive) throw new Error('اتصال به سرورِ ایمیل بسته شده است');
      if (!from) throw new Error('آدرسِ فرستنده خالی است');
      if (!to) throw new Error('آدرسِ گیرنده خالی است');

      try {
        await smtp.send(`MAIL FROM:<${from}>`, [250]);
        await smtp.send(`RCPT TO:<${to}>`, [250, 251]);
        await smtp.send('DATA', [354]);
      } catch (e) {
        // اگر سرور هنوز حرف می‌زند، فقط همین گیرنده رد شده
        if (e.smtpCode) {
          await this.reset();
          throw e;
        }
        throw bury(e);
      }

      const message = buildMessage({ from, fromName, to, subject, text, html })
        // خطی که با نقطه شروع شود باید دو نقطه شود، وگرنه پیام نصفه می‌رود
        .replace(/^\./gm, '..');
      socket.write(message + CRLF + '.' + CRLF);

      let stored;
      try {
        stored = await smtp.read();
      } catch (e) {
        throw bury(e);
      }
      if (stored.code !== 250) {
        const error = new Error(`ایمیل ذخیره نشد: ${stored.text.trim()}`);
        error.smtpCode = stored.code;
        error.temporary = stored.code >= 400 && stored.code < 500;
        await this.reset();
        throw error;
      }

      sentOnThisConnection++;
      return { ok: true, response: stored.text.trim() };
    },

    /** پاک کردنِ میز برای ایمیلِ بعدی */
    async reset() {
      if (!alive) return;
      try {
        await smtp.send('RSET', [250, 220, 221, 250]);
      } catch {
        // RSET که نگیرد، یعنی اتصال دیگر قابلِ اعتماد نیست
        alive = false;
      }
    },

    close() {
      alive = false;
      try {
        socket.write(`QUIT${CRLF}`);
      } catch { /* در هر حال می‌بندیم */ }
      try {
        socket.destroy();
      } catch { /* بسته شده */ }
    },
  };
}

/**
 * یک ایمیلِ تکی — همان openMailer، باز و بسته در یک حرکت.
 *
 * برای جاهایی که واقعاً یک ایمیل است (مثلِ دکمهٔ «ایمیلِ آزمایشی»). برای
 * چند ایمیل، openMailer را مستقیم بگیرید و اتصال را نگه دارید.
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
  const mailer = await openMailer({ host, port, secure, username, password, rejectUnauthorized, timeoutMs });
  try {
    return await mailer.send({ from, fromName, to, subject, text, html });
  } finally {
    mailer.close();
  }
}
