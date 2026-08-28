package ir.vil3ntec.tohid.data

import ir.vil3ntec.tohid.money

/**
 *  مصارف، خرید و تأمین‌کننده‌ها.
 *
 *  سه چیزِ به‌هم‌چسبیده: خرید هم‌زمان جنس را وارد انبار می‌کند، بدهیِ
 *  تأمین‌کننده را بالا می‌برد و اگر قیمتِ خرید عوض شده باشد آن را هم ثبت
 *  می‌کند. در نسخهٔ وب هم همین‌طور بود؛ اگر اینجا یکی‌شان جا بیفتد، عددِ
 *  انبار و عددِ حسابِ تأمین‌کننده از هم جدا می‌افتند.
 */
object LedgerEngine {

  sealed interface Result {
    data class Ok(val data: ShopData, val id: String) : Result
    data class Failed(val message: String) : Result
  }

  /* ============================== مصارف ============================== */

  data class ExpenseDraft(
    val title: String = "",
    val category: String = "",
    val amount: Double = 0.0,
    val date: String = "",
    val notes: String = "",
  )

  fun addExpense(d: ShopData, draft: ExpenseDraft, today: String, now: Long, newId: () -> String): Result {
    if (draft.amount.isNaN() || draft.amount <= 0) return Result.Failed("مبلغ معتبر وارد کنید")
    val category = draft.category.trim().ifBlank { d.expenseCategories.firstOrNull().orEmpty() }
    if (category.isBlank()) return Result.Failed("دسته‌بندی را انتخاب کنید")

    // «بابت چی؟» اختیاری است: نامِ دسته‌بندی به‌جایش می‌نشیند تا فهرستِ
    // مصارف ردیفِ بی‌عنوان نداشته باشد — همان کارِ نسخهٔ وب
    val title = draft.title.trim().ifBlank { category }
    val id = newId()

    return Result.Ok(
      d.copy(
        expenses = d.expenses + Expense(
          id = id,
          title = title,
          category = category,
          amount = draft.amount,
          date = draft.date.ifBlank { today },
          notes = draft.notes,
          createdAt = now,
        ),
        expenseCategories = withValue(d.expenseCategories, category),
      ),
      id = id,
    )
  }

  fun editExpense(d: ShopData, id: String, draft: ExpenseDraft, today: String): Result {
    val existing = d.expenses.find { it.id == id } ?: return Result.Failed("مصرف پیدا نشد")
    if (draft.amount.isNaN() || draft.amount <= 0) return Result.Failed("مبلغ معتبر وارد کنید")
    val category = draft.category.trim().ifBlank { existing.category }
    val title = draft.title.trim().ifBlank { category }

    return Result.Ok(
      d.copy(
        expenses = d.expenses.map {
          if (it.id == id) it.copy(
            title = title,
            category = category,
            amount = draft.amount,
            date = draft.date.ifBlank { today },
          ) else it
        },
        expenseCategories = withValue(d.expenseCategories, category),
      ),
      id = id,
    )
  }

  fun deleteExpense(d: ShopData, id: String): Result {
    if (d.expenses.none { it.id == id }) return Result.Failed("مصرف پیدا نشد")
    return Result.Ok(d.copy(expenses = d.expenses.filter { it.id != id }), id = id)
  }

  /* ========================== تأمین‌کننده‌ها ========================== */

  data class SupplierDraft(
    val name: String = "",
    val phone: String = "",
    val address: String = "",
    val notes: String = "",
  )

  fun addSupplier(d: ShopData, draft: SupplierDraft, now: Long, newId: () -> String): Result {
    val name = draft.name.trim()
    if (name.isEmpty()) return Result.Failed("نام تأمین‌کننده را بنویسید")
    val id = newId()
    return Result.Ok(
      d.copy(
        suppliers = d.suppliers + Supplier(
          id = id,
          name = name,
          phone = draft.phone.trim(),
          address = draft.address.trim(),
          notes = draft.notes.trim(),
          createdAt = now,
        )
      ),
      id = id,
    )
  }

  fun editSupplier(d: ShopData, id: String, draft: SupplierDraft): Result {
    if (d.suppliers.none { it.id == id }) return Result.Failed("تأمین‌کننده پیدا نشد")
    val name = draft.name.trim()
    if (name.isEmpty()) return Result.Failed("نام تأمین‌کننده را بنویسید")
    return Result.Ok(
      d.copy(
        suppliers = d.suppliers.map {
          if (it.id == id) it.copy(
            name = name,
            phone = draft.phone.trim(),
            address = draft.address.trim(),
            notes = draft.notes.trim(),
          ) else it
        }
      ),
      id = id,
    )
  }

  /**
   * حذفِ تأمین‌کننده.
   *
   * اگر خرید یا پرداختی به نامش ثبت شده باشد، حذف نمی‌شود: آن ارقام در
   * حسابِ دکان اثر دارند و بی‌صاحب کردنشان یعنی بدهی‌ای که دیگر معلوم
   * نیست به کیست.
   */
  fun deleteSupplier(d: ShopData, id: String): Result {
    val supplier = d.suppliers.find { it.id == id } ?: return Result.Failed("تأمین‌کننده پیدا نشد")
    val purchases = d.purchases.count { it.supplierId == id }
    val payments = d.supplierPayments.count { it.supplierId == id }
    if (purchases > 0 || payments > 0) {
      return Result.Failed("«${supplier.name}» خرید یا پرداخت ثبت‌شده دارد و حذف نمی‌شود")
    }
    return Result.Ok(d.copy(suppliers = d.suppliers.filter { it.id != id }), id = id)
  }

  /* ============================== خرید ============================== */

  data class PurchaseDraft(
    val supplierId: String = "",
    val productId: String = "",
    val quantity: Double = 0.0,
    val unit: String = "",
    val purchasePrice: Double = 0.0,
    val paidAmount: Double = 0.0,
    val date: String = "",
    val notes: String = "",
  )

  /**
   * ثبتِ خرید — یک کار، چهار اثر:
   *   • جنس وارد انبار می‌شود
   *   • حرکتِ انبار ثبت می‌شود
   *   • باقیِ مبلغ به حسابِ تأمین‌کننده می‌رود
   *   • اگر قیمتِ خرید عوض شده، هم روی کالا می‌نشیند هم در تاریخچه می‌ماند
   *
   * ویرایشِ خرید عمداً نیست — همان‌طور که در نسخهٔ وب. تغییرِ یک خریدِ
   * ثبت‌شده باید هم انبار، هم بدهی و هم تاریخچهٔ قیمت را عقب ببرد، و
   * نیمه‌کاره انجام‌شدنش بدتر از نبودنش است. برای اصلاح، ورودی‌اش حذف و
   * دوباره ثبت می‌شود.
   */
  fun addPurchase(d: ShopData, draft: PurchaseDraft, today: String, now: Long, newId: () -> String): Result {
    val supplier = d.suppliers.find { it.id == draft.supplierId }
      ?: return Result.Failed("تأمین‌کننده را انتخاب کنید")
    val product = d.products.find { it.id == draft.productId }
      ?: return Result.Failed("محصول را انتخاب کنید")
    if (draft.quantity.isNaN() || draft.quantity <= 0) return Result.Failed("مقدار معتبر وارد کنید")
    if (draft.purchasePrice.isNaN() || draft.purchasePrice < 0) return Result.Failed("قیمت خرید معتبر وارد کنید")

    val date = draft.date.ifBlank { today }
    val unit = draft.unit.ifBlank { product.unit }
    // گِرد کردن دقیقاً همان‌جای نسخهٔ وب است
    val totalAmount = Math.round(draft.quantity * draft.purchasePrice).toDouble()
    var paid = if (draft.paidAmount.isNaN() || draft.paidAmount < 0) 0.0 else draft.paidAmount
    paid = minOf(paid, totalAmount)

    val purchaseId = newId()
    val entryId = newId()

    var products = d.products
    var history = d.priceHistory
    var audit = d.auditLog

    // قیمتِ خریدِ کالا با آخرین خرید به‌روز می‌شود، و تغییرش می‌ماند
    if (product.purchasePrice != draft.purchasePrice) {
      history = history + PriceChange(
        id = newId(),
        productId = product.id,
        oldPrice = product.purchasePrice,
        newPrice = draft.purchasePrice,
        date = today,
        createdAt = now,
      )
      audit = audit + AuditEntry(
        id = newId(),
        type = "price_change",
        date = today,
        refId = product.id,
        notes = "تغییر قیمت خرید از ${money(product.purchasePrice)} به ${money(draft.purchasePrice)} افغانی",
        createdAt = now,
      )
      products = products.map {
        if (it.id == product.id) it.copy(purchasePrice = draft.purchasePrice) else it
      }
    }

    audit = audit + AuditEntry(
      id = newId(),
      type = "purchase",
      date = date,
      refId = purchaseId,
      notes = "ثبت خرید ${money(draft.quantity)} $unit از «${supplier.name}» به مبلغ ${money(totalAmount)} افغانی",
      createdAt = now,
    )

    return Result.Ok(
      d.copy(
        products = products,
        priceHistory = history,
        auditLog = audit,
        warehouseEntries = d.warehouseEntries + WarehouseEntry(
          id = entryId,
          productId = product.id,
          cartons = 0.0,
          perCarton = 0.0,
          units = draft.quantity,
          unit = unit,
          price = draft.purchasePrice,
          date = date,
          notes = draft.notes.ifBlank { "خرید از تأمین‌کننده" },
          purchaseId = purchaseId,
          createdAt = now,
        ),
        purchases = d.purchases + Purchase(
          id = purchaseId,
          productId = product.id,
          supplierId = supplier.id,
          quantity = draft.quantity,
          unit = unit,
          purchasePrice = draft.purchasePrice,
          totalAmount = totalAmount,
          date = date,
          notes = draft.notes,
          paidAmount = paid,
          debt = totalAmount - paid,
          warehouseEntryId = entryId,
          createdAt = now,
        ),
        stockMovements = d.stockMovements + StockMovement(
          id = newId(),
          productId = product.id,
          type = "purchase_in",
          qty = draft.quantity,
          date = date,
          notes = draft.notes.ifBlank { "ثبت خرید" },
          refId = purchaseId,
          createdAt = now,
        ),
      ),
      id = purchaseId,
    )
  }

  /** پرداخت به تأمین‌کننده — بدهیِ ما به او را کم می‌کند */
  fun paySupplier(
    d: ShopData,
    supplierId: String,
    amount: Double,
    date: String,
    notes: String,
    today: String,
    now: Long,
    newId: () -> String,
  ): Result {
    val supplier = d.suppliers.find { it.id == supplierId } ?: return Result.Failed("تأمین‌کننده پیدا نشد")
    if (amount.isNaN() || amount <= 0) return Result.Failed("مبلغ معتبر وارد کنید")

    val id = newId()
    val when_ = date.ifBlank { today }
    return Result.Ok(
      d.copy(
        supplierPayments = d.supplierPayments + SupplierPayment(
          id = id,
          supplierId = supplierId,
          amount = amount,
          date = when_,
          notes = notes.trim(),
          createdAt = now,
        ),
        auditLog = d.auditLog + AuditEntry(
          id = newId(),
          type = "supplier_payment",
          date = when_,
          refId = id,
          notes = "پرداخت به «${supplier.name}» به مبلغ ${money(amount)} افغانی",
          createdAt = now,
        ),
      ),
      id = id,
    )
  }

  /* ============================== خلاصه‌ها ============================== */

  /** مصارفِ یک بازهٔ زمانی، دسته به دسته */
  fun expensesByCategory(d: ShopData, from: String, to: String): List<Pair<String, Double>> =
    d.expenses
      .filter { it.date in from..to }
      .groupBy { it.category }
      .map { (category, list) -> category to list.sumOf { it.amount } }
      .sortedByDescending { it.second }

  fun expenseTotal(d: ShopData, from: String, to: String): Double =
    d.expenses.filter { it.date in from..to }.sumOf { it.amount }

  private fun withValue(list: List<String>, value: String): List<String> {
    val v = value.trim()
    return if (v.isEmpty() || list.contains(v)) list else list + v
  }
}
