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

/* ------------------------- زیردامنهٔ API از یک دامنه ---------------------- */

/*
 *  از دامنه‌ای که کاربر می‌نویسد، آدرسِ API ساخته می‌شود:
 *      yaqobipump.top  →  api.yaqobipump.top
 *
 *  فقط روی دامنهٔ ریشه. اگر کاربر «shop.yaqobipump.top» را وارد کند،
 *  «api.shop.yaqobipump.top» ساخته نمی‌شود — آدرسِ کلاینت‌ها باید یکی باشد،
 *  نه یکی به‌ازای هر زیردامنه.
 */

/**
 * پسوندهایی که خودشان دو تکه‌اند. بدونِ این فهرست، «example.co.uk» یک
 * زیردامنه به نظر می‌رسید و آدرسِ API برایش ساخته نمی‌شد.
 * فهرست کامل نیست و لازم هم نیست باشد: هرچه این‌جا نباشد فقط یعنی کاربر
 * باید api.<دامنه> را دستی اضافه کند، نه اینکه چیزی خراب شود.
 */
const TWO_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au', 'edu.au',
  'co.nz', 'co.za', 'co.jp', 'or.jp', 'ne.jp',
  'com.br', 'com.mx', 'com.ar', 'com.tr', 'com.cn', 'com.hk', 'com.sg',
  'co.ir', 'ac.ir', 'org.ir', 'net.ir', 'gov.ir', 'id.ir',
  'co.in', 'net.in', 'org.in',
]);

/** نقش‌هایی که خودشان زیردامنه‌اند — روی این‌ها دوباره api. نمی‌نشیند */
const ROLE_PREFIXES = new Set([...ROLES, 'www']);

/**
 * ریشهٔ قابلِ ثبتِ یک دامنه — «www.» و پسوندهای دوتکه‌ای را می‌فهمد.
 * @returns {string|null} مثلاً yaqobipump.top، یا null اگر زیردامنه باشد
 */
export function registrableRoot(raw) {
  const clean = cleanDomain(raw);
  if (!clean) return null;
  const labels = clean.replace(/^www\./, '').split('.');
  const suffixLabels = TWO_PART_SUFFIXES.has(labels.slice(-2).join('.')) ? 2 : 1;
  return labels.length === suffixLabels + 1 ? labels.join('.') : null;
}

/**
 * ریشهٔ دامنه — از *هر* نامی، حتی زیردامنه.
 *
 *      sync.vill3n.top   →  vill3n.top
 *      a.b.yaqobi.co.ir  →  yaqobi.co.ir
 *      vill3n.top        →  vill3n.top
 *
 * ⚠️ فرقش با registrableRoot این است که آن یکی برای زیردامنه null می‌دهد
 * («این خودش ریشه نیست»). آن معنی جای خودش لازم است، ولی برای ساختنِ
 * زیردامنه‌های نقش‌دار غلط بود: کسی که تونلش روی sync.example.com نشسته،
 * ریشه‌اش example.com است و باید admin.example.com بگیرد — نه هیچ‌چیز.
 * همین باعث شده بود برنامهٔ مدیر هیچ آدرسی نداشته باشد و به آدرسِ تونل
 * بیفتد، که اصلاً پنل را سرو نمی‌کند.
 */
export function rootOf(raw) {
  const clean = cleanDomain(raw);
  if (!clean) return null;
  const labels = clean.replace(/^www\./, '').split('.');
  const suffixLabels = TWO_PART_SUFFIXES.has(labels.slice(-2).join('.')) ? 2 : 1;
  const keep = suffixLabels + 1;
  return labels.length >= keep ? labels.slice(-keep).join('.') : null;
}

/**
 * آدرسِ APIِ یک دامنه.
 * @returns {string|null} api.<ریشه>، یا null اگر دامنه ریشه نباشد یا خودش
 *   یکی از زیردامنه‌های نقش‌دار (api/admin/files) باشد.
 */
export function apiHostFor(raw) {
  const clean = cleanDomain(raw);
  if (!clean) return null;
  const first = clean.split('.')[0];
  // api.foo.com که دوباره api.api.foo.com نشود
  if (ROLE_PREFIXES.has(first) && first !== 'www') return null;
  /*
   *  ⚠️ عمداً registrableRoot و نه rootOf.
   *
   *  اگر کسی زیردامنه‌ای مثلِ shop.example.com را به‌عنوان سایت اضافه کند،
   *  نباید api.example.com ساخته شود: شاید کلِ example.com اصلاً مالِ او
   *  نباشد و رکوردِ DNS جای دیگری بنشیند. آدرسِ API فقط از دامنه‌ای می‌آید
   *  که خودش ریشه است.
   */
  const root = registrableRoot(clean);
  return root ? `api.${root}` : null;
}

/**
 * آدرسِ برنامهٔ مدیر روی هر دامنه: `admin.<دامنه>`.
 *
 *      📱 ویلن ادمین → https://admin.yaqobipump.top → ☁️ → 🏠 سرور
 *
 *  ⚠️ چرا زیردامنهٔ جدا و نه همان دامنهٔ اصلی: روی دامنهٔ اصلی، سایت و
 *  APIِ عمومی نشسته‌اند و هر کسی می‌تواند بازشان کند. این یکی فقط یک در
 *  دارد و آن هم بی کلیدِ همان گوشی باز نمی‌شود — پس هرچه پشتش است، از
 *  بقیهٔ دامنه جدا می‌ماند.
 */
export function adminHostFor(raw) {
  const clean = cleanDomain(raw);
  if (!clean) return null;
  const first = clean.split('.')[0];
  if (ROLE_PREFIXES.has(first) && first !== 'www') return null;
  const root = rootOf(clean);
  return root ? `admin.${root}` : null;
}
