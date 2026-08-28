package ir.vil3ntec.tohid.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 *  انبار — موجودی، ورودِ کالا و اصلاح.
 *
 *  موجودی عددی است که فروشنده بر اساسش سفارش می‌دهد و به مشتری «هست» یا
 *  «نیست» می‌گوید. اگر یک واحد اشتباه باشد، جای دیگری معلوم نمی‌شود.
 */
class WarehouseEngineTest {

  private var seq = 0
  private fun newId(): String = "w${seq++}"

  private val base = ShopData(
    products = listOf(
      Product(id = "p1", name = "برنج", unit = "کیلو", purchasePrice = 200.0, salePrice = 300.0, minStock = 5.0,
        barcodes = listOf("111")),
    ),
  )

  private fun ok(r: WarehouseEngine.Result): WarehouseEngine.Result.Ok {
    assertTrue("انتظار می‌رفت ثبت شود، ولی: $r", r is WarehouseEngine.Result.Ok)
    return r as WarehouseEngine.Result.Ok
  }

  private fun failed(r: WarehouseEngine.Result): String {
    assertTrue("انتظار می‌رفت رد شود", r is WarehouseEngine.Result.Failed)
    return (r as WarehouseEngine.Result.Failed).message
  }

  /* ---------------------------- ثبتِ کالا ---------------------------- */

  @Test
  fun `کالای تازه با بارکدش ثبت می شود`() {
    val r = ok(
      WarehouseEngine.addProduct(
        base,
        WarehouseEngine.ProductDraft(
          name = "  روغن  ", category = "خوراکه", unit = "عدد",
          purchasePrice = 400.0, salePrice = 555.0, minStock = 2.0, barcode = "222",
        ),
        now = 1_700_000_000_000, newId = ::newId,
      )
    )
    val p = r.data.products.first { it.id == r.id }
    assertEquals("روغن", p.name)                       // فاصله‌های اضافی می‌روند
    assertEquals(listOf("222"), p.barcodes)
    assertEquals(555.0, p.salePrice, 0.0)
    assertEquals(2.0, p.minStock, 0.0)
    // دستهٔ تازه به فهرست اضافه می‌شود تا دفعهٔ بعد هم باشد
    assertTrue(r.data.productCategories.contains("خوراکه"))
    // موجودی صفر است تا ورودِ انبار ثبت نشود
    assertEquals(0.0, ShopStore.stock(r.data, r.id), 0.0)
  }

  @Test
  fun `بارکد تکراری کالای قبلی را خراب نمی کند`() {
    val message = failed(
      WarehouseEngine.addProduct(
        base,
        WarehouseEngine.ProductDraft(name = "شکر", salePrice = 100.0, barcode = "111"),
        now = 0, newId = ::newId,
      )
    )
    assertEquals("این بارکد قبلاً برای کالای دیگری ثبت شده", message)
  }

  @Test
  fun `کالای بی نام ثبت نمی شود`() {
    assertEquals(
      "نام کالا را بنویسید",
      failed(WarehouseEngine.addProduct(base, WarehouseEngine.ProductDraft(name = "   "), 0, ::newId)),
    )
  }

  @Test
  fun `همان بارکد روی همان کالا ایراد ندارد`() {
    // ویرایشِ کالا بدونِ عوض‌کردنِ بارکدش نباید رد شود
    val r = ok(
      WarehouseEngine.editProduct(
        base, "p1",
        WarehouseEngine.ProductDraft(name = "برنج", unit = "کیلو", purchasePrice = 200.0, salePrice = 320.0, barcode = "111"),
        today = "2026-08-28", now = 0, newId = ::newId,
      )
    )
    assertEquals(320.0, r.data.products.single().salePrice, 0.0)
  }

  @Test
  fun `تغییر قیمت خرید در تاریخچه می ماند`() {
    val r = ok(
      WarehouseEngine.editProduct(
        base, "p1",
        WarehouseEngine.ProductDraft(name = "برنج", unit = "کیلو", purchasePrice = 250.0, salePrice = 300.0, barcode = "111"),
        today = "2026-08-28", now = 1_700_000_000_000, newId = ::newId,
      )
    )
    val change = r.data.priceHistory.single()
    assertEquals(200.0, change.oldPrice, 0.0)
    assertEquals(250.0, change.newPrice, 0.0)
    assertEquals("p1", change.productId)

    val entry = r.data.auditLog.single()
    assertEquals("price_change", entry.type)
    assertEquals("تغییر قیمت خرید از ۲۰۰ به ۲۵۰ افغانی", entry.notes)
  }

  @Test
  fun `قیمت خرید که عوض نشود تاریخچه ای هم ساخته نمی شود`() {
    val r = ok(
      WarehouseEngine.editProduct(
        base, "p1",
        WarehouseEngine.ProductDraft(name = "برنج تازه", unit = "کیلو", purchasePrice = 200.0, salePrice = 300.0),
        today = "2026-08-28", now = 0, newId = ::newId,
      )
    )
    assertTrue(r.data.priceHistory.isEmpty())
    assertTrue(r.data.auditLog.isEmpty())
    assertEquals(emptyList<String>(), r.data.products.single().barcodes)  // بارکد برداشته شد
  }

  /* --------------------------- ورودِ کالا --------------------------- */

  @Test
  fun `ورود کالا موجودی را بالا می برد و حرکت انبار می سازد`() {
    val r = ok(
      WarehouseEngine.addEntry(
        base,
        WarehouseEngine.EntryDraft(productId = "p1", cartons = 4.0, perCarton = 25.0, units = 100.0,
          unit = "کیلو", price = 200.0, date = "2026-08-02", notes = "از شرکت نور"),
        today = "2026-08-28", now = 1_700_000_000_000, newId = ::newId,
      )
    )
    assertEquals(100.0, ShopStore.stock(r.data, "p1"), 0.0)

    val move = r.data.stockMovements.single()
    assertEquals("purchase_in", move.type)
    assertEquals(100.0, move.qty, 0.0)
    assertEquals("از شرکت نور", move.notes)
    assertEquals(r.id, move.refId)
    assertEquals("2026-08-02", move.date)
  }

  @Test
  fun `ورود بدون یادداشت هم متن روشنی در حرکت انبار می گذارد`() {
    val r = ok(
      WarehouseEngine.addEntry(
        base, WarehouseEngine.EntryDraft(productId = "p1", units = 10.0, price = 200.0),
        today = "2026-08-28", now = 0, newId = ::newId,
      )
    )
    assertEquals("ثبت ورود کالا", r.data.stockMovements.single().notes)
    assertEquals("2026-08-28", r.data.warehouseEntries.single().date)  // تاریخِ خالی یعنی امروز
  }

  @Test
  fun `ورود با تعداد صفر یا منفی رد می شود`() {
    val draft = WarehouseEngine.EntryDraft(productId = "p1", units = 0.0, price = 200.0)
    assertEquals(
      "تعداد واحد معتبر وارد کنید",
      failed(WarehouseEngine.addEntry(base, draft, "2026-08-28", 0, ::newId)),
    )
    assertEquals(
      "تعداد واحد معتبر وارد کنید",
      failed(WarehouseEngine.addEntry(base, draft.copy(units = -5.0), "2026-08-28", 0, ::newId)),
    )
  }

  @Test
  fun `ورود برای کالایی که نیست ثبت نمی شود`() {
    assertEquals(
      "ابتدا یک محصول انتخاب یا اضافه کنید",
      failed(
        WarehouseEngine.addEntry(
          base, WarehouseEngine.EntryDraft(productId = "نیست", units = 5.0, price = 10.0),
          "2026-08-28", 0, ::newId,
        )
      ),
    )
  }

  @Test
  fun `حذف ورودی موجودی و حرکتش را با هم می برد`() {
    val added = ok(
      WarehouseEngine.addEntry(
        base, WarehouseEngine.EntryDraft(productId = "p1", units = 40.0, price = 200.0),
        "2026-08-28", 0, ::newId,
      )
    )
    val removed = ok(WarehouseEngine.deleteEntry(added.data, added.id))
    assertEquals(0.0, ShopStore.stock(removed.data, "p1"), 0.0)
    assertTrue(removed.data.stockMovements.isEmpty())
  }

  /* ------------------------- اصلاحِ موجودی ------------------------- */

  @Test
  fun `اصلاح موجودی کم می کند و دلیلش می ماند`() {
    val stocked = ok(
      WarehouseEngine.addEntry(
        base, WarehouseEngine.EntryDraft(productId = "p1", units = 50.0, price = 200.0),
        "2026-08-28", 0, ::newId,
      )
    ).data

    val r = ok(
      WarehouseEngine.adjustStock(
        stocked, "p1", quantity = 3.0, increase = false, reason = "خراب شد",
        kind = WarehouseEngine.AdjustKind.ADJUSTMENT,
        today = "2026-08-28", now = 0, newId = ::newId,
      )
    )
    assertEquals(47.0, ShopStore.stock(r.data, "p1"), 0.0)

    val entry = r.data.warehouseEntries.first { it.id == r.id }
    assertTrue("ردیفِ اصلاح باید نشانه‌دار باشد", entry.isAdjustment)
    assertEquals(-3.0, entry.units, 0.0)
    assertEquals(0.0, entry.price, 0.0)   // اصلاح ارزشِ انبار را بالا نمی‌برد

    val audit = r.data.auditLog.single()
    assertEquals("stock_adjustment", audit.type)
    assertEquals("اصلاح موجودی «برنج» به مقدار −۳ — دلیل: خراب شد", audit.notes)
  }

  @Test
  fun `برگشت به تأمین کننده نوع خودش را می گیرد`() {
    val r = ok(
      WarehouseEngine.adjustStock(
        base, "p1", 2.0, increase = false, reason = "معیوب بود",
        kind = WarehouseEngine.AdjustKind.SUPPLIER_RETURN,
        today = "2026-08-28", now = 0, newId = ::newId,
      )
    )
    assertEquals("supplier_return", r.data.stockMovements.single().type)
    assertEquals("supplier_return", r.data.auditLog.single().type)
    assertTrue(r.data.auditLog.single().notes.startsWith("برگشت به تأمین‌کننده «برنج»"))
  }

  @Test
  fun `اصلاح بدون دلیل ثبت نمی شود`() {
    assertEquals(
      "دلیل اصلاح را بنویسید",
      failed(
        WarehouseEngine.adjustStock(
          base, "p1", 3.0, true, "   ", WarehouseEngine.AdjustKind.ADJUSTMENT, "2026-08-28", 0, ::newId,
        )
      ),
    )
  }

  /* ---------------------------- حذفِ کالا ---------------------------- */

  @Test
  fun `حذف کالا ورودی هایش را می برد ولی فاکتورها را نه`() {
    val stocked = ok(
      WarehouseEngine.addEntry(
        base, WarehouseEngine.EntryDraft(productId = "p1", units = 10.0, price = 200.0),
        "2026-08-28", 0, ::newId,
      )
    ).data
    val afterSale = (SalesEngine.record(
      stocked, listOf(SalesEngine.CartLine("p1", 2.0)), SalesEngine.Checkout(),
      "2026-08-28", 0, ::newId,
    ) as SalesEngine.Result.Ok).data

    val r = ok(WarehouseEngine.deleteProduct(afterSale, "p1", "2026-08-28", 0, ::newId))
    assertTrue(r.data.products.isEmpty())
    assertTrue(r.data.warehouseEntries.isEmpty())
    // فاکتور و اقلامش سرِ جایشان — سابقهٔ فروش حقیقتی است که افتاده
    assertEquals(1, r.data.sales.size)
    assertEquals(1, r.data.saleItems.size)
    assertEquals("حذف محصول «برنج»", r.data.auditLog.last().notes)
  }

  @Test
  fun `پیش از حذف می گوید چقدر از این کالا فروخته شده`() {
    val stocked = ok(
      WarehouseEngine.addEntry(base, WarehouseEngine.EntryDraft(productId = "p1", units = 10.0, price = 200.0),
        "2026-08-28", 0, ::newId)
    ).data
    val sold = (SalesEngine.record(
      stocked, listOf(SalesEngine.CartLine("p1", 2.0)), SalesEngine.Checkout(), "2026-08-28", 0, ::newId,
    ) as SalesEngine.Result.Ok).data

    assertTrue(WarehouseEngine.deleteWarning(sold, "p1").contains("۲ واحد فروخته"))
    assertTrue(WarehouseEngine.deleteWarning(base, "p1").contains("سوابق ورود آن"))
  }

  /* ---------------------------- خلاصهٔ انبار ---------------------------- */

  @Test
  fun `خلاصهٔ انبار همان جمع های نسخهٔ وب را می دهد`() {
    var d = ok(
      WarehouseEngine.addEntry(
        base, WarehouseEngine.EntryDraft(productId = "p1", cartons = 4.0, perCarton = 25.0, units = 100.0, price = 200.0),
        "2026-08-28", 0, ::newId,
      )
    ).data
    d = ok(
      WarehouseEngine.addProduct(d, WarehouseEngine.ProductDraft(name = "روغن", salePrice = 500.0), 0, ::newId)
    ).data

    val s = WarehouseEngine.summary(d)
    assertEquals(2, s.products)
    assertEquals(4.0, s.cartons, 0.0)
    assertEquals(100.0, s.units, 0.0)
    assertEquals(20_000.0, s.value, 0.0)
    assertEquals(1, s.out)      // روغن هیچ ورودی ندارد
    assertEquals(0, s.low)
  }

  @Test
  fun `موجودی کم و تمام شده درست تشخیص داده می شود`() {
    val d = ok(
      WarehouseEngine.addEntry(base, WarehouseEngine.EntryDraft(productId = "p1", units = 4.0, price = 200.0),
        "2026-08-28", 0, ::newId)
    ).data
    // حدِ کم برای برنج ۵ است، موجودی ۴ → کم
    assertEquals("low", ShopStore.stockStatus(d, d.products.single()))
    assertEquals(1, WarehouseEngine.summary(d).low)

    val empty = ok(WarehouseEngine.deleteEntry(d, d.warehouseEntries.single().id)).data
    assertEquals("out", ShopStore.stockStatus(empty, empty.products.single()))
  }

  @Test
  fun `کالای پیدا نشده پیام روشن می دهد`() {
    assertEquals("کالا پیدا نشد", failed(WarehouseEngine.deleteProduct(base, "نیست", "2026-08-28", 0, ::newId)))
    assertNull(base.products.find { it.id == "نیست" })
  }
}
