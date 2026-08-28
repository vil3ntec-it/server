package ir.vil3ntec.tohid.data

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 *  دفترِ دکان نباید با خوانده و نوشته شدن آب برود.
 *
 *  این برنامه کلِ فایل را از نو می‌نویسد. پس هر فیلدی که در مدل نباشد،
 *  با اولین ذخیره برای همیشه می‌رود — بی‌صدا، بدونِ خطا، و بدونِ اینکه
 *  کسی تا مدت‌ها بفهمد. دو موردِ واقعی همین‌طور پیدا شد: نشانهٔ عکسِ
 *  محصول و نشانهٔ «اصلاح موجودی» در ورودی انبار.
 *
 *  اینجا یک دفترِ نمونه با **همهٔ** فیلدهای نسخهٔ وب خوانده، دوباره نوشته
 *  و دوباره خوانده می‌شود؛ بعد کلید به کلید سنجیده می‌شود که چیزی نیفتاده
 *  باشد. اگر روزی فیلدی به مدل اضافه نشود، همین‌جا لو می‌رود.
 */
class LedgerRoundTripTest {

  private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; isLenient = true }

  /** دقیقاً همان شکلی که نسخهٔ وب در localStorage می‌نویسد */
  private val webLedger = """
  {
    "debtors": [{"id":"d1","name":"احمد","phone":"0700","notes":"همسایه","createdAt":1700000000000}],
    "transactions": [{"id":"t1","debtorId":"d1","type":"give","amount":500,"date":"2026-08-28","notes":"نسیه","createdAt":1700000000000}],
    "expenses": [{"id":"e1","title":"کرایه","category":"کرایه","amount":3000,"date":"2026-08-01","notes":"ماه سنبله","createdAt":1700000000000}],
    "expenseCategories": ["کرایه","برق"],
    "products": [{"id":"p1","name":"برنج","category":"خوراکه","unit":"کیلو","purchasePrice":200,"salePrice":300,
                  "wholesalePrice":280,"minStock":5,"notes":"","barcodes":["6291234567890"],"photo":true,"createdAt":1700000000000}],
    "productCategories": ["خوراکه"],
    "productUnits": ["عدد","کیلوگرم"],
    "warehouseEntries": [
      {"id":"w1","productId":"p1","cartons":4,"perCarton":25,"units":100,"unit":"کیلو","price":200,
       "date":"2026-08-02","notes":"از تأمین‌کننده","createdAt":1700000000000},
      {"id":"w2","productId":"p1","cartons":0,"perCarton":0,"units":-3,"unit":"کیلو","price":0,
       "date":"2026-08-10","notes":"خراب شد","isAdjustment":true,"createdAt":1700000000000}
    ],
    "sales": [{"id":"s1","invoiceNumber":1000,"total":600,"discountType":"percent","discountValue":10,"discount":60,
               "finalTotal":540,"paymentMethod":"credit","debtorId":"d1","paidAmount":40,"remaining":500,
               "status":"completed","debtGiven":500,"debtSettled":0,"createdAt":1700000000000,
               "date":"2026-08-28","syncStatus":"pending"}],
    "saleItems": [{"id":"si1","saleId":"s1","productId":"p1","quantity":2,"unitPrice":300,
                   "purchasePrice":200,"totalPrice":600,"returnedQty":0.5}],
    "returns": [{"id":"r1","saleId":"s1","saleItemId":"si1","productId":"p1","quantity":0.5,
                 "amount":150,"reason":"خراب بود","date":"2026-08-28","createdAt":1700000000000}],
    "nextInvoiceNo": 1001,
    "suppliers": [{"id":"su1","name":"شرکت نور","phone":"0788","address":"کابل","notes":"","createdAt":1700000000000}],
    "purchases": [{"id":"pu1","productId":"p1","supplierId":"su1","quantity":100,"unit":"کیلو","purchasePrice":200,
                   "totalAmount":20000,"date":"2026-08-02","notes":"","paidAmount":15000,"debt":5000,
                   "warehouseEntryId":"w1","createdAt":1700000000000}],
    "supplierPayments": [{"id":"sp1","supplierId":"su1","amount":5000,"date":"2026-08-20","notes":"تسویه","createdAt":1700000000000}],
    "stockMovements": [{"id":"m1","productId":"p1","type":"purchase_in","qty":100,"date":"2026-08-02",
                        "notes":"ثبت ورود کالا","refId":"w1","createdAt":1700000000000}],
    "priceHistory": [{"id":"ph1","productId":"p1","oldPrice":180,"newPrice":200,"date":"2026-08-02","createdAt":1700000000000}],
    "auditLog": [{"id":"a1","type":"sale","date":"2026-08-28","refId":"s1","notes":"ثبت فروش","createdAt":1700000000000}]
  }
  """.trimIndent()

  @Test
  fun `هیچ فیلدی با خواندن و نوشتن دوباره گم نمی شود`() {
    val original = json.parseToJsonElement(webLedger).jsonObject
    val decoded = json.decodeFromString<ShopData>(webLedger)
    val written = json.parseToJsonElement(json.encodeToString(decoded)).jsonObject

    val lost = mutableListOf<String>()
    compare(original, written, "", lost)
    assertEquals("این فیلدها با ذخیره گم می‌شوند: $lost", emptyList<String>(), lost)
  }

  @Test
  fun `مقدارها هم همان می مانند نه فقط نامشان`() {
    val decoded = json.decodeFromString<ShopData>(webLedger)

    assertEquals(true, decoded.products.single().photo)
    assertEquals(280.0, decoded.products.single().wholesalePrice, 0.0)
    assertEquals(true, decoded.warehouseEntries.first { it.id == "w2" }.isAdjustment)
    assertEquals(false, decoded.warehouseEntries.first { it.id == "w1" }.isAdjustment)
    assertEquals(0.5, decoded.saleItems.single().returnedQty, 0.0)
    assertEquals("w1", decoded.purchases.single().warehouseEntryId)
    assertEquals(1001, decoded.nextInvoiceNo)
    assertEquals(1, decoded.saleReturns.size)   // در فایل نامش returns است
    assertEquals(1000, decoded.sales.single().invoiceNumber)
  }

  @Test
  fun `دفترِ خالی هم خوانده می شود`() {
    // نسخه‌های قدیمی‌تر ممکن است بعضی کلیدها را اصلاً نداشته باشند
    val partial = """{"products":[],"debtors":[]}"""
    val decoded = json.decodeFromString<ShopData>(partial)
    assertEquals(1000, decoded.nextInvoiceNo)
    assertEquals(emptyList<Sale>(), decoded.sales)
  }

  /** هر کلیدِ فایلِ اصلی باید در فایلِ نوشته‌شده هم باشد، با همان مقدار */
  private fun compare(from: JsonObject, to: JsonObject, path: String, lost: MutableList<String>) {
    for ((key, value) in from) {
      val here = if (path.isEmpty()) key else "$path.$key"
      val other = to[key]
      if (other == null) {
        lost += here
        continue
      }
      when {
        value is JsonObject && other is JsonObject -> compare(value, other.jsonObject, here, lost)
        value is JsonArray && other is JsonArray ->
          value.forEachIndexed { i, item ->
            val mirror = other.jsonArray.getOrNull(i)
            if (mirror == null) lost += "$here[$i]"
            else if (item is JsonObject && mirror is JsonObject) compare(item, mirror.jsonObject, "$here[$i]", lost)
            else if (item.toString() != mirror.toString()) lost += "$here[$i] (${item} ≠ ${mirror})"
          }
        // عدد ممکن است ۱۰۰ نوشته شده باشد و ۱۰۰.۰ برگردد؛ همان مقدار است
        else -> if (!sameValue(value.toString(), other.toString())) lost += "$here (${value} ≠ ${other})"
      }
    }
  }

  private fun sameValue(a: String, b: String): Boolean {
    if (a == b) return true
    val x = a.trim('"').toDoubleOrNull()
    val y = b.trim('"').toDoubleOrNull()
    return x != null && y != null && x == y
  }
}
