package ir.vil3ntec.tohid

/**
 *  عددها همان‌طور که نسخهٔ وب نشان می‌دهد.
 *
 *  در نسخهٔ وب مبلغ با `Math.round(n).toLocaleString('fa-IR')` نوشته می‌شود:
 *  رُند به عددِ درست، رقمِ فارسی، و جداکنندهٔ هزارگانِ فارسی (٬ — نه کاما).
 *  همان کار اینجا هم می‌شود، چون عددِ روی فاکتورِ کاغذی و عددِ روی صفحه
 *  باید مو به مو یکی باشند.
 */
private const val FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹"

fun Int.fa(): String = toString().toFaDigits()
fun Long.fa(): String = toString().toFaDigits()
fun String.toFaDigits(): String = map { c -> if (c in '0'..'9') FA_DIGITS[c - '0'] else c }.joinToString("")

/** مبلغ — رُند شده، با جداکنندهٔ هزارگان. واحد (افغانی) را صدازننده می‌گذارد. */
fun money(value: Double): String {
  val n = if (value.isNaN() || value.isInfinite()) 0L else Math.round(value)
  val negative = n < 0
  val digits = kotlin.math.abs(n).toString()
  val out = StringBuilder()
  digits.forEachIndexed { i, c ->
    if (i > 0 && (digits.length - i) % 3 == 0) out.append('٬')
    out.append(FA_DIGITS[c - '0'])
  }
  return if (negative) "-$out" else out.toString()
}

/**
 * مقدار — کیلو و لیتر و گرم اعشار دارند، دانه ندارد. تا سه رقمِ اعشار،
 * بدونِ صفرهای اضافی؛ همان `formatCartQty` نسخهٔ وب.
 */
fun qty(value: Double): String {
  val rounded = Math.round(value * 1000) / 1000.0
  val text = if (rounded == Math.floor(rounded)) rounded.toLong().toString()
  else rounded.toString().trimEnd('0').trimEnd('.')
  return text.toFaDigits().replace('.', '٫')
}

/** عددِ ساده — سال و شمارهٔ فاکتور که پول نیستند و جداکننده نمی‌خواهند */
fun plain(value: Int): String = value.toString().toFaDigits()
