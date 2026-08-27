package ir.vil3ntec.tohid

import java.util.Locale

/**
 *  عددها همان‌طور که نسخهٔ وب نشان می‌دهد: رقمِ فارسی، جداکنندهٔ هزارگان،
 *  و بدونِ اعشارِ بی‌مورد.
 */
private const val FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹"

fun Int.fa(): String = toString().toFaDigits()
fun String.toFaDigits(): String = map { c -> if (c in '0'..'9') FA_DIGITS[c - '0'] else c }.joinToString("")

/** مبلغ — بدونِ اعشار وقتی رُند است، وگرنه تا دو رقم */
fun money(value: Double): String {
  val rounded = Math.round(value * 100) / 100.0
  val text = if (rounded == Math.floor(rounded) && !rounded.isInfinite()) {
    String.format(Locale.US, "%,d", rounded.toLong())
  } else {
    String.format(Locale.US, "%,.2f", rounded)
  }
  return text.toFaDigits().replace('.', '٫')
}

/** مقدار — کیلو و گرم اعشار دارند، دانه ندارد */
fun qty(value: Double): String {
  val rounded = Math.round(value * 1000) / 1000.0
  val text = if (rounded == Math.floor(rounded)) rounded.toLong().toString()
  else rounded.toString().trimEnd('0').trimEnd('.')
  return text.toFaDigits().replace('.', '٫')
}
