// ---------------------------------------------------------------------------
//  فرستادنِ ایمیل — بدونِ هیچ کتابخانه‌ای
//
//  چرا دستی: افزودنِ یک وابستگیِ تازه یعنی به‌روزرسانیِ داخلِ برنامهٔ ویندوز
//  دیگر کافی نیست و باید فایلِ نصبیِ تازه گرفت. یک کلاینتِ کوچکِ SMTP روی
//  node:tls همان کار را می‌کند و این هزینه را ندارد.
//
//  هر دو حالتِ معمول کار می‌کند:
//      پورت ۴۶۵ — از همان اول رمزنگاری‌شده
//      پورت ۵۸۷ — ساده شروع می‌شود و با STARTTLS رمزنگاری می‌شود
//  رمز هیچ‌وقت روی اتصالِ رمزنگاری‌نشده فرستاده نمی‌شود.
// ---------------------------------------------------------------------------
import tls from 'node:tls';
import net from 'node:net';

/**
 * گفت‌وگوی خط‌به‌خط با سرورِ SMTP.
 *
 * پاسخِ چندخطی با «۲۵۰-» ادامه پیدا می‌کند و با «۲۵۰ » تمام می‌شود؛ تا آن
 * خطِ پایانی نیامده، پاسخ کامل نیست.
 */
function talk(socket, timeoutMs) {
  let buffer = '';
  let waiter = null;
  let failure = null;

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    flush();
  });

  // قطع شدنِ اتصال باید همان درخواستِ منتظر را رد کند، نه اینکه برنامه را
  // با یک رویدادِ خطای بی‌صاحب بخواباند.
  const fail = (e) => {
    failure = e instanceof Error ? e : new Error(String(e));
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(null, '', failure);
    }
  };
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('smtp_connection_closed')));

  function finishedCode() {
    const m = /(?:^|\n)(\d{3}) [^\n]*\r?\n$/.exec(buffer);
    return m ? Number(m[1]) : null;
  }

  function flush() {
    if (!waiter) return;
    const code = finishedCode();
    if (code === null) return;
    const text = buffer;
    buffer = '';
    const w = waiter;
    waiter = null;
    w(code, text, null);
  }

  function expect(codes) {
    return new Promise((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      const timer = setTimeout(() => {
        waiter = null;
        reject(new Error('smtp_timeout'));
      }, timeoutMs);
      waiter = (code, text, err) => {
        clearTimeout(timer);
        if (err) {
          reject(err);
          return;
        }
        if (codes && !codes.includes(code)) {
          reject(new Error(`smtp_${code}: ${text.trim().slice(0, 200)}`));
          return;
        }
        resolve({ code, text });
      };
      flush(); // ممکن است پاسخ قبلاً رسیده باشد
    });
  }

  return { expect, send: (line) => socket.write(`${line}\r\n`) };
}

/**
 * SNI فقط برای نامِ دامنه معنی دارد. اگر میزبان یک IP باشد، فرستادنش به
 * عنوانِ servername خلافِ RFC 6066 است و Node هم هشدار می‌دهد و در آینده
 * نادیده‌اش می‌گیرد. پس آنجا نامی نمی‌فرستیم — بررسیِ گواهی سرِ جایش می‌ماند.
 */
const isIp = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');

function connect(options, secure, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = secure ? tls.connect(options) : net.connect(options);
    const onError = (e) => reject(e);
    socket.once('error', onError);
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('smtp_connect_timeout')));
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      socket.off('error', onError);
      // مهلتِ بی‌کاری فقط برای *برقراری* اتصال بود. اگر بماند، وسطِ
      // گفت‌وگو سوکت را می‌کشد؛ از اینجا به بعد مهلت کارِ expect است.
      socket.setTimeout(0);
      resolve(socket);
    });
  });
}

/** عنوانِ فارسی باید کدگذاری شود، وگرنه در صندوقِ گیرنده به‌هم می‌ریزد */
function encodeHeader(text) {
  return /^[\x20-\x7E]*$/.test(text)
    ? text
    : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

/**
 * فرستادنِ یک ایمیل.
 * @param settings { host, port, user, pass, from, fromName, timeoutMs }
 */
export async function sendMail(settings, { to, subject, text }) {
  const host = String(settings?.host || '').trim();
  const port = Number(settings?.port) || 465;
  const user = String(settings?.user || '').trim();
  const pass = String(settings?.pass || '');
  const from = String(settings?.from || user).trim();
  if (!host || !from) {
    throw Object.assign(new Error('تنظیمات ایمیل کامل نیست'), { code: 'mail_not_configured' });
  }

  const timeoutMs = Number(settings?.timeoutMs) || 20000;
  // پورت ۴۶۵ از همان اول رمزنگاری‌شده است؛ بقیه با STARTTLS. با secure
  // می‌شود صریح گفت، برای سرورهایی که روی پورتِ غیرمعمول نشسته‌اند.
  const implicitTls = settings?.secure === undefined ? port === 465 : Boolean(settings.secure);

  const sni = isIp(host) ? {} : { servername: host };
  let socket = await connect({ host, port, ...sni }, implicitTls, timeoutMs);
  let io = talk(socket, timeoutMs);

  try {
    await io.expect([220]);
    io.send(`EHLO ${host}`);
    const greeting = await io.expect([250]);

    if (!implicitTls) {
      if (!/STARTTLS/i.test(greeting.text)) {
        throw Object.assign(
          new Error('این سرور رمزنگاری ندارد؛ رمز روی خطِ باز فرستاده نمی‌شود'),
          { code: 'no_starttls' },
        );
      }
      io.send('STARTTLS');
      await io.expect([220]);

      socket = await new Promise((resolve, reject) => {
        const secured = tls.connect({ socket, host, ...sni }, () => resolve(secured));
        secured.once('error', reject);
      });
      io = talk(socket, timeoutMs);
      io.send(`EHLO ${host}`);
      await io.expect([250]);
    }

    if (user) {
      io.send('AUTH LOGIN');
      await io.expect([334]);
      io.send(Buffer.from(user, 'utf8').toString('base64'));
      await io.expect([334]);
      io.send(Buffer.from(pass, 'utf8').toString('base64'));
      await io.expect([235]);
    }

    io.send(`MAIL FROM:<${from}>`);
    await io.expect([250]);
    io.send(`RCPT TO:<${to}>`);
    await io.expect([250, 251]);
    io.send('DATA');
    await io.expect([354]);

    const fromHeader = settings.fromName ? `${encodeHeader(settings.fromName)} <${from}>` : from;
    const message = [
      `From: ${fromHeader}`,
      `To: <${to}>`,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      `Date: ${new Date().toUTCString()}`,
      '',
      Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
      '.',
    ].join('\r\n');
    socket.write(`${message}\r\n`);
    await io.expect([250]);

    io.send('QUIT');
    return { ok: true };
  } finally {
    try { socket.destroy(); } catch { /* از قبل بسته */ }
  }
}
