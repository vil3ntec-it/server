// ---------------------------------------------------------------------------
//  آزمون: دستیارِ پشتیبانی باید واقعاً بالا بیاید
//      node test/ai-boot.mjs
//
//  خرابی‌ای که این‌جا گرفته می‌شود:
//
//    پنل پوشهٔ دادهٔ دستیار را `<dataDir>/ai-support` می‌داد — یعنی مسیری داخلِ
//    خودِ homelab-panel. ولی مرزِ امنیتیِ سرویس کلِ درختِ پنل را ممنوع می‌داند
//    و با چنین مسیری **عمداً بالا نمی‌آید**. نتیجه‌اش این بود:
//
//        🤖 دستیارِ پشتیبانی روشن شد …
//        ❌ AI_DATA_DIR روی مسیرِ ممنوع تنظیم شده: …/server/data/ai-support
//        پروسه بسته شد (کد 1)      ← و دوباره، و دوباره، تا ابد
//
//  پس دو چیز سنجیده می‌شود: مرز هنوز واقعی است، و پنل مسیری می‌دهد که از آن
//  مرز رد می‌شود.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import path from 'node:path';

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};

const { resolveAiDir, aiDataDir, aiChildEnv } = await import('../src/ai/supervisor.js');
const { config, SERVER_ROOT } = await import('../src/config.js');

const aiDir = resolveAiDir();
if (!aiDir) {
  console.log('  ⏭️  پوشهٔ ai-support کنارِ پنل نیست — این آزمون رد شد.');
  process.exit(0);
}

/** مرزِ خودِ سرویس را در پروسهٔ جدا اجرا کن و بگو قبول شد یا نه */
function boundary(dataDir) {
  return new Promise((resolve) => {
    const code = `
      process.env.AI_DATA_DIR = ${JSON.stringify(dataDir)};
      const { runBoundaryChecks } = await import(${JSON.stringify(
        path.join(aiDir, 'src', 'security', 'guard.js')
      )});
      const r = runBoundaryChecks();
      console.log(JSON.stringify({ ok: r.ok, problems: r.problems }));
    `;
    const p = spawn(process.execPath, ['--input-type=module', '-e', code], {
      cwd: aiDir,
      // محیطِ پاک: نباید AI_* های همین پروسه نتیجه را عوض کند
      env: { PATH: process.env.PATH, HOME: process.env.HOME, AI_DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', () => {
      try { resolve(JSON.parse(out.trim().split('\n').pop())); }
      catch { resolve({ ok: false, problems: [out.slice(-200)] }); }
    });
  });
}

console.log('\n── مرزِ امنیتیِ سرویس هنوز واقعی است ──');
const inPanel = path.join(config.dataDir, 'ai-support');
const bad = await boundary(inPanel);
check('پوشهٔ داده داخلِ درختِ پنل رد می‌شود', bad.ok === false, JSON.stringify(bad.problems));
check('و دلیلش را می‌گوید',
  bad.problems.some((x) => /AI_DATA_DIR/.test(x)), JSON.stringify(bad.problems));

console.log('\n── و پنل مسیری می‌دهد که از این مرز رد می‌شود ──');
const chosen = aiDataDir(aiDir);
check('مسیرِ انتخابیِ پنل داخلِ درختِ پنل نیست',
  path.relative(path.resolve(SERVER_ROOT, '..'), chosen).startsWith('..'), chosen);

const good = await boundary(chosen);
check('دستیار با این مسیر بالا می‌آید', good.ok === true, JSON.stringify(good.problems));

// و چیزی که پنل واقعاً پاس می‌دهد باید همین باشد
const env = aiChildEnv(aiDir);
check('همان مسیر است که به پروسهٔ فرزند داده می‌شود', env.AI_DATA_DIR === chosen, env.AI_DATA_DIR);
check('و بدونِ درخواستِ صریح، اجازهٔ «پوشهٔ بیرونی» داده نمی‌شود',
  config.aiDataDir ? env.AI_ALLOW_EXTERNAL_DATA_DIR === '1' : !env.AI_ALLOW_EXTERNAL_DATA_DIR,
  String(env.AI_ALLOW_EXTERNAL_DATA_DIR));

console.log(`\n${failed ? '❌' : '✅'} ${passed} سبز، ${failed} قرمز`);
process.exit(failed ? 1 : 0);
