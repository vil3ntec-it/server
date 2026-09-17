// ---------------------------------------------------------------------------
//  یک برنامه، دو دفتر — پلی که نگذارد نصفه بماند
//
//  ⚠️ این فایل از یک باگِ واقعی درآمد. سرور دو دفترِ برنامه دارد:
//
//      code_apps    (src/codes/store.js)    — بخشِ «کدهای شش‌رقمی» پنل
//      app_clients  (src/appauth/clients.js) — بخشِ «برنامه‌ها»ی ورود
//
//  و دو مسیرِ ورود، هر کدام فقط یکی را می‌شناسند:
//
//      /api/codes/request      → code_apps
//      /api/app/auth/request-code → app_clients
//
//  تا دیروز این پنهان بود، چون هر مسیر برنامهٔ ناشناخته را خودش خاموشی
//  ثبت می‌کرد. وقتی آن ثبتِ بی‌حساب بسته شد، حقیقت بیرون زد: برنامه‌ای که
//  در پنل ثبت می‌کردی، *نصفِ* سرور نمی‌شناختش و ورودش «unknown_app»
//  می‌گرفت. یک آزمونِ سرتاسری همان‌جا گرفتش.
//
//  ⚠️ چرا دو دفتر را یکی نکردم: هر کدام ستون‌ها، تنظیمات و صفحهٔ خودش را
//  در پنل دارد. یکی کردنشان یک بازنویسیِ بزرگ است با ریسکِ از دست رفتنِ
//  تنظیماتِ موجود. پلی زدن هم مشکل را کامل حل می‌کند و هم چیزی را
//  نمی‌شکند: ثبت در هر کدام، آن یکی را هم می‌سازد — با **همان کلید**، تا
//  یک کلید روی هر دو مسیر کار کند.
// ---------------------------------------------------------------------------
import { getApp as getCodeApp, ensureApp as ensureCodeApp } from '../codes/store.js';
import { getClient, ensureClient, syncClientKey } from './clients.js';
import { cleanApp } from './identity.js';

/**
 * برنامه را در هر دو دفتر می‌سازد/هم‌تراز می‌کند.
 *
 * @param {string} slug
 * @param {object} [o]
 * @param {string} [o.name]  نامِ نمایشی، اگر تازه ساخته شود
 * @param {string} [o.kind]  app | site
 * @returns {{codeApp:object|null, client:object|null, linked:boolean}}
 */
export function linkApp(slug, { name = null, kind = 'app' } = {}) {
  const key = cleanApp(slug);
  if (!key) return { codeApp: null, client: null, linked: false };

  let codeApp = getCodeApp(key);
  let client = getClient(key);
  if (!codeApp && !client) return { codeApp: null, client: null, linked: false };

  let linked = false;

  // در دفترِ کدها هست ولی در دفترِ ورود نه
  if (codeApp && !client) {
    client = ensureClient(key, { name: name || codeApp.name || key, kind: codeApp.kind || kind });
    linked = true;
  }
  // در دفترِ ورود هست ولی در دفترِ کدها نه
  if (client && !codeApp) {
    codeApp = ensureCodeApp(key, { name: name || client.name || key, kind: client.kind || kind });
    linked = true;
  }

  /*
   *  ⚠️ و کلید باید یکی باشد.
   *
   *  بی این، برنامه‌ای که کلیدش را از صفحهٔ «کدهای شش‌رقمی» برداشته بود،
   *  روی مسیرِ ورود ۴۰۱ می‌گرفت — و برعکس. یعنی دو کلید برای یک برنامه،
   *  و صاحبِ سرور نمی‌دانست کدام را کجا بگذارد.
   *
   *  کلیدِ دفترِ کدها مرجع است، چون همان چیزی است که در صفحهٔ کدهای
   *  شش‌رقمی دیده و کپی می‌شود.
   */
  if (codeApp?.api_key && client && client.api_key !== codeApp.api_key) {
    client = syncClientKey(key, codeApp.api_key) || client;
    linked = true;
  }

  return { codeApp, client, linked };
}

/** هست یا نه — در هر کدام از دو دفتر */
export function knownApp(slug) {
  const key = cleanApp(slug);
  return Boolean(getCodeApp(key) || getClient(key));
}
