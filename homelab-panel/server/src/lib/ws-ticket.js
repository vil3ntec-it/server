// ---------------------------------------------------------------------------
//  بلیتِ کوتاه‌عمرِ وب‌سوکت
//
//  مسئله: برای وصل شدنِ وب‌سوکت، رمز در خودِ آدرس می‌رود
//  (ws://…/?token=…) و آدرس در لاگِ پراکسی، تاریخچهٔ مرورگر و گزارشِ خطا
//  می‌نشیند. یعنی رمزِ دائمی جاهای زیادی رد می‌گذارد.
//
//  راهِ حل: اپ اول با همان رمز یک «بلیت» می‌گیرد که ۶۰ ثانیه اعتبار دارد و
//  فقط یک بار مصرف می‌شود. اگر بلیت هم لو برود، تا کسی بجنبد باطل شده است.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';

const TTL_MS = Number(process.env.HLP_WS_TICKET_TTL) > 0 ? Number(process.env.HLP_WS_TICKET_TTL) : 60000;
const tickets = new Map();

/** یک بلیتِ تازه برای همین کاربر/برنامه */
export function issueTicket(payload = {}) {
  const id = crypto.randomBytes(24).toString('base64url');
  tickets.set(id, { payload, expiresAt: Date.now() + TTL_MS });
  return { ticket: id, expiresIn: Math.round(TTL_MS / 1000) };
}

/**
 * بلیت را مصرف می‌کند. بارِ دوم دیگر کار نمی‌کند.
 * اگر نبود یا منقضی شده بود، null.
 */
export function useTicket(id) {
  if (!id) return null;
  const found = tickets.get(String(id));
  if (!found) return null;
  tickets.delete(String(id));
  if (found.expiresAt < Date.now()) return null;
  return found.payload;
}

/** بلیت‌های استفاده‌نشده که وقتشان گذشته */
export function pruneTickets() {
  const now = Date.now();
  for (const [id, row] of tickets) {
    if (row.expiresAt < now) tickets.delete(id);
  }
}

export function ticketCount() {
  return tickets.size;
}
