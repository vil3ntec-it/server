package ir.vil3ntec.tohid.data

import ir.vil3ntec.tohid.money
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

/**
 *  ثبتِ فروش — همان حسابی که نسخهٔ وب می‌کند.
 *
 *  عمداً تابعِ خالص است: ورودی «دفترِ فعلی + سبد + شرایطِ تسویه»، خروجی
 *  «دفترِ تازه». نه به صفحه دست می‌زند نه به فایل، پس می‌شود بدونِ گوشی
 *  درستیِ حساب را سنجید — و حسابِ پولِ دکان همان چیزی است که بیش از همه
 *  باید سنجیده شود.
 */
object SalesEngine {

  data class CartLine(val productId: String, val quantity: Double)

  enum class DiscountType { AMOUNT, PERCENT }
  enum class Payment { CASH, CREDIT }

  data class Checkout(
    val discountType: DiscountType = DiscountType.AMOUNT,
    val discountValue: Double = 0.0,
    val payment: Payment = Payment.CASH,
    /** فقط وقتی نسیه است معنی دارد */
    val paidAmount: Double = 0.0,
    val debtorId: String? = null,
  )

  data class Totals(
    val subtotal: Double,
    val discountValue: Double,
    val discount: Double,
    val finalTotal: Double,
  )

  sealed interface Result {
    data class Ok(val data: ShopData, val invoiceNumber: Int, val saleId: String) : Result
    data class Failed(val message: String) : Result
  }

  /* --------------------------- سبد خرید --------------------------- */

  /**
   * واحدهایی که اعشار می‌گیرند. «۲٫۵ کیلو» معنی دارد، «۲٫۵ عدد» ندارد.
   *
   * توجه: فهرستِ پیش‌فرضِ واحدها «کیلوگرم» دارد نه «کیلو»، پس در عمل
   * کیلوگرم هم اعشار نمی‌گیرد. این عیناً رفتارِ نسخهٔ وب است و عمداً
   * عوض نشده — عددِ سبد نباید با آمدنِ این نسخه فرق کند.
   */
  fun isFractionalUnit(unit: String): Boolean =
    unit == "کیلو" || unit == "گرم" || unit == "لیتر"

  /** پلهٔ دکمه‌های کم/زیاد — گرم ۱۰تایی، کیلو و لیتر ۰٫۱، بقیه ۱ */
  fun cartStep(unit: String): Double =
    if (unit == "گرم") 10.0 else if (isFractionalUnit(unit)) 0.1 else 1.0

  /**
   * افزودن به سبد. اگر کالا از قبل در سبد باشد فقط عددش بالا می‌رود —
   * ردیفِ تازه ساخته نمی‌شود، همان‌طور که در نسخهٔ وب.
   */
  fun addToCart(cart: List<CartLine>, productId: String, quantity: Double = 1.0): List<CartLine> {
    if (cart.any { it.productId == productId }) {
      return cart.map { if (it.productId == productId) it.copy(quantity = it.quantity + quantity) else it }
    }
    return cart + CartLine(productId, quantity)
  }

  /** تعیینِ تعداد. صفر یا کمتر یعنی حذفِ ردیف. */
  fun setCartQty(cart: List<CartLine>, productId: String, quantity: Double): List<CartLine> {
    if (quantity <= 0) return cart.filter { it.productId != productId }
    // اعشارِ شناور را مهار می‌کند: ۰٫۱+۰٫۲ نباید ۰٫۳۰۰۰۰۰۰۰۴ شود
    val clean = Math.round(quantity * 1000) / 1000.0
    return cart.map { if (it.productId == productId) it.copy(quantity = clean) else it }
  }

  /**
   * پیامِ کمبودِ موجودی — همان جمله‌های نسخهٔ وب، چون فروشنده به همین
   * جمله‌ها عادت کرده و باید بداند دقیقاً چقدر کم دارد.
   */
  fun shortageMessage(product: Product, wanted: Double, available: Double): String {
    val u = if (product.unit.isNotBlank()) " ${product.unit}" else ""
    if (available <= 0) {
      return "«${product.name}» در برنامه موجودی ندارد. اگر جنس در دکان هست، اول ورودی انبار را ثبت کنید."
    }
    return "«${product.name}»: ${money(available)}$u موجود است، شما ${money(wanted)}$u خواستید."
  }

  fun cartTotal(d: ShopData, cart: List<CartLine>): Double =
    cart.sumOf { line ->
      val p = d.products.find { it.id == line.productId }
      if (p == null) 0.0 else p.salePrice * line.quantity
    }

  /**
   * جمع، تخفیف و مبلغِ نهایی.
   * گِرد کردن دقیقاً همان‌جایی است که نسخهٔ وب گِرد می‌کند — نه زودتر، نه
   * دیرتر — وگرنه عدد با فاکتورِ کاغذی یکی درنمی‌آید.
   */
  fun totals(d: ShopData, cart: List<CartLine>, checkout: Checkout): Totals {
    val subtotal = cartTotal(d, cart)
    var value = checkout.discountValue.takeIf { it > 0 && !it.isNaN() } ?: 0.0

    val discount: Double
    if (checkout.discountType == DiscountType.PERCENT) {
      value = min(value, 100.0)
      discount = (subtotal * (value / 100.0)).roundToLong().toDouble()
    } else {
      value = min(value, subtotal)
      discount = value.roundToLong().toDouble()
    }

    return Totals(
      subtotal = subtotal,
      discountValue = value,
      discount = discount,
      finalTotal = max(0.0, subtotal - discount),
    )
  }

  /**
   * ثبتِ فروش. اگر چیزی درست نباشد، دفتر دست‌نخورده می‌ماند و دلیلش
   * برگردانده می‌شود — نصفه ثبت نمی‌شود.
   */
  fun record(
    d: ShopData,
    cart: List<CartLine>,
    checkout: Checkout,
    today: String,
    now: Long,
    newId: () -> String,
  ): Result {
    if (cart.isEmpty()) return Result.Failed("سبد خرید خالی است")

    // موجودی درست پیش از ثبت سنجیده می‌شود، نه بعد از آن
    for (line in cart) {
      val p = d.products.find { it.id == line.productId } ?: continue
      val available = ShopStore.stock(d, p.id)
      if (line.quantity > available) return Result.Failed(shortageMessage(p, line.quantity, available))
    }

    val t = totals(d, cart, checkout)

    // فروشِ نقدی همیشه کامل تسویه می‌شود
    var paid = if (checkout.payment == Payment.CASH) t.finalTotal else checkout.paidAmount
    if (paid.isNaN() || paid < 0) return Result.Failed("مبلغ پرداختی درست نیست")
    paid = min(paid, t.finalTotal)
    val remaining = max(0.0, t.finalTotal - paid)

    var debtorId: String? = null
    if (checkout.payment == Payment.CREDIT && remaining > 0) {
      debtorId = checkout.debtorId
      if (debtorId.isNullOrBlank()) return Result.Failed("برای فروش نسیه، قرض‌دار را انتخاب کنید")
      if (d.debtors.none { it.id == debtorId }) return Result.Failed("قرض‌دار پیدا نشد")
    }

    val saleId = newId()
    val invoiceNumber = d.nextInvoiceNo

    val sale = Sale(
      id = saleId,
      invoiceNumber = invoiceNumber,
      total = t.subtotal,
      discountType = if (checkout.discountType == DiscountType.PERCENT) "percent" else "amount",
      discountValue = t.discountValue,
      discount = t.discount,
      finalTotal = t.finalTotal,
      paymentMethod = if (checkout.payment == Payment.CASH) "cash" else "credit",
      debtorId = debtorId,
      paidAmount = paid,
      remaining = remaining,
      status = "completed",
      debtGiven = if (debtorId != null && remaining > 0) remaining else 0.0,
      debtSettled = 0.0,
      createdAt = now,
      date = today,
      syncStatus = "pending",
    )

    val items = mutableListOf<SaleItem>()
    val movements = mutableListOf<StockMovement>()
    cart.forEach { line ->
      val p = d.products.find { it.id == line.productId } ?: return@forEach
      items += SaleItem(
        id = newId(),
        saleId = saleId,
        productId = p.id,
        quantity = line.quantity,
        unitPrice = p.salePrice,
        purchasePrice = p.purchasePrice,
        totalPrice = p.salePrice * line.quantity,
        returnedQty = 0.0,
      )
      movements += StockMovement(
        id = newId(),
        productId = p.id,
        type = "sale",
        qty = -line.quantity,
        date = today,
        notes = "فاکتور #$invoiceNumber",
        refId = saleId,
        createdAt = now,
      )
    }

    // فروشِ نسیه به حسابِ قرض‌دار می‌رود، با همان منطقِ قرض‌داران
    val transactions = d.transactions.toMutableList()
    if (debtorId != null && remaining > 0) {
      transactions += DebtTransaction(
        id = newId(),
        debtorId = debtorId,
        type = "give",
        amount = remaining,
        date = today,
        notes = "فروش نسیه — فاکتور #$invoiceNumber",
        createdAt = now,
      )
    }

    val audit = d.auditLog + AuditEntry(
      id = newId(),
      type = "sale",
      date = today,
      refId = saleId,
      notes = "ثبت فروش فاکتور #$invoiceNumber به مبلغ ${money(t.finalTotal)} افغانی",
      createdAt = now,
    )

    return Result.Ok(
      d.copy(
        sales = d.sales + sale,
        saleItems = d.saleItems + items,
        stockMovements = d.stockMovements + movements,
        transactions = transactions,
        auditLog = audit,
        nextInvoiceNo = invoiceNumber + 1,
      ),
      invoiceNumber = invoiceNumber,
      saleId = saleId,
    )
  }
}
