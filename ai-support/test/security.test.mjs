// ═══════════════════════════════════════════════════════════════════════════
//  تست‌های امنیتی — مرزِ دسترسی، اسرار، سطحِ دسترسی، نشست
// ═══════════════════════════════════════════════════════════════════════════

import path from 'node:path';
import { suite, test, assert, assertEqual, assertThrows } from './helpers.mjs';
import { assertReadable, assertWritable, safeJoin, isForbidden, runBoundaryChecks } from '../src/security/guard.js';
import { redact, containsSecret, redactDeep } from '../src/security/redact.js';
import { canAccess, issueSession, verifySession, levelForAppRole, checkAppCredentials } from '../src/security/auth.js';
import { ROOT, DATA_DIR, KB_DIR } from '../src/config.js';

const REPO = path.resolve(ROOT, '..');

export default async function run() {

  suite('مرزِ دسترسی به فایل');

  test('دادهٔ برنامهٔ اصلی خواندنی نیست', () => {
    assertThrows(() => assertReadable(path.join(REPO, 'server', 'data')), 'server/data نباید خواندنی باشد');
    assertThrows(() => assertReadable(path.join(REPO, 'server', 'data', 'token.txt')), 'توکنِ سرور نباید خواندنی باشد');
  });

  test('خودِ برنامه (index.html) خواندنی نیست', () => {
    assertThrows(() => assertReadable(path.join(REPO, 'index.html')));
    assertThrows(() => assertReadable(path.join(REPO, 'sw.js')));
  });

  test('پنلِ سرور و پوشهٔ .git خواندنی نیستند', () => {
    assertThrows(() => assertReadable(path.join(REPO, 'homelab-panel')));
    assertThrows(() => assertReadable(path.join(REPO, '.git', 'config')));
  });

  test('نوشتن فقط داخلِ پوشهٔ دادهٔ خودِ سرویس ممکن است', () => {
    assertWritable(path.join(DATA_DIR, 'x.json'));
    assertThrows(() => assertWritable(path.join(REPO, 'index.html')), 'نباید بشود روی index.html نوشت');
    assertThrows(() => assertWritable(path.join(REPO, 'server', 'server.js')));
    assertThrows(() => assertWritable(path.join(KB_DIR, 'new.md')), 'حتی knowledge هم نوشتنی نیست');
  });

  test('مسیرپیمایی (path traversal) بسته است', () => {
    assertThrows(() => safeJoin(KB_DIR, '../../etc/passwd'));
    assertThrows(() => safeJoin(DATA_DIR, '..', '..', 'server', 'data'));
    assertThrows(() => assertReadable(path.join(KB_DIR, '..', 'server')));
  });

  test('isForbidden مسیرهای برنامه را می‌شناسد', () => {
    assert(isForbidden(path.join(REPO, 'server')));
    assert(isForbidden(path.join(REPO, 'payam', 'index.html')));
    assert(!isForbidden(path.join(ROOT, 'knowledge')));
  });

  test('بررسیِ کاملِ مرز بدونِ ایراد رد می‌شود', () => {
    const { ok, problems } = runBoundaryChecks();
    assert(ok, 'مرز ایراد دارد: ' + problems.join(' | '));
  });

  // ───────────────────────────────────────────────────────────────────────
  suite('پالایشِ اسرار');

  test('توکنِ داخلیِ برنامه پنهان می‌شود', () => {
    const r = redact('رمز سرور 3f25db6ea9ff8ea4e8089a66cc7492f5f017 است');
    assert(!r.text.includes('3f25db6ea9ff8ea4e8089a66cc7492f5f017'), 'توکن نشت کرد');
    assert(r.hits.length > 0);
  });

  test('انواعِ کلید و رمز گرفته می‌شوند', () => {
    const cases = [
      'password: hunter2000',
      'رمز: مخفی123456',
      'api_key=sk-abcdefghij1234567890',
      'ghp_abcdefghijklmnopqrstuvwxyz1234',
      'AKIAIOSFODNN7EXAMPLE',
      'postgres://user:pw@localhost:5432/db',
      'https://user:secret@example.com/x',
    ];
    for (const c of cases) {
      assert(containsSecret(c), `این نشت می‌کند: ${c}`);
    }
  });

  test('کلیدِ حساس در شیء هم پنهان می‌شود', () => {
    const out = redactDeep({ token: 'abc123456789', nested: { رمز: 'x1234567', ok: 'سلام' } });
    assert(out.token !== 'abc123456789');
    assertEqual(out.nested.ok, 'سلام', 'مقدارِ بی‌خطر نباید دست بخورد');
  });

  test('متنِ عادی دست‌نخورده می‌ماند', () => {
    const t = 'برای گرفتن پی‌دی‌اف Ctrl+P را بزنید';
    assertEqual(redact(t).text, t);
  });

  // ───────────────────────────────────────────────────────────────────────
  suite('سطحِ دسترسی');

  test('نردبانِ دسترسی درست کار می‌کند', () => {
    assert(canAccess('ADMIN', 'USER'));
    assert(canAccess('USER', 'PUBLIC'));
    assert(!canAccess('PUBLIC', 'USER'));
    assert(!canAccess('USER', 'ADMIN'));
  });

  test('INTERNAL برای هیچ‌کس باز نمی‌شود — حتی ADMIN', () => {
    assert(!canAccess('ADMIN', 'INTERNAL'));
    assert(!canAccess('INTERNAL', 'INTERNAL'));
  });

  test('نقشِ برنامه به سطحِ درست نگاشت می‌شود', () => {
    assertEqual(levelForAppRole('admin'), 'ADMIN');
    assertEqual(levelForAppRole('viewer'), 'USER');
    assertEqual(levelForAppRole('staff'), 'USER');
    assertEqual(levelForAppRole('customer'), 'PUBLIC');
    assertEqual(levelForAppRole('چیزِ عجیب'), 'PUBLIC');
  });

  test('ادعای مدیر بدونِ رمزِ مدیر به USER محدود می‌شود', () => {
    delete process.env.AI_ADMIN_TOKEN;
    const c = checkAppCredentials({ appToken: '', adminToken: 'هرچه' });
    assert(c.ok);
    assertEqual(c.maxLevel, 'USER', 'بدونِ AI_ADMIN_TOKEN نباید ADMIN صادر شود');
  });

  // ───────────────────────────────────────────────────────────────────────
  suite('نشست');

  test('نشستِ سالم تأیید می‌شود', () => {
    const { token } = issueSession({ deviceId: 'd1', role: 'admin', level: 'ADMIN' });
    const v = verifySession(token);
    assert(v.ok, v.reason);
    assertEqual(v.session.lvl, 'ADMIN');
  });

  test('نشستِ دست‌کاری‌شده رد می‌شود', () => {
    const { token } = issueSession({ deviceId: 'd1', role: 'viewer', level: 'USER' });
    const [body, sig] = token.split('.');
    // بالا بردنِ سطح در محتوا، بدونِ داشتنِ رمزِ امضا
    const forged = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(body, 'base64url').toString()), lvl: 'ADMIN',
    })).toString('base64url');
    assert(!verifySession(`${forged}.${sig}`).ok, 'نشستِ جعلی پذیرفته شد');
  });

  test('نشستِ منقضی رد می‌شود', () => {
    const { token } = issueSession({ deviceId: 'd', role: 'x', level: 'USER' });
    const [body, sig] = token.split('.');
    const old = JSON.parse(Buffer.from(body, 'base64url').toString());
    old.exp = Date.now() - 1000;
    const forged = Buffer.from(JSON.stringify(old)).toString('base64url');
    assert(!verifySession(`${forged}.${sig}`).ok);
  });

  test('نشستِ INTERNAL حتی با امضای درست هم رد می‌شود', () => {
    const { token } = issueSession({ deviceId: 'd', role: 'x', level: 'INTERNAL' });
    const v = verifySession(token);
    // issueSession خودش INTERNAL را نگه می‌دارد ولی verify باید ردش کند
    assert(!v.ok || v.session.lvl !== 'INTERNAL', 'نشستِ INTERNAL نباید معتبر باشد');
  });

  test('توکنِ بی‌معنی رد می‌شود', () => {
    for (const t of ['', 'abc', 'a.b', null, undefined, 'x'.repeat(500)]) {
      assert(!verifySession(t).ok, `این پذیرفته شد: ${t}`);
    }
  });
}
