package ir.vil3ntec.tohid.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 *  گزارشِ سود.
 *
 *  اثرِ مرجوعی روی سود سه حالتِ جدا دارد و هر سه در نسخهٔ وب با دقت
 *  نوشته شده بود — چون اشتباهش سودِ ماه را دو بار جریمه می‌کند یا اصلاً
 *  حساب نمی‌کند، و هیچ‌کدام روی صفحه به چشم نمی‌آید. هر سه حالت اینجا
 *  سنجیده می‌شود.
 */
class ReportEngineTest {

  private var seq = 0
  private fun newId(): String = "g${seq++}"

  private val rice = Product(id = "p1", name = "برنج", unit = "کیلو", purchasePrice = 200.0, salePrice = 300.0)
  private val oil = Product(id = "p2", name = "روغن", unit = "عدد", purchasePrice = 400.0, salePrice = 500.0)

  private fun ledger() = ShopData(
    products = listOf(rice, oil),
    warehouseEntries = listOf(
      WarehouseEntry(id = "w1", productId = "p1", units = 1000.0),
      WarehouseEntry(id = "w2", productId = "p2", units = 1000.0),
    ),
  )

  private fun sell(d: ShopData, productId: String, quantity: Double, date: String, discount: Double = 0.0) =
    (SalesEngine.record(
      d, listOf(SalesEngine.CartLine(productId, quantity)),
      SalesEngine.Checkout(discountType = SalesEngine.DiscountType.AMOUNT, discountValue = discount),
      date, 1_700_000_000_000, ::newId,
    ) as SalesEngine.Result.Ok)

  /* --------------------------- سود پایه --------------------------- */

  @Test
  fun `سود ناخالص از قیمت خرید ثبت شده روی قلم فروش حساب می شود`() {
    val sold = sell(ledger(), "p1", 10.0, "2026-08-10")
    val r = ReportEngine.sales(sold.data, "2026-08-01", "2026-08-31")

    assertEquals(1, r.count)
    assertEquals(3000.0, r.gross, 0.0)         // ۱۰ × ۳۰۰
    assertEquals(0.0, r.discount, 0.0)
    assertEquals(3000.0, r.net, 0.0)
    assertEquals(2000.0, r.cogs, 0.0)          // ۱۰ × ۲۰۰
    assertEquals(1000.0, r.grossProfit, 0.0)
    assertEquals(1000.0, r.netProfit, 0.0)
  }

  @Test
  fun `تخفیف از سود کم می شود`() {
    val sold = sell(ledger(), "p1", 10.0, "2026-08-10", discount = 500.0)
    val r = ReportEngine.sales(sold.data, "2026-08-01", "2026-08-31")
    assertEquals(3000.0, r.gross, 0.0)
    assertEquals(500.0, r.discount, 0.0)
    assertEquals(2500.0, r.net, 0.0)
    assertEquals(500.0, r.grossProfit, 0.0)    // ۲۵۰۰ − ۲۰۰۰
  }

  @Test
  fun `مصارف از سود ناخالص کم می شوند`() {
    var d = sell(ledger(), "p1", 10.0, "2026-08-10").data
    d = (LedgerEngine.addExpense(
      d, LedgerEngine.ExpenseDraft(title = "کرایه", category = "کرایه", amount = 400.0, date = "2026-08-05"),
      "2026-08-28", 0, ::newId,
    ) as LedgerEngine.Result.Ok).data

    val r = ReportEngine.sales(d, "2026-08-01", "2026-08-31")
    assertEquals(1000.0, r.grossProfit, 0.0)
    assertEquals(400.0, r.expenses, 0.0)
    assertEquals(600.0, r.netProfit, 0.0)
  }

  @Test
  fun `فروش خارج از بازه در گزارش نمی آید`() {
    var d = sell(ledger(), "p1", 10.0, "2026-07-20").data
    d = sell(d, "p1", 5.0, "2026-08-10").data
    val r = ReportEngine.sales(d, "2026-08-01", "2026-08-31")
    assertEquals(1, r.count)
    assertEquals(1500.0, r.net, 0.0)
  }

  @Test
  fun `فروش لغوشده در گزارش نمی آید`() {
    val sold = sell(ledger(), "p1", 10.0, "2026-08-10")
    val cancelled = (SalesEngine.cancel(sold.data, sold.saleId, "2026-08-11", 0, ::newId) as SalesEngine.Result.Ok).data
    val r = ReportEngine.sales(cancelled, "2026-08-01", "2026-08-31")
    assertEquals(0, r.count)
    assertEquals(0.0, r.net, 0.0)
    assertEquals(0.0, r.netProfit, 0.0)
  }

  /* ------------------- سه حالتِ اثرِ مرجوعی روی سود ------------------- */

  @Test
  fun `حالت یک — مرجوعیِ فروشِ لغوشده سود را دوبار جریمه نمی کند`() {
    val sold = sell(ledger(), "p1", 10.0, "2026-08-10")
    val itemId = sold.data.saleItems.single().id
    var d = (SalesEngine.recordReturn(
      sold.data, sold.saleId, mapOf(itemId to 4.0), "", "2026-08-12", 0, ::newId,
    ) as SalesEngine.Result.Ok).data
    d = (SalesEngine.cancel(d, sold.saleId, "2026-08-13", 0, ::newId) as SalesEngine.Result.Ok).data

    val r = ReportEngine.sales(d, "2026-08-01", "2026-08-31")
    // فروش اصلاً شمرده نمی‌شود، پس مرجوعی‌اش هم نباید جایی کم شود
    assertEquals(0.0, r.returnAmount, 0.0)
    assertEquals(0.0, r.netProfit, 0.0)
  }

  @Test
  fun `حالت دو — مرجوعیِ فروشِ همان بازه، کل مبلغش از سود کم می شود`() {
    val sold = sell(ledger(), "p1", 10.0, "2026-08-10")
    val itemId = sold.data.saleItems.single().id
    val d = (SalesEngine.recordReturn(
      sold.data, sold.saleId, mapOf(itemId to 4.0), "", "2026-08-12", 0, ::newId,
    ) as SalesEngine.Result.Ok).data

    val r = ReportEngine.sales(d, "2026-08-01", "2026-08-31")
    assertEquals(3000.0, r.net, 0.0)           // مبلغِ اولیهٔ فاکتور
    assertEquals(1200.0, r.cogs, 0.0)          // ۶ کیلوی مانده × ۲۰۰
    assertEquals(1200.0, r.returnAmount, 0.0)  // ۴ × ۳۰۰
    // ۳۰۰۰ − ۱۲۰۰ − ۱۲۰۰ = ۶۰۰ ، یعنی سودِ همان ۶ کیلو
    assertEquals(600.0, r.grossProfit, 0.0)
    assertEquals(6 * (300.0 - 200.0), r.grossProfit, 0.0)
  }

  @Test
  fun `حالت سه — مرجوعیِ فروشِ بازه ی قبل، فقط سودِ از دست رفته کم می شود`() {
    // فروش در ماه قبل، مرجوعی در این ماه
    val sold = sell(ledger(), "p1", 10.0, "2026-07-20")
    val itemId = sold.data.saleItems.single().id
    var d = (SalesEngine.recordReturn(
      sold.data, sold.saleId, mapOf(itemId to 4.0), "", "2026-08-12", 0, ::newId,
    ) as SalesEngine.Result.Ok).data
    // و یک فروشِ تازه در همین ماه
    d = sell(d, "p2", 10.0, "2026-08-15").data

    val r = ReportEngine.sales(d, "2026-08-01", "2026-08-31")
    assertEquals(5000.0, r.net, 0.0)           // فقط فروشِ روغن
    assertEquals(4000.0, r.cogs, 0.0)
    assertEquals(1200.0, r.returnAmount, 0.0)
    // مرجوعیِ ماهِ قبل: ۱۲۰۰ مبلغ − ۸۰۰ بهای تمام‌شده = ۴۰۰ سودِ از‌دست‌رفته
    assertEquals(1000.0 - 400.0, r.grossProfit, 0.0)
  }

  @Test
  fun `مرجوعیِ خارج از بازه اصلاً حساب نمی شود`() {
    val sold = sell(ledger(), "p1", 10.0, "2026-08-10")
    val itemId = sold.data.saleItems.single().id
    val d = (SalesEngine.recordReturn(
      sold.data, sold.saleId, mapOf(itemId to 4.0), "", "2026-09-05", 0, ::newId,
    ) as SalesEngine.Result.Ok).data

    val r = ReportEngine.sales(d, "2026-08-01", "2026-08-31")
    assertEquals(0.0, r.returnAmount, 0.0)
    // ولی cogs مرجوعی را کم کرده — همان رفتارِ نسخهٔ وب
    assertEquals(1200.0, r.cogs, 0.0)
    assertEquals(1800.0, r.grossProfit, 0.0)
  }

  /* --------------------------- محصولات --------------------------- */

  @Test
  fun `سود هر کالا از قیمت همان فاکتور می آید نه قیمت امروز`() {
    var d = sell(ledger(), "p1", 10.0, "2026-08-10").data
    // قیمت‌ها بعد از فروش عوض می‌شوند
    d = d.copy(products = d.products.map {
      if (it.id == "p1") it.copy(salePrice = 900.0, purchasePrice = 50.0) else it
    })

    val (quantity, profit) = ReportEngine.productStat(d, "p1")
    assertEquals(10.0, quantity, 0.0)
    assertEquals(1000.0, profit, 0.0)   // ۱۰ × (۳۰۰ − ۲۰۰)، نه قیمت‌های تازه
  }

  @Test
  fun `مرجوعی از فروش و سود کالا کم می شود`() {
    val sold = sell(ledger(), "p1", 10.0, "2026-08-10")
    val itemId = sold.data.saleItems.single().id
    val d = (SalesEngine.recordReturn(
      sold.data, sold.saleId, mapOf(itemId to 4.0), "", "2026-08-12", 0, ::newId,
    ) as SalesEngine.Result.Ok).data

    val (quantity, profit) = ReportEngine.productStat(d, "p1")
    assertEquals(6.0, quantity, 0.0)
    assertEquals(600.0, profit, 0.0)
  }

  @Test
  fun `پرفروش ها و کم فروش ها درست مرتب می شوند`() {
    var d = sell(ledger(), "p1", 3.0, "2026-08-10").data
    d = sell(d, "p2", 20.0, "2026-08-10").data

    val report = ReportEngine.products(d)
    assertEquals("روغن", report.topSelling.first().product.name)
    // «کم‌فروش» فقط بین آن‌هایی که فروش داشته‌اند
    assertEquals("برنج", report.slowest.first().product.name)
    assertTrue(report.slowest.all { it.quantity > 0 })
  }

  @Test
  fun `ارزش موجودی به بهای خرید حساب می شود نه فروش`() {
    val d = sell(ledger(), "p1", 100.0, "2026-08-10").data
    // ۹۰۰ کیلو برنج × ۲۰۰ + ۱۰۰۰ روغن × ۴۰۰
    assertEquals(900 * 200.0 + 1000 * 400.0, ReportEngine.products(d).inventoryValue, 0.0)
  }

  /* --------------------------- قرض‌داران --------------------------- */

  @Test
  fun `گزارش قرض داران داده و گرفته را جدا نشان می دهد`() {
    val d = ShopData(
      debtors = listOf(Debtor(id = "d1", name = "احمد")),
      transactions = listOf(
        DebtTransaction(id = "t1", debtorId = "d1", type = "give", amount = 5000.0),
        DebtTransaction(id = "t2", debtorId = "d1", type = "receive", amount = 2000.0),
        DebtTransaction(id = "t3", debtorId = "d1", type = "give", amount = 1000.0),
      ),
    )
    val row = ReportEngine.debtors(d).single()
    assertEquals(6000.0, row.given, 0.0)
    assertEquals(2000.0, row.received, 0.0)
    assertEquals(4000.0, row.remaining, 0.0)
  }

  /* --------------------------- بازه‌ها --------------------------- */

  @Test
  fun `بازه های آماده درست حساب می شوند`() {
    assertEquals("2026-08-28" to "2026-08-28", ReportEngine.rangeOf(ReportEngine.Range.TODAY, "2026-08-28"))
    assertEquals("2026-08-22" to "2026-08-28", ReportEngine.rangeOf(ReportEngine.Range.WEEK, "2026-08-28"))
    assertEquals("2026-08-01" to "2026-08-28", ReportEngine.rangeOf(ReportEngine.Range.MONTH, "2026-08-28"))
    // هفته‌ای که از مرزِ ماه رد می‌شود
    assertEquals("2026-07-29" to "2026-08-04", ReportEngine.rangeOf(ReportEngine.Range.WEEK, "2026-08-04"))
  }

  @Test
  fun `گردش موجودی تازه ترین را اول می آورد`() {
    var d = sell(ledger(), "p1", 2.0, "2026-08-10").data
    d = d.copy(stockMovements = d.stockMovements.map { it.copy(createdAt = 100) } +
      StockMovement(id = "m9", productId = "p1", type = "adjustment", qty = -1.0, createdAt = 999))

    val rows = ReportEngine.stockLedger(d, "p1")
    assertEquals("m9", rows.first().id)
    assertEquals(2, rows.size)
    assertTrue(ReportEngine.stockLedger(d, "p2").isEmpty())
  }
}
