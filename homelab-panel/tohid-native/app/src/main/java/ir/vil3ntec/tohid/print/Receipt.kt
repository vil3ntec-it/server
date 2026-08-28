package ir.vil3ntec.tohid.print

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.core.content.res.ResourcesCompat
import ir.vil3ntec.tohid.R
import ir.vil3ntec.tohid.data.Debtor
import ir.vil3ntec.tohid.data.Product
import ir.vil3ntec.tohid.data.Sale
import ir.vil3ntec.tohid.data.SaleItem
import ir.vil3ntec.tohid.data.ShopData
import ir.vil3ntec.tohid.formatDate
import ir.vil3ntec.tohid.money
import ir.vil3ntec.tohid.plain
import ir.vil3ntec.tohid.toFaDigits
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 *  فاکتور، به‌صورت تصویر.
 *
 *  چاپگرهای حرارتیِ دکان جدولِ نویسهٔ فارسی ندارند؛ متنِ فارسی را
 *  به‌هم‌ریخته یا علامتِ سؤال چاپ می‌کنند. پس فاکتور را خودِ اندروید
 *  می‌کشد — با همان فونتِ وزیرمتن و همان چیدمانِ راست‌به‌چپ — و آن تصویر
 *  چاپ می‌شود. چیزی که روی کاغذ می‌آید همان است که روی صفحه دیده می‌شود.
 *
 *  عرض بر حسب «نقطه» است نه پیکسل: کاغذِ ۵۸ میلی‌متری ۳۸۴ نقطه دارد و
 *  ۸۰ میلی‌متری ۵۷۶. تصویر دقیقاً به همان عرض کشیده می‌شود تا چاپگر
 *  مجبور نباشد آن را بزرگ یا کوچک کند.
 */
object Receipt {

  fun render(
    context: Context,
    d: ShopData,
    sale: Sale,
    storeName: String,
    width: Int,
  ): Bitmap {
    val regular = font(context, R.font.vazirmatn_regular)
    val bold = font(context, R.font.vazirmatn_bold)

    val pad = (width * 0.04f)
    val inner = width - pad * 2

    val title = paint(bold, width * 0.075f)
    val head = paint(bold, width * 0.048f)
    val body = paint(regular, width * 0.044f)
    val small = paint(regular, width * 0.038f)

    val items = d.saleItems.filter { it.saleId == sale.id }
    val debtor = sale.debtorId?.let { id -> d.debtors.find { it.id == id } }

    // یک بار برای اندازه‌گیری، یک بار برای کشیدن — تا ارتفاعِ تصویر
    // دقیقاً اندازهٔ محتوا باشد و کاغذِ خالی هدر نرود
    val height = draw(null, context, d, sale, debtor, items, storeName, width, pad, inner, title, head, body, small)
    val bitmap = Bitmap.createBitmap(width, height.toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.WHITE)
    draw(canvas, context, d, sale, debtor, items, storeName, width, pad, inner, title, head, body, small)
    return bitmap
  }

  /** برمی‌گرداند: ارتفاعِ لازم. اگر canvas داده شود، همان‌جا هم می‌کشد. */
  private fun draw(
    canvas: Canvas?,
    context: Context,
    d: ShopData,
    sale: Sale,
    debtor: Debtor?,
    items: List<SaleItem>,
    storeName: String,
    width: Int,
    pad: Float,
    inner: Float,
    title: TextPaint,
    head: TextPaint,
    body: TextPaint,
    small: TextPaint,
  ): Float {
    var y = pad

    fun line(text: String, paint: TextPaint, align: Layout.Alignment = Layout.Alignment.ALIGN_NORMAL) {
      val layout = layout(text, paint, inner.toInt(), align)
      if (canvas != null) {
        canvas.save()
        canvas.translate(pad, y)
        layout.draw(canvas)
        canvas.restore()
      }
      y += layout.height
    }

    /** یک ردیفِ دوستونی: برچسب راست، عدد چپ */
    fun row(label: String, value: String, paint: TextPaint) {
      val half = (inner / 2).toInt()
      val right = layout(label, paint, half, Layout.Alignment.ALIGN_NORMAL)
      val left = layout(value, paint, half, Layout.Alignment.ALIGN_OPPOSITE)
      if (canvas != null) {
        canvas.save(); canvas.translate(pad + inner - half, y); right.draw(canvas); canvas.restore()
        canvas.save(); canvas.translate(pad, y); left.draw(canvas); canvas.restore()
      }
      y += maxOf(right.height, left.height)
    }

    fun rule(thick: Boolean = false) {
      y += pad * 0.4f
      if (canvas != null) {
        val p = Paint().apply {
          color = Color.BLACK
          strokeWidth = if (thick) width * 0.006f else width * 0.003f
        }
        canvas.drawLine(pad, y, width - pad, y, p)
      }
      y += pad * 0.4f
    }

    fun gap(factor: Float = 0.5f) { y += pad * factor }

    /* ------------------------------ سربرگ ------------------------------ */
    line(storeName.ifBlank { "فروشگاه" }, title, Layout.Alignment.ALIGN_CENTER)
    gap(0.3f)
    line("فاکتور فروش #${sale.invoiceNumber?.let { plain(it) } ?: "—"}", head, Layout.Alignment.ALIGN_CENTER)
    gap(0.3f)

    val time = runCatching {
      SimpleDateFormat("HH:mm", Locale.US).format(Date(if (sale.createdAt > 0) sale.createdAt else System.currentTimeMillis()))
    }.getOrDefault("")
    val kind = when {
      sale.status == "cancelled" -> "لغوشده"
      sale.paymentMethod == "credit" -> "نسیه"
      else -> "نقدی"
    }
    line("${formatDate(sale.date)} — ${time.toFaDigits()}   ($kind)", small, Layout.Alignment.ALIGN_CENTER)

    rule(thick = true)

    /* ------------------------------ اقلام ------------------------------ */
    items.forEach { item ->
      val product = d.products.find { it.id == item.productId }
      val name = product?.name ?: "(محصول حذف‌شده)"
      val unit = product?.unit.orEmpty()
      line(name, body)
      val detail = "${money(item.quantity)}${if (unit.isNotBlank()) " $unit" else ""} × ${money(item.unitPrice)}"
      row(detail, money(item.totalPrice), small)
      if (item.returnedQty > 0) line("مرجوعی: ${money(item.returnedQty)}", small)
      gap(0.25f)
    }

    rule()

    /* ------------------------------ جمع‌ها ------------------------------ */
    row("جمع اقلام", "${money(sale.total)} افغانی", body)
    row("تخفیف", "${money(sale.discount)} افغانی", body)
    rule()
    row("مبلغ نهایی", "${money(sale.finalTotal)} افغانی", head)
    row("پرداختی", "${money(sale.paidAmount)} افغانی", body)
    row("باقی‌مانده", "${money(sale.remaining)} افغانی", body)
    if (debtor != null) row("قرض‌دار", debtor.name, body)

    rule(thick = true)
    gap(0.4f)
    line("تشکر از خرید شما", small, Layout.Alignment.ALIGN_CENTER)
    y += pad * 1.5f

    return y
  }

  /* ------------------------------ ابزارها ------------------------------ */

  private fun font(context: Context, id: Int): Typeface =
    runCatching { ResourcesCompat.getFont(context, id) }.getOrNull() ?: Typeface.DEFAULT

  private fun paint(typeface: Typeface, size: Float) = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    this.typeface = typeface
    textSize = size
    color = Color.BLACK
  }

  @Suppress("DEPRECATION")
  private fun layout(text: String, paint: TextPaint, width: Int, align: Layout.Alignment): StaticLayout {
    val w = width.coerceAtLeast(1)
    return if (android.os.Build.VERSION.SDK_INT >= 23) {
      StaticLayout.Builder.obtain(text, 0, text.length, paint, w)
        .setAlignment(align)
        // متن فارسی است، پس جهتِ پایه راست‌به‌چپ است — وگرنه نقطه و
        // پرانتز و عدد سرِ جای اشتباه می‌افتند
        .setTextDirection(android.text.TextDirectionHeuristics.RTL)
        .setIncludePad(false)
        .build()
    } else {
      StaticLayout(text, paint, w, align, 1f, 0f, false)
    }
  }
}
