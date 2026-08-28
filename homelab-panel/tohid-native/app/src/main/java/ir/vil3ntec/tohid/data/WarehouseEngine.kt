package ir.vil3ntec.tohid.data

import ir.vil3ntec.tohid.money

/**
 *  انبار — ثبتِ کالا، ورودِ جنس، اصلاحِ موجودی.
 *
 *  مثل حسابِ فروش، اینجا هم هیچ چیز به صفحه یا فایل دست نمی‌زند: ورودی
 *  «دفترِ فعلی»، خروجی «دفترِ تازه». همان قاعده‌ها و همان پیام‌های نسخهٔ
 *  وب، چون فروشنده به همان‌ها عادت کرده.
 */
object WarehouseEngine {

  data class ProductDraft(
    val name: String = "",
    val category: String = "",
    val unit: String = "",
    val purchasePrice: Double = 0.0,
    val salePrice: Double = 0.0,
    val minStock: Double = 0.0,
    val barcode: String = "",
  )

  data class EntryDraft(
    val productId: String = "",
    val cartons: Double = 0.0,
    val perCarton: Double = 0.0,
    val units: Double = 0.0,
    val unit: String = "",
    val price: Double = 0.0,
    val date: String = "",
    val notes: String = "",
  )

  /** اصلاح موجودی | برگشت به تأمین‌کننده — همان دو حالتِ نسخهٔ وب */
  enum class AdjustKind { ADJUSTMENT, SUPPLIER_RETURN }

  sealed interface Result {
    data class Ok(val data: ShopData, val id: String) : Result
    data class Failed(val message: String) : Result
  }

  data class Summary(
    val products: Int,
    val cartons: Double,
    val units: Double,
    val value: Double,
    val low: Int,
    val out: Int,
  )

  /* --------------------------- خلاصهٔ انبار --------------------------- */

  fun summary(d: ShopData) = Summary(
    products = d.products.size,
    cartons = d.warehouseEntries.sumOf { it.cartons },
    units = d.warehouseEntries.sumOf { it.units },
    // ارزشِ تقریبی: همان جمعِ «واحد × قیمتِ خرید» نسخهٔ وب، نه موجودیِ فعلی
    value = d.warehouseEntries.sumOf { it.units * it.price },
    low = d.products.count { ShopStore.stockStatus(d, it) == "low" },
    out = d.products.count { ShopStore.stockStatus(d, it) == "out" },
  )

  /* ---------------------------- ثبتِ کالا ---------------------------- */

  fun addProduct(d: ShopData, draft: ProductDraft, now: Long, newId: () -> String): Result {
    val name = draft.name.trim()
    if (name.isEmpty()) return Result.Failed("نام کالا را بنویسید")
    if (draft.salePrice.isNaN() || draft.salePrice < 0) return Result.Failed("قیمت فروش درست نیست")
    if (draft.purchasePrice.isNaN() || draft.purchasePrice < 0) return Result.Failed("قیمت خرید درست نیست")

    val barcode = draft.barcode.trim()
    // بارکدِ تکراری، کالای قبلی را از دسترسِ اسکنر بیرون می‌برد
    if (barcode.isNotEmpty() && ShopStore.barcodeIndex(d).containsKey(barcode)) {
      return Result.Failed("این بارکد قبلاً برای کالای دیگری ثبت شده")
    }

    val id = newId()
    val product = Product(
      id = id,
      name = name,
      category = draft.category,
      unit = draft.unit,
      purchasePrice = draft.purchasePrice,
      salePrice = draft.salePrice,
      wholesalePrice = 0.0,
      minStock = if (draft.minStock.isNaN()) 0.0 else draft.minStock,
      notes = "",
      barcodes = if (barcode.isEmpty()) emptyList() else listOf(barcode),
      createdAt = now,
    )

    return Result.Ok(
      d.copy(
        products = d.products + product,
        productCategories = withCategory(d.productCategories, draft.category),
        productUnits = withUnit(d.productUnits, draft.unit),
      ),
      id = id,
    )
  }

  fun editProduct(
    d: ShopData,
    id: String,
    draft: ProductDraft,
    today: String,
    now: Long,
    newId: () -> String,
  ): Result {
    val existing = d.products.find { it.id == id } ?: return Result.Failed("کالا پیدا نشد")
    val name = draft.name.trim()
    if (name.isEmpty()) return Result.Failed("نام کالا را بنویسید")
    if (draft.salePrice.isNaN() || draft.salePrice < 0) return Result.Failed("قیمت فروش درست نیست")
    if (draft.purchasePrice.isNaN() || draft.purchasePrice < 0) return Result.Failed("قیمت خرید درست نیست")

    val barcode = draft.barcode.trim()
    // بارکدِ تکراری فقط وقتی ایراد دارد که مالِ کالای دیگری باشد
    val owner = if (barcode.isEmpty()) null else ShopStore.barcodeIndex(d)[barcode]
    if (owner != null && owner != id) return Result.Failed("این بارکد قبلاً برای کالای دیگری ثبت شده")

    val updated = existing.copy(
      name = name,
      category = draft.category,
      unit = draft.unit,
      purchasePrice = draft.purchasePrice,
      salePrice = draft.salePrice,
      minStock = if (draft.minStock.isNaN()) 0.0 else draft.minStock,
      barcodes = if (barcode.isEmpty()) emptyList() else listOf(barcode),
    )

    // تغییرِ قیمتِ خرید در تاریخچه می‌ماند — سودِ گذشته نباید عوض شود
    var history = d.priceHistory
    var audit = d.auditLog
    if (existing.purchasePrice != draft.purchasePrice) {
      history = history + PriceChange(
        id = newId(),
        productId = id,
        oldPrice = existing.purchasePrice,
        newPrice = draft.purchasePrice,
        date = today,
        createdAt = now,
      )
      audit = audit + AuditEntry(
        id = newId(),
        type = "price_change",
        date = today,
        refId = id,
        notes = "تغییر قیمت خرید از ${money(existing.purchasePrice)} به ${money(draft.purchasePrice)} افغانی",
        createdAt = now,
      )
    }

    return Result.Ok(
      d.copy(
        products = d.products.map { if (it.id == id) updated else it },
        productCategories = withCategory(d.productCategories, draft.category),
        productUnits = withUnit(d.productUnits, draft.unit),
        priceHistory = history,
        auditLog = audit,
      ),
      id = id,
    )
  }

  /**
   * حذفِ کالا.
   *
   * فاکتورهای گذشته دست نمی‌خورند — همان‌طور که در نسخهٔ وب. سابقهٔ فروش
   * حقیقتی است که افتاده، و پاک کردنش گزارشِ سودِ ماه‌های قبل را عوض
   * می‌کند. فقط خودِ کالا و ورودی‌های انبارش می‌روند.
   */
  fun deleteProduct(d: ShopData, id: String, today: String, now: Long, newId: () -> String): Result {
    val product = d.products.find { it.id == id } ?: return Result.Failed("کالا پیدا نشد")
    return Result.Ok(
      d.copy(
        products = d.products.filter { it.id != id },
        warehouseEntries = d.warehouseEntries.filter { it.productId != id },
        auditLog = d.auditLog + AuditEntry(
          id = newId(),
          type = "delete_product",
          date = today,
          refId = id,
          notes = "حذف محصول «${product.name}»",
          createdAt = now,
        ),
      ),
      id = id,
    )
  }

  /** جمله‌ای که پیش از حذف به کاربر نشان داده می‌شود */
  fun deleteWarning(d: ShopData, id: String): String {
    val product = d.products.find { it.id == id } ?: return ""
    val sold = ShopStore.soldQty(d, id)
    return if (sold > 0) {
      "از «${product.name}» تا کنون ${money(sold)} واحد فروخته شده است. فاکتورهای قبلی حفظ می‌شوند ولی نام این کالا در آن‌ها «حذف‌شده» نشان داده می‌شود و از گزارش سود محصولات کنار می‌رود."
    } else {
      "محصول «${product.name}» و سوابق ورود آن از انبار حذف خواهد شد."
    }
  }

  /* --------------------------- ورودِ کالا --------------------------- */

  fun addEntry(d: ShopData, draft: EntryDraft, today: String, now: Long, newId: () -> String): Result {
    if (d.products.none { it.id == draft.productId }) return Result.Failed("ابتدا یک محصول انتخاب یا اضافه کنید")
    if (draft.units.isNaN() || draft.units <= 0) return Result.Failed("تعداد واحد معتبر وارد کنید")
    if (draft.price.isNaN() || draft.price < 0) return Result.Failed("قیمت خرید معتبر وارد کنید")

    val id = newId()
    val date = draft.date.ifBlank { today }
    return Result.Ok(
      d.copy(
        warehouseEntries = d.warehouseEntries + WarehouseEntry(
          id = id,
          productId = draft.productId,
          cartons = draft.cartons,
          perCarton = draft.perCarton,
          units = draft.units,
          unit = draft.unit,
          price = draft.price,
          date = date,
          notes = draft.notes,
          createdAt = now,
        ),
        stockMovements = d.stockMovements + StockMovement(
          id = newId(),
          productId = draft.productId,
          type = "purchase_in",
          qty = draft.units,
          date = date,
          notes = draft.notes.ifBlank { "ثبت ورود کالا" },
          refId = id,
          createdAt = now,
        ),
        productUnits = withUnit(d.productUnits, draft.unit),
      ),
      id = id,
    )
  }

  /**
   * ویرایشِ ورودی. حرکتِ انبارِ قبلی سرِ جایش می‌ماند — عیناً مثل نسخهٔ وب.
   */
  fun editEntry(d: ShopData, id: String, draft: EntryDraft, today: String): Result {
    val existing = d.warehouseEntries.find { it.id == id } ?: return Result.Failed("ورودی پیدا نشد")
    if (d.products.none { it.id == draft.productId }) return Result.Failed("ابتدا یک محصول انتخاب یا اضافه کنید")
    if (draft.units.isNaN() || draft.units <= 0) return Result.Failed("تعداد واحد معتبر وارد کنید")
    if (draft.price.isNaN() || draft.price < 0) return Result.Failed("قیمت خرید معتبر وارد کنید")

    val updated = existing.copy(
      productId = draft.productId,
      cartons = draft.cartons,
      perCarton = draft.perCarton,
      units = draft.units,
      unit = draft.unit,
      price = draft.price,
      date = draft.date.ifBlank { today },
      notes = draft.notes,
    )
    return Result.Ok(
      d.copy(
        warehouseEntries = d.warehouseEntries.map { if (it.id == id) updated else it },
        productUnits = withUnit(d.productUnits, draft.unit),
      ),
      id = id,
    )
  }

  fun deleteEntry(d: ShopData, id: String): Result {
    if (d.warehouseEntries.none { it.id == id }) return Result.Failed("ورودی پیدا نشد")
    return Result.Ok(
      d.copy(
        warehouseEntries = d.warehouseEntries.filter { it.id != id },
        stockMovements = d.stockMovements.filter { it.refId != id },
      ),
      id = id,
    )
  }

  /* ------------------------- اصلاحِ موجودی ------------------------- */

  /**
   * موجودی را کم یا زیاد می‌کند و دلیلش را ثبت می‌کند.
   *
   * دلیل اجباری است. موجودیِ بی‌دلیل که عوض شود، فردا هیچ‌کس نمی‌فهمد
   * جنس کجا رفته.
   */
  fun adjustStock(
    d: ShopData,
    productId: String,
    quantity: Double,
    increase: Boolean,
    reason: String,
    kind: AdjustKind,
    today: String,
    now: Long,
    newId: () -> String,
  ): Result {
    val product = d.products.find { it.id == productId } ?: return Result.Failed("ابتدا یک محصول اضافه کنید")
    if (quantity.isNaN() || quantity <= 0) return Result.Failed("مقدار معتبر وارد کنید")
    val why = reason.trim()
    if (why.isEmpty()) return Result.Failed("دلیل اصلاح را بنویسید")

    val delta = if (increase) quantity else -quantity
    val id = newId()
    val date = today
    val label = if (kind == AdjustKind.SUPPLIER_RETURN) "برگشت به تأمین‌کننده" else "اصلاح موجودی"

    return Result.Ok(
      d.copy(
        warehouseEntries = d.warehouseEntries + WarehouseEntry(
          id = id,
          productId = productId,
          cartons = 0.0,
          perCarton = 0.0,
          units = delta,
          unit = product.unit,
          price = 0.0,
          date = date,
          notes = why,
          isAdjustment = true,
          createdAt = now,
        ),
        stockMovements = d.stockMovements + StockMovement(
          id = newId(),
          productId = productId,
          type = if (kind == AdjustKind.SUPPLIER_RETURN) "supplier_return" else "adjustment",
          qty = delta,
          date = date,
          notes = why,
          refId = id,
          createdAt = now,
        ),
        auditLog = d.auditLog + AuditEntry(
          id = newId(),
          type = if (kind == AdjustKind.SUPPLIER_RETURN) "supplier_return" else "stock_adjustment",
          date = date,
          refId = id,
          notes = "$label «${product.name}» به مقدار ${if (increase) "+" else "−"}${money(quantity)} — دلیل: $why",
          createdAt = now,
        ),
      ),
      id = id,
    )
  }

  /* ------------------------------ ریزه‌کاری ------------------------------ */

  private fun withCategory(list: List<String>, value: String): List<String> {
    val v = value.trim()
    return if (v.isEmpty() || list.contains(v)) list else list + v
  }

  private fun withUnit(list: List<String>, value: String): List<String> {
    val v = value.trim()
    return if (v.isEmpty() || list.contains(v)) list else list + v
  }
}
