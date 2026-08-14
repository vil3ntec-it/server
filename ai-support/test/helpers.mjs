// کمکی‌های تست — عمداً کوچک، بدونِ هیچ چارچوبِ تست (وابستگیِ صفر)
//
// ⚠️ نکتهٔ مهم: تست‌ها **پشتِ سر هم** اجرا می‌شوند، نه هم‌زمان.
//    بعضی تست‌ها عمداً پیکربندی یا رجیستری را موقتاً دست‌کاری می‌کنند تا رفتارِ
//    نگهبان‌ها را بسنجند. اگر هم‌زمان اجرا شوند، آن دست‌کاری به تستِ دیگری نشت
//    می‌کند و نتیجه بی‌معنی می‌شود. پس `test()` فقط ثبت می‌کند و `runQueued()`
//    یکی‌یکی اجرایشان می‌کند.

let passed = 0;
let failed = 0;
const failures = [];
const queue = [];

export function suite(name) {
  queue.push({ kind: 'suite', name });
}

export function test(name, fn) {
  queue.push({ kind: 'test', name, fn });
}

/** صف را به ترتیب اجرا می‌کند و خالی می‌کند */
export async function runQueued() {
  let current = '';
  while (queue.length) {
    const item = queue.shift();
    if (item.kind === 'suite') {
      current = item.name;
      console.log(`\n── ${item.name} ──`);
      continue;
    }
    try {
      await item.fn();
      passed++;
      console.log(`  ✅ ${item.name}`);
    } catch (e) {
      failed++;
      failures.push(`${current} › ${item.name}: ${e.message}`);
      console.log(`  ❌ ${item.name}\n     ${e.message}`);
    }
  }
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'شرط برقرار نبود');
}

export function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || 'برابر نبود'} — انتظار: ${expected} / واقعی: ${actual}`);
}

export function assertThrows(fn, msg) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(msg || 'انتظار خطا داشتیم ولی خطایی رخ نداد');
}

export async function assertRejects(fn, msg) {
  let threw = false;
  try { await fn(); } catch { threw = true; }
  if (!threw) throw new Error(msg || 'انتظار خطا داشتیم ولی خطایی رخ نداد');
}

export function summary() {
  console.log('\n' + '═'.repeat(60));
  if (failed) {
    console.log(`❌ ${failed} تست شکست خورد، ${passed} قبول\n`);
    for (const f of failures) console.log('   • ' + f);
    console.log('');
    return 1;
  }
  console.log(`✅ همهٔ ${passed} تست قبول شد\n`);
  return 0;
}

export function stats() { return { passed, failed }; }
