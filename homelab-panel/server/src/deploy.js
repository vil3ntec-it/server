// ---------------------------------------------------------------------------
//  ══ کجا اجرا می‌شویم؟ — نمایهٔ استقرار (۱۴۰۵/۰۸/۰۹) ═══════════════════════
//
//  دستورِ صاحب محصول: «برنامهٔ سرور قابلِ جابه‌جایی شود — از کامپیوترِ خانه به
//  سرورِ اجاره‌ای (VPS)، داکر یا میزبان‌های دیگر — فقط با تنظیم، بی تغییرِ کد.»
//
//  پنل تا امروز یک فرضِ پنهان داشت: «روی کامپیوترِ خانهٔ صاحب سامانه‌ام».
//  ترمینال، فایل‌منیجر، اجرای پروسهٔ سایت‌ها، کشفِ شبکهٔ خانه و تونل همه بر
//  همین فرض‌اند. روی سرورِ عمومی همان‌ها درِ خطرند. این فایل **تنها جایی** است
//  که می‌گوید کجاییم و هر قابلیت روشن است یا نه.
//
//    HLP_DEPLOY = home (پیش‌فرض) · vps · docker · paas
//
//  ⛔ home یعنی دقیقاً همان رفتارِ امروز — هیچ پیش‌فرضی عوض نمی‌شود و هر
//     متغیرِ قدیمی (‎HLP_DISCOVERY‎ · ‎HLP_TUNNEL‎ · ‎HLP_AGENT‎ · ‎HLP_TRUST_PROXY‎
//     · ‎HLP_STATIONS_ENROLL‎ · ‎HLP_PANEL_LAN_ONLY‎) با **همان معنای قدیمش**
//     خوانده می‌شود: فقط «0» خاموش است.
//  ⛔ هر قابلیت را می‌شود جدا روشن/خاموش کرد: ‎HLP_FEATURE_<نام>=1|0‎ — و این
//     از هر دو (نمایه و متغیرِ قدیمی) جلوتر است.
//  ⛔ هاستِ اشتراکی (cPanel) نمایهٔ پنل نیست: پنل دو پورت، پروسهٔ همیشه‌روشن و
//     پروسهٔ فرزند می‌خواهد. آن‌جا فقط سرورِ حساب می‌نشیند
//     (‎docs/DEPLOY-ANYWHERE-fa.md‎ §۵) — و پنل با پیامِ روشن بالا نمی‌آید.
//
//  این فایل خالص است (فقط ‎env‎ می‌خواند) تا آزمون بتواند هر ترکیبی را بسنجد.
// ---------------------------------------------------------------------------

import { LOCAL_NETS } from './lib/lan-guard.js';

export const PROFILES = Object.freeze(['home', 'vps', 'docker', 'paas']);

/** نام‌هایی که مردم برای هاستِ اشتراکی می‌نویسند — همه یک پیامِ روشن می‌گیرند */
const SHARED_NAMES = new Set(['shared', 'shared-hosting', 'cpanel', 'passenger', 'hosting']);

/** شبکه‌هایی که درِ پنل (پورتِ ۴۷۰۰) از آن‌ها اتصال می‌پذیرد — به تفکیکِ نمایه */
export const NETS = Object.freeze({
  //  همان فهرستِ امروزِ ‎lib/lan-guard.js‎ (شبکهٔ خانه) — خودِ همان، نه رونوشت
  lan: LOCAL_NETS,
  //  سرورِ اجاره‌ای: «شبکهٔ خصوصی»ِ دیتاسنتر شبکهٔ خانه نیست (گاهی میانِ
  //  مشتری‌ها مشترک است). فقط خودِ سرور و Tailscale.
  tailscale: Object.freeze(['127.0.0.0/8', '::1/128', '100.64.0.0/10', 'fd7a:115c:a1e0::/48']),
  //  میزبانِ کانتینری: فقط خودِ کانتینر؛ بقیه با ‎HLP_PANEL_NETS‎ افزوده می‌شود
  loopback: Object.freeze(['127.0.0.0/8', '::1/128']),
});

/**
 * پیش‌فرضِ هر نمایه.
 *
 *  terminal · files · databases · sites · docker  ⇒ درهای «کنترلِ کاملِ همین
 *    کامپیوتر» (فرمانِ دلخواه، خواندن/نوشتنِ دیسک، اجرای پروسه). روی میزبانِ
 *    عمومی پیش‌فرض خاموش؛ فقط با ‎HLP_FEATURE_*=1‎ و آگاهانه.
 *  agent      ⇒ دستیار (Ollama روی همین کامپیوتر + ابزارهایش)
 *  update     ⇒ نصبِ خودکار/دستیِ نسخهٔ تازهٔ پنل روی خودِ پوشهٔ کد. در داکر و
 *               PaaS کد جزوِ ایمیج است: به‌روزرسانی یعنی ایمیجِ تازه.
 *  discovery  ⇒ پخشِ UDP در شبکهٔ خانه تا برنامه‌ها سرور را بی IP پیدا کنند
 *  tunnel     ⇒ بالا آمدنِ خودکارِ تونلِ Cloudflare (دستی همیشه شدنی است)
 */
const DEFAULTS = Object.freeze({
  home: {
    features: { terminal: true, files: true, databases: true, sites: true, docker: true, agent: true, update: true, discovery: true, tunnel: true },
    trustProxy: false, enroll: 'lan', nets: 'lan',
  },
  vps: {
    features: { terminal: false, files: false, databases: false, sites: false, docker: false, agent: false, update: true, discovery: false, tunnel: false },
    trustProxy: false, enroll: 'off', nets: 'tailscale',
  },
  docker: {
    //  شبکهٔ داکر خصوصیِ همان میزبان است و پورتِ پنل منتشر نمی‌شود (یا فقط روی
    //  ‎127.0.0.1‎ِ میزبان) ⇒ Caddy از ‎172.x‎ می‌آید و باید برسد.
    features: { terminal: false, files: false, databases: false, sites: false, docker: false, agent: false, update: false, discovery: false, tunnel: false },
    trustProxy: true, enroll: 'off', nets: 'lan',
  },
  paas: {
    features: { terminal: false, files: false, databases: false, sites: false, docker: false, agent: false, update: false, discovery: false, tunnel: false },
    trustProxy: true, enroll: 'off', nets: 'loopback',
  },
});

/** نامِ متغیرِ قدیمیِ هر قابلیت — با همان معنای قدیم (فقط «0» خاموش) */
const LEGACY = Object.freeze({ agent: 'HLP_AGENT', discovery: 'HLP_DISCOVERY', tunnel: 'HLP_TUNNEL' });

/** قابلیت‌هایی که روشن بودنشان روی میزبانِ عمومی هشدار می‌خواهد */
const DANGEROUS = Object.freeze(['terminal', 'files', 'databases', 'sites', 'docker']);

export const FEATURE_NAMES = Object.freeze(Object.keys(DEFAULTS.home.features));

const TRUE = new Set(['1', 'true', 'on', 'yes']);
const FALSE = new Set(['0', 'false', 'off', 'no']);

/** ‎"1"/"true"/"on"/"yes"‎ ⇒ true · ‎"0"/…‎ ⇒ false · بقیه ⇒ null (نامعتبر) */
export function parseBool(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  return null;
}

const defined = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/**
 * نمایهٔ استقرار از روی محیط.
 *
 * @returns {{
 *   profile: string, home: boolean,
 *   features: Record<string, boolean>, sources: Record<string, string>,
 *   trustProxy: boolean, enroll: 'lan'|'off'|'open',
 *   panel: { guard: boolean, nets: string[], netsName: string, public: boolean, url: string },
 *   errors: string[], warnings: string[],
 * }}
 */
export function resolveDeploy(env = process.env) {
  const errors = [];
  const warnings = [];

  const rawProfile = String(env.HLP_DEPLOY ?? '').trim().toLowerCase();
  let profile = rawProfile || 'home';
  if (SHARED_NAMES.has(profile)) {
    errors.push(
      `HLP_DEPLOY=${rawProfile}: پنل روی هاستِ اشتراکی (cPanel/Passenger) اجرا نمی‌شود — دو پورت، پروسهٔ همیشه‌روشن و ` +
      'پروسهٔ فرزند می‌خواهد. روی هاستِ اشتراکی فقط سرورِ حساب را بگذارید و پنل را در خانه یا یک VPS ' +
      'با HLP_ACCOUNT_API به آن وصل کنید (docs/DEPLOY-ANYWHERE-fa.md، بخشِ هاستِ اشتراکی).',
    );
    profile = 'home';
  } else if (!PROFILES.includes(profile)) {
    errors.push(`HLP_DEPLOY=${rawProfile} شناخته نیست — یکی از: ${PROFILES.join(' · ')}`);
    profile = 'home';
  }
  const base = DEFAULTS[profile];
  const home = profile === 'home';

  // ── قابلیت‌ها: HLP_FEATURE_* ⇒ متغیرِ قدیمی ⇒ پیش‌فرضِ نمایه ─────────────
  const features = {};
  const sources = {};
  for (const name of FEATURE_NAMES) {
    const key = `HLP_FEATURE_${name.toUpperCase()}`;
    if (defined(env[key])) {
      const v = parseBool(env[key]);
      if (v === null) {
        //  مقدارِ نامفهوم روی قابلیتِ خطرناک ⇒ خاموش (بسته شکست بخورد، نه باز)
        features[name] = DANGEROUS.includes(name) ? false : base.features[name];
        sources[name] = 'invalid';
        warnings.push(`${key}=${env[key]} نامفهوم است — ${features[name] ? 'روشن' : 'خاموش'} ماند (فقط 1 یا 0)`);
      } else {
        features[name] = v;
        sources[name] = key;
      }
      continue;
    }
    const legacy = LEGACY[name];
    if (legacy && env[legacy] !== undefined) {
      features[name] = env[legacy] !== '0';
      sources[name] = legacy;
      continue;
    }
    features[name] = base.features[name];
    sources[name] = 'profile';
  }

  // ── پراکسی، ثبتِ پمپ و درِ پنل ─────────────────────────────────────────
  const trustProxy = env.HLP_TRUST_PROXY !== undefined ? env.HLP_TRUST_PROXY !== '0' : base.trustProxy;
  const enroll = ['lan', 'off', 'open'].includes(env.HLP_STATIONS_ENROLL) ? env.HLP_STATIONS_ENROLL : base.enroll;
  const guard = (env.HLP_PANEL_LAN_ONLY ?? '1') !== '0';
  const panelPublic = parseBool(env.HLP_PANEL_PUBLIC) === true;
  const panelUrl = String(env.HLP_PANEL_URL || '').trim().replace(/\/+$/, '');
  const tlsDirect = Boolean(env.HLP_TLS_CERT && env.HLP_TLS_KEY);

  if (!home) {
    for (const name of DANGEROUS) {
      if (features[name]) {
        warnings.push(`قابلیتِ «${name}» روی میزبانِ ${profile} روشن است — کنترلِ کاملِ همین سرور از پنل. فقط اگر واقعاً لازم است.`);
      }
    }
    if (enroll === 'open') {
      errors.push('HLP_STATIONS_ENROLL=open فقط برای آزمون است — روی سرورِ عمومی هر کسی از اینترنت پمپ ثبت می‌کرد.');
    }
    if (!guard && !tlsDirect) {
      errors.push('HLP_PANEL_LAN_ONLY=0 روی میزبانِ عمومی بی TLS یعنی رمز و توکنِ پنل روی HTTPِ ساده در اینترنت — ' +
        'یا نگهبان را روشن بگذارید و از Tailscale/تونلِ SSH وارد شوید، یا HLP_PANEL_PUBLIC=1 پشتِ Caddy.');
    }
    if (!env.HLP_SECRET_KEY) {
      warnings.push('HLP_SECRET_KEY خالی است — رازِ نشست‌های پنل در دیتابیس ساخته می‌شود (کار می‌کند؛ ولی بهتر است از محیط بیاید).');
    }
    if (!env.HLP_DOMAIN && !env.HLP_API_URL) {
      warnings.push('نه HLP_DOMAIN هست نه HLP_API_URL — برنامه‌ها نشانیِ عمومیِ این سرور را از کجا بدانند؟');
    }
  }
  if (panelPublic) {
    if (!/^https:\/\/[^/\s]+$/i.test(panelUrl)) {
      errors.push('HLP_PANEL_PUBLIC=1 بی HLP_PANEL_URL=https://… پذیرفته نیست — پنل هرگز بی TLS عمومی نمی‌شود.');
    }
    if (!trustProxy) {
      errors.push('HLP_PANEL_PUBLIC=1 یعنی پنل پشتِ پراکسیِ TLS (Caddy) است ⇒ HLP_TRUST_PROXY=1 لازم است.');
    }
    if (!guard) {
      errors.push('HLP_PANEL_PUBLIC=1 با HLP_PANEL_LAN_ONLY=0 نمی‌شود — راهِ عمومی فقط از پراکسی است، نه مستقیم به پورتِ پنل.');
    }
  }
  if (!home && !trustProxy && (profile === 'docker' || profile === 'paas')) {
    warnings.push(`HLP_TRUST_PROXY=0 روی ${profile}: همهٔ کاربران با IPِ پراکسی دیده می‌شوند و سقفِ نرخ همه را با هم قفل می‌کند.`);
  }

  return {
    profile,
    home,
    features,
    sources,
    trustProxy,
    enroll,
    panel: {
      guard,
      netsName: base.nets,
      nets: [...NETS[base.nets]],
      public: panelPublic,
      url: panelPublic ? panelUrl : '',
    },
    errors,
    warnings,
  };
}

/** خلاصهٔ بی‌راز برای رابط (‎/api/auth/me‎) — هیچ مقدارِ محیطی جز نام‌ها نمی‌رود */
export function deploySummary(d) {
  return {
    profile: d.profile,
    home: d.home,
    features: { ...d.features },
    panelPublic: d.panel.public,
  };
}

/**
 * درخواستی که از راهِ پراکسی آمده (Caddy، تونل، درِ مدیر).
 *
 * ⚠️ در حالتِ «پنلِ عمومی» تنها نشانهٔ قابلِ اعتماد همین است: پراکسی همیشه
 * ‎X-Forwarded-For‎ می‌گذارد و کاربرِ اینترنت نمی‌تواند پاکش کند؛ راهِ خصوصی
 * (تونلِ SSH، Tailscale) مستقیم به پورتِ پنل می‌رسد و این سرآیندها را ندارد.
 * کسی که از راهِ خصوصی همین سرآیند را جعل کند فقط سخت‌گیریِ بیشتری می‌خرد.
 */
export function viaProxy(req) {
  const h = req?.headers || {};
  return Boolean(h['x-forwarded-for'] || h['cf-connecting-ip'] || h['x-real-ip'] || h.forwarded);
}
