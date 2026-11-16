// ---------------------------------------------------------------------------
//  آزمونِ سنجاقِ الگوریتمِ JWT ِ پنل (ممیزیِ امنیتِ ۱۴۰۵/۰۸/۲۶، R2-CC-01)
//      node test/jwt-alg-pin.mjs
//
//  همهٔ توکن‌های پنل با HS256 و `jwtSecret()` امضا می‌شوند (`auth.js` نشستِ مدیر، `routes/auth.js`
//  بلیتِ گامِ دومِ TOTP، `appauth` توکنِ برنامه). نشستِ مدیر از پیش `algorithms: ['HS256']` داشت؛ دو در
//  نداشتند و توکنِ HS384/HS512 با همان راز را هم می‌پذیرفتند. این آزمون می‌سنجد هر سه در فقط HS256 را
//  می‌پذیرند و `alg: none` همیشه رد است. پوشهٔ دادهٔ موقت، رازِ آزمونی؛ هیچ دادهٔ واقعی.
// ---------------------------------------------------------------------------
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-jwtpin-'));
process.env.HLP_DATA_DIR = tmp;
process.env.HLP_SITES_ROOT = path.join(tmp, 'sites');
process.env.HLP_SECRET_KEY = 'test-only-jwt-pin-secret-not-real-0123456789';

const jwt = (await import('jsonwebtoken')).default;
const { jwtSecret } = await import('../src/auth.js');
const { verifyAppToken } = await import('../src/appauth/index.js');
const { verifyTotpTicket } = await import('../src/routes/auth.js');

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};

const secret = jwtSecret();
const unsigned = (payload) =>
  `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;

console.log('── بلیتِ گامِ دومِ TOTP ──');
{
  const body = { uid: 1, typ: 'totp' };
  check('HS256 با همان راز پذیرفته می‌شود', verifyTotpTicket(jwt.sign(body, secret, { algorithm: 'HS256', expiresIn: 300 }))?.uid === 1);
  check('HS512 با همان راز رد می‌شود', verifyTotpTicket(jwt.sign(body, secret, { algorithm: 'HS512', expiresIn: 300 })) === null);
  check('HS384 با همان راز رد می‌شود', verifyTotpTicket(jwt.sign(body, secret, { algorithm: 'HS384', expiresIn: 300 })) === null);
  check('alg: none رد می‌شود', verifyTotpTicket(unsigned({ ...body, exp: Math.floor(Date.now() / 1000) + 300 })) === null);
  check('رازِ دیگر رد می‌شود', verifyTotpTicket(jwt.sign(body, 'another-secret', { algorithm: 'HS256', expiresIn: 300 })) === null);
}

console.log('── توکنِ برنامه (appauth) ──');
{
  //  نشستی در پایگاه نیست ⇒ حتی توکنِ درست null است؛ پس سنجش فقط روی امضاست: HS512 باید پیش از رسیدن به پایگاه رد شود.
  //  `verifyAppToken` خطای امضا و نبودِ نشست را هر دو null می‌دهد، پس امضا را مستقیم با همان گزینه‌ها می‌سنجیم.
  const { APP_TOKEN_VERIFY } = await import('../src/appauth/index.js');
  const body = { typ: 'app', uid: 1, sid: 'x', app: 'pump', exp: Math.floor(Date.now() / 1000) + 300 };
  const ok = (t) => { try { jwt.verify(t, secret, APP_TOKEN_VERIFY); return true; } catch { return false; } };
  check('گزینه‌های سنجش فقط HS256', JSON.stringify(APP_TOKEN_VERIFY?.algorithms) === '["HS256"]', JSON.stringify(APP_TOKEN_VERIFY));
  check('HS256 امضای درست را می‌پذیرد', ok(jwt.sign(body, secret, { algorithm: 'HS256' })));
  check('HS512 با همان راز رد می‌شود', !ok(jwt.sign(body, secret, { algorithm: 'HS512' })));
  check('alg: none رد می‌شود', !ok(unsigned(body)));
  check('verifyAppToken برای HS512 null است', verifyAppToken(jwt.sign(body, secret, { algorithm: 'HS512' })) === null);
}

await fsp.rm(tmp, { recursive: true, force: true });
console.log(`\n${passed} ✅  ${failed} ❌`);
process.exit(failed ? 1 : 0);
