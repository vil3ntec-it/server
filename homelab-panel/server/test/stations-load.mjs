// ---------------------------------------------------------------------------
//  ══ تستِ فشارِ چندپمپی ═════════════════════════════════════════════════════
//
//  خواستهٔ صاحب ریپو (۱۴۰۵/۰۶/۳۰): «برای زیرساخت تست‌هایی طراحی و اجرا کن که
//  رفتارِ سیستم را با افزایشِ تعدادِ پمپ‌ها، دستگاه‌ها، درخواست‌ها و
//  همگام‌سازی‌های همزمان بررسی کند… نتیجهٔ واقعی را گزارش کن، عددِ ساختگی نه.»
//
//  ⚠️ این آزمون **حکم نمی‌دهد که سامانه برای ده‌هزار مشتری آماده است**. فقط
//  همان چیزی را می‌گوید که روی همین ماشین و با همین عددها دیده شد، و این‌که
//  با بالا رفتنِ شمارِ پمپ‌ها رفتار **خطی** می‌ماند یا منفجر می‌شود.
//
//  چه چیزی سنجیده می‌شود:
//    ۱) ثبتِ N پمپ پشتِ سرِ هم                        (زمان، خطا)
//    ۲) M دستگاهِ هم‌زمان که هر کدام روی پمپِ خودش می‌نویسد (زمان، خطا)
//    ۳) خواندنِ هم‌زمانِ همان‌ها با رمزِ فقط‌خواندنی    (زمان، خطا)
//    ۴) جداسازی زیرِ فشار: هیچ پمپی دادهٔ پمپِ دیگر را نمی‌بیند
//    ۵) حافظه و CPUِ خودِ سرور پیش و پس
//
//      node test/stations-load.mjs           (پیش‌فرض: ۲۵ پمپ × ۴ دور)
//      STATIONS=100 ROUNDS=4 node test/stations-load.mjs
//      STATIONS=2000 ROUNDS=3 node test/stations-load.mjs   ← «۱۰۰۰ تا ۲۰۰۰ مشتری»
//
//  ⚠️ هر پمپ از **آی‌پیِ خودش** می‌آید (‎X-Forwarded-For‎، که سرور فقط از
//  لوکال‌هاست باور می‌کند — ‎platform/security.js‎). این تقلب نیست، واقعیت
//  است: دو هزار پمپِ واقعی دو هزار مودم دارند. بی این، همهٔ درخواست‌ها در یک
//  سطلِ آی‌پی (۳۰۰۰ در دقیقه) می‌افتادند و سنجه فقط همان سقف را می‌سنجید،
//  نه توانِ سرور. یک پمپ (‎load-1‎) عمداً **بی** آی‌پیِ جعلی می‌ماند تا راهِ
//  عادی هم سنجیده شود.
//  ⚠️ و ۱۴۰۵/۰۷/۱۴ همین سنجه با ۲۰۰۰ پمپ یک باگِ واقعی گرفت: ‎/enroll‎ در سطلِ
//  «هر پمپ» به‌عنوانِ پمپی به نامِ «enroll» شمرده می‌شد ⇒ ۱۲۰۰ ثبت در دقیقه
//  برای همه با هم، و ۸۰۰ ثبتِ آخر ۴۲۹. (‎src/index.js‎)
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4799);
const BASE = `http://127.0.0.1:${PORT}`;
const STATIONS = Number(process.env.STATIONS || 25);
const ROUNDS = Number(process.env.ROUNDS || 4);

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-stload-'));
let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};
const ms = (n) => `${n.toFixed(0)}ms`;

const serverPath = path.join(import.meta.dirname, '..', 'src', 'index.js');
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', serverPath], {
  env: {
    ...process.env,
    HLP_PORT: String(PORT),
    HLP_SITESYNC_PORT: String(PORT + 1),
    HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: path.join(tmp, 'data'),
    HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_TUNNEL: '0',
    HLP_METRICS_INTERVAL: '60000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

async function up(timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function api(method, url, body, headers = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* غیرِ JSON */ }
  return { status: res.status, json };
}

/** آی‌پیِ «مودمِ» هر پمپ — پمپِ اول بی سرآیند، مثلِ درخواستِ خامِ شبکهٔ خانه */
function ipOf(i) {
  if (i === 0) return {};
  return { 'X-Forwarded-For': `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` };
}

/** حافظه و CPUِ خودِ فرآیندِ سرور، از دیدِ سیستم‌عامل */
async function serverUsage() {
  try {
    const stat = await fsp.readFile(`/proc/${child.pid}/status`, 'utf8');
    const rss = /VmRSS:\s+(\d+)/.exec(stat);
    const io = await fsp.readFile(`/proc/${child.pid}/stat`, 'utf8');
    const f = io.split(' ');
    const ticks = Number(f[13]) + Number(f[14]);            // utime + stime
    return { rssMb: rss ? Number(rss[1]) / 1024 : -1, cpuMs: (ticks / 100) * 1000 };
  } catch { return { rssMb: -1, cpuMs: -1 }; }
}

try {
  if (!await up()) { console.log('سرور بالا نیامد:\n' + out.slice(-2000)); process.exit(1); }
  console.log(`\n══ فشار: ${STATIONS} پمپ × ${ROUNDS} دور ══\n`);
  const before = await serverUsage();

  // ── ۱) ثبتِ پمپ‌ها ───────────────────────────────────────────────────
  const allCodes = Array.from({ length: STATIONS }, (_, i) => `load-${i + 1}`);
  const ip = new Map(allCodes.map((c, i) => [c, ipOf(i)]));
  const keys = new Map();
  let t0 = performance.now();
  let bad = 0;
  const badSample = new Map();
  for (const code of allCodes) {
    const r = await api('POST', '/api/stations/enroll', { code, name: 'پمپِ ' + code }, ip.get(code));
    if (r.status !== 200 && r.status !== 201 || !r.json?.token) {
      bad++;
      const k = `${r.status} ${r.json?.error || ''}`.trim();
      badSample.set(k, (badSample.get(k) || 0) + 1);
      continue;
    }
    keys.set(code, { token: r.json.token, readKey: r.json.readKey });
  }
  const enrollMs = performance.now() - t0;
  check(`ثبتِ ${STATIONS} پمپ`, bad === 0 && keys.size === STATIONS,
        `${ms(enrollMs)} · ${ms(enrollMs / STATIONS)} برای هر پمپ · خطا ${bad}`);
  if (bad) console.log('    ↳ خطاها:', [...badSample].map(([k, n]) => `${k} ×${n}`).join(' · '));

  //  ⚠️ بقیهٔ سنجه‌ها فقط روی پمپ‌هایی که واقعاً ثبت شدند می‌دوند — یک ثبتِ
  //  ناموفق نباید کلِ سنجه را با ‎TypeError‎ بیندازد؛ سرخیِ خودش را بالا گرفت.
  const codes = allCodes.filter((c) => keys.has(c));
  if (codes.length === 0) throw new Error('هیچ پمپی ثبت نشد — بقیهٔ سنجه بی‌معناست');

  const tokens = [...keys.values()].map((k) => k.token);
  check('هیچ دو پمپی رمزِ یکسان ندارند', new Set(tokens).size === tokens.length);

  // ── ۲) نوشتنِ هم‌زمانِ همهٔ پمپ‌ها ────────────────────────────────────
  //  همان کاری که برنامهٔ نیتیو با «عکسِ زنده» می‌کند، ولی همه با هم.
  const snapshot = (code, round) => ({
    seq: round,
    banner: { debt: 1000 + round, tank: 5000 - round },
    sections: { debt: { t: 'قرض‌داران', head: ['نام', 'الباقی'], rows: [[code, round * 7]] } },
  });

  t0 = performance.now();
  let writeErr = 0;
  for (let round = 1; round <= ROUNDS; round++) {
    const all = await Promise.all(codes.map((code) =>
      api('PUT', `/api/stations/${code}/data/live`, { value: snapshot(code, round) },
          { 'X-Station-Token': keys.get(code).token, ...ip.get(code) })
        .catch(() => ({ status: 0 }))));
    const errs = all.filter((r) => r.status >= 400 || r.status === 0);
    writeErr += errs.length;
    if (errs.length && round === 1) console.log('    ↳ نمونهٔ خطای نوشتن:', errs[0].status, JSON.stringify(errs[0].json).slice(0, 160));
  }
  const writeMs = performance.now() - t0;
  const writes = codes.length * ROUNDS;
  check(`${writes} نوشتنِ هم‌زمان`, writeErr === 0,
        `${ms(writeMs)} · ${ms(writeMs / writes)} برای هر نوشتن · خطا ${writeErr}`);

  // ── ۳) خواندنِ هم‌زمان با رمزِ فقط‌خواندنی ────────────────────────────
  t0 = performance.now();
  const reads = await Promise.all(codes.map((code) =>
    api('GET', `/api/stations/${code}/live?token=${keys.get(code).readKey}`, undefined, ip.get(code))
      .catch(() => ({ status: 0 }))));
  const readMs = performance.now() - t0;
  const readErr = reads.filter((r) => r.status !== 200).length;
  if (readErr) {
    const first = reads.find((r) => r.status !== 200);
    console.log('    ↳ نمونهٔ خطا:', first.status, JSON.stringify(first.json).slice(0, 200));
  }
  check(`${codes.length} خواندنِ هم‌زمان`, readErr === 0,
        `${ms(readMs)} · ${ms(readMs / codes.length)} برای هر خواندن · خطا ${readErr}`);

  //  هر پمپ دادهٔ **خودش** را گرفت، نه دادهٔ همسایه — و آخرین دور را، نه دورِ کهنه
  const mixed = reads.filter((r, i) => {
    const rows = r.json?.live?.sections?.debt?.rows;
    return !Array.isArray(rows) || rows[0]?.[0] !== codes[i] || rows[0]?.[1] !== ROUNDS * 7;
  }).length;
  check('هر پمپ دادهٔ خودش را گرفت (و تازه‌ترین دور را)', mixed === 0, `${codes.length - mixed}/${codes.length} درست`);

  // ── ۴) جداسازی زیرِ فشار ─────────────────────────────────────────────
  let leaks = 0;
  for (let i = 0; i < codes.length; i++) {
    const mine = keys.get(codes[i]);
    const other = codes[(i + 1) % codes.length];
    const cross = await api('GET', `/api/stations/${other}/live?token=${mine.readKey}`, undefined, ip.get(codes[i]));
    if (cross.status === 200) leaks++;
    const crossWrite = await api('PUT', `/api/stations/${other}/data/live`,
                                 { value: snapshot(other, 99) },
                                 { 'X-Station-Token': mine.token, ...ip.get(codes[i]) });
    if (crossWrite.status < 400) leaks++;
  }
  check('رمزِ هر پمپ روی پمپِ بعدی نمی‌خورد (نه خواندن، نه نوشتن)', leaks === 0,
        `${codes.length * 2} تلاش · ${leaks} نشت`);

  //  و پس از آن همه تلاشِ ناروا، دادهٔ هر پمپ هنوز همان است که خودش نوشت
  const again = await Promise.all(codes.map((code) =>
    api('GET', `/api/stations/${code}/live?token=${keys.get(code).readKey}`, undefined, ip.get(code))
      .catch(() => ({ status: 0 }))));
  const tampered = again.filter((r, i) => r.json?.live?.sections?.debt?.rows?.[0]?.[1] !== ROUNDS * 7 || r.json?.live?.seq !== ROUNDS).length;
  check('نوشتنِ ناروا هیچ پمپی را دست نزد', tampered === 0, `${tampered} پمپِ دست‌خورده`);

  // ── ۵) خودِ سرور چقدر خرج کرد ────────────────────────────────────────
  const after = await serverUsage();
  console.log(`\n  · حافظهٔ سرور: ${before.rssMb.toFixed(0)}MB ⇒ ${after.rssMb.toFixed(0)}MB`);
  console.log(`  · CPUِ سرور در کلِ این فشار: ${ms(after.cpuMs - before.cpuMs)}`);
  console.log(`  · روی دیسک: یک پوشه برای هر پمپ (${codes.length} پوشه)`);

  console.log(`\n════════════════════════════════════`);
  console.log(`  موفق: ${passed}    ناموفق: ${failed}`);
  console.log(`════════════════════════════════════\n`);
} finally {
  child.kill();
  try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* بی‌اهمیت */ }
}

process.exit(failed ? 1 : 0);
