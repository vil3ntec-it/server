package ir.vil3ntec.tohid.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.core.content.ContextCompat
import ir.vil3ntec.tohid.data.Sale
import ir.vil3ntec.tohid.data.SalesEngine
import ir.vil3ntec.tohid.data.ShopData
import ir.vil3ntec.tohid.data.ShopStore
import ir.vil3ntec.tohid.formatDate
import ir.vil3ntec.tohid.money
import ir.vil3ntec.tohid.plain
import ir.vil3ntec.tohid.print.PrintJob
import ir.vil3ntec.tohid.print.ThermalPrinter
import ir.vil3ntec.tohid.ui.theme.Radius
import ir.vil3ntec.tohid.ui.theme.Shop
import kotlinx.coroutines.launch

/* ============================ تسویه ============================ */

/**
 *  پنجرهٔ تسویه — تخفیف، نقدی/نسیه، مبلغِ پرداختی.
 *
 *  عددها همان‌جا و همان لحظه با `SalesEngine` حساب می‌شوند، نه با فرمولِ
 *  جداگانه‌ای در رابط کاربری. پس چیزی که اینجا دیده می‌شود دقیقاً همان
 *  چیزی است که ثبت خواهد شد.
 */
@Composable
fun CheckoutDialog(
  d: ShopData,
  cart: List<SalesEngine.CartLine>,
  presetDebtorId: String?,
  onDismiss: () -> Unit,
  onConfirm: (SalesEngine.Checkout) -> Unit,
) {
  // مثل نسخهٔ وب: اگر از سبد قرض‌داری انتخاب شده باشد، پنجره روی «نسیه»
  // باز می‌شود؛ وگرنه «نقدی». تخفیف هم پیش‌فرض درصدی است.
  val preset = presetDebtorId?.takeIf { id -> d.debtors.any { it.id == id } }

  var discountType by remember { mutableStateOf(SalesEngine.DiscountType.PERCENT) }
  var payment by remember { mutableStateOf(if (preset != null) SalesEngine.Payment.CREDIT else SalesEngine.Payment.CASH) }
  var discountText by remember { mutableStateOf("0") }
  var debtorId by remember { mutableStateOf(preset) }
  var paidText by remember { mutableStateOf(if (preset != null) "0" else "") }
  var debtorMenu by remember { mutableStateOf(false) }

  val checkout = SalesEngine.Checkout(
    discountType = discountType,
    discountValue = discountText.toDoubleOrNull() ?: 0.0,
    payment = payment,
    paidAmount = paidText.toDoubleOrNull() ?: 0.0,
    debtorId = debtorId,
  )
  val totals = SalesEngine.totals(d, cart, checkout)

  // در فروشِ نقدی مبلغِ پرداختی همیشه کلِ مبلغِ نهایی است
  val paid = if (payment == SalesEngine.Payment.CASH) totals.finalTotal
  else minOf(paidText.toDoubleOrNull()?.coerceAtLeast(0.0) ?: 0.0, totals.finalTotal)
  val remaining = (totals.finalTotal - paid).coerceAtLeast(0.0)

  Dialog(onDismissRequest = onDismiss) {
    Surface(
      color = Shop.colors.surface,
      shape = RoundedCornerShape(Radius.lg),
      modifier = Modifier.fillMaxWidth(),
    ) {
      Column(Modifier.padding(18.dp).verticalScroll(rememberScrollState())) {
        Text("تسویه فروش", style = MaterialTheme.typography.titleMedium, color = Shop.colors.text)
        Spacer(Modifier.height(14.dp))

        Text("نوع تخفیف", style = MaterialTheme.typography.labelMedium, color = Shop.colors.muted)
        Spacer(Modifier.height(6.dp))
        Segmented(
          options = listOf("درصدی" to SalesEngine.DiscountType.PERCENT, "مبلغی" to SalesEngine.DiscountType.AMOUNT),
          selected = discountType,
          onSelect = { discountType = it },
        )

        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
          value = discountText,
          onValueChange = { discountText = it.filter { c -> c.isDigit() || c == '.' } },
          label = { Text(if (discountType == SalesEngine.DiscountType.PERCENT) "تخفیف (٪)" else "تخفیف (افغانی)") },
          singleLine = true,
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
          modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(14.dp))
        Text("نوع پرداخت", style = MaterialTheme.typography.labelMedium, color = Shop.colors.muted)
        Spacer(Modifier.height(6.dp))
        Segmented(
          options = listOf("نقدی" to SalesEngine.Payment.CASH, "نسیه" to SalesEngine.Payment.CREDIT),
          selected = payment,
          onSelect = { payment = it },
        )

        if (payment == SalesEngine.Payment.CREDIT) {
          Spacer(Modifier.height(12.dp))
          Box {
            OutlinedButton(onClick = { debtorMenu = true }, modifier = Modifier.fillMaxWidth()) {
              Text(
                debtorId?.let { id -> d.debtors.find { it.id == id }?.name }
                  ?: if (d.debtors.isEmpty()) "— ابتدا یک قرض‌دار اضافه کنید —" else "انتخاب قرض‌دار",
              )
            }
            DropdownMenu(expanded = debtorMenu, onDismissRequest = { debtorMenu = false }) {
              d.debtors.forEach { debtor ->
                DropdownMenuItem(
                  text = { Text(debtor.name) },
                  onClick = { debtorId = debtor.id; debtorMenu = false },
                )
              }
            }
          }

          Spacer(Modifier.height(12.dp))
          OutlinedTextField(
            value = paidText,
            onValueChange = { paidText = it.filter { c -> c.isDigit() || c == '.' } },
            label = { Text("مبلغ پرداختی") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(),
          )
        }

        Spacer(Modifier.height(16.dp))
        Panel {
          MoneyRow("جمع اقلام", totals.subtotal)
          MoneyRow("تخفیف", totals.discount)
          HorizontalDivider(Modifier.padding(vertical = 6.dp), color = Shop.colors.border)
          MoneyRow("مبلغ نهایی", totals.finalTotal, strong = true)
          MoneyRow("مبلغ پرداختی", paid)
          MoneyRow("باقی‌مانده", remaining, tint = if (remaining > 0) Shop.colors.warning else null)
        }

        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("انصراف") }
          Button(
            onClick = { onConfirm(checkout.copy(paidAmount = paid, debtorId = debtorId)) },
            modifier = Modifier.weight(1f),
          ) { Text("ثبت فروش") }
        }
      }
    }
  }
}

@Composable
private fun <T> Segmented(options: List<Pair<String, T>>, selected: T, onSelect: (T) -> Unit) {
  Row(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(Radius.sm))
      .background(Shop.colors.surface2)
      .padding(3.dp),
  ) {
    options.forEach { (label, value) ->
      val active = value == selected
      Box(
        Modifier
          .weight(1f)
          .clip(RoundedCornerShape(Radius.sm))
          .background(if (active) Shop.colors.primary else Color.Transparent)
          .clickable { onSelect(value) }
          .padding(vertical = 9.dp),
        contentAlignment = Alignment.Center,
      ) {
        Text(
          label,
          style = MaterialTheme.typography.labelLarge,
          color = if (active) Color.White else Shop.colors.muted,
        )
      }
    }
  }
}

@Composable
private fun MoneyRow(label: String, amount: Double, strong: Boolean = false, tint: Color? = null) {
  Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.SpaceBetween) {
    Text(
      label,
      style = if (strong) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodySmall,
      color = if (strong) Shop.colors.text else Shop.colors.muted,
    )
    Text(
      "${money(amount)} افغانی",
      style = if (strong) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium,
      color = tint ?: Shop.colors.text,
      fontWeight = if (strong) FontWeight.Bold else FontWeight.Normal,
    )
  }
}

/* ============================ فاکتور ============================ */

/**
 *  فاکتور — همان چیدمانِ نسخهٔ وب، به‌علاوهٔ چاپ روی چاپگرِ حرارتی.
 */
@Composable
fun InvoiceDialog(
  d: ShopData,
  sale: Sale,
  onDismiss: () -> Unit,
  onMessage: (String) -> Unit,
) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var printer by remember { mutableStateOf(false) }

  val items = remember(sale.id) { d.saleItems.filter { it.saleId == sale.id } }
  val debtor = sale.debtorId?.let { id -> d.debtors.find { it.id == id } }

  Dialog(onDismissRequest = onDismiss) {
    Surface(
      color = Shop.colors.surface,
      shape = RoundedCornerShape(Radius.lg),
      modifier = Modifier.fillMaxWidth(),
    ) {
      Column(Modifier.padding(18.dp).verticalScroll(rememberScrollState())) {
        Text(
          "فاکتور فروش #${sale.invoiceNumber?.let { plain(it) } ?: "—"}",
          style = MaterialTheme.typography.titleMedium,
          color = Shop.colors.text,
        )
        Spacer(Modifier.height(4.dp))
        Text(
          "${formatDate(sale.date)} — ${if (sale.paymentMethod == "credit") "نسیه" else "نقدی"}",
          style = MaterialTheme.typography.labelSmall,
          color = Shop.colors.muted,
        )

        Spacer(Modifier.height(14.dp))
        items.forEach { item ->
          val product = d.products.find { it.id == item.productId }
          Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
            Column(Modifier.weight(1f)) {
              Text(
                product?.name ?: "(محصول حذف‌شده)",
                style = MaterialTheme.typography.bodyMedium,
                color = Shop.colors.text,
              )
              Text(
                "${money(item.quantity)}${product?.unit?.takeIf { it.isNotBlank() }?.let { " $it" } ?: ""} × ${money(item.unitPrice)}",
                style = MaterialTheme.typography.labelSmall,
                color = Shop.colors.muted,
              )
            }
            Text(money(item.totalPrice), style = MaterialTheme.typography.bodyMedium, color = Shop.colors.text)
          }
        }

        Spacer(Modifier.height(10.dp))
        HorizontalDivider(color = Shop.colors.border)
        Spacer(Modifier.height(10.dp))

        MoneyRow("جمع اقلام", sale.total)
        MoneyRow("تخفیف", sale.discount)
        MoneyRow("مبلغ نهایی", sale.finalTotal, strong = true)
        MoneyRow("پرداختی", sale.paidAmount)
        MoneyRow("باقی‌مانده", sale.remaining, tint = if (sale.remaining > 0) Shop.colors.warning else null)
        if (debtor != null) {
          Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("قرض‌دار", style = MaterialTheme.typography.bodySmall, color = Shop.colors.muted)
            Text(debtor.name, style = MaterialTheme.typography.bodyMedium, color = Shop.colors.text)
          }
        }

        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("بستن") }
          Button(onClick = { printer = true }, modifier = Modifier.weight(1f)) { Text("چاپ") }
        }
      }
    }
  }

  if (printer) {
    PrinterDialog(
      onDismiss = { printer = false },
      onPrint = { address, width ->
        printer = false
        onMessage("در حال فرستادن به چاپگر…")
        scope.launch {
          val error = PrintJob.printSale(context, d, sale, address, width)
          onMessage(error ?: "فاکتور به چاپگر فرستاده شد")
        }
      },
    )
  }
}

/* ============================ چاپگر ============================ */

/**
 *  انتخابِ چاپگر.
 *
 *  فقط چاپگرهایی نشان داده می‌شوند که واقعاً در تنظیماتِ بلوتوثِ گوشی جفت
 *  شده‌اند — فهرستِ ساختگی ساخته نمی‌شود. اگر چیزی جفت نشده، همین گفته
 *  می‌شود، نه اینکه دکمهٔ چاپ بی‌صدا کاری نکند.
 */
@Composable
private fun PrinterDialog(onDismiss: () -> Unit, onPrint: (String, Int) -> Unit) {
  val context = LocalContext.current
  val prefs = remember { context.getSharedPreferences("tohid", android.content.Context.MODE_PRIVATE) }

  var granted by remember {
    mutableStateOf(
      android.os.Build.VERSION.SDK_INT < 31 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) ==
        PackageManager.PERMISSION_GRANTED
    )
  }
  val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }

  var printers by remember { mutableStateOf(emptyList<ThermalPrinter.Printer>()) }
  LaunchedEffect(granted) {
    printers = if (granted) ThermalPrinter.paired(context) else emptyList()
  }

  var width by remember { mutableStateOf(prefs.getInt("printer_width", ThermalPrinter.WIDTH_58MM)) }
  var selected by remember { mutableStateOf(prefs.getString("printer_address", null)) }

  Dialog(onDismissRequest = onDismiss) {
    Surface(color = Shop.colors.surface, shape = RoundedCornerShape(Radius.lg), modifier = Modifier.fillMaxWidth()) {
      Column(Modifier.padding(18.dp)) {
        Text("چاپ فاکتور", style = MaterialTheme.typography.titleMedium, color = Shop.colors.text)
        Spacer(Modifier.height(12.dp))

        Text("عرض کاغذ", style = MaterialTheme.typography.labelMedium, color = Shop.colors.muted)
        Spacer(Modifier.height(6.dp))
        Segmented(
          options = listOf("۵۸ میلی‌متر" to ThermalPrinter.WIDTH_58MM, "۸۰ میلی‌متر" to ThermalPrinter.WIDTH_80MM),
          selected = width,
          onSelect = { width = it; prefs.edit().putInt("printer_width", it).apply() },
        )

        Spacer(Modifier.height(16.dp))
        Text("چاپگر", style = MaterialTheme.typography.labelMedium, color = Shop.colors.muted)
        Spacer(Modifier.height(6.dp))

        if (!granted) {
          Text(
            "برای دیدن چاپگرها، اجازهٔ بلوتوث لازم است.",
            style = MaterialTheme.typography.bodySmall,
            color = Shop.colors.muted,
          )
          Spacer(Modifier.height(8.dp))
          Button(onClick = { ask.launch(Manifest.permission.BLUETOOTH_CONNECT) }) { Text("اجازه دادن") }
        } else if (printers.isEmpty()) {
          Text(
            "چاپگری پیدا نشد. اول چاپگر را در تنظیمات بلوتوث گوشی جفت کنید، بعد اینجا برگردید.",
            style = MaterialTheme.typography.bodySmall,
            color = Shop.colors.muted,
          )
        } else {
          printers.forEach { p ->
            Row(
              Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.sm))
                .background(if (selected == p.address) Shop.colors.primaryTint else Color.Transparent)
                .clickable { selected = p.address }
                .padding(10.dp),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              RadioButton(selected = selected == p.address, onClick = { selected = p.address })
              Spacer(Modifier.width(6.dp))
              Column {
                Text(p.name, style = MaterialTheme.typography.bodyMedium, color = Shop.colors.text)
                Text(p.address, style = MaterialTheme.typography.labelSmall, color = Shop.colors.muted2)
              }
            }
          }
        }

        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("انصراف") }
          Button(
            enabled = selected != null,
            onClick = {
              val address = selected ?: return@Button
              prefs.edit().putString("printer_address", address).apply()
              onPrint(address, width)
            },
            modifier = Modifier.weight(1f),
          ) { Text("چاپ") }
        }
      }
    }
  }
}

/* ============================ انتخاب‌ها ============================ */

/** انتخابِ محصول — همان صفحهٔ «انتخاب محصول» نسخهٔ وب، با فیلترِ دسته‌بندی */
@Composable
fun ProductPicker(
  d: ShopData,
  cart: List<SalesEngine.CartLine>,
  onClose: () -> Unit,
  onAdd: (String) -> Unit,
  onSetQty: (String, Double) -> Unit,
) {
  var category by remember { mutableStateOf<String?>(null) }
  var search by remember { mutableStateOf("") }

  val shown = d.products.filter { p ->
    (category == null || p.category == category) &&
      (search.isBlank() || p.name.contains(search.trim(), ignoreCase = true))
  }

  Dialog(onDismissRequest = onClose) {
    Surface(color = Shop.colors.surface, shape = RoundedCornerShape(Radius.lg), modifier = Modifier.fillMaxWidth()) {
      Column(Modifier.padding(16.dp).heightIn(max = 560.dp)) {
        Text("انتخاب محصول", style = MaterialTheme.typography.titleMedium, color = Shop.colors.text)
        Spacer(Modifier.height(4.dp))
        Text(
          "روی محصول بزنید تا یک عدد به سبد خرید اضافه شود",
          style = MaterialTheme.typography.labelSmall,
          color = Shop.colors.muted,
        )

        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
          value = search,
          onValueChange = { search = it },
          placeholder = { Text("جستجوی نام کالا") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth(),
        )

        if (d.productCategories.isNotEmpty()) {
          Spacer(Modifier.height(10.dp))
          Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
          ) {
            FilterChip(selected = category == null, onClick = { category = null }, label = { Text("همه") })
            d.productCategories.forEach { c ->
              FilterChip(selected = category == c, onClick = { category = c }, label = { Text(c) })
            }
          }
        }

        Spacer(Modifier.height(10.dp))
        if (shown.isEmpty()) {
          EmptyNote("محصولی پیدا نشد")
        } else {
          LazyColumn(Modifier.weight(1f, fill = false)) {
            items(shown, key = { it.id }) { p ->
              val inCart = cart.find { it.productId == p.id }?.quantity ?: 0.0
              val stock = ShopStore.stock(d, p.id)
              Row(
                Modifier
                  .fillMaxWidth()
                  .clip(RoundedCornerShape(Radius.sm))
                  .background(if (inCart > 0) Shop.colors.primaryTint else Color.Transparent)
                  .clickable { onAdd(p.id) }
                  .padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
              ) {
                Column(Modifier.weight(1f)) {
                  Text(p.name, style = MaterialTheme.typography.bodyMedium, color = Shop.colors.text)
                  Text(
                    "${money(p.salePrice)} افغانی — موجودی ${ir.vil3ntec.tohid.qty(stock)}${if (p.unit.isNotBlank()) " ${p.unit}" else ""}",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (stock <= 0) Shop.colors.danger else Shop.colors.muted,
                  )
                }
                if (inCart > 0) {
                  Text(
                    ir.vil3ntec.tohid.qty(inCart),
                    style = MaterialTheme.typography.titleSmall,
                    color = Shop.colors.primary,
                  )
                  Spacer(Modifier.width(6.dp))
                  IconButton(onClick = { onSetQty(p.id, 0.0) }) {
                    Icon(
                      androidx.compose.material.icons.Icons.Filled.Close,
                      contentDescription = "حذف از سبد",
                      tint = Shop.colors.muted,
                    )
                  }
                }
              }
            }
          }
        }

        Spacer(Modifier.height(12.dp))
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text("بازگشت به فروش") }
      }
    }
  }
}

/** انتخابِ قرض‌دار برای فروشِ نسیه */
@Composable
fun DebtorPicker(
  d: ShopData,
  selected: String?,
  onClose: () -> Unit,
  onPick: (String?) -> Unit,
) {
  var search by remember { mutableStateOf("") }
  val shown = d.debtors.filter { search.isBlank() || it.name.contains(search.trim(), ignoreCase = true) }

  Dialog(onDismissRequest = onClose) {
    Surface(color = Shop.colors.surface, shape = RoundedCornerShape(Radius.lg), modifier = Modifier.fillMaxWidth()) {
      Column(Modifier.padding(16.dp).heightIn(max = 520.dp)) {
        Text("انتخاب قرض‌دار", style = MaterialTheme.typography.titleMedium, color = Shop.colors.text)
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
          value = search,
          onValueChange = { search = it },
          placeholder = { Text("نام قرض‌دار") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(10.dp))

        if (shown.isEmpty()) {
          EmptyNote(if (d.debtors.isEmpty()) "هنوز قرض‌داری ثبت نشده است" else "قرض‌داری پیدا نشد")
        } else {
          LazyColumn(Modifier.weight(1f, fill = false)) {
            items(shown, key = { it.id }) { debtor ->
              Row(
                Modifier
                  .fillMaxWidth()
                  .clip(RoundedCornerShape(Radius.sm))
                  .background(if (selected == debtor.id) Shop.colors.primaryTint else Color.Transparent)
                  .clickable { onPick(debtor.id) }
                  .padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
              ) {
                Column(Modifier.weight(1f)) {
                  Text(debtor.name, style = MaterialTheme.typography.bodyMedium, color = Shop.colors.text)
                  Text(
                    debtStateText(d, debtor.id),
                    style = MaterialTheme.typography.labelSmall,
                    color = Shop.colors.muted,
                  )
                }
              }
            }
          }
        }

        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = onClose, modifier = Modifier.weight(1f)) { Text("بستن") }
          if (selected != null) {
            Button(onClick = { onPick(null) }, modifier = Modifier.weight(1f)) { Text("بدون قرض‌دار") }
          }
        }
      }
    }
  }
}
