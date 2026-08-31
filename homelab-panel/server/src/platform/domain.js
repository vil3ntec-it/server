// ---------------------------------------------------------------------------
//  دامنهٔ مرکزی — تنها جایی که «نامِ سرویس‌ها» تعریف می‌شود
//
//  کلاینت‌ها (موبایل، دسکتاپ، وب) هرگز IP سرور را نمی‌دانند؛ فقط یک نام:
//      https://api.<domain>
//  اگر روزی سرور از خانه به VPS برود، فقط رکوردِ DNS عوض می‌شود و هیچ
//  برنامه‌ای به‌روزرسانی نمی‌خواهد.
//
//  نبودِ دامنه خطا نیست: سرور در «حالتِ شبکهٔ خانگی» بالا می‌آید و همان‌طور
//  که تا امروز کار می‌کرد کار می‌کند. نصبِ یک‌کلیکی نباید به تنظیمِ دامنه
//  گره بخورد.
// ---------------------------------------------------------------------------

/** نامِ دامنه را تمیز می‌کند: بدون پروتکل، بدون مسیر، بدون پورت، بدون نقطهٔ آخر */
export function cleanDomain(raw) {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')   // https://
    .replace(/[/?#].*$/, '')        // مسیر و کوئری
    .replace(/:\d+$/, '')           // پورت
    .replace(/\.+$/, '');           // نقطهٔ پایانیِ FQDN
  if (!s) return null;
  // یک دامنهٔ معتبر: برچسب‌های حرف/عدد/خط‌تیره، دستِ‌کم یک نقطه
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s)) return null;
  return s;
}

/** آدرسِ کامل را تمیز می‌کند (بدون اسلشِ آخر)؛ اگر بی‌اعتبار بود null */
export function cleanUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/**
 * زیردامنه‌های استاندارد. نام‌ها قابلِ تغییرند ولی نقش‌ها ثابت:
 *   api   → تنها آدرسی که کلاینت‌ها می‌شناسند
 *   admin → پنلِ مدیریت (سطحِ اعتمادِ متفاوت، پس نامِ متفاوت)
 *   files → فایل و دانلود
 */
const ROLES = ['api', 'admin', 'files'];

export function buildDomains(env = process.env) {
  const root = cleanDomain(env.HLP_DOMAIN);

  if (!root) {
    return {
      configured: false,
      root: null,
      www: null,
      api: null,
      admin: null,
      files: null,
      hosts: [],
      apiUrl: cleanUrl(env.HLP_API_URL),
    };
  }

  const map = { root, www: `www.${root}` };
  for (const role of ROLES) {
    map[role] = cleanDomain(env[`HLP_${role.toUpperCase()}_DOMAIN`]) || `${role}.${root}`;
  }

  return {
    configured: true,
    ...map,
    // همهٔ نام‌هایی که این سرور پاسخگوی آن‌هاست — مصرف در CORS و مسیریابیِ لبه
    hosts: [...new Set([map.root, map.www, ...ROLES.map((r) => map[r])])],
    // آدرسی که به کلاینت‌ها اعلام می‌شود؛ قابلِ بازنویسی برای حالتِ CDN
    apiUrl: cleanUrl(env.HLP_API_URL) || `https://${map.api}`,
  };
}

export const domains = buildDomains();
