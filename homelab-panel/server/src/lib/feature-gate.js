// ---------------------------------------------------------------------------
//  درِ قابلیت‌های «فقط خانه» — یک جا، با یک پاسخ
//
//  نمایهٔ استقرار (‎src/deploy.js‎) می‌گوید کدام قابلیت روشن است؛ این‌جا همان
//  تصمیم سرِ درِ هر بخش می‌نشیند. ⛔ خاموش یعنی **نبودن**، نه خطا: پاسخِ روشنِ
//  ‎feature_disabled‎ با نامِ متغیری که روشنش می‌کند — نه ۵۰۰، نه پروسهٔ نیمه‌کاره.
// ---------------------------------------------------------------------------
import { deploy } from '../config.js';

const LABELS = Object.freeze({
  terminal: 'ترمینال',
  files: 'فایل‌منیجر',
  databases: 'مدیریتِ دیتابیس‌های همین کامپیوتر',
  sites: 'اجرای پروسهٔ سایت‌ها',
  docker: 'داکرِ همین کامپیوتر',
  agent: 'دستیارِ هوشمند',
  update: 'به‌روزرسانیِ درجای پنل',
});

export function featureOn(name) {
  return deploy.features[name] === true;
}

/** پاسخِ یکسانِ «این‌جا نیست» — برای مسیرها و برای تابع‌ها */
export function disabledPayload(name) {
  const why = name === 'update'
    ? `روی میزبانِ «${deploy.profile}» کد جزوِ ایمیج است — ایمیجِ تازه بکشید (docs/DEPLOY-ANYWHERE-fa.md).`
    : `روی میزبانِ «${deploy.profile}» خاموش است — فقط آگاهانه با HLP_FEATURE_${name.toUpperCase()}=1 روشن می‌شود.`;
  return {
    ok: false,
    error: 'feature_disabled',
    feature: name,
    profile: deploy.profile,
    message: `${LABELS[name] || name} ${why}`,
  };
}

/** میان‌افزارِ Express: پیش از روترِ همان بخش */
export function featureGate(name) {
  return (req, res, next) => (featureOn(name) ? next() : res.status(403).json(disabledPayload(name)));
}
