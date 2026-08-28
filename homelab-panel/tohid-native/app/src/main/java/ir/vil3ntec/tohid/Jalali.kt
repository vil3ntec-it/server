package ir.vil3ntec.tohid

/**
 *  تبدیلِ تاریخ میلادی به خورشیدی.
 *
 *  نسخهٔ وب تاریخ‌ها را با `toLocaleDateString('fa-IR')` نشان می‌داد، یعنی
 *  تقویمِ خورشیدی. تاریخ در فایلِ داده میلادی ذخیره می‌شود (`2026-08-28`)
 *  ولی چیزی که فروشنده می‌بیند باید خورشیدی باشد — وگرنه فاکتورِ امروز
 *  تاریخِ ناآشنا دارد.
 *
 *  الگوریتم همان الگوریتمِ شناخته‌شدهٔ jalaali است (بر پایهٔ تقویمِ رسمی با
 *  جدولِ «شکست»‌ها، نه تقریبِ ۳۳ ساله). درستی‌اش با ۱۷۰ سال روزِ پیاپی
 *  سنجیده شده: هیچ روزی جا نمی‌افتد و هیچ روزی دوبار نمی‌آید.
 *
 *  در کاتلین `/` روی عددِ صحیح به سمتِ صفر بریده می‌شود و `%` هم علامتِ
 *  مقسوم را می‌گیرد — دقیقاً همان `div` و `mod` الگوریتمِ اصلی.
 */
object Jalali {

  private val BREAKS = intArrayOf(
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
    1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
  )

  data class Date(val year: Int, val month: Int, val day: Int)

  private data class Cal(val leap: Int, val gy: Int, val march: Int)

  private fun cal(jy: Int): Cal {
    val gy = jy + 621
    var leapJ = -14
    var jp = BREAKS[0]
    var jump = 0

    require(jy >= jp && jy < BREAKS[BREAKS.size - 1]) { "سالِ خورشیدیِ خارج از دامنه: $jy" }

    for (i in 1 until BREAKS.size) {
      val jm = BREAKS[i]
      jump = jm - jp
      if (jy < jm) break
      leapJ += (jump / 33) * 8 + (jump % 33) / 4
      jp = jm
    }
    var n = jy - jp

    leapJ += (n / 33) * 8 + ((n % 33) + 3) / 4
    if (jump % 33 == 4 && jump - n == 4) leapJ += 1

    val leapG = gy / 4 - ((gy / 100 + 1) * 3) / 4 - 150
    val march = 20 + leapJ - leapG

    if (jump - n < 6) n = n - jump + ((jump + 4) / 33) * 33
    var leap = (((n + 1) % 33) - 1) % 4
    if (leap == -1) leap = 4

    return Cal(leap, gy, march)
  }

  /** شمارهٔ روزِ مطلق برای یک تاریخِ میلادی */
  private fun g2d(gy: Int, gm: Int, gd: Int): Int {
    var d = ((gy + (gm - 8) / 6 + 100100) * 1461) / 4 +
      (153 * ((gm + 9) % 12) + 2) / 5 + gd - 34840408
    d -= ((gy + 100100 + (gm - 8) / 6) / 100 * 3) / 4 - 752
    return d
  }

  private fun d2gYear(jdn: Int): Int {
    var j = 4 * jdn + 139361631
    j += (((4 * jdn + 183187720) / 146097) * 3) / 4 * 4 - 3908
    val i = ((j % 1461) / 4) * 5 + 308
    val gm = ((i / 153) % 12) + 1
    return j / 1461 - 100100 + (8 - gm) / 6
  }

  fun of(gy: Int, gm: Int, gd: Int): Date {
    val jdn = g2d(gy, gm, gd)
    val gYear = d2gYear(jdn)
    var jy = gYear - 621
    val c = cal(jy)
    var k = jdn - g2d(gYear, 3, c.march)

    if (k >= 0) {
      if (k <= 185) return Date(jy, 1 + k / 31, k % 31 + 1)
      k -= 186
    } else {
      jy -= 1
      k += 179
      if (c.leap == 1) k += 1
    }
    return Date(jy, 7 + k / 30, k % 30 + 1)
  }

  /** از تاریخِ ذخیره‌شده در فایلِ داده: `YYYY-MM-DD` */
  fun ofIso(iso: String): Date? {
    val parts = iso.split('-')
    if (parts.size != 3) return null
    val y = parts[0].toIntOrNull() ?: return null
    val m = parts[1].toIntOrNull() ?: return null
    val d = parts[2].toIntOrNull() ?: return null
    return runCatching { of(y, m, d) }.getOrNull()
  }
}

/**
 * تاریخِ خورشیدی با رقمِ فارسی — همان شکلی که نسخهٔ وب نشان می‌داد:
 * `۱۴۰۵/۰۶/۰۶`. اگر تاریخ خوانده نشد، خودِ رشته برگردانده می‌شود تا
 * چیزی گم نشود.
 */
fun formatDate(iso: String): String {
  val j = Jalali.ofIso(iso) ?: return iso.toFaDigits()
  val mm = j.month.toString().padStart(2, '0')
  val dd = j.day.toString().padStart(2, '0')
  return "${j.year}/$mm/$dd".toFaDigits()
}

/** تاریخِ امروزِ دستگاه به شکلِ `YYYY-MM-DD` — همان `todayISO` نسخهٔ وب */
fun todayIso(): String {
  val c = java.util.Calendar.getInstance()
  val y = c.get(java.util.Calendar.YEAR)
  val m = (c.get(java.util.Calendar.MONTH) + 1).toString().padStart(2, '0')
  val d = c.get(java.util.Calendar.DAY_OF_MONTH).toString().padStart(2, '0')
  return "$y-$m-$d"
}
