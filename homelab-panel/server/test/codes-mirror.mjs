// ---------------------------------------------------------------------------
//  آینهٔ کدهای سرورِ حساب — سنجهٔ خالص، بی هیچ سروری
//
//      node test/codes-mirror.mjs
//
//  سه چیز را نگه می‌دارد و هر سه در ۱.۵۰.۳ دلیلِ واقعی داشتند:
//
//    ۱) هر کد **یک بار** پرسیده می‌شود ⇒ دفترِ ممیزی یک ردیف دارد، نه
//       یکی به‌ازای هر تازه شدنِ دو‌ونیم‌ثانیه‌ایِ صفحه.
//    ۲) سقفِ هر دور ⇒ فهرستِ شصت‌تایی یک رگبارِ شصت‌تایی به سرورِ حساب
//       نمی‌زند. همان «ازدحامِ سرد»ی که ۱.۵۰.۲ بست.
//    ۳) خطا فهرست را نمی‌شکند ⇒ کد رفاه است، فهرست اصل.
// ---------------------------------------------------------------------------
import { MAX_PER_PASS, mirrorAccountCodes, mirrorSize, resetMirror } from '../src/codes/mirror.js';

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 200) : ''}`); }
};

const NOW = Date.now();
const row = (id, over = {}) => ({
  id, source: 'account', status: 'live', canReveal: true, code: null,
  expiresAt: NOW + 120_000, ...over,
});

console.log('\n── آینهٔ کدها ──');

/* ۱) یک کد، یک پرسش ------------------------------------------------------ */
resetMirror();
let asks = 0;
let logged = 0;
const ask = async () => { asks++; return '123456'; };
const onReveal = () => { logged++; };

let out = await mirrorAccountCodes([row('a1')], ask, onReveal, NOW);
check('کد در همان فهرست می‌نشیند', out[0].code === '123456', JSON.stringify(out[0]));
check('و ممیزی یک ردیف گرفت', logged === 1, String(logged));

for (let i = 0; i < 5; i++) out = await mirrorAccountCodes([row('a1')], ask, onReveal, NOW);
check('⛔ پنج بار تازه شدن ⇒ همان یک پرسش', asks === 1, String(asks));
check('⛔ و همان یک ردیفِ ممیزی', logged === 1, String(logged));
check('⚠️ ولی کد هنوز روی صفحه است', out[0].code === '123456', JSON.stringify(out[0]));

/* ۲) فقط کدِ زنده -------------------------------------------------------- */
resetMirror();
asks = 0;
const dead = [
  row('u1', { status: 'used' }),
  row('e1', { status: 'expired' }),
  row('n1', { canReveal: false }),
  { id: 'p1', source: 'panel', status: 'live', code: '000111' },
];
out = await mirrorAccountCodes(dead, ask, onReveal, NOW);
check('⛔ کدِ مرده و ردیفِ خودِ پنل هیچ‌وقت پرسیده نمی‌شوند', asks === 0, String(asks));
check('و ردیفِ خودِ پنل دست‌نخورده رد می‌شود', out[3].code === '000111', JSON.stringify(out[3]));

/* ۳) سقفِ هر دور --------------------------------------------------------- */
resetMirror();
asks = 0;
const many = Array.from({ length: MAX_PER_PASS + 8 }, (_, i) => row(`m${i}`));
out = await mirrorAccountCodes(many, ask, onReveal, NOW);
check(`⛔ سقفِ هر دور ${MAX_PER_PASS} است، نه ${many.length}`, asks === MAX_PER_PASS, String(asks));
check('و بقیه بی‌کد رد می‌شوند، نه حذف', out.length === many.length && out.at(-1).code === null,
  `${out.length}`);
//  دورِ بعد بقیه را می‌گیرد — هیچ کدی برای همیشه جا نمی‌ماند
out = await mirrorAccountCodes(many, ask, onReveal, NOW);
check('⚠️ و دورِ بعد بقیه را می‌گیرد', asks === MAX_PER_PASS + 8, String(asks));

/* ۴) خطا فهرست را نمی‌شکند ----------------------------------------------- */
resetMirror();
const boom = async () => { throw new Error('سرورِ حسابِ کهنه'); };
out = await mirrorAccountCodes([row('b1')], boom, onReveal, NOW);
check('⛔ خطای سرورِ حساب فهرست را نمی‌شکند', out.length === 1 && out[0].code === null,
  JSON.stringify(out));
check('و چیزی هم در آینه نمی‌نشیند', mirrorSize() === 0, String(mirrorSize()));

/* ۵) کدِ منقضی از آینه می‌افتد ------------------------------------------- */
resetMirror();
asks = 0;
await mirrorAccountCodes([row('x1', { expiresAt: NOW + 1_000 })], ask, onReveal, NOW);
check('کد در آینه نشست', mirrorSize() === 1, String(mirrorSize()));
await mirrorAccountCodes([], ask, onReveal, NOW + 5_000);
check('⚠️ و با گذشتنِ وقت خودش پاک می‌شود', mirrorSize() === 0, String(mirrorSize()));

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} سبز، ${failed} سرخ`);
process.exit(failed === 0 ? 0 : 1);
