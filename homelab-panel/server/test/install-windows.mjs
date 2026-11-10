// ---------------------------------------------------------------------------
//  آزمونِ «نصب‌کنندهٔ ویندوز فقط از main» (۱.۵۰.۸۵) — سنجشِ متنِ اسکریپت، بی اجرا
//      node test/install-windows.mjs
//
//  یافته: `install-windows.bat` وقتی `install.ps1` از main نمی‌رسید، به `master` و یک
//  شاخهٔ کهنهٔ `claude/…` برمی‌گشت، و `install.ps1` هم زیپِ برنامه را پس از main از
//  `master` می‌گرفت ⇒ زنجیرهٔ تأمین: هر که به آن شاخه‌ها بنویسد (یا شاخهٔ پاک‌شده را
//  دوباره بسازد) تعیین می‌کرد هر نصبِ تازه چه چیزی اجرا کند. حالا فقط main (یا شاخه‌ای
//  که صاحبِ کامپیوتر خودش با ‎-Branch‎ بگوید) و شکستِ روشن.
//
//  این آزمون نمی‌گذارد بازگشت برگردد، و قیدهای خودِ پرونده‌ها را هم نگه می‌دارد:
//  ‎.bat‎ فقط ASCII با CRLF (cmd.exe جز این را بد می‌خواند)، ‎.ps1‎ با BOM و CRLF.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', '..');
let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};

const batBytes = fs.readFileSync(path.join(ROOT, 'install-windows.bat'));
const ps1Bytes = fs.readFileSync(path.join(ROOT, 'install.ps1'));
const bat = batBytes.toString('latin1');
const ps1 = ps1Bytes.toString('utf8').replace(/^﻿/, '');

/** خط‌های اجراشدنی — بی REM/:: ِ batch و بی # ِ PowerShell */
const batCode = bat.split(/\r?\n/).filter((l) => !/^\s*(rem\b|::)/i.test(l));
const ps1Code = ps1.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s+#.*$/, ''));
const OTHER_BRANCH = /\bmaster\b|claude\/|refs\/heads\/(?!\$b\b)/i;

console.log('── install-windows.bat ──');
{
  const bad = batCode.filter((l) => OTHER_BRANCH.test(l));
  check('⛔ هیچ خطِ اجراشدنی شاخه‌ای جز main نام نمی‌برد (master، claude/…)', bad.length === 0, bad.join(' | '));
  const urls = [...bat.matchAll(/raw\.githubusercontent\.com[^\s"')]*/g)].map((m) => m[0]);
  check('install.ps1 فقط از یک نشانی گرفته می‌شود', urls.length === 1, JSON.stringify(urls));
  check('و آن نشانی شاخهٔ main است', batCode.some((l) => /raw\.githubusercontent\.com\/'\s*\+\s*\$env:CC_REPO\s*\+\s*'\/main\/homelab-panel\/install\.ps1/.test(l)),
    batCode.find((l) => l.includes('raw.githubusercontent')) || 'نشانی پیدا نشد');
  check('⛔ هیچ حلقه‌ای روی فهرستِ شاخه‌ها نیست', !batCode.some((l) => /foreach\s*\(\s*\$\w+\s+in\s+@\(/i.test(l)));
  check('شکستِ دانلود روشن گفته می‌شود و می‌ایستد (exit /b 1)',
    /Could not download install\.ps1 from the main branch/.test(bat) && /No other branch is tried/.test(bat)
    && /Could not download[\s\S]*?pause\r\nexit \/b 1/.test(bat));
  check('پرونده فقط ASCII است', batBytes.every((c) => c < 128));
  check('همهٔ پایانِ خط‌ها CRLF', (bat.match(/\n/g) || []).length === (bat.match(/\r\n/g) || []).length);
}

console.log('\n── install.ps1 ──');
{
  const bad = ps1Code.filter((l) => OTHER_BRANCH.test(l));
  check('⛔ هیچ خطِ اجراشدنی شاخه‌ای جز main نام نمی‌برد (master، claude/…)', bad.length === 0, bad.join(' | '));
  const def = ps1Code.find((l) => /\$branches\s*=/.test(l)) || '';
  check('پیش‌فرض فقط main؛ -Branch ِ صریحِ صاحبِ کامپیوتر همچنان', /if\s*\(\$Branch\)\s*\{\s*@\(\$Branch\)\s*\}\s*else\s*\{\s*@\("main"\)\s*\}/.test(def), def.trim());
  check('پارامترِ -Branch هست و پیش‌فرضش خالی', /\[string\]\$Branch\s*=\s*""/.test(ps1));
  check('شکستِ دانلود: پیامِ روشن «شاخهٔ دیگری امتحان نمی‌شود» و Fail', /if \(-not \$got\) \{ Fail "[^"]*شاخهٔ دیگری عمداً امتحان نمی‌شود/.test(ps1));
  check('BOM ِ UTF-8 و CRLF (پیام‌های فارسی در PowerShell 5.1)', ps1Bytes[0] === 0xef && ps1Bytes[1] === 0xbb && ps1Bytes[2] === 0xbf
    && (ps1.match(/\n/g) || []).length === (ps1.match(/\r\n/g) || []).length);
}

console.log(`\n${failed ? '❌' : '✅'} install-windows: ${passed} درست، ${failed} نادرست`);
process.exit(failed ? 1 : 0);
