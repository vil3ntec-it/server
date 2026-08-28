package ir.vil3ntec.tohid.print

import android.content.Context
import ir.vil3ntec.tohid.data.Sale
import ir.vil3ntec.tohid.data.ShopData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 *  چاپِ یک فاکتور: کشیدنِ تصویر و فرستادنش به چاپگر.
 *
 *  هر دو کار سنگین‌اند (یکی کشیدنِ چند هزار پیکسل، یکی حرف‌زدن با
 *  بلوتوث)، پس هیچ‌کدام روی نخِ صفحه انجام نمی‌شود — وگرنه برنامه هنگامِ
 *  چاپ لحظه‌ای می‌خشکد.
 */
object PrintJob {

  /** برمی‌گرداند: پیامِ خطا، یا null اگر چاپ انجام شد */
  suspend fun printSale(
    context: Context,
    d: ShopData,
    sale: Sale,
    address: String,
    width: Int,
  ): String? = withContext(Dispatchers.IO) {
    val storeName = context
      .getSharedPreferences("tohid", Context.MODE_PRIVATE)
      .getString("store_name", "") ?: ""

    val bitmap = runCatching { Receipt.render(context, d, sale, storeName, width) }
      .getOrElse { return@withContext "فاکتور کشیده نشد: ${it.message ?: "دلیل نامعلوم"}" }

    try {
      ThermalPrinter.print(context, address, bitmap, width)
    } finally {
      bitmap.recycle()
    }
  }
}
