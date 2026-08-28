package ir.vil3ntec.tohid.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import ir.vil3ntec.tohid.data.LedgerEngine
import ir.vil3ntec.tohid.data.ShopData
import ir.vil3ntec.tohid.data.ShopStore
import ir.vil3ntec.tohid.data.Supplier
import ir.vil3ntec.tohid.formatDate
import ir.vil3ntec.tohid.money
import ir.vil3ntec.tohid.plain
import ir.vil3ntec.tohid.qty
import ir.vil3ntec.tohid.todayIso
import ir.vil3ntec.tohid.ui.theme.Radius
import ir.vil3ntec.tohid.ui.theme.Shop
import kotlinx.coroutines.launch

/**
 *  خرید و تأمین‌کننده.
 *
 *  ثبتِ خرید یک کار است ولی چهار اثر دارد — جنس وارد انبار می‌شود، بدهیِ
 *  تأمین‌کننده بالا می‌رود، قیمتِ خرید به‌روز می‌شود و تغییرش در تاریخچه
 *  می‌ماند. همهٔ این‌ها در `LedgerEngine` یک‌جا انجام می‌شود تا هیچ‌وقت
 *  نصفه ثبت نشود.
 */
@Composable
fun PurchasingScreen(store: ShopStore, d: ShopData, snackbar: SnackbarHostState) {
  val scope = rememberCoroutineScope()

  var openSupplier by rememberSaveable { mutableStateOf<String?>(null) }
  var supplierForm by remember { mutableStateOf<SupplierFormState?>(null) }
  var purchaseFor by remember { mutableStateOf<String?>(null) }
  var payFor by remember { mutableStateOf<String?>(null) }
  var confirmDelete by remember { mutableStateOf<Supplier?>(null) }

  fun toast(text: String) {
    scope.launch { snackbar.showSnackbar(text) }
  }

  fun apply(result: LedgerEngine.Result, done: String, after: () -> Unit = {}) {
    when (result) {
      is LedgerEngine.Result.Failed -> toast(result.message)
      is LedgerEngine.Result.Ok -> {
        scope.launch { store.save(result.data) }
        toast(done)
        after()
      }
    }
  }

  Box(Modifier.fillMaxSize()) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 96.dp)) {
      item {
        Text("خرید و تأمین‌کننده", style = MaterialTheme.typography.headlineMedium, color = Shop.colors.text)
        Text(
          "حساب تأمین‌کننده‌ها و بدهی به آن‌ها",
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
        Spacer(Modifier.height(14.dp))
      }

      item {
        val owed = d.suppliers.sumOf { ShopStore.supplierDebt(d, it.id).coerceAtLeast(0.0) }
        StatTile(
          label = "جمع بدهی ما به تأمین‌کننده‌ها",
          value = "${money(owed)} افغانی",
          tint = if (owed > 0) Shop.colors.warning else Shop.colors.success,
          hint = "${plain(d.suppliers.size)} تأمین‌کننده — ${plain(d.purchases.size)} خرید",
          modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(16.dp))
      }

      if (d.suppliers.isEmpty()) {
        item { Panel { EmptyNote("هنوز تأمین‌کننده‌ای ثبت نشده است.") } }
      } else {
        items(d.suppliers, key = { it.id }) { supplier ->
          SupplierRow(
            d = d,
            supplier = supplier,
            open = openSupplier == supplier.id,
            onClick = { openSupplier = if (openSupplier == supplier.id) null else supplier.id },
            onPurchase = { purchaseFor = supplier.id },
            onPay = { payFor = supplier.id },
            onEdit = { supplierForm = SupplierFormState.of(supplier) },
            onDelete = { confirmDelete = supplier },
          )
          Spacer(Modifier.height(8.dp))
        }
      }
    }

    ExtendedFloatingActionButton(
      onClick = { supplierForm = SupplierFormState() },
      containerColor = Shop.colors.primary,
      contentColor = Color.White,
      modifier = Modifier.align(Alignment.BottomStart).padding(16.dp),
      icon = { Icon(Icons.Filled.Add, contentDescription = null) },
      text = { Text("تأمین‌کننده") },
    )
  }

  /* ---------------------------- پنجره‌ها ---------------------------- */

  supplierForm?.let { state ->
    SupplierDialog(
      state = state,
      onDismiss = { supplierForm = null },
      onSave = { draft ->
        val result = if (state.editingId == null) {
          LedgerEngine.addSupplier(d, draft, System.currentTimeMillis(), ::newId)
        } else {
          LedgerEngine.editSupplier(d, state.editingId, draft)
        }
        apply(result, "با موفقیت ثبت شد") { supplierForm = null }
      },
    )
  }

  purchaseFor?.let { supplierId ->
    PurchaseDialog(
      d = d,
      supplierId = supplierId,
      onDismiss = { purchaseFor = null },
      onSave = { draft ->
        apply(
          LedgerEngine.addPurchase(d, draft, todayIso(), System.currentTimeMillis(), ::newId),
          "خرید با موفقیت ثبت شد",
        ) { purchaseFor = null }
      },
    )
  }

  payFor?.let { supplierId ->
    PaymentDialog(
      supplier = d.suppliers.find { it.id == supplierId },
      debt = ShopStore.supplierDebt(d, supplierId),
      onDismiss = { payFor = null },
      onSave = { amount, date, notes ->
        apply(
          LedgerEngine.paySupplier(d, supplierId, amount, date, notes, todayIso(), System.currentTimeMillis(), ::newId),
          "با موفقیت ثبت شد",
        ) { payFor = null }
      },
    )
  }

  confirmDelete?.let { supplier ->
    AlertDialog(
      onDismissRequest = { confirmDelete = null },
      containerColor = Shop.colors.surface,
      title = { Text("حذف تأمین‌کننده؟", color = Shop.colors.text) },
      text = {
        Text(
          "«${supplier.name}» حذف می‌شود. اگر خرید یا پرداختی به نامش ثبت شده باشد، حذف نمی‌شود.",
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
      },
      confirmButton = {
        TextButton(onClick = {
          apply(LedgerEngine.deleteSupplier(d, supplier.id), "با موفقیت حذف شد") {
            confirmDelete = null
            openSupplier = null
          }
        }) { Text("حذف", color = Shop.colors.danger) }
      },
      dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("انصراف") } },
    )
  }
}

/* ============================ تکه‌ها ============================ */

@Composable
private fun SupplierRow(
  d: ShopData,
  supplier: Supplier,
  open: Boolean,
  onClick: () -> Unit,
  onPurchase: () -> Unit,
  onPay: () -> Unit,
  onEdit: () -> Unit,
  onDelete: () -> Unit,
) {
  val debt = ShopStore.supplierDebt(d, supplier.id)
  val purchases = d.purchases.filter { it.supplierId == supplier.id }.sortedByDescending { it.createdAt }
  val payments = d.supplierPayments.filter { it.supplierId == supplier.id }.sortedByDescending { it.createdAt }

  Column(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(Radius.md))
      .background(Shop.colors.surface)
      .border(1.dp, if (open) Shop.colors.primary else Shop.colors.border, RoundedCornerShape(Radius.md))
      .clickable(onClick = onClick)
      .padding(14.dp)
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(supplier.name, style = MaterialTheme.typography.titleSmall, color = Shop.colors.text)
        if (supplier.phone.isNotBlank()) {
          Spacer(Modifier.height(3.dp))
          Text(supplier.phone, style = MaterialTheme.typography.labelSmall, color = Shop.colors.muted)
        }
      }
      Column(horizontalAlignment = Alignment.End) {
        Text(
          "${money(kotlin.math.abs(debt))} افغانی",
          style = MaterialTheme.typography.titleSmall,
          color = when {
            debt > 0 -> Shop.colors.warning
            debt < 0 -> Shop.colors.success
            else -> Shop.colors.muted
          },
          fontWeight = FontWeight.Bold,
        )
        Text(
          when {
            debt > 0 -> "بدهکاریم"
            debt < 0 -> "پیش‌پرداخت داریم"
            else -> "حساب صاف است"
          },
          style = MaterialTheme.typography.labelSmall,
          color = Shop.colors.muted,
        )
      }
    }

    AnimatedVisibility(visible = open) {
      Column(Modifier.padding(top = 12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          Button(onClick = onPurchase, modifier = Modifier.weight(1f)) { Text("ثبت خرید") }
          OutlinedButton(onClick = onPay, modifier = Modifier.weight(1f)) { Text("پرداخت") }
        }
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          OutlinedButton(onClick = onEdit, modifier = Modifier.weight(1f)) { Text("ویرایش") }
          OutlinedButton(
            onClick = onDelete,
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Shop.colors.danger),
            modifier = Modifier.weight(1f),
          ) { Text("حذف") }
        }

        if (purchases.isNotEmpty()) {
          Spacer(Modifier.height(14.dp))
          Text("خریدها", style = MaterialTheme.typography.labelMedium, color = Shop.colors.muted)
          purchases.take(10).forEach { purchase ->
            val product = d.products.find { it.id == purchase.productId }
            HistoryLine(
              title = "${product?.name ?: "(محصول حذف‌شده)"} — ${qty(purchase.quantity)} ${purchase.unit}",
              detail = formatDate(purchase.date) +
                if (purchase.debt > 0) " — ${money(purchase.debt)} افغانی باقی" else " — تسویه",
              amount = "${money(purchase.totalAmount)} افغانی",
              tint = Shop.colors.text,
            )
          }
          if (purchases.size > 10) {
            Text(
              "و ${plain(purchases.size - 10)} خرید قدیمی‌تر",
              style = MaterialTheme.typography.labelSmall,
              color = Shop.colors.muted2,
              modifier = Modifier.padding(top = 4.dp),
            )
          }
        }

        if (payments.isNotEmpty()) {
          Spacer(Modifier.height(14.dp))
          Text("پرداخت‌ها", style = MaterialTheme.typography.labelMedium, color = Shop.colors.muted)
          payments.take(10).forEach { payment ->
            HistoryLine(
              title = payment.notes.ifBlank { "پرداخت" },
              detail = formatDate(payment.date),
              amount = "${money(payment.amount)} افغانی",
              tint = Shop.colors.success,
            )
          }
        }
      }
    }
  }
}

@Composable
private fun HistoryLine(title: String, detail: String, amount: String, tint: Color) {
  Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f)) {
      Text(title, style = MaterialTheme.typography.bodySmall, color = Shop.colors.text)
      Text(detail, style = MaterialTheme.typography.labelSmall, color = Shop.colors.muted)
    }
    Text(amount, style = MaterialTheme.typography.bodySmall, color = tint)
  }
}

/* ============================ فرم‌ها ============================ */

data class SupplierFormState(
  val editingId: String? = null,
  val name: String = "",
  val phone: String = "",
  val address: String = "",
  val notes: String = "",
) {
  companion object {
    fun of(s: Supplier) = SupplierFormState(s.id, s.name, s.phone, s.address, s.notes)
  }
}

@Composable
private fun SupplierDialog(
  state: SupplierFormState,
  onDismiss: () -> Unit,
  onSave: (LedgerEngine.SupplierDraft) -> Unit,
) {
  var form by remember(state.editingId) { mutableStateOf(state) }

  Dialog(onDismissRequest = onDismiss) {
    Surface(color = Shop.colors.surface, shape = RoundedCornerShape(Radius.lg), modifier = Modifier.fillMaxWidth()) {
      Column(Modifier.padding(18.dp).verticalScroll(rememberScrollState())) {
        Text(
          if (form.editingId == null) "تأمین‌کنندهٔ تازه" else "ویرایش تأمین‌کننده",
          style = MaterialTheme.typography.titleMedium,
          color = Shop.colors.text,
        )
        Spacer(Modifier.height(14.dp))

        OutlinedTextField(form.name, { form = form.copy(name = it) }, label = { Text("نام") },
          singleLine = true, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(form.phone, { form = form.copy(phone = it) }, label = { Text("تلفن") },
          singleLine = true, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(form.address, { form = form.copy(address = it) }, label = { Text("آدرس") },
          singleLine = true, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(form.notes, { form = form.copy(notes = it) }, label = { Text("یادداشت") },
          modifier = Modifier.fillMaxWidth())

        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("انصراف") }
          Button(
            onClick = {
              onSave(LedgerEngine.SupplierDraft(form.name, form.phone, form.address, form.notes))
            },
            modifier = Modifier.weight(1f),
          ) { Text("ذخیره") }
        }
      }
    }
  }
}

@Composable
private fun PurchaseDialog(
  d: ShopData,
  supplierId: String,
  onDismiss: () -> Unit,
  onSave: (LedgerEngine.PurchaseDraft) -> Unit,
) {
  var productId by remember { mutableStateOf<String?>(null) }
  var quantity by remember { mutableStateOf("") }
  var price by remember { mutableStateOf("") }
  var paid by remember { mutableStateOf("") }
  var date by remember { mutableStateOf(todayIso()) }
  var notes by remember { mutableStateOf("") }

  val product = d.products.find { it.id == productId }
  // قیمتِ خریدِ فعلیِ همان کالا پیشنهاد می‌شود، ولی قابلِ عوض کردن است
  LaunchedEffect(productId) {
    if (product != null && price.isBlank() && product.purchasePrice > 0) {
      price = product.purchasePrice.toLong().toString()
    }
  }

  val total = (quantity.toDoubleOrNull() ?: 0.0) * (price.toDoubleOrNull() ?: 0.0)
  val remaining = (total - (paid.toDoubleOrNull() ?: 0.0)).coerceAtLeast(0.0)

  Dialog(onDismissRequest = onDismiss) {
    Surface(color = Shop.colors.surface, shape = RoundedCornerShape(Radius.lg), modifier = Modifier.fillMaxWidth()) {
      Column(Modifier.padding(18.dp).verticalScroll(rememberScrollState())) {
        Text("ثبت خرید", style = MaterialTheme.typography.titleMedium, color = Shop.colors.text)
        Spacer(Modifier.height(4.dp))
        Text(
          d.suppliers.find { it.id == supplierId }?.name.orEmpty(),
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )

        Spacer(Modifier.height(14.dp))
        NamedPicker(
          title = "محصول",
          options = d.products,
          selectedId = productId,
          idOf = { it.id },
          nameOf = { it.name },
          emptyNote = "— ابتدا یک کالا در انبار ثبت کنید —",
          onSelect = { productId = it },
        )

        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          NumberField(quantity, { quantity = it },
            "مقدار${product?.unit?.takeIf { it.isNotBlank() }?.let { " ($it)" } ?: ""}", Modifier.weight(1f))
          NumberField(price, { price = it }, "قیمت هر واحد", Modifier.weight(1f))
        }

        if (total > 0) {
          Spacer(Modifier.height(8.dp))
          Panel {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
              Text("جمع خرید", style = MaterialTheme.typography.bodySmall, color = Shop.colors.muted)
              Text("${money(total)} افغانی", style = MaterialTheme.typography.titleSmall, color = Shop.colors.text)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
              Text("باقی‌مانده", style = MaterialTheme.typography.bodySmall, color = Shop.colors.muted)
              Text(
                "${money(remaining)} افغانی",
                style = MaterialTheme.typography.bodySmall,
                color = if (remaining > 0) Shop.colors.warning else Shop.colors.success,
              )
            }
          }
        }

        Spacer(Modifier.height(12.dp))
        AmountField(paid, { paid = it }, "پرداخت‌شده (خالی یعنی نسیه)")

        Spacer(Modifier.height(12.dp))
        DateField(date) { date = it }

        Spacer(Modifier.height(10.dp))
        OutlinedTextField(notes, { notes = it }, label = { Text("توضیحات (اختیاری)") },
          modifier = Modifier.fillMaxWidth())

        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("انصراف") }
          Button(
            onClick = {
              onSave(
                LedgerEngine.PurchaseDraft(
                  supplierId = supplierId,
                  productId = productId.orEmpty(),
                  quantity = quantity.toDoubleOrNull() ?: 0.0,
                  unit = product?.unit.orEmpty(),
                  purchasePrice = price.toDoubleOrNull() ?: -1.0,
                  paidAmount = paid.toDoubleOrNull() ?: 0.0,
                  date = date,
                  notes = notes.trim(),
                )
              )
            },
            modifier = Modifier.weight(1f),
          ) { Text("ثبت خرید") }
        }
      }
    }
  }
}

@Composable
private fun PaymentDialog(
  supplier: Supplier?,
  debt: Double,
  onDismiss: () -> Unit,
  onSave: (Double, String, String) -> Unit,
) {
  var amount by remember { mutableStateOf("") }
  var date by remember { mutableStateOf(todayIso()) }
  var notes by remember { mutableStateOf("") }

  Dialog(onDismissRequest = onDismiss) {
    Surface(color = Shop.colors.surface, shape = RoundedCornerShape(Radius.lg), modifier = Modifier.fillMaxWidth()) {
      Column(Modifier.padding(18.dp).verticalScroll(rememberScrollState())) {
        Text("پرداخت به تأمین‌کننده", style = MaterialTheme.typography.titleMedium, color = Shop.colors.text)
        if (supplier != null) {
          Spacer(Modifier.height(4.dp))
          Text(
            "${supplier.name} — ${money(debt.coerceAtLeast(0.0))} افغانی بدهکاریم",
            style = MaterialTheme.typography.bodySmall,
            color = Shop.colors.muted,
          )
        }

        Spacer(Modifier.height(14.dp))
        AmountField(amount, { amount = it }, "مبلغ پرداختی")

        if (debt > 0) {
          Spacer(Modifier.height(6.dp))
          TextButton(onClick = { amount = Math.round(debt).toString() }) {
            Text("تسویهٔ کامل", color = Shop.colors.primary)
          }
        }

        Spacer(Modifier.height(8.dp))
        DateField(date) { date = it }

        Spacer(Modifier.height(10.dp))
        OutlinedTextField(notes, { notes = it }, label = { Text("یادداشت (اختیاری)") },
          modifier = Modifier.fillMaxWidth())

        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("انصراف") }
          Button(
            onClick = { onSave(amount.toDoubleOrNull() ?: 0.0, date, notes) },
            modifier = Modifier.weight(1f),
          ) { Text("ثبت پرداخت") }
        }
      }
    }
  }
}
