package ir.vil3ntec.tohid.data

import ir.vil3ntec.tohid.money

/**
 *  قرض‌داران.
 *
 *  حسابِ هر کس یک چیز است: آنچه گرفته منهای آنچه پس داده. همین و بس —
 *  عددِ مانده هیچ‌جا ذخیره نمی‌شود، همیشه از روی تراکنش‌ها حساب می‌شود.
 *  اگر جدا نگه داشته می‌شد، یک روز با تراکنش‌ها نمی‌خواند و معلوم نبود
 *  کدام درست است.
 *
 *  فروشِ نسیه هم از همین راه می‌آید: `SalesEngine` یک تراکنشِ «give»
 *  می‌سازد، نه چیزِ جداگانه‌ای. پس حسابِ قرض‌دار چه از فروش پر شود چه با
 *  دست، یک‌جور حساب می‌شود.
 */
object DebtorEngine {

  /** give = قرض داده شد | receive = پول گرفته شد */
  enum class Kind { GIVE, RECEIVE }

  data class DebtorDraft(
    val name: String = "",
    val phone: String = "",
    val notes: String = "",
  )

  sealed interface Result {
    data class Ok(val data: ShopData, val id: String) : Result
    data class Failed(val message: String) : Result
  }

  /* ---------------------------- خودِ قرض‌دار ---------------------------- */

  fun add(d: ShopData, draft: DebtorDraft, now: Long, newId: () -> String): Result {
    val name = draft.name.trim()
    if (name.isEmpty()) return Result.Failed("نام قرض‌دار را بنویسید")

    val id = newId()
    return Result.Ok(
      d.copy(
        debtors = d.debtors + Debtor(
          id = id,
          name = name,
          phone = draft.phone.trim(),
          notes = draft.notes.trim(),
          createdAt = now,
        )
      ),
      id = id,
    )
  }

  fun edit(d: ShopData, id: String, draft: DebtorDraft): Result {
    if (d.debtors.none { it.id == id }) return Result.Failed("قرض‌دار پیدا نشد")
    val name = draft.name.trim()
    if (name.isEmpty()) return Result.Failed("نام قرض‌دار را بنویسید")

    return Result.Ok(
      d.copy(
        debtors = d.debtors.map {
          if (it.id == id) it.copy(name = name, phone = draft.phone.trim(), notes = draft.notes.trim()) else it
        }
      ),
      id = id,
    )
  }

  /**
   * حذفِ قرض‌دار — با تراکنش‌هایش.
   *
   * عیناً رفتارِ نسخهٔ وب. ولی اگر هنوز بدهکار باشد، مبلغش در هشدار
   * می‌آید: طلبی که سهواً از دفتر پاک شود دیگر برنمی‌گردد.
   */
  fun delete(d: ShopData, id: String): Result {
    if (d.debtors.none { it.id == id }) return Result.Failed("قرض‌دار پیدا نشد")
    return Result.Ok(
      d.copy(
        debtors = d.debtors.filter { it.id != id },
        transactions = d.transactions.filter { it.debtorId != id },
      ),
      id = id,
    )
  }

  /** جمله‌ای که پیش از حذف نشان داده می‌شود */
  fun deleteWarning(d: ShopData, id: String): String {
    val debtor = d.debtors.find { it.id == id } ?: return ""
    val balance = ShopStore.debt(d, id)
    val count = d.transactions.count { it.debtorId == id }
    return if (balance > 0) {
      "«${debtor.name}» هنوز ${money(balance)} افغانی بدهی دارد. با حذف او، این طلب و ${money(count.toDouble())} تراکنش او برای همیشه از دفتر پاک می‌شود."
    } else {
      "«${debtor.name}» و ${money(count.toDouble())} تراکنش او حذف خواهند شد. این عملیات قابل بازگشت نیست."
    }
  }

  /* ---------------------------- تراکنش‌ها ---------------------------- */

  /**
   * ثبتِ قرض یا پرداخت.
   *
   * فقط «پرداخت» در دفترچهٔ ثبت می‌نشیند، نه «قرض دادن» — همان کارِ نسخهٔ
   * وب. دلیلش این است که پول‌گرفتن چیزی است که بعداً سرش بحث می‌شود.
   */
  fun addTransaction(
    d: ShopData,
    debtorId: String,
    kind: Kind,
    amount: Double,
    date: String,
    notes: String,
    today: String,
    now: Long,
    newId: () -> String,
  ): Result {
    val debtor = d.debtors.find { it.id == debtorId } ?: return Result.Failed("قرض‌دار پیدا نشد")
    if (amount.isNaN() || amount <= 0) return Result.Failed("مبلغ معتبر وارد کنید")

    val id = newId()
    val when_ = date.ifBlank { today }
    val transaction = DebtTransaction(
      id = id,
      debtorId = debtorId,
      type = if (kind == Kind.GIVE) "give" else "receive",
      amount = amount,
      date = when_,
      notes = notes.trim(),
      createdAt = now,
    )

    val audit = if (kind == Kind.RECEIVE) {
      d.auditLog + AuditEntry(
        id = newId(),
        type = "customer_payment",
        date = when_,
        refId = id,
        notes = "پرداخت مشتری «${debtor.name}» به مبلغ ${money(amount)} افغانی",
        createdAt = now,
      )
    } else {
      d.auditLog
    }

    return Result.Ok(
      d.copy(transactions = d.transactions + transaction, auditLog = audit),
      id = id,
    )
  }

  fun deleteTransaction(d: ShopData, id: String): Result {
    if (d.transactions.none { it.id == id }) return Result.Failed("تراکنش پیدا نشد")
    return Result.Ok(d.copy(transactions = d.transactions.filter { it.id != id }), id = id)
  }

  /* ------------------------------ حساب ------------------------------ */

  data class Account(
    val debtor: Debtor,
    val given: Double,
    val received: Double,
    val balance: Double,
    val transactions: List<DebtTransaction>,
  )

  fun account(d: ShopData, id: String): Account? {
    val debtor = d.debtors.find { it.id == id } ?: return null
    val mine = d.transactions.filter { it.debtorId == id }.sortedByDescending { it.createdAt }
    return Account(
      debtor = debtor,
      given = mine.filter { it.type == "give" }.sumOf { it.amount },
      received = mine.filter { it.type == "receive" }.sumOf { it.amount },
      balance = ShopStore.debt(d, id),
      transactions = mine,
    )
  }

  /** حالِ حساب، با همان جمله‌های نسخهٔ وب */
  fun stateText(balance: Double): String = when {
    balance > 0 -> "${money(balance)} افغانی بدهکار"
    balance < 0 -> "${money(-balance)} افغانی موجودی دارد"
    else -> "حساب صاف است"
  }
}
