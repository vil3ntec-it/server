package ir.vil3ntec.tohid.data

import ir.vil3ntec.tohid.money
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 *  حسابِ پولِ دکان — همان چیزی که بیش از همه باید سنجیده شود.
 *
 *  این آزمون‌ها روی رایانه اجرا می‌شوند، نه روی گوشی. یعنی هر بار پیش از
 *  ساختِ برنامه معلوم می‌شود که تخفیف، باقی‌مانده، حسابِ قرض‌دار و موجودی
 *  همان عددی را می‌دهند که نسخهٔ وب می‌داد — بدونِ اینکه کسی مجبور باشد
 *  دستی فروش ثبت کند.
 */
class SalesEngineTest {

  /* ------------------------- دفترِ نمونه ------------------------- */

  private val rice = Product(id = "p1", name = "برنج", unit = "کیلو", purchasePrice = 200.0, salePrice = 300.0)
  private val oil = Product(id = "p2", name = "روغن", unit = "عدد", purchasePrice = 400.0, salePrice = 555.0)
  private val ahmad = Debtor(id = "d1", name = "احمد")

  private fun ledger(riceUnits: Double = 100.0, oilUnits: Double = 10.0) = ShopData(
    products = listOf(rice, oil),
    debtors = listOf(ahmad),
    warehouseEntries = listOf(
      WarehouseEntry(id = "w1", productId = "p1", units = riceUnits),
      WarehouseEntry(id = "w2", productId = "p2", units = oilUnits),
    ),
  )

  private var seq = 0
  private fun newId(): String = "t${seq++}"

  private fun record(
    d: ShopData,
    cart: List<SalesEngine.CartLine>,
    checkout: SalesEngine.Checkout,
  ) = SalesEngine.record(d, cart, checkout, today = "2026-08-28", now = 1_700_000_000_000, newId = ::newId)

  private fun ok(r: SalesEngine.Result): SalesEngine.Result.Ok {
    assertTrue("انتظار می‌رفت ثبت شود، ولی: $r", r is SalesEngine.Result.Ok)
    return r as SalesEngine.Result.Ok
  }

  private fun failed(r: SalesEngine.Result): String {
    assertTrue("انتظار می‌رفت رد شود", r is SalesEngine.Result.Failed)
    return (r as SalesEngine.Result.Failed).message
  }

  private val twoRice = listOf(SalesEngine.CartLine("p1", 2.0))

  /* --------------------------- جمع و تخفیف --------------------------- */

  @Test
  fun `جمع سبد از قیمت فروش حساب می شود`() {
    val d = ledger()
    val cart = listOf(SalesEngine.CartLine("p1", 2.0), SalesEngine.CartLine("p2", 3.0))
    assertEquals(2 * 300.0 + 3 * 555.0, SalesEngine.cartTotal(d, cart), 0.0001)
  }

  @Test
  fun `کالای حذف شده در جمع سبد صفر حساب می شود`() {
    val d = ledger()
    val cart = listOf(SalesEngine.CartLine("گم‌شده", 5.0))
    assertEquals(0.0, SalesEngine.cartTotal(d, cart), 0.0001)
  }

  @Test
  fun `تخفیف درصدی رند می شود`() {
    val d = ledger()
    // ۳ × ۵۵۵ = ۱۶۶۵ ؛ ۷٪ = ۱۱۶٫۵۵ → ۱۱۷
    val t = SalesEngine.totals(
      d, listOf(SalesEngine.CartLine("p2", 3.0)),
      SalesEngine.Checkout(discountType = SalesEngine.DiscountType.PERCENT, discountValue = 7.0),
    )
    assertEquals(1665.0, t.subtotal, 0.0001)
    assertEquals(117.0, t.discount, 0.0001)
    assertEquals(1548.0, t.finalTotal, 0.0001)
  }

  @Test
  fun `تخفیف درصدی از صد بالاتر نمی رود`() {
    val d = ledger()
    val t = SalesEngine.totals(
      d, twoRice,
      SalesEngine.Checkout(discountType = SalesEngine.DiscountType.PERCENT, discountValue = 250.0),
    )
    assertEquals(100.0, t.discountValue, 0.0001)
    assertEquals(600.0, t.discount, 0.0001)
    assertEquals(0.0, t.finalTotal, 0.0001)
  }

  @Test
  fun `تخفیف مبلغی از جمع سبد بالاتر نمی رود`() {
    val d = ledger()
    val t = SalesEngine.totals(
      d, twoRice,
      SalesEngine.Checkout(discountType = SalesEngine.DiscountType.AMOUNT, discountValue = 5000.0),
    )
    assertEquals(600.0, t.discountValue, 0.0001)
    assertEquals(600.0, t.discount, 0.0001)
    assertEquals(0.0, t.finalTotal, 0.0001)
  }

  @Test
  fun `تخفیف منفی نادیده گرفته می شود`() {
    val d = ledger()
    val t = SalesEngine.totals(d, twoRice, SalesEngine.Checkout(discountValue = -50.0))
    assertEquals(0.0, t.discount, 0.0001)
    assertEquals(600.0, t.finalTotal, 0.0001)
  }

  /* --------------------------- ثبتِ فروش --------------------------- */

  @Test
  fun `فروش نقدی همیشه کامل تسویه می شود`() {
    val d = ledger()
    // حتی اگر مبلغِ پرداختی کمتر داده شود، نقدی یعنی کامل
    val r = ok(record(d, twoRice, SalesEngine.Checkout(payment = SalesEngine.Payment.CASH, paidAmount = 10.0)))
    val sale = r.data.sales.single()
    assertEquals(600.0, sale.finalTotal, 0.0001)
    assertEquals(600.0, sale.paidAmount, 0.0001)
    assertEquals(0.0, sale.remaining, 0.0001)
    assertNull(sale.debtorId)
    assertEquals(0.0, sale.debtGiven, 0.0001)
    assertTrue("فروشِ نقدی نباید حسابِ قرض‌دار بسازد", r.data.transactions.isEmpty())
  }

  @Test
  fun `فروش نسیه باقی مانده را به حساب قرض دار می گذارد`() {
    val d = ledger()
    val r = ok(
      record(
        d, twoRice,
        SalesEngine.Checkout(payment = SalesEngine.Payment.CREDIT, paidAmount = 100.0, debtorId = "d1"),
      )
    )
    val sale = r.data.sales.single()
    assertEquals(100.0, sale.paidAmount, 0.0001)
    assertEquals(500.0, sale.remaining, 0.0001)
    assertEquals(500.0, sale.debtGiven, 0.0001)
    assertEquals("d1", sale.debtorId)

    val tx = r.data.transactions.single()
    assertEquals("give", tx.type)
    assertEquals(500.0, tx.amount, 0.0001)
    assertEquals("d1", tx.debtorId)
    assertEquals("فروش نسیه — فاکتور #1000", tx.notes)

    // و همان عدد از حسابِ قرض‌دار هم درمی‌آید
    assertEquals(500.0, ShopStore.debt(r.data, "d1"), 0.0001)
  }

  @Test
  fun `نسیه ای که کامل پرداخت شده قرض دار نمی خواهد`() {
    val d = ledger()
    val r = ok(
      record(d, twoRice, SalesEngine.Checkout(payment = SalesEngine.Payment.CREDIT, paidAmount = 600.0))
    )
    assertNull(r.data.sales.single().debtorId)
    assertTrue(r.data.transactions.isEmpty())
  }

  @Test
  fun `نسیه بدون قرض دار ثبت نمی شود`() {
    val d = ledger()
    val message = failed(
      record(d, twoRice, SalesEngine.Checkout(payment = SalesEngine.Payment.CREDIT, paidAmount = 0.0))
    )
    assertEquals("برای فروش نسیه، قرض‌دار را انتخاب کنید", message)
  }

  @Test
  fun `قرض دار ناموجود رد می شود`() {
    val d = ledger()
    failed(
      record(
        d, twoRice,
        SalesEngine.Checkout(payment = SalesEngine.Payment.CREDIT, paidAmount = 0.0, debtorId = "کسی-نیست"),
      )
    )
  }

  @Test
  fun `پرداختی بیشتر از مبلغ نهایی به همان مبلغ محدود می شود`() {
    val d = ledger()
    val r = ok(
      record(
        d, twoRice,
        SalesEngine.Checkout(payment = SalesEngine.Payment.CREDIT, paidAmount = 9_000.0),
      )
    )
    assertEquals(600.0, r.data.sales.single().paidAmount, 0.0001)
    assertEquals(0.0, r.data.sales.single().remaining, 0.0001)
  }

  @Test
  fun `سبد خالی ثبت نمی شود`() {
    assertEquals("سبد خرید خالی است", failed(record(ledger(), emptyList(), SalesEngine.Checkout())))
  }

  /* --------------------------- موجودی --------------------------- */

  @Test
  fun `فروشِ بیشتر از موجودی رد می شود و دفتر دست نخورده می ماند`() {
    val d = ledger(riceUnits = 3.0)
    val before = d.copy()
    val message = failed(record(d, listOf(SalesEngine.CartLine("p1", 5.0)), SalesEngine.Checkout()))
    assertTrue(message, message.contains("برنج"))
    assertTrue(message, message.contains("موجود است"))
    assertEquals(before, d)   // نصفه ثبت نشده
  }

  @Test
  fun `کالای بدون موجودی پیام روشن می دهد`() {
    val d = ledger(riceUnits = 0.0)
    val message = failed(record(d, twoRice, SalesEngine.Checkout()))
    assertEquals(
      "«برنج» در برنامه موجودی ندارد. اگر جنس در دکان هست، اول ورودی انبار را ثبت کنید.",
      message,
    )
  }

  @Test
  fun `فروش از موجودی کم می کند`() {
    val d = ledger(riceUnits = 10.0)
    assertEquals(10.0, ShopStore.stock(d, "p1"), 0.0001)
    val r = ok(record(d, twoRice, SalesEngine.Checkout()))
    assertEquals(8.0, ShopStore.stock(r.data, "p1"), 0.0001)

    val movement = r.data.stockMovements.single()
    assertEquals("sale", movement.type)
    assertEquals(-2.0, movement.qty, 0.0001)
    assertEquals("فاکتور #1000", movement.notes)
    assertEquals(r.saleId, movement.refId)
  }

  /* --------------------------- فاکتور --------------------------- */

  @Test
  fun `شماره فاکتور از هزار شروع می شود و یکی یکی بالا می رود`() {
    var d = ledger()
    val first = ok(record(d, twoRice, SalesEngine.Checkout()))
    assertEquals(1000, first.invoiceNumber)
    assertEquals(1001, first.data.nextInvoiceNo)

    d = first.data
    val second = ok(record(d, twoRice, SalesEngine.Checkout()))
    assertEquals(1001, second.invoiceNumber)
    assertEquals(1002, second.data.nextInvoiceNo)
    assertEquals(2, second.data.sales.size)
  }

  @Test
  fun `اقلام فاکتور قیمت خرید را هم نگه می دارند`() {
    val d = ledger()
    val r = ok(record(d, listOf(SalesEngine.CartLine("p1", 2.0), SalesEngine.CartLine("p2", 1.0)), SalesEngine.Checkout()))
    assertEquals(2, r.data.saleItems.size)
    val riceLine = r.data.saleItems.first { it.productId == "p1" }
    assertEquals(300.0, riceLine.unitPrice, 0.0001)
    assertEquals(200.0, riceLine.purchasePrice, 0.0001)   // برای حسابِ سود
    assertEquals(600.0, riceLine.totalPrice, 0.0001)
    assertEquals(0.0, riceLine.returnedQty, 0.0001)
    assertEquals(r.saleId, riceLine.saleId)
  }

  @Test
  fun `هر فروش یک ردیف در دفترچه ثبت می گذارد`() {
    val d = ledger()
    val r = ok(
      record(d, twoRice, SalesEngine.Checkout(discountType = SalesEngine.DiscountType.PERCENT, discountValue = 10.0))
    )
    val entry = r.data.auditLog.single()
    assertEquals("sale", entry.type)
    assertEquals(r.saleId, entry.refId)
    assertEquals("ثبت فروش فاکتور #1000 به مبلغ ۵۴۰ افغانی", entry.notes)
  }

  @Test
  fun `فروش با وضعیت تکمیل و در انتظار همگام سازی ثبت می شود`() {
    val r = ok(record(ledger(), twoRice, SalesEngine.Checkout()))
    val sale = r.data.sales.single()
    assertEquals("completed", sale.status)
    assertEquals("pending", sale.syncStatus)
    assertEquals("2026-08-28", sale.date)
    assertEquals(1_700_000_000_000, sale.createdAt)
    assertNotNull(sale.invoiceNumber)
  }

  /* --------------------------- سبد خرید --------------------------- */

  @Test
  fun `افزودن دوباره فقط عدد را بالا می برد`() {
    var cart = SalesEngine.addToCart(emptyList(), "p1", 1.0)
    cart = SalesEngine.addToCart(cart, "p1", 2.0)
    cart = SalesEngine.addToCart(cart, "p2", 1.0)
    assertEquals(2, cart.size)
    assertEquals(3.0, cart.first { it.productId == "p1" }.quantity, 0.0001)
  }

  @Test
  fun `تعداد صفر ردیف را از سبد بیرون می برد`() {
    val cart = SalesEngine.addToCart(emptyList(), "p1", 1.0)
    assertTrue(SalesEngine.setCartQty(cart, "p1", 0.0).isEmpty())
  }

  @Test
  fun `اعشار شناور در تعداد جمع نمی شود`() {
    // ۰٫۱ + ۰٫۲ نباید ۰٫۳۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۴ شود
    val cart = SalesEngine.setCartQty(listOf(SalesEngine.CartLine("p1", 1.0)), "p1", 0.1 + 0.2)
    assertEquals("0.3", cart.single().quantity.toString())
  }

  @Test
  fun `پله ی کم و زیاد به واحد بستگی دارد`() {
    assertEquals(1.0, SalesEngine.cartStep("عدد"), 0.0)
    assertEquals(0.1, SalesEngine.cartStep("کیلو"), 0.0)
    assertEquals(0.1, SalesEngine.cartStep("لیتر"), 0.0)
    assertEquals(10.0, SalesEngine.cartStep("گرم"), 0.0)
    // فهرستِ پیش‌فرض «کیلوگرم» دارد؛ نسخهٔ وب آن را اعشاری نمی‌داند
    assertEquals(1.0, SalesEngine.cartStep("کیلوگرم"), 0.0)
  }

  /* --------------------------- نوشتنِ عدد --------------------------- */

  @Test
  fun `مبلغ با رقم فارسی و جداکننده ی هزارگان نوشته می شود`() {
    assertEquals("۰", money(0.0))
    assertEquals("۹۹۹", money(999.0))
    assertEquals("۱٬۰۰۰", money(1000.0))
    assertEquals("۱۲٬۳۴۵٬۶۷۸", money(12345678.0))
    assertEquals("۱۱۷", money(116.55))   // مثل Math.round نسخهٔ وب
    assertEquals("-۵۰۰", money(-500.0))
  }
}
