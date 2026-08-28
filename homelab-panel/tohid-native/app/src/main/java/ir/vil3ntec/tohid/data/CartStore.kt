package ir.vil3ntec.tohid.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 *  سبدِ نیمه‌کاره.
 *
 *  اگر وسطِ فروش برنامه بسته شود — تماس بیاید، باتری تمام شود، کاربر برود
 *  بخشِ دیگر — سبد نباید بپرد. نسخهٔ وب هم همین کار را می‌کرد و با همان
 *  شکلِ داده، پس همان پیش‌نویس بینِ دو نسخه خوانده می‌شود.
 */
class CartStore(context: Context) {

  private val prefs = context.getSharedPreferences("tohid", Context.MODE_PRIVATE)
  private val json = Json { ignoreUnknownKeys = true; isLenient = true }

  private val _lines = MutableStateFlow(read())
  val lines: StateFlow<List<SalesEngine.CartLine>> = _lines.asStateFlow()

  /** قرض‌داری که سبد به حسابش می‌رود — میان‌بری برای فروشِ نسیه */
  private val _debtorId = MutableStateFlow(prefs.getString(DEBTOR_KEY, null))
  val debtorId: StateFlow<String?> = _debtorId.asStateFlow()

  private fun read(): List<SalesEngine.CartLine> {
    val raw = prefs.getString(KEY, null) ?: return emptyList()
    return runCatching { json.decodeFromString<List<DraftLine>>(raw) }
      .getOrDefault(emptyList())
      .map { SalesEngine.CartLine(it.productId, it.quantity) }
  }

  private fun write(lines: List<SalesEngine.CartLine>) {
    val draft = lines.map { DraftLine(it.productId, it.quantity) }
    prefs.edit().putString(KEY, json.encodeToString(draft)).apply()
  }

  fun set(lines: List<SalesEngine.CartLine>) {
    _lines.value = lines
    write(lines)
  }

  fun setDebtor(id: String?) {
    _debtorId.value = id
    prefs.edit().putString(DEBTOR_KEY, id).apply()
  }

  fun clear() {
    set(emptyList())
    setDebtor(null)
  }

  /**
   * کالاهایی که دیگر در فهرست نیستند از سبد بیرون می‌روند — وگرنه ردیفی
   * بی‌نام‌ونشان در سبد می‌ماند که نه قیمت دارد نه می‌شود حذفش کرد.
   */
  fun prune(d: ShopData) {
    val known = d.products.mapTo(HashSet()) { it.id }
    val kept = _lines.value.filter { it.productId in known }
    if (kept.size != _lines.value.size) set(kept)
    if (_debtorId.value != null && d.debtors.none { it.id == _debtorId.value }) setDebtor(null)
  }

  @kotlinx.serialization.Serializable
  private data class DraftLine(val productId: String, val quantity: Double)

  private companion object {
    // همان کلیدِ نسخهٔ وب
    const val KEY = "tohid-shop-draft-cart-v1"
    const val DEBTOR_KEY = "tohid-shop-draft-cart-debtor"
  }
}
