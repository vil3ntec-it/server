// ---------------------------------------------------------------------------
//  آزمونِ کلاینتِ SMTP — «چرا برای بعضی‌ها می‌رفت و برای بعضی‌ها نه»
//      node test/smtp-client.mjs
//
//  ⚠️ این آزمون از یک گزارشِ واقعی درآمد: «۵ تا تست زدم، ۲ ایمیل رفت و سه
//  تای دیگر اصلاً نیامد» — با همان تنظیمات، همان سرور، همان لحظه.
//
//  علتش در خوانندهٔ پاسخِ SMTP بود. پاسخِ EHLO چندخطی است:
//
//      250-smtp.gmail.com at your service
//      250-SIZE 35882577
//      250-STARTTLS
//      250 SMTPUTF8          ← «کد + فاصله» یعنی پاسخ تمام شد
//
//  این چند خط در شبکه لزوماً یک‌جا نمی‌رسد؛ TCP هر جا دلش بخواهد تکه‌اش
//  می‌کند. خوانندهٔ قدیمی به «آخرین خطِ بافر» نگاه می‌کرد، بی‌آنکه ببیند آن
//  خط تمام شده یا نه. اگر تکه دقیقاً وسطِ خطِ آخر می‌افتاد — مثلاً «250 SMT»
//  — همان را پاسخِ کامل می‌گرفت، بقیه را دور می‌ریخت، و «STARTTLS» را در
//  فهرست نمی‌دید. آن‌وقت روی پورت ۵۸۷ رمزنگاری شروع نمی‌شد و جیمیل جواب
//  می‌داد: «Must issue a STARTTLS command first».
//
//  یعنی موفق یا ناموفق بودنِ هر ایمیل به این بستگی داشت که TCP آن لحظه
//  بسته را کجا برید. قرعه‌کشی.
// ---------------------------------------------------------------------------
import net from 'node:net';
import { readReply, sendMail } from '../src/appauth/smtp.js';

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`);
  }
};

/* ------------------- پاسخِ واقعیِ جیمیل به EHLO --------------------------- */

const EHLO_REPLY =
  '250-smtp.gmail.com at your service, [1.2.3.4]\r\n'
  + '250-SIZE 35882577\r\n'
  + '250-8BITMIME\r\n'
  + '250-STARTTLS\r\n'
  + '250-ENHANCEDSTATUSCODES\r\n'
  + '250-PIPELINING\r\n'
  + '250-CHUNKING\r\n'
  + '250 SMTPUTF8\r\n';

console.log('\n── پاسخ را از هر جا که ببُری، درست خوانده می‌شود ──');
/*
 *  هر ۲۳۹ نقطهٔ برشِ ممکن امتحان می‌شود — نه یکی دو تا، چون همان یکی که
 *  امتحان نکنیم همانی است که روی سرورِ واقعی اتفاق می‌افتد.
 */
let worstCases = 0;
let allGood = true;
let firstBad = '';
for (let cut = 1; cut < EHLO_REPLY.length; cut++) {
  let buffer = '';
  let reply = null;

  // تکهٔ اول
  buffer += EHLO_REPLY.slice(0, cut);
  let taken = readReply(buffer);
  if (taken) {
    // اگر این‌جا چیزی برگرداند، یعنی پیش از کامل‌شدنِ پاسخ تصمیم گرفته
    reply = taken.reply;
    buffer = taken.rest;
    worstCases++;
  }

  // تکهٔ دوم
  if (!reply) {
    buffer += EHLO_REPLY.slice(cut);
    taken = readReply(buffer);
    reply = taken?.reply || null;
    buffer = taken?.rest ?? buffer;
  }

  const ok = reply
    && reply.code === 250
    && reply.text.includes('STARTTLS')
    && reply.text.includes('SMTPUTF8')
    && buffer === '';
  if (!ok) {
    allGood = false;
    if (!firstBad) firstBad = `برشِ ${cut}: ${JSON.stringify(reply)} + باقی‌مانده ${JSON.stringify(buffer)}`;
  }
}
check(`هر ۲۳۹ نقطهٔ برش درست خوانده شد`, allGood, firstBad);
check('و هیچ‌وقت پیش از پایانِ پاسخ تصمیم نگرفت', worstCases === 0, `${worstCases} بار زود تصمیم گرفت`);

console.log('\n── پاسخ را بایت‌به‌بایت هم بدهی، نمی‌شکند ──');
{
  let buffer = '';
  let reply = null;
  for (const ch of EHLO_REPLY) {
    buffer += ch;
    const taken = readReply(buffer);
    if (taken) {
      reply = taken.reply;
      buffer = taken.rest;
      break;
    }
  }
  check('پاسخ کامل خوانده شد', reply?.code === 250 && reply.text.includes('SMTPUTF8'), JSON.stringify(reply));
  check('و چیزی ته بافر نماند', buffer === '', JSON.stringify(buffer));
}

console.log('\n── دو پاسخ که با هم برسند، قاطی نمی‌شوند ──');
/*
 *  ⚠️ سرورهایی که PIPELINING دارند می‌توانند دو پاسخ را در یک بسته
 *  بفرستند. خوانندهٔ قدیمی کلِ بافر را یک پاسخ می‌دید و دومی را دور
 *  می‌ریخت — یعنی از آن‌جا به بعد هر پاسخ یک قدم عقب می‌افتاد.
 */
{
  const both = '250 ok\r\n354 go ahead\r\n';
  const first = readReply(both);
  check('پاسخِ اول ۲۵۰ است', first?.reply.code === 250, JSON.stringify(first?.reply));
  check('و دومی دست‌نخورده می‌ماند', first?.rest === '354 go ahead\r\n', JSON.stringify(first?.rest));
  const second = readReply(first.rest);
  check('پاسخِ دوم ۳۵۴ است', second?.reply.code === 354, JSON.stringify(second?.reply));
  check('و بعدش بافر خالی است', second?.rest === '', JSON.stringify(second?.rest));
}

console.log('\n── خطِ ناقص، پاسخ حساب نمی‌شود ──');
check('خطِ بی‌پایان هنوز پاسخ نیست', readReply('250 SMT') === null);
check('خطِ ادامه‌دار هم پاسخ نیست', readReply('250-STARTTLS\r\n') === null);
check('خالی هم پاسخ نیست', readReply('') === null);

/* --------- و همین را روی سوکتِ واقعی: STARTTLS باید زده شود ------------- */

console.log('\n── روی سوکتِ واقعی، با بدترین نقطهٔ برش ──');
/*
 *  سرورِ قلابی عمداً پاسخِ EHLO را جایی می‌بُرد که خطِ آخر نصفه بماند:
 *  «…250 SMT» + «UTF8». دقیقاً همان حالتی که کلاینتِ قدیمی را گول می‌زد.
 *
 *  انتظار: کلاینت STARTTLS را ببیند و بزند. (دست‌دادنِ TLS روی این سوکتِ
 *  ساده شکست می‌خورد و همان‌جا خطا می‌گیریم — مهم این است که *زد*.)
 */
const seen = [];
const server = net.createServer((socket) => {
  socket.setEncoding('utf8');
  socket.write('220 smtp.fake ESMTP ready\r\n');
  socket.on('data', (chunk) => {
    for (const line of chunk.split('\r\n').filter(Boolean)) {
      seen.push(line);
      if (/^EHLO|^HELO/i.test(line)) {
        const cut = EHLO_REPLY.length - 5; // وسطِ خطِ آخر
        socket.write(EHLO_REPLY.slice(0, cut));
        setTimeout(() => socket.write(EHLO_REPLY.slice(cut)), 30);
      } else if (/^STARTTLS/i.test(line)) {
        socket.write('220 ready to start TLS\r\n');
      } else {
        socket.write('250 ok\r\n');
      }
    }
  });
  socket.on('error', () => {});
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();

try {
  await sendMail({
    host: '127.0.0.1',
    port,
    secure: false,
    username: 'robot@test.local',
    password: 'secret',
    from: 'robot@test.local',
    to: 'someone@example.com',
    subject: 'سلام',
    text: 'کد: 123456',
    rejectUnauthorized: false,
    timeoutMs: 4000,
  });
} catch { /* دست‌دادنِ TLS روی سوکتِ ساده شکست می‌خورد — انتظارش را داریم */ }

check('STARTTLS زده شد', seen.some((l) => /^STARTTLS$/i.test(l)), seen.join(' | '));
check('و رمزِ حساب پیش از رمزنگاری نرفت',
  !seen.some((l) => /^AUTH/i.test(l)), seen.join(' | '));

/* ------------ قطع‌شدنِ ناگهانی: همان‌جا خطا، نه ۲۰ ثانیه انتظار ---------- */

console.log('\n── وقتی سرور وسطِ کار در را می‌بندد ──');
const rude = net.createServer((socket) => {
  socket.write('220 smtp.fake ESMTP\r\n');
  socket.on('data', () => socket.destroy());
  socket.on('error', () => {});
});
await new Promise((r) => rude.listen(0, '127.0.0.1', r));

const startedAt = Date.now();
let rudeError = '';
try {
  await sendMail({
    host: '127.0.0.1',
    port: rude.address().port,
    secure: false,
    from: 'robot@test.local',
    to: 'someone@example.com',
    subject: 'x',
    text: 'x',
    timeoutMs: 8000,
  });
} catch (e) {
  rudeError = e.message;
}
const took = Date.now() - startedAt;
check('خطا داد', Boolean(rudeError), rudeError);
/*
 *  ⚠️ پیش از این، بستنِ در هیچ خبری نمی‌داد و کلاینت تا سر رسیدنِ مهلت
 *  (۲۰ ثانیه) منتظر می‌ماند. با چند ایمیل پشتِ هم، صف عملاً می‌خوابید.
 */
check(`و همان‌جا، نه سرِ مهلت (${took}ms)`, took < 3000, `${took}ms`);
check('و می‌گوید در بسته شد', /بست|قطع/.test(rudeError), rudeError);

server.close();
rude.close();

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 ? 0 : 1);
