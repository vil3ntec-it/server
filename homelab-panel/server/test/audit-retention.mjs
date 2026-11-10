// ---------------------------------------------------------------------------
//  دفترِ رخداد هرس می‌شود، ولی هیچ ردیفی بی ردِ پا گم نمی‌شود (۱.۵۰.۷۱، S9 ِ ممیزی)
//
//      node test/audit-retention.mjs
//
//  ⛔ تا ۱.۵۰.۷۰ هر ۱۵ دقیقه `audit_log` و `cc_audit` به ۲۰ هزار ردیفِ آخر بریده و بقیه **پاک**
//  می‌شد، بی هیچ خروجی. هر واردشده‌ای (حتی بیننده با ۴۰۳های پشتِ هم) در یک ربع ساعت ۲۰ هزار ردیف
//  می‌ساخت و کارِ پیشینِ خودش یا دیگری را از دفتر بیرون می‌راند — دست‌کاریِ دفتر با سیل.
//  حالا هر ردیفی که هرس می‌شود پیش از پاک شدن در `data/audit-archive/<دفتر>-<ماه>.jsonl` می‌نشیند
//  (فقط افزودن؛ اگر نوشتن نشد، هیچ ردیفی پاک نمی‌شود) و دفترِ یکپارچه می‌گوید چه بایگانی شده.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'audit-retention-'));
process.env.HLP_DATA_DIR = path.join(tmp, 'data');
process.env.HLP_SITES_ROOT = path.join(tmp, 'sites');

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
};

try {
  const { db } = await import('../src/db.js');
  await import('../src/control/schema.js').then((m) => (typeof m.ensureControlSchema === 'function' ? m.ensureControlSchema() : null)).catch(() => null);
  const lib = await import('../src/lib/audit.js');
  const control = await import('../src/control/audit.js');
  const archiveDir = path.join(process.env.HLP_DATA_DIR, 'audit-archive');
  const readArchive = (book) => {
    if (!fs.existsSync(archiveDir)) return [];
    return fs.readdirSync(archiveDir).filter((f) => f.startsWith(`${book}-`) && f.endsWith('.jsonl'))
      .flatMap((f) => fs.readFileSync(path.join(archiveDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  };

  console.log('\n── audit_log (کارهای حساس) ──');
  const req = { user: { username: 'mirza' }, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  for (let i = 0; i < 30; i++) lib.audit(req, i === 3 ? 'panel.user.role' : 'panel.login', { target: `t${i}`, ok: i % 2 === 0 });
  const before = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
  check('۳۰ ردیف نوشته شد', before === 30, String(before));
  lib.pruneAudit(10);
  const left = db.prepare('SELECT target FROM audit_log ORDER BY id').all().map((r) => r.target);
  check('در دیتابیس ۱۰ ردیفِ تازه‌تر ماند', left.length === 10 && left[0] === 't20' && left[9] === 't29', left.join(','));
  const arch = readArchive('audit_log');
  check('⛔ ۲۰ ردیفِ هرس‌شده پیش از پاک شدن بایگانی شد', arch.length === 20 && arch[0].target === 't0' && arch[19].target === 't19',
    `${arch.length} ${arch[0]?.target} ${arch.at(-1)?.target}`);
  check('⛔ ردیفِ «کارِ پیشین» (t3، تغییرِ نقش) با همهٔ ستون‌هایش در بایگانی هست', arch.some((r) => r.target === 't3' && r.action === 'panel.user.role' && r.actor === 'panel:mirza' && r.ip === '127.0.0.1' && Number(r.at) > 0));
  lib.pruneAudit(10);
  check('هرسِ دوباره چیزی را دو بار بایگانی نمی‌کند', readArchive('audit_log').length === 20, String(readArchive('audit_log').length));

  console.log('\n── cc_audit (مدیریت، پل، بازیابیِ مالک) ──');
  for (let i = 0; i < 25; i++) control.audit({ actor: `a${i}`, action: 'account.flag.set', entity: 'flag', entityId: `k${i}`, detail: { i } });
  control.pruneAudit(5);
  const ccLeft = db.prepare('SELECT COUNT(*) AS n FROM cc_audit').get().n;
  const ccArch = readArchive('cc_audit');
  check('cc_audit: ۵ ماند، ۲۰ بایگانی شد', ccLeft === 5 && ccArch.length === 20 && ccArch[0].actor === 'a0', `${ccLeft} ${ccArch.length}`);

  console.log('\n── اگر بایگانی نوشته نشود، هیچ ردیفی پاک نمی‌شود ──');
  for (let i = 0; i < 10; i++) lib.audit(req, 'panel.logout', { target: `x${i}` });
  const n0 = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
  fs.rmSync(archiveDir, { recursive: true, force: true });
  fs.writeFileSync(archiveDir, 'not a directory'); //  پوشه نمی‌تواند ساخته شود
  lib.pruneAudit(10);
  const n1 = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
  check('⛔ نوشتنِ بایگانی شکست ⇒ دیتابیس دست‌نخورده', n1 === n0 && n0 === 20, `${n0} → ${n1}`);
  fs.rmSync(archiveDir, { force: true });

  console.log('\n── دفترِ یکپارچه می‌گوید چه بایگانی شده ──');
  lib.pruneAudit(10);
  const info = typeof lib.archiveInfo === 'function' ? lib.archiveInfo() : null;
  check('archiveInfo: پرونده‌ها و اندازه، بی خواندنِ محتوا', info && Array.isArray(info.files) && info.files.length >= 1 && info.bytes > 0, JSON.stringify(info));
} catch (e) {
  fail++;
  console.log(`  ❌ خطا: ${e.stack || e.message}`);
} finally {
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} سبز، ${fail} قرمز`);
process.exit(fail === 0 ? 0 : 1);
