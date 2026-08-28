package ir.vil3ntec.tohid.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 *  لغو فروش و مرجوعی.
 *
 *  اینجا حساسیت روی «دو بار حساب نشدن» است: فاکتوری که هم مرجوعی خورده
 *  هم لغو شده، نباید بدهیِ قرض‌دار را منفی کند یا موجودی را دو بار
 *  برگرداند. نسخهٔ وب برای همین دقیقاً «باقیِ تسویه‌نشده» را حساب می‌کرد،
 *  نه کلِ مبلغ — و همان قاعده اینجا هم هست.
 */
class SalesReturnTest {

  private var seq = 0
  private fun newId(): String = "r${seq++}"

  private val rice = Product(id = "p1", name = "برنج", unit = "کیلو", purchasePrice = 200.0, salePrice = 300.0)
  private val ahmad = Debtor(id = "d1", name = "احمد")

  private fun ledger() = ShopData(
    products = listOf(rice),
    debtors = listOf(ahmad),
    warehouseEntries = listOf(WarehouseEntry(id = "w1", productId = "p1", units = 100.0)),
  )

  private fun sell(d: ShopData, quantity: Double, checkout: SalesEngine.Checkout) =
    (SalesEngine.record(
      d, listOf(SalesEngine.CartLine("p1", quantity)), checkout,
      "2026-08-28", 1_700_000_000_000, ::newId,
    ) as SalesEngine.Result.Ok)

  private fun ok(r: SalesEngine.Result): SalesEngine.Result.Ok {
    assertTrue("انتظار می‌رفت ثبت شود، ولی: $r", r is SalesEngine.Result.Ok)
    return r as SalesEngine.Result.Ok
  }

  private fun failed(r: SalesEngine.Result): String {
    assertTrue("انتظار می‌رفت رد شود", r is SalesEngine.Result.Failed)
    return (r as SalesEngine.Result.Failed).message
  }

  /* ============================== لغو ============================== */

  @Test
  fun `لغو فروش موجودی را برمی گرداند ولی فاکتور را پاک نمی کند`() {
    val sold = sell(ledger(), 10.0, SalesEngine.Checkout())
    assertEquals(90.0, ShopStore.stock(sold.data, "p1"), 0.0)

    val cancelled = ok(SalesEngine.cancel(sold.data, sold.saleId, "2026-08-29", 0, ::newId))
    assertEquals(100.0, ShopStore.stock(cancelled.data, "p1"), 0.0)

    // فاکتور سرِ جایش، فقط لغوشده
    assertEquals(1, cancelled.data.sales.size)
    assertEquals("cancelled", cancelled.data.sales.single().status)
    assertEquals(1, cancelled.data.saleItems.size)
    assertEquals("لغو فروش فاکتور #1000", cancelled.data.auditLog.last().notes)
  }

  @Test
  fun `لغو فروش نسیه بدهی قرض دار را صاف می کند`() {
    val sold = sell(
      ledger(), 10.0,
      SalesEngine.Checkout(payment = SalesEngine.Payment.CREDIT, paidAmount = 0.0, debtorId = "d1"),
    )
    assertEquals(3000.0, ShopStore.debt(sold.data, "d1"), 0.0)

    val cancelled = ok(SalesEngine.cancel(sold.data, sold.saleId, "2026-08-29", 0, ::newId))
    assertEquals(0.0, ShopStore.debt(cancelled.data, "d1"), 0.0)

    val back = cancelled.data.transactions.last()
    assertEquals("receive", back.type)
    assertEquals(3000.0, back.amount, 0.0)
    assertEquals("لغو فروش — فاکتور #1000", back.notes)
    assertEquals(3000.0, cancelled.data.sales.single().debtSettled, 0.0)
  }

  @Test
  fun `فاکتور لغوشده دوباره لغو نمی شود`() {
    val sold = sell(ledger(), 5.0, SalesEngine.Checkout())
    val once = ok(SalesEngine.cancel(sold.data, sold.saleId, "2026-08-29", 0, ::newId))
    assertEquals(
      "این فاکتور قبلاً لغو شده است",
      failed(SalesEngine.cancel(once.data, sold.saleId, "2026-08-29", 0, ::newId)),
    )
  }

  /* ============================== مرجوعی ============================== */

  @Test
  fun `مرجوعی جزئی موجودی را به همان اندازه برمی گرداند`() {
    val sold = sell(ledger(), 10.0, SalesEngine.Checkout())
    val itemId = sold.data.saleItems.single().id

    val returned = ok(
      SalesEngine.recordReturn(sold.data, sold.saleId, mapOf(itemId to 3.0), "خراب بود", "2026-08-29", 0, ::newId)
    )
    assertEquals(93.0, ShopStore.stock(returned.data, "p1"), 0.0)
    assertEquals(3.0, returned.data.saleItems.single().returnedQty, 0.0)

    val entry = returned.data.saleReturns.single()
    assertEquals(3.0, entry.quantity, 0.0)
    assertEquals(900.0, entry.amount, 0.0)     // ۳ × ۳۰۰
    assertEquals("خراب بود", entry.reason)

    val move = returned.data.stockMovements.last()
    assertEquals("customer_return", move.type)
    assertEquals(3.0, move.qty, 0.0)

    assertEquals("مرجوعی به مبلغ ۹۰۰ افغانی — فاکتور #1000", returned.data.auditLog.last().notes)
  }

  @Test
  fun `مبلغ مرجوعی از قیمت همان فاکتور حساب می شود نه قیمت امروز`() {
    val sold = sell(ledger(), 4.0, SalesEngine.Checkout())
    val itemId = sold.data.saleItems.single().id

    // قیمتِ کالا بعد از فروش بالا می‌رود
    val pricier = sold.data.copy(products = sold.data.products.map { it.copy(salePrice = 900.0) })

    val returned = ok(
      SalesEngine.recordReturn(pricier, sold.saleId, mapOf(itemId to 2.0), "", "2026-08-29", 0, ::newId)
    )
    // ۲ × ۳۰۰ (قیمتِ روزِ فروش)، نه ۲ × ۹۰۰
    assertEquals(600.0, returned.data.saleReturns.single().amount, 0.0)
  }

  @Test
  fun `مرجوعی بیشتر از فروخته شده به همان مقدار محدود می شود`() {
    val sold = sell(ledger(), 5.0, SalesEngine.Checkout())
    val itemId = sold.data.saleItems.single().id

    val returned = ok(
      SalesEngine.recordReturn(sold.data, sold.saleId, mapOf(itemId to 99.0), "", "2026-08-29", 0, ::newId)
    )
    assertEquals(5.0, returned.data.saleReturns.single().quantity, 0.0)
    assertEquals(5.0, returned.data.saleItems.single().returnedQty, 0.0)
    assertEquals(100.0, ShopStore.stock(returned.data, "p1"), 0.0)
    // دیگر چیزی برای برگرداندن نمانده
    assertEquals(0.0, SalesEngine.returnable(returned.data.saleItems.single()), 0.0)
  }

  @Test
  fun `مرجوعی بدون مقدار ثبت نمی شود`() {
    val sold = sell(ledger(), 5.0, SalesEngine.Checkout())
    val itemId = sold.data.saleItems.single().id
    assertEquals(
      "مقدار معتبری برای مرجوعی وارد نشده",
      failed(SalesEngine.recordReturn(sold.data, sold.saleId, mapOf(itemId to 0.0), "", "2026-08-29", 0, ::newId)),
    )
  }

  @Test
  fun `مرجوعی در فروش نسیه بدهی را به همان اندازه کم می کند`() {
    val sold = sell(
      ledger(), 10.0,
      SalesEngine.Checkout(payment = SalesEngine.Payment.CREDIT, paidAmount = 0.0, debtorId = "d1"),
    )
    val itemId = sold.data.saleItems.single().id

    val returned = ok(
      SalesEngine.recordReturn(sold.data, sold.saleId, mapOf(itemId to 4.0), "", "2026-08-29", 0, ::newId)
    )
    // ۳۰۰۰ بدهی، ۴ × ۳۰۰ = ۱۲۰۰ مرجوعی → ۱۸۰۰ می‌ماند
    assertEquals(1800.0, ShopStore.debt(returned.data, "d1"), 0.0)
    assertEquals(1200.0, returned.data.sales.single().debtSettled, 0.0)
    assertEquals("مرجوعی کالا — فاکتور #1000", returned.data.transactions.last().notes)
  }

  @Test
  fun `مرجوعی و بعد لغو، بدهی را منفی نمی کند`() {
    // همان حالتی که نسخهٔ وب برایش «باقیِ تسویه‌نشده» را حساب می‌کرد
    val sold = sell(
      ledger(), 10.0,
      SalesEngine.Checkout(payment = SalesEngine.Payment.CREDIT, paidAmount = 0.0, debtorId = "d1"),
    )
    val itemId = sold.data.saleItems.single().id

    val returned = ok(
      SalesEngine.recordReturn(sold.data, sold.saleId, mapOf(itemId to 4.0), "", "2026-08-29", 0, ::newId)
    ).data
    val cancelled = ok(SalesEngine.cancel(returned, sold.saleId, "2026-08-30", 0, ::newId)).data

    assertEquals(0.0, ShopStore.debt(cancelled, "d1"), 0.0)
    assertEquals(3000.0, cancelled.sales.single().debtSettled, 0.0)
    // موجودی هم دو بار برنمی‌گردد: فروشِ لغوشده اصلاً شمرده نمی‌شود
    assertEquals(100.0, ShopStore.stock(cancelled, "p1"), 0.0)
  }

  @Test
  fun `مرجوعی در فروش نقدی به حساب کسی نمی رود`() {
    val sold = sell(ledger(), 10.0, SalesEngine.Checkout())
    val itemId = sold.data.saleItems.single().id
    val returned = ok(
      SalesEngine.recordReturn(sold.data, sold.saleId, mapOf(itemId to 2.0), "", "2026-08-29", 0, ::newId)
    )
    assertTrue(returned.data.transactions.isEmpty())
  }

  @Test
  fun `دو مرجوعی پشت سر هم روی هم جمع می شوند`() {
    val sold = sell(ledger(), 10.0, SalesEngine.Checkout())
    val itemId = sold.data.saleItems.single().id

    var d = ok(SalesEngine.recordReturn(sold.data, sold.saleId, mapOf(itemId to 3.0), "", "2026-08-29", 0, ::newId)).data
    d = ok(SalesEngine.recordReturn(d, sold.saleId, mapOf(itemId to 2.0), "", "2026-08-30", 0, ::newId)).data

    assertEquals(5.0, d.saleItems.single().returnedQty, 0.0)
    assertEquals(2, d.saleReturns.size)
    assertEquals(95.0, ShopStore.stock(d, "p1"), 0.0)
    assertEquals(5.0, SalesEngine.returnable(d.saleItems.single()), 0.0)
  }

  @Test
  fun `فروش لغوشده در حساب فروخته شده نمی آید`() {
    val sold = sell(ledger(), 10.0, SalesEngine.Checkout())
    assertEquals(10.0, ShopStore.soldQty(sold.data, "p1"), 0.0)
    val cancelled = ok(SalesEngine.cancel(sold.data, sold.saleId, "2026-08-29", 0, ::newId))
    assertEquals(0.0, ShopStore.soldQty(cancelled.data, "p1"), 0.0)
  }
}
