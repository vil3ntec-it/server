package ir.vil3ntec.tohid.sync

import ir.vil3ntec.tohid.data.ShopData
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 *  همگام‌سازی با سرور.
 *
 *  قالبِ پیام عیناً همان چیزی است که نسخهٔ وب می‌فرستد:
 *  `{collection, id, updatedAt, deleted, data}`. دلیلش این است که هر دو
 *  نسخه به یک سرور وصل می‌شوند؛ اگر قالب فرق کند، گوشیِ اندروید و
 *  مرورگر داده‌های هم را نمی‌بینند.
 *
 *  رکورد به رکورد فرستاده می‌شود، نه کلِ دفتر. اگر کلِ دفتر فرستاده
 *  می‌شد، دو نفر که هم‌زمان می‌فروشند کارِ همدیگر را پاک می‌کردند.
 *
 *  «سایه» عکسِ آخرین وضعیتی است که با سرور یکی بوده. تفاوتِ دفترِ فعلی با
 *  سایه، همان چیزی است که باید فرستاده شود — نه بیشتر، نه کمتر.
 */
object SyncEngine {

  /** همان COLLECTIONS نسخهٔ وب، با همان نام‌ها */
  val COLLECTIONS = listOf(
    "debtors", "transactions", "expenses",
    "products", "warehouseEntries",
    "sales", "saleItems", "returns",
    "suppliers", "purchases", "supplierPayments",
    "stockMovements", "priceHistory", "auditLog",
  )

  /** فهرست‌هایی که رکورد نیستند و با «اتحاد» ادغام می‌شوند */
  val SETTING_LISTS = listOf("expenseCategories", "productCategories", "productUnits")

  private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; isLenient = true }

  /** سایه: برای هر مجموعه، شناسه → اثرِ انگشتِ رکورد */
  data class Shadow(val entries: Map<String, Map<String, String>> = emptyMap())

  data class Outgoing(val changes: JsonArray, val settings: JsonObject)

  /**
   * اثرِ انگشتِ یک رکورد — دقیقاً همان الگوریتمِ نسخهٔ وب
   * (`h = h * 31 + charCode`, سپس `h:length`).
   *
   * لازم نیست رمزنگارانه باشد؛ فقط باید بگوید «این رکورد عوض شده یا نه».
   */
  fun fingerprint(element: JsonElement): String {
    val text = element.toString()
    var h = 0
    for (c in text) h = h * 31 + c.code
    return "$h:${text.length}"
  }

  private fun tree(d: ShopData): JsonObject =
    json.encodeToJsonElement(ShopData.serializer(), d).jsonObject

  /** تفاوتِ دفترِ فعلی با سایه — همان چیزی که باید فرستاده شود */
  fun collect(d: ShopData, shadow: Shadow, now: Long): Outgoing {
    val data = tree(d)
    val changes = buildJsonArray {
      for (name in COLLECTIONS) {
        val rows = data[name]?.jsonArray ?: continue
        val previous = shadow.entries[name].orEmpty()
        val seen = HashSet<String>()

        for (row in rows) {
          val record = row.jsonObject
          val id = record["id"]?.jsonPrimitive?.contentOrNullSafe() ?: continue
          seen += id
          if (previous[id] != fingerprint(record)) {
            add(buildJsonObject {
              put("collection", JsonPrimitive(name))
              put("id", JsonPrimitive(id))
              put("updatedAt", JsonPrimitive(now))
              put("deleted", JsonPrimitive(false))
              put("data", record)
            })
          }
        }
        // آنچه قبلاً بود و حالا نیست: حذف شده
        for (id in previous.keys) {
          if (id !in seen) {
            add(buildJsonObject {
              put("collection", JsonPrimitive(name))
              put("id", JsonPrimitive(id))
              put("updatedAt", JsonPrimitive(now))
              put("deleted", JsonPrimitive(true))
              put("data", JsonPrimitive(null as String?))
            })
          }
        }
      }
    }

    val settings = buildJsonObject {
      put("data", buildJsonObject {
        for (name in SETTING_LISTS) data[name]?.let { put(name, it) }
      })
      put("updatedAt", JsonPrimitive(now))
    }

    return Outgoing(changes, settings)
  }

  /** عکسِ وضعیتِ فعلی، برای دفعهٔ بعد */
  fun snapshot(d: ShopData): Shadow {
    val data = tree(d)
    return Shadow(
      COLLECTIONS.associateWith { name ->
        val rows = data[name]?.jsonArray ?: JsonArray(emptyList())
        rows.mapNotNull { row ->
          val record = row.jsonObject
          val id = record["id"]?.jsonPrimitive?.contentOrNullSafe() ?: return@mapNotNull null
          id to fingerprint(record)
        }.toMap()
      }
    )
  }

  data class Merged(val data: ShopData, val touched: Int)

  /**
   * ادغامِ تغییراتِ دیگران.
   *
   * رکوردی که رسیده جای رکوردِ محلی می‌نشیند، و رکوردی که «حذف‌شده»
   * علامت خورده برداشته می‌شود. فهرستِ دسته‌بندی‌ها اتحاد می‌شود، نه
   * جایگزینی — وگرنه دسته‌ای که یک گوشی ساخته، با همگام‌سازیِ گوشیِ دیگر
   * پاک می‌شد.
   */
  fun merge(d: ShopData, changes: JsonArray, settings: JsonObject?): Merged {
    val data = tree(d).toMutableMap()
    var touched = 0

    for (element in changes) {
      val change = element as? JsonObject ?: continue
      val name = change["collection"]?.jsonPrimitive?.contentOrNullSafe() ?: continue
      if (name !in COLLECTIONS) continue
      val id = change["id"]?.jsonPrimitive?.contentOrNullSafe() ?: continue
      val deleted = change["deleted"]?.jsonPrimitive?.booleanOrNullSafe() ?: false

      val rows = (data[name] as? JsonArray)?.toMutableList() ?: mutableListOf()
      val index = rows.indexOfFirst { it.jsonObject["id"]?.jsonPrimitive?.contentOrNullSafe() == id }

      if (deleted) {
        if (index >= 0) {
          rows.removeAt(index)
          touched++
        }
      } else {
        val record = change["data"] as? JsonObject ?: continue
        if (record["id"] == null) continue
        // اگر همان چیزی است که داریم (تغییرِ خودمان که برگشته)، عوض نشده
        val same = index >= 0 && fingerprint(rows[index]) == fingerprint(record)
        if (index >= 0) rows[index] = record else rows.add(record)
        if (!same) touched++
      }
      data[name] = JsonArray(rows)
    }

    settings?.get("data")?.let { it as? JsonObject }?.let { incoming ->
      for (name in SETTING_LISTS) {
        val remote = incoming[name] as? JsonArray ?: continue
        if (remote.isEmpty()) continue
        val local = (data[name] as? JsonArray).orEmpty()
        val union = LinkedHashSet<JsonElement>()
        union.addAll(local)
        union.addAll(remote)
        data[name] = JsonArray(union.toList())
      }
    }

    val merged = json.decodeFromJsonElement(ShopData.serializer(), JsonObject(data))
    return Merged(merged, touched)
  }

  /* ------------------------------ ریزه‌کاری ------------------------------ */

  private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()

  private fun JsonPrimitive.contentOrNullSafe(): String? =
    if (this is kotlinx.serialization.json.JsonNull) null else content.takeIf { it.isNotBlank() }

  private fun JsonPrimitive.booleanOrNullSafe(): Boolean? =
    runCatching { content.toBooleanStrict() }.getOrNull()
}
