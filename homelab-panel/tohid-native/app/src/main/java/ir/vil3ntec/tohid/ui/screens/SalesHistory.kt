package ir.vil3ntec.tohid.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import ir.vil3ntec.tohid.data.Sale
import ir.vil3ntec.tohid.data.SalesEngine
import ir.vil3ntec.tohid.data.ShopData
import ir.vil3ntec.tohid.data.ShopStore
import ir.vil3ntec.tohid.formatDate
import ir.vil3ntec.tohid.money
import ir.vil3ntec.tohid.plain
import ir.vil3ntec.tohid.qty
import ir.vil3ntec.tohid.todayIso
import ir.vil3ntec.tohid.ui.theme.Radius
import ir.vil3ntec.tohid.ui.theme.Shop
import kotlinx.coroutines.launch

/**
 *  تاریخچهٔ فروش.
 *
 *  هر فاکتوری که ثبت شده اینجاست — از جمله لغوشده‌ها. فاکتور هیچ‌وقت پاک
 *  نمی‌شود، فقط لغو می‌شود؛ فروشی که افتاده حقیقتی است که در گزارشِ سود و
 *  حسابِ قرض‌دار اثر گذاشته، و برداشتنش آن عددها را عوض می‌کند.
 */
@Composable
fun SalesHistoryScreen(store: ShopStore, d: ShopData, snackbar: SnackbarHostState) {
  val scope = rememberCoroutineScope()

  var filter by rememberSaveable { mutableStateOf("all") }
  var invoiceFor by remember { mutableStateOf<Sale?>(null) }
  var returnFor by remember { mutableStateOf<Sale?>(null) }
  var cancelFor by remember { mutableStateOf<Sale?>(null) }

  fun toast(text: String) {
    scope.launch { snackbar.showSnackbar(text) }
  }

  fun apply(result: SalesEngine.Result, done: String, after: () -> Unit = {}) {
    when (result) {
      is SalesEngine.Result.Failed -> toast(result.message)
      is SalesEngine.Result.Ok -> {
        scope.launch { store.save(result.data) }
        toast(done)
        after()
      }
    }
  }

  val shown = d.sales
    .filter {
      when (filter) {
        "cash" -> it.status != "cancelled" && it.paymentMethod == "cash"
        "credit" -> it.status != "cancelled" && it.paymentMethod == "credit"
        "cancelled" -> it.status == "cancelled"
        else -> true
      }
    }
    .sortedByDescending { it.createdAt }

  val active = d.sales.filter { it.status != "cancelled" }

  LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp)) {
    item {
      Text("تاریخچه فروش", style = MaterialTheme.typography.headlineMedium, color = Shop.colors.text)
      Text(
        "فاکتورهای ثبت‌شده، مرجوعی و لغو فروش",
        style = MaterialTheme.typography.bodySmall,
        color = Shop.colors.muted,
      )
      Spacer(Modifier.height(14.dp))
    }

    item {
      StatTile(
        label = "جمع فروش",
        value = "${money(active.sumOf { it.finalTotal })} افغانی",
        hint = "${plain(active.size)} فاکتور — ${plain(d.sales.size - active.size)} لغوشده",
        modifier = Modifier.fillMaxWidth(),
      )
      Spacer(Modifier.height(12.dp))
    }

    item {
      Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        listOf("all" to "همه", "cash" to "نقدی", "credit" to "نسیه", "cancelled" to "لغوشده").forEach { (id, label) ->
          FilterChip(selected = filter == id, onClick = { filter = id }, label = { Text(label) })
        }
      }
      Spacer(Modifier.height(14.dp))
    }

    if (shown.isEmpty()) {
      item { Panel { EmptyNote("فاکتوری با این فیلتر پیدا نشد.") } }
    } else {
      items(shown, key = { it.id }) { sale ->
        SaleCard(
          d = d,
          sale = sale,
          onInvoice = { invoiceFor = sale },
          onReturn = { returnFor = sale },
          onCancel = { cancelFor = sale },
        )
        Spacer(Modifier.height(8.dp))
      }
    }
  }

  /* ---------------------------- پنجره‌ها ---------------------------- */

  invoiceFor?.let { sale ->
    InvoiceDialog(d = d, sale = sale, onDismiss = { invoiceFor = null }, onMessage = ::toast)
  }

  returnFor?.let { sale ->
    ReturnDialog(
      d = d,
      sale = sale,
      onDismiss = { returnFor = null },
      onConfirm = { quantities, reason ->
        apply(
          SalesEngine.recordReturn(d, sale.id, quantities, reason, todayIso(), System.currentTimeMillis(), ::newId),
          "مرجوعی با موفقیت ثبت شد",
        ) { returnFor = null }
      },
    )
  }

  cancelFor?.let { sale ->
    AlertDialog(
      onDismissRequest = { cancelFor = null },
      containerColor = Shop.colors.surface,
      title = { Text("لغو فروش؟", color = Shop.colors.text) },
      text = {
        Text(
          SalesEngine.cancelWarning(sale),
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
      },
      confirmButton = {
        TextButton(onClick = {
          apply(
            SalesEngine.cancel(d, sale.id, todayIso(), System.currentTimeMillis(), ::newId),
            "فروش لغو شد",
          ) { cancelFor = null }
        }) { Text("لغو فروش", color = Shop.colors.danger) }
      },
      dismissButton = { TextButton(onClick = { cancelFor = null }) { Text("بازگشت") } },
    )
  }
}

/* ============================ تکه‌ها ============================ */

@Composable
private fun SaleCard(
  d: ShopData,
  sale: Sale,
  onInvoice: () -> Unit,
  onReturn: () -> Unit,
  onCancel: () -> Unit,
) {
  val cancelled = sale.status == "cancelled"
  val debtor = sale.debtorId?.let { id -> d.debtors.find { it.id == id } }
  val canReturn = !cancelled && d.saleItems.any { it.saleId == sale.id && SalesEngine.returnable(it) > 0 }

  Column(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(Radius.md))
      .background(Shop.colors.surface)
      .border(1.dp, Shop.colors.border, RoundedCornerShape(Radius.md))
      .padding(14.dp)
  ) {
    Row(verticalAlignment = Alignment.Top) {
      Column(Modifier.weight(1f)) {
        Text(
          "فاکتور #${plain(sale.invoiceNumber ?: 0)}",
          style = MaterialTheme.typography.titleSmall,
          color = if (cancelled) Shop.colors.muted else Shop.colors.text,
        )
        Spacer(Modifier.height(4.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
          Text(formatDate(sale.date), style = MaterialTheme.typography.labelSmall, color = Shop.colors.muted)
          Badge(
            text = when {
              cancelled -> "لغوشده"
              sale.paymentMethod == "credit" -> "نسیه"
              else -> "نقدی"
            },
            tint = when {
              cancelled -> Shop.colors.danger
              sale.paymentMethod == "credit" -> Shop.colors.warning
              else -> Shop.colors.success
            },
            background = when {
              cancelled -> Shop.colors.dangerTint
              sale.paymentMethod == "credit" -> Shop.colors.warningTint
              else -> Shop.colors.successTint
            },
          )
          if (debtor != null) {
            Text("— ${debtor.name}", style = MaterialTheme.typography.labelSmall, color = Shop.colors.muted)
          }
        }
      }
      Text(
        "${money(sale.finalTotal)} افغانی",
        style = MaterialTheme.typography.titleSmall,
        color = if (cancelled) Shop.colors.muted else Shop.colors.text,
        fontWeight = FontWeight.Bold,
      )
    }

    if (sale.remaining > 0 && !cancelled) {
      Spacer(Modifier.height(6.dp))
      Text(
        "${money(sale.remaining)} افغانی باقی‌مانده",
        style = MaterialTheme.typography.labelSmall,
        color = Shop.colors.warning,
      )
    }

    Spacer(Modifier.height(10.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      OutlinedButton(onClick = onInvoice, modifier = Modifier.weight(1f)) { Text("فاکتور") }
      if (canReturn) OutlinedButton(onClick = onReturn, modifier = Modifier.weight(1f)) { Text("مرجوعی") }
      if (!cancelled) {
        OutlinedButton(
          onClick = onCancel,
          colors = ButtonDefaults.outlinedButtonColors(contentColor = Shop.colors.danger),
        ) { Text("لغو") }
      }
    }
  }
}

@Composable
private fun Badge(text: String, tint: Color, background: Color) {
  Box(
    Modifier
      .clip(RoundedCornerShape(999.dp))
      .background(background)
      .padding(horizontal = 8.dp, vertical = 3.dp)
  ) {
    Text(text, style = MaterialTheme.typography.labelSmall, color = tint)
  }
}

/**
 *  مرجوعیِ جزئی — هر قلم به هر مقدار.
 *
 *  کنارِ هر قلم نوشته می‌شود چقدرش قابلِ برگشت است، تا کسی مقداری بزند که
 *  اصلاً فروخته نشده. اگر بیشتر هم بزند، همان‌جا محدود می‌شود.
 */
@Composable
private fun ReturnDialog(
  d: ShopData,
  sale: Sale,
  onDismiss: () -> Unit,
  onConfirm: (Map<String, Double>, String) -> Unit,
) {
  val items = d.saleItems.filter { it.saleId == sale.id && SalesEngine.returnable(it) > 0 }
  var quantities by remember { mutableStateOf(mapOf<String, String>()) }
  var reason by remember { mutableStateOf("") }

  val total = items.sumOf { item ->
    val wanted = (quantities[item.id]?.toDoubleOrNull() ?: 0.0).coerceIn(0.0, SalesEngine.returnable(item))
    if (item.quantity > 0) Math.round(item.totalPrice / item.quantity * wanted).toDouble() else 0.0
  }

  Dialog(onDismissRequest = onDismiss) {
    Surface(color = Shop.colors.surface, shape = RoundedCornerShape(Radius.lg), modifier = Modifier.fillMaxWidth()) {
      Column(Modifier.padding(18.dp).verticalScroll(rememberScrollState())) {
        Text("مرجوعی — فاکتور #${plain(sale.invoiceNumber ?: 0)}",
          style = MaterialTheme.typography.titleMedium, color = Shop.colors.text)
        Spacer(Modifier.height(12.dp))

        if (items.isEmpty()) {
          EmptyNote("موردی برای مرجوعی وجود ندارد.")
        } else {
          items.forEach { item ->
            val product = d.products.find { it.id == item.productId }
            val allowed = SalesEngine.returnable(item)
            Column(Modifier.padding(bottom = 12.dp)) {
              Text(
                "${product?.name ?: "(محصول حذف‌شده)"} — قابل مرجوعی: ${qty(allowed)}${product?.unit?.takeIf { it.isNotBlank() }?.let { " $it" } ?: ""}",
                style = MaterialTheme.typography.bodySmall,
                color = Shop.colors.muted,
              )
              Spacer(Modifier.height(6.dp))
              NumberField(
                value = quantities[item.id].orEmpty(),
                onValueChange = { quantities = quantities + (item.id to it) },
                label = "مقدار مرجوعی",
                modifier = Modifier.fillMaxWidth(),
              )
            }
          }

          if (total > 0) {
            Panel {
              Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("مبلغ مرجوعی", style = MaterialTheme.typography.bodySmall, color = Shop.colors.muted)
                Text("${money(total)} افغانی", style = MaterialTheme.typography.titleSmall, color = Shop.colors.text)
              }
            }
            Spacer(Modifier.height(10.dp))
          }

          OutlinedTextField(
            value = reason,
            onValueChange = { reason = it },
            label = { Text("دلیل (اختیاری)") },
            modifier = Modifier.fillMaxWidth(),
          )
        }

        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("انصراف") }
          Button(
            enabled = items.isNotEmpty(),
            onClick = {
              onConfirm(
                quantities.mapNotNull { (id, text) ->
                  text.toDoubleOrNull()?.takeIf { it > 0 }?.let { id to it }
                }.toMap(),
                reason.trim(),
              )
            },
            modifier = Modifier.weight(1f),
          ) { Text("ثبت مرجوعی") }
        }
      }
    }
  }
}
