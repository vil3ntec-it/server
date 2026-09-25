// ---------------------------------------------------------------------------
//  تجزیه‌کنندهٔ cron — فقط تجزیه و «اجرای بعدی کِی است»
//
//  ⛔ کارهای دلخواهِ کاربر (جدولِ cron_jobs، اجرای فرمانِ shell، صفحهٔ
//  «زمان‌بندی») در ۱.۵۰.۱۵ برداشته شدند: به کارِ سرورِ پمپ و دکان نبودند.
//  آن‌چه ماند همین تجزیه‌کننده است که موتورِ اتوماسیون (automation/engine.js)
//  زمان‌بندیِ کارهای خودِ پنل را با آن حساب می‌کند. مهاجرتِ 004_cron.js
//  عمداً می‌ماند تا دفترِ نصب‌های قدیمی بی‌خطا بالا بیاید.
//
//  یک تجزیه‌کنندهٔ cron کوچک و کاملاً درون‌خانگی. چرا کتابخانه نیاورده‌ایم:
//  کلِ کاری که لازم داریم «آیا این دقیقه با این الگو می‌خواند؟» است، و همان
//  در صد خط جا می‌شود — در برابرِ یک وابستگیِ تازه که باید سال‌ها نگه‌داری و
//  به‌روزرسانی شود.
//
//  الگوی پشتیبانی‌شده، همان پنج‌فیلدیِ متعارف:
//
//      دقیقه  ساعت  روزِ‌ماه  ماه  روزِ‌هفته
//        *      *      *       *       *
//
//  با  *  و  عدد  و  a-b  و  a,b,c  و  *​/n  و  a-b/n
//  نامِ ماه و روز (jan، mon) هم پذیرفته می‌شود چون آدم‌ها همان را می‌نویسند.
//
//  ⚠️ زمانِ محلیِ همین ماشین ملاک است، نه UTC — چون کاربر «هر شب ساعت ۲»
//  را به وقتِ خودش می‌گوید.
// ---------------------------------------------------------------------------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** میان‌برهایی که مردم می‌نویسند و انتظار دارند کار کند */
const ALIASES = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dom', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS, offset: 1 },
  { name: 'dow', min: 0, max: 6, names: DAYS, offset: 0 },
];

function fail(code, detail = null) {
  return { ok: false, error: code, detail };
}

/** یک فیلد را به مجموعه‌ای از عددهای مجاز تبدیل می‌کند */
function parseField(text, spec) {
  const values = new Set();

  for (const part of String(text).split(',')) {
    const piece = part.trim().toLowerCase();
    if (!piece) return null;

    // a-b/n یا */n
    const [rangePart, stepPart] = piece.split('/');
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) return null;

    let from;
    let to;

    if (rangePart === '*') {
      from = spec.min;
      to = spec.max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      from = toNumber(a, spec);
      to = toNumber(b, spec);
    } else {
      from = toNumber(rangePart, spec);
      to = from;
    }

    if (from === null || to === null) return null;
    // یکشنبه هم ۰ است هم ۷ — هر دو را می‌پذیریم
    if (spec.name === 'dow') {
      if (from === 7) from = 0;
      if (to === 7) to = 0;
    }
    if (from > to || from < spec.min || to > spec.max) return null;

    for (let v = from; v <= to; v += step) values.add(v);
  }

  return values.size ? values : null;
}

function toNumber(token, spec) {
  const text = String(token).trim().toLowerCase();
  if (spec.names) {
    const idx = spec.names.indexOf(text.slice(0, 3));
    if (idx >= 0) return idx + (spec.offset ?? 0);
  }
  const n = Number(text);
  return Number.isInteger(n) ? n : null;
}

/** الگو را به پنج مجموعه تبدیل می‌کند، یا می‌گوید چرا نشد */
export function parseSchedule(expression) {
  const raw = String(expression ?? '').trim().toLowerCase();
  if (!raw) return fail('empty_schedule');

  const text = ALIASES[raw] ?? raw;
  const parts = text.split(/\s+/);
  if (parts.length !== 5) return fail('need_five_fields');

  const sets = [];
  for (let i = 0; i < 5; i++) {
    const set = parseField(parts[i], FIELDS[i]);
    if (!set) return fail('bad_field', FIELDS[i].name);
    sets.push(set);
  }
  return { ok: true, sets, normalized: parts.join(' ') };
}

export function isValidSchedule(expression) {
  return parseSchedule(expression).ok === true;
}

/**
 * آیا این لحظه با الگو می‌خواند؟
 *
 * قاعدهٔ عجیبِ cron که همه از قلم می‌اندازند: اگر هم روزِ‌ماه و هم روزِ‌هفته
 * مشخص شده باشند (هیچ‌کدام *)، **یا**ی منطقی است نه **و**. یعنی
 * «0 0 1 * mon» یعنی اولِ هر ماه، و هر دوشنبه.
 */
function matches(sets, date) {
  const [minute, hour, dom, month, dow] = sets;
  if (!minute.has(date.getMinutes())) return false;
  if (!hour.has(date.getHours())) return false;
  if (!month.has(date.getMonth() + 1)) return false;

  const domRestricted = dom.size !== 31;
  const dowRestricted = dow.size !== 7;
  const domHit = dom.has(date.getDate());
  const dowHit = dow.has(date.getDay());

  if (domRestricted && dowRestricted) return domHit || dowHit;
  if (domRestricted) return domHit;
  if (dowRestricted) return dowHit;
  return true;
}

/** اجرای بعدی چه وقتی است؟ حداکثر چهار سال جلو می‌رود، بعد تسلیم */
export function nextRunAt(expression, from = new Date()) {
  const parsed = parseSchedule(expression);
  if (!parsed.ok) return null;

  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const limit = 60 * 24 * 366 * 4;
  for (let i = 0; i < limit; i++) {
    if (matches(parsed.sets, cursor)) return cursor.getTime();
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}
