// ---------------------------------------------------------------------------
//  ══ مغزِ مشترکِ ربات‌های «پمپ» و «فروشگاه» ══════════════════════════════════
//
//  خواستهٔ صاحب سامانه: «یک رباتِ هوشمندِ خیلی دقیق که همیشه در حالِ کار باشد
//  و حساب‌ها را چک کند… بک‌آپ زده؟ اشتراک دارد؟ رو به اتمام است؟ پیام بدهد…
//  بک‌آپش به سرور رسید یا نه… کدِ شش‌رقمی‌اش آمد یا نه.» و: «یک رباتِ
//  جداگانه برای فروشگاه با همان مشخصات.»
//
//  ⛔ **«جداگانه» یعنی دو کار، نه دو رونوشت.** منطق یک بار این‌جا نوشته شده
//  و `bots/index.js` دو `defineJob`ِ نازک رویش می‌گذارد. دو رونوشت یعنی
//  روزی یکی اصلاح می‌شود و دیگری نه — و آن‌وقت کارتِ یک بخش سرخ است و
//  بخشِ دیگر ساکت.
//
//  ── ده قاعده‌ای که این فایل روی آن‌ها بند است (بندِ ۵.۰ سند) ──────────────
//
//   ۱ ⛔ هیچ `setInterval`ی این‌جا نیست — زمان‌بندی کارِ موتور است.
//   ۲ ⛔ هیچ ثبتی این‌جا نمی‌شود — `automation_runs` را خودِ موتور می‌نویسد.
//   ۳ ⛔ **دفترِ دوم ساخته نمی‌شود**: همه‌چیز از پلِ موجود خوانده می‌شود
//       (`stations/cloud.js` ⇒ `cloudRaw`). نه جدولی، نه کشی، نه محاسبه‌ای
//       که جای سرورِ حساب تصمیم بگیرد.
//   ۴ ⛔ **هیچ رمزی خوانده یا نوشته نمی‌شود** — نه خام، نه هش. آزمونِ سورس
//       همین را می‌گردد.
//   ۵ ⛔ **یک خبر برای یک حال، نه برای هر دور** — `noteKey` حال را هم در
//       خود دارد. همان قاعدهٔ `k`ِ اپِ کارمندانِ پمپ، و عمداً همان.
//   ۶ ⛔ **سرورِ خواب ⇒ هشدار، نه سکوت** — `unchecked` در گزارش می‌گوید
//       کدام‌ها سنجیده **نشدند**. «نتوانستم بپرسم» با «همه‌چیز خوب است»
//       یکی نیست.
//   ۷ ⛔ **سقفِ نرخ پر نمی‌شود**: روی ۴۲۹ همان دور رها می‌شود. ⚠️ خودِ
//       `cloudRaw` مهلتِ `autoFail` را دارد، ولی ربات نباید بعدِ ۴۲۹ به
//       حسابِ بعدی برود و باز بزند — درسِ ۱.۴۷.۴.
//   ۸ ⛔ **هر یافته یک `ctx.emit` است** — ربات خودش پیام نمی‌سازد و ایمیل
//       نمی‌زند.
//   ۹ ⛔ **تنها کارِ درست‌کننده‌اش فرستادنِ دوبارهٔ کد است** و آن هم در
//       `code-rescue`، از همان موتورِ کدِ موجود.
//  ۱۰ ⚠️ **بی مدلِ هوش مصنوعی کار می‌کند** — یافته‌ها با قاعده درمی‌آیند.
// ---------------------------------------------------------------------------
import { cloudRaw } from '../../stations/cloud.js';
import { getSetting, setSetting } from '../../db.js';

const HOUR = 3600_000;

/**
 * ⛔ **«۲۶ ساعت» از روی خودِ برنامهٔ پمپ است، نه سلیقه**: آن برنامه هر شش
 * ساعت پشتیبان می‌فرستد و هشدارش را از `WarnAfter` ۲۶ ساعت می‌گیرد. دو
 * عددِ جدا یعنی روزی ربات هشدار می‌دهد و برنامه نه.
 */
export const BACKUP_WARN_MS = 26 * HOUR;
/** عکسِ زندهٔ کهنه — دو ساعت. کمتر یعنی هر قطعیِ گذرا یک هشدار. */
export const LIVE_STALE_MS = 2 * HOUR;
/** «رو به پایان» از چند روز مانده شروع می‌شود. */
export const EXPIRING_DAYS = 7;

/** ۴۲۹ی سرورِ حساب — با هر شکلی که برگردد. */
export function isRateLimited(err) {
  return Number(err?.status) === 429 || err?.code === 'rate_limited';
}

/** سرورِ حساب اصلاً جواب نمی‌دهد (نه «رد کرد»). */
export function isDown(err) {
  return err?.code === 'account_server_down' || err?.code === 'account_server_unreachable';
}

/*
 *  ══ دفترِ خبرهای داده‌شده ═══════════════════════════════════════════════
 *
 *  ⛔ این **دفترِ دوم نیست**: هیچ دادهٔ حسابی این‌جا نمی‌نشیند، فقط
 *  «این خبر را قبلاً داده‌ام». بی آن، هر پانزده دقیقه همان خبر دوباره
 *  می‌رفت و کاربر خاموشش می‌کرد — یعنی خبرِ بعدیِ واقعی را هم نمی‌دید.
 *
 *  ⚠️ کلید **حال** را هم در خود دارد (`sub-<شناسه>-d3`), پس «هفت روز
 *  مانده ⇒ سه روز مانده» خبرِ تازه می‌دهد و همان حال دوباره نه.
 *  ⚠️ و کلیدی که از فهرستِ این دور بیفتد **فراموش می‌شود**، وگرنه حسابی
 *  که خراب شد و درست شد و دوباره خراب شد، بارِ دوم ساکت می‌مانْد.
 */
const NOTE_SETTING = 'bot_notes';

export function readNotes() {
  try {
    const raw = JSON.parse(getSetting(NOTE_SETTING, '{}'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}

export function writeNotes(next) {
  //  ⚠️ سقف دارد تا این تنظیم با هزار حساب بی‌مرز بزرگ نشود
  const keys = Object.keys(next).slice(0, 2000);
  setSetting(NOTE_SETTING, JSON.stringify(Object.fromEntries(keys.map((k) => [k, next[k]]))));
}

const dayBucket = (days) => (days <= 0 ? 'gone' : days <= 1 ? 'd1' : days <= 3 ? 'd3' : 'd7');

/**
 * یک دورِ کاملِ سنجش برای یک بخش.
 *
 * @param {'pump'|'shop'} app
 * @param {object} ctx  زمینهٔ خودِ موتور (`log` · `emit` · `notify`)
 * @param {number} now  ⚠️ صریح، تا آزمون بتواند ساعت را جابه‌جا کند
 */
export async function runWatch(app, ctx, now = Date.now()) {
  const section = app === 'pump' ? 'pump' : 'shop';
  const findings = [];
  const unchecked = [];
  let rateLimited = false;

  const seenNow = new Set();
  const notes = readNotes();

  /** یک یافته: ثبت می‌شود، و فقط وقتی **حالش تازه است** خبر می‌دهد. */
  const add = (kind, tenant, detail, noteKey) => {
    const row = { app: section, kind, tenantId: tenant.id, tenantName: tenant.name || tenant.id, ...detail };
    findings.push(row);
    if (!noteKey) return row;
    seenNow.add(noteKey);
    if (notes[noteKey]) { row.repeated = true; return row; }
    notes[noteKey] = now;
    row.fresh = true;
    //  ⛔ خبر از همان ماشینِ رویدادِ موجود می‌رود — ربات خودش ایمیل نمی‌زند
    ctx.emit(`bot.${kind}`, row);
    return row;
  };

  let tenants = [];
  try {
    const out = await cloudRaw('GET', section === 'pump' ? '/api/admin/pump/stations' : '/api/admin/shops',
      { query: { limit: 200 } });
    tenants = (out.stations || out.shops || []).map((r) => ({
      id: r.id,
      name: r.name || '',
      ownerEmail: r.owner_email || '',
      subStatus: r.sub_status || 'none',
      endsAt: Number(r.ends_at) || 0,
      plan: r.plan || '',
    }));
  } catch (err) {
    /*
     *  ⛔ **سکوت نه.** نتوانستیم بپرسیم، پس هیچ حسابی سنجیده نشد — و
     *  گزارش باید همین را بگوید، نه «همه‌چیز خوب است».
     */
    const why = isRateLimited(err) ? 'rate_limited' : (isDown(err) ? 'account_server_down' : (err?.code || 'error'));
    ctx.log(`فهرستِ ${section} خوانده نشد: ${why}`);
    await ctx.notify('warn', `رباتِ ${section}: فهرستِ حساب‌ها خوانده نشد (${why}) — هیچ حسابی این دور سنجیده نشد`);
    return { app: section, checked: 0, findings: [], unchecked: [{ tenantId: '*', why }], rateLimited: isRateLimited(err) };
  }

  for (const tenant of tenants) {
    if (rateLimited) { unchecked.push({ tenantId: tenant.id, why: 'rate_limited' }); continue; }

    /* ── ۱) اشتراک: دارد؟ چند روز مانده؟ ─────────────────────────────── */
    if (tenant.endsAt > 0) {
      const days = Math.ceil((tenant.endsAt - now) / (24 * HOUR));
      if (days <= EXPIRING_DAYS) {
        //  ⛔ متنِ خبر **عدد** دارد (بندِ ۵.۴): «۵ روز دیگر»، نه «رو به پایان»
        add('subscription_expiring', tenant,
          { daysLeft: days, endsAt: tenant.endsAt, ownerEmail: tenant.ownerEmail, plan: tenant.plan,
            text: days <= 0 ? 'اشتراکِ شما تمام شده است' : `اشتراکِ شما ${days} روز دیگر تمام می‌شود` },
          `sub-${section}-${tenant.id}-${dayBucket(days)}`);
      }
    } else if (tenant.subStatus === 'none') {
      add('no_subscription', tenant, { ownerEmail: tenant.ownerEmail }, `nosub-${section}-${tenant.id}`);
    }

    /* ── ۲ و ۳) پشتیبان و عکسِ زنده — فقط پمپ دفترِ خانگی دارد ────────── */
    if (section === 'pump') {
      try {
        const d = await cloudRaw('GET', `/api/admin/pump/stations/${tenant.id}`);
        const st = d.station || d || {};
        const backupAt = Number(st.last_backup_at || st.lastBackupAt || 0);
        if (!backupAt) {
          add('backup_never', tenant, {}, `bknever-${tenant.id}`);
        } else if (now - backupAt > BACKUP_WARN_MS) {
          const hours = Math.floor((now - backupAt) / HOUR);
          add('backup_late', tenant, { lastAt: backupAt, hours,
            text: `آخرین پشتیبانِ شما ${hours} ساعت پیش رسیده` }, `bklate-${tenant.id}-${Math.floor(hours / 24)}`);
        }
        const seenAt = Number(st.home_seen_at || st.homeSeenAt || 0);
        if (seenAt && now - seenAt > LIVE_STALE_MS) {
          add('live_stale', tenant, { lastAt: seenAt,
            hours: Math.floor((now - seenAt) / HOUR) }, `stale-${tenant.id}-${Math.floor((now - seenAt) / HOUR / 6)}`);
        }
      } catch (err) {
        if (isRateLimited(err)) {
          /*
           *  ⛔ **همین‌جا می‌ایستد.** ادامه دادن یعنی صد درخواستِ دیگر روی
           *  سقفی که پر است — و بعد حتی با رمزِ درست هیچ‌وقت وارد نمی‌شود
           *  (درسِ ۱.۴۷.۴). بقیه «سنجیده نشدند» ثبت می‌شوند، نه «سالم».
           */
          rateLimited = true;
          unchecked.push({ tenantId: tenant.id, why: 'rate_limited' });
          continue;
        }
        unchecked.push({ tenantId: tenant.id, why: isDown(err) ? 'account_server_down' : (err?.code || 'error') });
        continue;
      }
    }
  }

  /*
   *  ⚠️ کلیدهایی که این دور دیده نشدند فراموش می‌شوند — حسابی که درست
   *  شد و دوباره خراب شد باید دوباره خبر بدهد.
   *  ⛔ ولی فقط کلیدهای **همین بخش**: رباتِ پمپ نباید خبرهای فروشگاه را
   *  پاک کند.
   */
  const kept = {};
  for (const [k, v] of Object.entries(notes)) {
    const mine = k.includes(`-${section}-`) || (section === 'pump' && /^(bknever|bklate|stale)-/.test(k));
    if (!mine || seenNow.has(k)) kept[k] = v;
  }
  writeNotes(kept);

  if (rateLimited) {
    await ctx.notify('warn',
      `رباتِ ${section}: سقفِ نرخِ سرورِ حساب پر شد — ${unchecked.length} حساب این دور سنجیده نشدند`);
  } else if (unchecked.length) {
    await ctx.notify('warn', `رباتِ ${section}: ${unchecked.length} حساب سنجیده نشدند`);
  }

  ctx.log(`${section}: ${tenants.length - unchecked.length} حساب سنجیده شد، ${findings.length} یافته، ${unchecked.length} نسنجیده`);
  return { app: section, checked: tenants.length - unchecked.length, findings, unchecked, rateLimited };
}
