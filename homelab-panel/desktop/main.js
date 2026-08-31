// ---------------------------------------------------------------------------
//  راه‌اندازِ برنامه — عمداً کوچک و عمداً بی‌تغییر
//
//  کارِ واقعیِ برنامه در app/main-impl.js است، نه اینجا. دلیلش این است:
//  فایلِ ورودیِ Electron داخلِ app.asar قفل است و بدونِ نصبِ دوبارهٔ کلِ
//  برنامه (~۸۵ مگابایت) عوض نمی‌شود. ولی این فایل می‌تواند نسخهٔ تازه‌تر را
//  از پوشهٔ به‌روزرسانی بردارد. پس به‌روزرسانی از داخلِ خودِ برنامه فقط
//  چند صد کیلوبایت دانلود می‌خواهد، نه یک نصب‌کنندهٔ تازه.
//
//  اگر نسخهٔ به‌روزرسانی‌شده بالا نیاید، برنامه خودش برمی‌گردد به نسخهٔ
//  همراهِ نصب. یک به‌روزرسانیِ خراب نباید برنامه را از کار بیندازد.
// ---------------------------------------------------------------------------
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packagedDir = path.join(here, 'app');
const overlayDir = path.join(app.getPath('userData'), 'app-update');

/** نشانهٔ «داشتم بالا می‌آمدم» — اگر بماند یعنی دفعهٔ قبل وسطِ راه مرد */
const bootFlag = path.join(overlayDir, '.booting');

function overlayUsable() {
  if (!fs.existsSync(path.join(overlayDir, 'main-impl.js'))) return false;
  // همهٔ فایل‌های لازم باید با هم آمده باشند
  for (const name of ['preload.cjs', 'shell.html', 'shell.css', 'shell.js']) {
    if (!fs.existsSync(path.join(overlayDir, name))) return false;
  }
  if (fs.existsSync(bootFlag)) {
    // دفعهٔ قبل با همین نسخه بالا نیامد — کنارش می‌گذاریم
    try {
      fs.renameSync(overlayDir, `${overlayDir}-broken-${Date.now()}`);
    } catch { /* دستِ‌کم از آن استفاده نمی‌کنیم */ }
    return false;
  }
  return true;
}

async function boot() {
  const useOverlay = overlayUsable();
  const implDir = useOverlay ? overlayDir : packagedDir;

  if (useOverlay) {
    try {
      fs.writeFileSync(bootFlag, String(Date.now()), 'utf8');
    } catch { /* بی‌خیال */ }
  }

  const context = {
    implDir,
    packagedDir,
    overlayDir,
    assetsDir: path.join(here, 'assets'),
    usingOverlay: useOverlay,
    /** وقتی پنجره واقعاً آمد، یعنی این نسخه سالم است */
    markBooted() {
      try {
        fs.rmSync(bootFlag, { force: true });
      } catch { /* بی‌خیال */ }
    },
  };

  try {
    const mod = await import(pathToFileURL(path.join(implDir, 'main-impl.js')).href);
    await mod.start(context);
  } catch (e) {
    if (!useOverlay) throw e;
    // به‌روزرسانی بالا نیامد — با نسخهٔ همراهِ نصب ادامه می‌دهیم
    console.error(`[boot] نسخهٔ به‌روزرسانی‌شده بالا نیامد، برگشت به نسخهٔ نصب: ${e.message}`);
    try {
      fs.renameSync(overlayDir, `${overlayDir}-broken-${Date.now()}`);
    } catch { /* بی‌خیال */ }
    const mod = await import(pathToFileURL(path.join(packagedDir, 'main-impl.js')).href);
    await mod.start({ ...context, implDir: packagedDir, usingOverlay: false });
  }
}

boot();
