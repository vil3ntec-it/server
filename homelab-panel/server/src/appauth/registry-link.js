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
import { getApp as getCodeApp, ensureApp as ensureCodeApp, rotateKey, syncAppKey } from '../codes/store.js';
import { db } from '../db.js';
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
    if (client.api_key) codeApp = syncAppKey(key, client.api_key, client.api_key_hint);
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
    client = syncClientKey(key, codeApp.api_key, codeApp.api_key_hint) || client;
    linked = true;
  }

  return { codeApp, client, linked };
}

/**
 * کلیدِ تازهٔ **مشترکِ** هر دو دفتر (C-04، ۱.۵۳.۳) — ساختن و چرخاندن از هر دو صفحهٔ پنل.
 *
 * روی دیسک فقط هش است، پس خامِ کلید فقط همین یک بار برمی‌گردد و صدازننده همان را در پاسخ نشان می‌دهد. تا ۱.۵۳.۲ چرخاندن از
 * صفحهٔ «برنامه‌ها» فقط دفترِ ورود را عوض می‌کرد و `linkApp` ِ بعدی کلیدِ دفترِ کدها را رویش می‌نشاند؛ با کلیدِ ناپیدا این یعنی
 * برنامهٔ قفل‌شده. حالا هر دو دفتر همان هش را می‌گیرند.
 *
 * @returns {string|null} کلیدِ خام، یا null اگر برنامه در هیچ دفتری نیست
 */
export function issueSharedKey(slug, { name = null, kind = 'app' } = {}) {
  const key = cleanApp(slug);
  db.exec('BEGIN IMMEDIATE');
  try {
    const { codeApp, client } = linkApp(key, { name, kind });
    let raw = null;
    if (codeApp && client) {
      const { row, key: freshKey } = rotateKey(key);
      syncClientKey(key, row.api_key, row.api_key_hint);
      raw = freshKey;
    }
    db.exec('COMMIT');
    return raw;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** هست یا نه — در هر کدام از دو دفتر */
export function knownApp(slug) {
  const key = cleanApp(slug);
  return Boolean(getCodeApp(key) || getClient(key));
}
