package ir.vil3ntec.tohid.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 *  مصارف، خرید و تأمین‌کننده.
 *
 *  خرید تنها جایی است که یک کار چند دفتر را هم‌زمان عوض می‌کند: انبار،
 *  حسابِ تأمین‌کننده، قیمتِ کالا و تاریخچهٔ قیمت. اگر یکی‌شان جا بیفتد،
 *  دو عددِ درست‌به‌نظر در دو صفحه با هم نمی‌خوانند.
 */
class LedgerEngineTest {

  private var seq = 0
  private fun newId(): String = "x${seq++}"

  private val base = ShopData(
    products = listOf(Product(id = "p1", name = "برنج", unit = "کیلو", purchasePrice = 200.0, salePrice = 300.0)),
    suppliers = listOf(Supplier(id = "su1", name = "شرکت نور")),
  )

  private fun ok(r: LedgerEngine.Result): LedgerEngine.Result.Ok {
    assertTrue("انتظار می‌رفت ثبت شود، ولی: $r", r is LedgerEngine.Result.Ok)
    return r as LedgerEngine.Result.Ok
  }

  private fun failed(r: LedgerEngine.Result): String {
    assertTrue("انتظار می‌رفت رد شود", r is LedgerEngine.Result.Failed)
    return (r as LedgerEngine.Result.Failed).message
  }

  /* ============================== مصارف ============================== */

  @Test
  fun `مصرف با دسته بندی و مبلغ ثبت می شود`() {
    val r = ok(
      LedgerEngine.addExpense(
        base, LedgerEngine.ExpenseDraft(title = "کرایه دکان", category = "کرایه", amount = 3000.0),
        today = "2026-08-28", now = 1_700_000_000_000, newId = ::newId,
      )
    )
    val e = r.data.expenses.single()
    assertEquals("کرایه دکان", e.title)
    assertEquals("کرایه", e.category)
    assertEquals(3000.0, e.amount, 0.0)
    assertEquals("2026-08-28", e.date)
  }

  @Test
  fun `مصرف بی عنوان نام دسته بندی را می گیرد`() {
    // «بابت چی؟» اختیاری است — ردیفِ بی‌عنوان در فهرست بد است
    val r = ok(
      LedgerEngine.addExpense(
        base, LedgerEngine.ExpenseDraft(title = "   ", category = "برق", amount = 500.0),
        "2026-08-28", 0, ::newId,
      )
    )
    assertEquals("برق", r.data.expenses.single().title)
  }

  @Test
  fun `دسته بندی تازه به فهرست اضافه می شود`() {
    val r = ok(
      LedgerEngine.addExpense(
        base, LedgerEngine.ExpenseDraft(title = "چای", category = "پذیرایی", amount = 100.0),
        "2026-08-28", 0, ::newId,
      )
    )
    assertTrue(r.data.expenseCategories.contains("پذیرایی"))
    // دوباره ثبتِ همان دسته، تکراری نمی‌سازد
    val again = ok(
      LedgerEngine.addExpense(
        r.data, LedgerEngine.ExpenseDraft(title = "قند", category = "پذیرایی", amount = 50.0),
        "2026-08-28", 0, ::newId,
      )
    )
    assertEquals(1, again.data.expenseCategories.count { it == "پذیرایی" })
  }

  @Test
  fun `مصرف با مبلغ صفر یا منفی ثبت نمی شود`() {
    assertEquals(
      "مبلغ معتبر وارد کنید",
      failed(LedgerEngine.addExpense(base, LedgerEngine.ExpenseDraft(category = "برق", amount = 0.0), "2026-08-28", 0, ::newId)),
    )
    assertEquals(
      "مبلغ معتبر وارد کنید",
      failed(LedgerEngine.addExpense(base, LedgerEngine.ExpenseDraft(category = "برق", amount = -5.0), "2026-08-28", 0, ::newId)),
    )
  }

  @Test
  fun `جمع مصارف بازه ای حساب می شود`() {
    var d = base
    listOf("2026-08-01" to 1000.0, "2026-08-15" to 2000.0, "2026-09-01" to 4000.0).forEach { (date, amount) ->
      d = ok(
        LedgerEngine.addExpense(
          d, LedgerEngine.ExpenseDraft(title = "x", category = "برق", amount = amount, date = date),
          "2026-08-28", 0, ::newId,
        )
      ).data
    }
    assertEquals(3000.0, LedgerEngine.expenseTotal(d, "2026-08-01", "2026-08-31"), 0.0)
    assertEquals(7000.0, LedgerEngine.expenseTotal(d, "2026-08-01", "2026-09-30"), 0.0)
  }

  @Test
  fun `مصارف دسته به دسته و از بزرگ به کوچک`() {
    var d = base
    listOf("کرایه" to 5000.0, "برق" to 800.0, "کرایه" to 1000.0, "معاش" to 9000.0).forEach { (c, a) ->
      d = ok(
        LedgerEngine.addExpense(
          d, LedgerEngine.ExpenseDraft(title = c, category = c, amount = a, date = "2026-08-10"),
          "2026-08-28", 0, ::newId,
        )
      ).data
    }
    val rows = LedgerEngine.expensesByCategory(d, "2026-08-01", "2026-08-31")
    assertEquals(listOf("معاش" to 9000.0, "کرایه" to 6000.0, "برق" to 800.0), rows)
  }

  /* ============================== خرید ============================== */

  @Test
  fun `خرید هم انبار را پر می کند هم بدهی تأمین کننده را`() {
    val r = ok(
      LedgerEngine.addPurchase(
        base,
        LedgerEngine.PurchaseDraft(
          supplierId = "su1", productId = "p1", quantity = 100.0, unit = "کیلو",
          purchasePrice = 200.0, paidAmount = 15_000.0, date = "2026-08-02", notes = "بار اول",
        ),
        today = "2026-08-28", now = 1_700_000_000_000, newId = ::newId,
      )
    )

    // انبار
    assertEquals(100.0, ShopStore.stock(r.data, "p1"), 0.0)
    val entry = r.data.warehouseEntries.single()
    assertEquals(r.id, entry.purchaseId)
    assertEquals("بار اول", entry.notes)

    // حسابِ تأمین‌کننده
    val purchase = r.data.purchases.single()
    assertEquals(20_000.0, purchase.totalAmount, 0.0)
    assertEquals(15_000.0, purchase.paidAmount, 0.0)
    assertEquals(5_000.0, purchase.debt, 0.0)
    assertEquals(entry.id, purchase.warehouseEntryId)
    assertEquals(5_000.0, ShopStore.supplierDebt(r.data, "su1"), 0.0)

    // حرکتِ انبار
    val move = r.data.stockMovements.single()
    assertEquals("purchase_in", move.type)
    assertEquals(100.0, move.qty, 0.0)
    assertEquals(r.id, move.refId)

    // دفترچهٔ ثبت
    val audit = r.data.auditLog.single { it.type == "purchase" }
    assertEquals("ثبت خرید ۱۰۰ کیلو از «شرکت نور» به مبلغ ۲۰٬۰۰۰ افغانی", audit.notes)
  }

  @Test
  fun `خرید با قیمت تازه قیمت کالا را به روز می کند و تغییرش می ماند`() {
    val r = ok(
      LedgerEngine.addPurchase(
        base,
        LedgerEngine.PurchaseDraft(supplierId = "su1", productId = "p1", quantity = 10.0, purchasePrice = 250.0),
        "2026-08-28", 0, ::newId,
      )
    )
    assertEquals(250.0, r.data.products.single().purchasePrice, 0.0)
    val change = r.data.priceHistory.single()
    assertEquals(200.0, change.oldPrice, 0.0)
    assertEquals(250.0, change.newPrice, 0.0)
    assertTrue(r.data.auditLog.any { it.type == "price_change" })
  }

  @Test
  fun `خرید با همان قیمت تاریخچه ای نمی سازد`() {
    val r = ok(
      LedgerEngine.addPurchase(
        base,
        LedgerEngine.PurchaseDraft(supplierId = "su1", productId = "p1", quantity = 10.0, purchasePrice = 200.0),
        "2026-08-28", 0, ::newId,
      )
    )
    assertTrue(r.data.priceHistory.isEmpty())
    assertEquals(1, r.data.auditLog.size)   // فقط خودِ خرید
  }

  @Test
  fun `پرداختی بیشتر از مبلغ خرید به همان مبلغ محدود می شود`() {
    val r = ok(
      LedgerEngine.addPurchase(
        base,
        LedgerEngine.PurchaseDraft(supplierId = "su1", productId = "p1", quantity = 2.0,
          purchasePrice = 100.0, paidAmount = 9_999.0),
        "2026-08-28", 0, ::newId,
      )
    )
    assertEquals(200.0, r.data.purchases.single().paidAmount, 0.0)
    assertEquals(0.0, r.data.purchases.single().debt, 0.0)
  }

  @Test
  fun `خرید بدون تأمین کننده یا محصول ثبت نمی شود`() {
    assertEquals(
      "تأمین‌کننده را انتخاب کنید",
      failed(LedgerEngine.addPurchase(base, LedgerEngine.PurchaseDraft(productId = "p1", quantity = 1.0), "2026-08-28", 0, ::newId)),
    )
    assertEquals(
      "محصول را انتخاب کنید",
      failed(LedgerEngine.addPurchase(base, LedgerEngine.PurchaseDraft(supplierId = "su1", quantity = 1.0), "2026-08-28", 0, ::newId)),
    )
  }

  @Test
  fun `واحد خالی از خود کالا گرفته می شود`() {
    val r = ok(
      LedgerEngine.addPurchase(
        base, LedgerEngine.PurchaseDraft(supplierId = "su1", productId = "p1", quantity = 5.0, purchasePrice = 200.0),
        "2026-08-28", 0, ::newId,
      )
    )
    assertEquals("کیلو", r.data.purchases.single().unit)
  }

  /* ========================== تأمین‌کننده ========================== */

  @Test
  fun `پرداخت به تأمین کننده بدهی را کم می کند`() {
    val bought = ok(
      LedgerEngine.addPurchase(
        base,
        LedgerEngine.PurchaseDraft(supplierId = "su1", productId = "p1", quantity = 100.0,
          purchasePrice = 200.0, paidAmount = 0.0),
        "2026-08-28", 0, ::newId,
      )
    ).data
    assertEquals(20_000.0, ShopStore.supplierDebt(bought, "su1"), 0.0)

    val paid = ok(
      LedgerEngine.paySupplier(bought, "su1", 8_000.0, "2026-08-20", "قسط اول", "2026-08-28", 0, ::newId)
    )
    assertEquals(12_000.0, ShopStore.supplierDebt(paid.data, "su1"), 0.0)
    assertEquals("پرداخت به «شرکت نور» به مبلغ ۸٬۰۰۰ افغانی", paid.data.auditLog.last().notes)
    assertEquals("قسط اول", paid.data.supplierPayments.single().notes)
  }

  @Test
  fun `پرداخت صفر ثبت نمی شود`() {
    assertEquals(
      "مبلغ معتبر وارد کنید",
      failed(LedgerEngine.paySupplier(base, "su1", 0.0, "", "", "2026-08-28", 0, ::newId)),
    )
  }

  @Test
  fun `تأمین کننده ای که خرید دارد حذف نمی شود`() {
    val bought = ok(
      LedgerEngine.addPurchase(
        base, LedgerEngine.PurchaseDraft(supplierId = "su1", productId = "p1", quantity = 1.0, purchasePrice = 200.0),
        "2026-08-28", 0, ::newId,
      )
    ).data
    val message = failed(LedgerEngine.deleteSupplier(bought, "su1"))
    assertEquals("«شرکت نور» خرید یا پرداخت ثبت‌شده دارد و حذف نمی‌شود", message)
    assertEquals(1, bought.suppliers.size)
  }

  @Test
  fun `تأمین کننده ی بدون سابقه حذف می شود`() {
    val r = ok(LedgerEngine.deleteSupplier(base, "su1"))
    assertTrue(r.data.suppliers.isEmpty())
  }

  @Test
  fun `تأمین کننده ی بی نام ثبت نمی شود`() {
    assertEquals(
      "نام تأمین‌کننده را بنویسید",
      failed(LedgerEngine.addSupplier(base, LedgerEngine.SupplierDraft(name = "  "), 0, ::newId)),
    )
  }
}
