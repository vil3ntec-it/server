package ir.vil3ntec.tohid.sync

import ir.vil3ntec.tohid.data.Debtor
import ir.vil3ntec.tohid.data.Product
import ir.vil3ntec.tohid.data.ShopData
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 *  همگام‌سازی.
 *
 *  خطرِ اصلیِ همگام‌سازی «گم شدن» است، نه «خراب شدن»: دو گوشی که هم‌زمان
 *  می‌فروشند نباید کارِ همدیگر را پاک کنند. برای همین رکورد به رکورد
 *  فرستاده می‌شود و اینجا سنجیده می‌شود که فقط همان چیزی می‌رود که واقعاً
 *  عوض شده — و آنچه از سرور می‌آید چیزِ دیگری را نمی‌برد.
 */
class SyncEngineTest {

  private val base = ShopData(
    products = listOf(Product(id = "p1", name = "برنج", salePrice = 300.0)),
    debtors = listOf(Debtor(id = "d1", name = "احمد")),
  )

  private fun idsOf(changes: JsonArray): List<Pair<String, String>> =
    changes.map {
      it.jsonObject["collection"]!!.jsonPrimitive.content to it.jsonObject["id"]!!.jsonPrimitive.content
    }

  /* ------------------------- فرستادن ------------------------- */

  @Test
  fun `اولین همگام سازی همه ی رکوردها را می فرستد`() {
    val out = SyncEngine.collect(base, SyncEngine.Shadow(), now = 1000)
    val ids = idsOf(out.changes)
    assertTrue(ids.contains("products" to "p1"))
    assertTrue(ids.contains("debtors" to "d1"))
    assertEquals(2, ids.size)
  }

  @Test
  fun `دفتری که عوض نشده چیزی نمی فرستد`() {
    val shadow = SyncEngine.snapshot(base)
    val out = SyncEngine.collect(base, shadow, now = 1000)
    assertEquals(0, out.changes.size)
  }

  @Test
  fun `فقط رکوردِ عوض شده فرستاده می شود`() {
    val shadow = SyncEngine.snapshot(base)
    val changed = base.copy(products = listOf(base.products.single().copy(salePrice = 350.0)))

    val out = SyncEngine.collect(changed, shadow, now = 1000)
    assertEquals(listOf("products" to "p1"), idsOf(out.changes))
    assertEquals(
      350.0,
      out.changes.single().jsonObject["data"]!!.jsonObject["salePrice"]!!.jsonPrimitive.content.toDouble(),
      0.0,
    )
  }

  @Test
  fun `رکوردِ حذف شده به صورت حذف فرستاده می شود`() {
    val shadow = SyncEngine.snapshot(base)
    val out = SyncEngine.collect(base.copy(products = emptyList()), shadow, now = 1000)

    val change = out.changes.single().jsonObject
    assertEquals("products", change["collection"]!!.jsonPrimitive.content)
    assertEquals("p1", change["id"]!!.jsonPrimitive.content)
    assertEquals("true", change["deleted"]!!.jsonPrimitive.content)
  }

  @Test
  fun `فهرست دسته بندی ها هم فرستاده می شود`() {
    val out = SyncEngine.collect(base, SyncEngine.Shadow(), now = 1000)
    val lists = out.settings["data"]!!.jsonObject
    assertTrue(lists.containsKey("expenseCategories"))
    assertTrue(lists.containsKey("productUnits"))
  }

  /* ------------------------- گرفتن ------------------------- */

  private fun change(collection: String, id: String, data: Map<String, Any?>?, deleted: Boolean = false) =
    JsonObject(
      buildMap {
        put("collection", kotlinx.serialization.json.JsonPrimitive(collection))
        put("id", kotlinx.serialization.json.JsonPrimitive(id))
        put("updatedAt", kotlinx.serialization.json.JsonPrimitive(1L))
        put("deleted", kotlinx.serialization.json.JsonPrimitive(deleted))
        put(
          "data",
          if (data == null) kotlinx.serialization.json.JsonNull
          else JsonObject(data.mapValues { (_, v) ->
            when (v) {
              null -> kotlinx.serialization.json.JsonNull
              is String -> kotlinx.serialization.json.JsonPrimitive(v)
              is Number -> kotlinx.serialization.json.JsonPrimitive(v)
              is Boolean -> kotlinx.serialization.json.JsonPrimitive(v)
              else -> kotlinx.serialization.json.JsonPrimitive(v.toString())
            }
          }),
        )
      }
    )

  @Test
  fun `رکوردِ تازه از سرور اضافه می شود`() {
    val incoming = JsonArray(listOf(change("products", "p2", mapOf("id" to "p2", "name" to "روغن", "salePrice" to 500))))
    val merged = SyncEngine.merge(base, incoming, null)

    assertEquals(2, merged.data.products.size)
    assertEquals("روغن", merged.data.products.first { it.id == "p2" }.name)
    assertEquals(1, merged.touched)
  }

  @Test
  fun `رکوردِ موجود به روز می شود نه اینکه دوباره اضافه شود`() {
    val incoming = JsonArray(listOf(change("products", "p1", mapOf("id" to "p1", "name" to "برنج", "salePrice" to 400))))
    val merged = SyncEngine.merge(base, incoming, null)

    assertEquals(1, merged.data.products.size)
    assertEquals(400.0, merged.data.products.single().salePrice, 0.0)
  }

  @Test
  fun `رکوردی که همان است چیزی را دست نخورده نمی شمارد`() {
    // تغییرِ خودمان که از سرور برگشته — نباید «تغییر تازه» شمرده شود
    val same = SyncEngine.collect(base, SyncEngine.Shadow(), now = 1)
      .changes.first { it.jsonObject["id"]!!.jsonPrimitive.content == "p1" }
    val merged = SyncEngine.merge(base, JsonArray(listOf(same)), null)
    assertEquals(0, merged.touched)
    assertEquals(1, merged.data.products.size)
  }

  @Test
  fun `حذف از سرور رکورد را برمی دارد`() {
    val incoming = JsonArray(listOf(change("products", "p1", null, deleted = true)))
    val merged = SyncEngine.merge(base, incoming, null)
    assertTrue(merged.data.products.isEmpty())
    assertEquals(1, merged.touched)
    // قرض‌دار دست‌نخورده مانده
    assertEquals(1, merged.data.debtors.size)
  }

  @Test
  fun `مجموعه ی ناشناس نادیده گرفته می شود`() {
    val incoming = JsonArray(listOf(change("چیزِ‌عجیب", "x1", mapOf("id" to "x1"))))
    val merged = SyncEngine.merge(base, incoming, null)
    assertEquals(0, merged.touched)
    assertEquals(1, merged.data.products.size)
  }

  @Test
  fun `دسته بندی ها اتحاد می شوند نه جایگزین`() {
    val local = base.copy(expenseCategories = listOf("کرایه", "برق"))
    val settings = JsonObject(
      mapOf(
        "data" to JsonObject(
          mapOf(
            "expenseCategories" to JsonArray(
              listOf(
                kotlinx.serialization.json.JsonPrimitive("برق"),
                kotlinx.serialization.json.JsonPrimitive("معاش"),
              )
            )
          )
        )
      )
    )
    val merged = SyncEngine.merge(local, JsonArray(emptyList()), settings)
    // «کرایه» که فقط اینجا بود نباید برود، «معاش» که فقط آنجا بود باید بیاید
    assertEquals(listOf("کرایه", "برق", "معاش"), merged.data.expenseCategories)
  }

  @Test
  fun `فهرست خالی از سرور فهرست محلی را پاک نمی کند`() {
    val local = base.copy(productUnits = listOf("عدد", "کیلو"))
    val settings = JsonObject(mapOf("data" to JsonObject(mapOf("productUnits" to JsonArray(emptyList())))))
    val merged = SyncEngine.merge(local, JsonArray(emptyList()), settings)
    assertEquals(listOf("عدد", "کیلو"), merged.data.productUnits)
  }

  /* ------------------------- رفت و برگشت ------------------------- */

  @Test
  fun `آنچه فرستاده شد، همان چیزی است که طرف مقابل می گیرد`() {
    // گوشیِ اول یک کالا اضافه می‌کند
    val shadow = SyncEngine.snapshot(base)
    val phoneOne = base.copy(
      products = base.products + Product(id = "p2", name = "روغن", salePrice = 500.0, purchasePrice = 400.0)
    )
    val out = SyncEngine.collect(phoneOne, shadow, now = 1000)

    // گوشیِ دوم همان را می‌گیرد
    val phoneTwo = SyncEngine.merge(base, out.changes, out.settings)
    assertEquals(2, phoneTwo.data.products.size)
    val oil = phoneTwo.data.products.first { it.id == "p2" }
    assertEquals("روغن", oil.name)
    assertEquals(500.0, oil.salePrice, 0.0)
    assertEquals(400.0, oil.purchasePrice, 0.0)

    // و بعد از ادغام، چیزی برای پس‌فرستادن نمانده
    val nothing = SyncEngine.collect(phoneTwo.data, SyncEngine.snapshot(phoneTwo.data), now = 2000)
    assertEquals(0, nothing.changes.size)
  }

  @Test
  fun `اثر انگشت با هر تغییر کوچکی عوض می شود`() {
    fun productChange(d: ShopData) = SyncEngine.collect(d, SyncEngine.Shadow(), 1).changes
      .first { it.jsonObject["collection"]!!.jsonPrimitive.content == "products" }

    val a = productChange(base)
    val b = productChange(base.copy(products = listOf(base.products.single().copy(minStock = 1.0))))
    assertTrue(SyncEngine.fingerprint(a.jsonObject["data"]!!) != SyncEngine.fingerprint(b.jsonObject["data"]!!))
  }
}
