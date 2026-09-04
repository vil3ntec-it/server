// ---------------------------------------------------------------------------
//  ساختنِ «تعمیر-خودکار.bat» از روی auto-fix.ps1 و auto-fix.mjs
//      node homelab-panel/desktop/build-auto-fix.mjs
//
//  چرا با اسکریپت و نه دستی: باید سه چیز هم‌زمان درست بماند و هر سه‌شان قبلاً
//  یک بار فایل را شکسته‌اند —
//
//    ۱) سربرگِ batch باید ASCII خالص باشد. cmd خط‌ها را با کدپیجِ ANSI
//       می‌خواند؛ یک حرفِ فارسی آن بالا یعنی «'▯▯▯' is not recognized».
//    ۲) هرچه پس از #PSCODE# است PowerShell است و cmd سرِ «exit /b» می‌ایستد و
//       نمی‌خواندش — به شرطی که هیچ‌جای دیگری آن نشان تکرار نشود.
//    ۳) متنِ auto-fix.mjs داخلِ یک here-stringِ تک‌گیومه‌ای می‌نشیند، پس هیچ
//       خطی از آن نباید با '@ شروع شود وگرنه رشته وسطِ کار بسته می‌شود.
//
//  هر سه این‌جا بررسی می‌شوند و اگر یکی بخورد، ساخت متوقف می‌شود.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, '..', '..');
const OUT = path.join(repo, 'تعمیر-خودکار.bat');
const MARKER = '#PSCODE#';

const brain = fs.readFileSync(path.join(here, 'auto-fix.mjs'), 'utf8');
let shell = fs.readFileSync(path.join(here, 'auto-fix.ps1'), 'utf8');

// ── بررسیِ ۳ ──────────────────────────────────────────────────────────────
const badLine = brain.split('\n').findIndex((l) => l.trimStart().startsWith("'@"));
if (badLine !== -1) {
  throw new Error(`auto-fix.mjs خطِ ${badLine + 1} با '@ شروع می‌شود — here-string را می‌شکند`);
}

// جاگذاریِ مغز
const slot = /^\$EmbeddedBrain = ''.*$/m;
if (!slot.test(shell)) throw new Error("جای $EmbeddedBrain در auto-fix.ps1 پیدا نشد");
shell = shell.replace(slot, `$EmbeddedBrain = @'\n${brain.replace(/\r\n/g, '\n')}\n'@`);

// ── سربرگِ batch — ASCII خالص، بدونِ پرانتزِ بلوکی، بدونِ گیومهٔ بی‌قرینه ──
const header = [
  '@echo off',
  'setlocal',
  'title Automatic repair - server address',
  'set "AUTOFIX_HERE=%~dp0"',
  'powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=[IO.File]::ReadAllText(\'%~f0\');$i=$c.LastIndexOf(\'#PSCODE#\');Invoke-Expression $c.Substring($i+8)"',
  'exit /b %ERRORLEVEL%',
  MARKER,
  '',
].join('\r\n');

// ── بررسیِ ۱ ──────────────────────────────────────────────────────────────
if (/[^\x09\x0a\x0d\x20-\x7e]/.test(header)) throw new Error('سربرگِ batch ASCII خالص نیست');

// ── بررسیِ ۲ — نشان فقط دو بار: یکی در دستور، یکی خودِ نشان ────────────────
const body = `${header}${shell.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')}`;
const hits = body.split(MARKER).length - 1;
if (hits !== 2) throw new Error(`نشانِ ${MARKER} باید دقیقاً دو بار باشد، ${hits} بار است`);
if (body.charCodeAt(0) === 0xfeff) throw new Error('فایل BOM دارد — cmd خطِ اول را نمی‌فهمد');

fs.writeFileSync(OUT, body, 'utf8');   // بدونِ BOM
console.log(`✅ ${path.relative(repo, OUT)} — ${(Buffer.byteLength(body) / 1024).toFixed(1)} کیلوبایت`);
