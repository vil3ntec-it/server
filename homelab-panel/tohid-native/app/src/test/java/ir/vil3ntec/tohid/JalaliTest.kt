package ir.vil3ntec.tohid

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 *  تاریخِ خورشیدی.
 *
 *  اگر این تبدیل یک روز بلغزد، تاریخِ روی فاکتور و گزارشِ «فروش امروز»
 *  اشتباه می‌شود — چیزی که به‌سختی به چشم می‌آید و به‌سختی جبران می‌شود.
 *  پس هم چند تاریخِ شناخته‌شده سنجیده می‌شود، هم پیوستگیِ همهٔ روزها.
 */
class JalaliTest {

  private fun j(y: Int, m: Int, d: Int) = Jalali.of(y, m, d).let { "${it.year}/${it.month}/${it.day}" }

  @Test
  fun `تاریخ های شناخته شده درست تبدیل می شوند`() {
    assertEquals("1357/11/22", j(1979, 2, 11))    // ۲۲ بهمن ۵۷
    assertEquals("1378/10/11", j(2000, 1, 1))
    assertEquals("1403/1/1", j(2024, 3, 20))      // نوروز ۱۴۰۳
    assertEquals("1403/12/30", j(2025, 3, 20))    // ۱۴۰۳ کبیسه است
    assertEquals("1404/12/29", j(2026, 3, 20))    // ۱۴۰۴ کبیسه نیست
    assertEquals("1405/1/1", j(2026, 3, 21))      // نوروز ۱۴۰۵
    assertEquals("1405/6/6", j(2026, 8, 28))
  }

  @Test
  fun `هیچ روزی جا نمی افتد و هیچ روزی دوبار نمی آید`() {
    val calendar = java.util.GregorianCalendar(1930, 0, 1)
    val end = java.util.GregorianCalendar(2100, 0, 1)
    var previous: Jalali.Date? = null

    while (calendar.before(end)) {
      val current = Jalali.of(
        calendar.get(java.util.Calendar.YEAR),
        calendar.get(java.util.Calendar.MONTH) + 1,
        calendar.get(java.util.Calendar.DAY_OF_MONTH),
      )
      previous?.let { p ->
        val stepped = (current.year == p.year && current.month == p.month && current.day == p.day + 1) ||
          (current.year == p.year && current.month == p.month + 1 && current.day == 1) ||
          (current.year == p.year + 1 && current.month == 1 && current.day == 1)
        if (!stepped) {
          throw AssertionError("پرشِ تاریخ: $p → $current در ${calendar.time}")
        }
      }
      previous = current
      calendar.add(java.util.Calendar.DAY_OF_MONTH, 1)
    }
  }

  @Test
  fun `تاریخ برای نمایش با رقم فارسی و دو رقمی نوشته می شود`() {
    assertEquals("۱۴۰۵/۰۶/۰۶", formatDate("2026-08-28"))
    assertEquals("۱۴۰۵/۰۱/۰۱", formatDate("2026-03-21"))
    // تاریخِ ناخوانا گم نمی‌شود، فقط رقمش فارسی می‌شود
    assertEquals("چیزی-نیست", formatDate("چیزی-نیست"))
  }

  @Test
  fun `تاریخ امروز شکل درستی دارد`() {
    val today = todayIso()
    assert(Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(today)) { "شکلِ تاریخ درست نیست: $today" }
  }
}
