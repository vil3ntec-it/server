package ir.vil3ntec.tohid.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

/**
 *  دفترِ دکان.
 *
 *  همان یک فایلِ JSON که نسخهٔ وب هم می‌نوشت — با همان کلیدها. پس هم داده‌های
 *  قدیمی مستقیم خوانده می‌شوند و هم فایلِ پشتیبان بین دو نسخه یکی می‌ماند.
 *
 *  محاسبه‌ها عمداً همان فرمولِ نسخهٔ وب‌اند، حتی جاهایی که می‌شد «بهترش» کرد:
 *  عددی که فروشنده روی کاغذ دارد نباید با به‌روزرسانی عوض شود.
 */
class ShopStore(private val context: Context) {

  private val file = File(context.filesDir, "shop-data.json")
  private val json = Json {
    ignoreUnknownKeys = true      // نسخهٔ وب ممکن است فیلدی اضافه کند
    encodeDefaults = true
    isLenient = true
  }

  private val _data = MutableStateFlow(ShopData())
  val data: StateFlow<ShopData> = _data.asStateFlow()

  suspend fun load() = withContext(Dispatchers.IO) {
    if (!file.exists()) return@withContext
    runCatching { json.decodeFromString<ShopData>(file.readText()) }
      .onSuccess { _data.value = it }
  }

  suspend fun save(next: ShopData) = withContext(Dispatchers.IO) {
    _data.value = next
    runCatching {
      // اول در فایلِ کنارى، بعد جابه‌جایی: اگر وسطِ نوشتن برق برود،
      // دفترِ دکان نصفه‌نیمه نمی‌ماند
      val tmp = File(file.parentFile, "${file.name}.tmp")
      tmp.writeText(json.encodeToString(next))
      tmp.renameTo(file)
    }
  }

  /** واردکردنِ داده‌ای که از نسخهٔ وب می‌آید */
  suspend fun importJson(raw: String): Result<ShopData> = withContext(Dispatchers.IO) {
    runCatching {
      val parsed = json.decodeFromString<ShopData>(raw)
      save(parsed)
      parsed
    }
  }

  fun hasData(): Boolean = file.exists()

  /**
   * فایلِ پشتیبان.
   *
   * همان قالبی که نسخهٔ وب می‌سازد و می‌خواند — به‌علاوهٔ `exportedAt`.
   * پس پشتیبانی که اینجا گرفته می‌شود در آنجا باز می‌شود و برعکس؛ کسی که
   * بین دو نسخه جابه‌جا می‌شود دفترش را دوباره نمی‌سازد.
   */
  suspend fun exportBackup(storeName: String = ""): String = withContext(Dispatchers.IO) {
    val tree = json.encodeToJsonElement(ShopData.serializer(), _data.value)
      .let { it as kotlinx.serialization.json.JsonObject }
      .toMutableMap()
    tree["exportedAt"] = kotlinx.serialization.json.JsonPrimitive(
      java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US).apply {
        timeZone = java.util.TimeZone.getTimeZone("UTC")
      }.format(java.util.Date())
    )
    tree["settings"] = kotlinx.serialization.json.buildJsonObject {
      put("storeName", kotlinx.serialization.json.JsonPrimitive(storeName))
    }
    kotlinx.serialization.json.JsonObject(tree).toString()
  }

  companion object {
    /* ------------------------- محاسبه‌ها ------------------------- */

    /**
     * مقدارِ فروخته‌شدهٔ یک کالا.
     * فروشِ لغوشده و مقدارِ مرجوعی حساب نمی‌شوند — عیناً مثل نسخهٔ وب.
     */
    fun soldQty(d: ShopData, productId: String): Double =
      d.saleItems
        .filter { item ->
          if (item.productId != productId) return@filter false
          val sale = d.sales.find { it.id == item.saleId }
          sale == null || sale.status != "cancelled"
        }
        .sumOf { it.quantity - it.returnedQty }

    /** موجودی = آنچه وارد انبار شده، منهای آنچه فروخته شده */
    fun stock(d: ShopData, productId: String): Double =
      d.warehouseEntries.filter { it.productId == productId }.sumOf { it.units } -
        soldQty(d, productId)

    fun cartons(d: ShopData, productId: String): Double =
      d.warehouseEntries.filter { it.productId == productId }.sumOf { it.cartons }

    /** تمام‌شده | موجودی کم | موجودی کافی */
    fun stockStatus(d: ShopData, product: Product): String {
      val s = stock(d, product.id)
      return when {
        s <= 0 -> "out"
        s <= product.minStock -> "low"
        else -> "ok"
      }
    }

    /** بدهیِ یک قرض‌دار: آنچه گرفته منهای آنچه پس داده */
    fun debt(d: ShopData, debtorId: String): Double =
      d.transactions.filter { it.debtorId == debtorId }
        .sumOf { if (it.type == "give") it.amount else -it.amount }

    /** بدهیِ ما به یک تأمین‌کننده */
    fun supplierDebt(d: ShopData, supplierId: String): Double =
      d.purchases.filter { it.supplierId == supplierId }.sumOf { it.debt } -
        d.supplierPayments.filter { it.supplierId == supplierId }.sumOf { it.amount }

    fun barcodeIndex(d: ShopData): Map<String, String> = buildMap {
      d.products.forEach { p -> p.barcodes.forEach { code -> put(code, p.id) } }
    }
  }
}
