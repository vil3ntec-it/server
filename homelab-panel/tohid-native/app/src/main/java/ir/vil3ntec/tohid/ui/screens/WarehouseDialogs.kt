package ir.vil3ntec.tohid.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import ir.vil3ntec.tohid.data.Product
import ir.vil3ntec.tohid.data.ShopData
import ir.vil3ntec.tohid.data.WarehouseEngine
import ir.vil3ntec.tohid.money
import ir.vil3ntec.tohid.qty
import ir.vil3ntec.tohid.ui.theme.Radius
import ir.vil3ntec.tohid.ui.theme.Shop

/**
 *  فرم‌های انبار.
 *
 *  عددها همان‌جا که تایپ می‌شوند سنجیده نمی‌شوند — سنجش کارِ
 *  `WarehouseEngine` است. اینجا فقط جمع‌آوری می‌شود و دلیلِ رد شدن به
 *  کاربر نشان داده می‌شود؛ پس هرگز دو جای متفاوت دو قاعدهٔ متفاوت ندارند.
 */

/* ============================ فرمِ کالا ============================ */

data class ProductFormState(
  val editingId: String? = null,
  val name: String = "",
  val category: String = "",
  val unit: String = "",
  val purchase: String = "",
  val sale: String = "",
  val minStock: String = "",
  val barcode: String = "",
) {
  companion object {
    fun of(p: Product) = ProductFormState(
      editingId = p.id,
      name = p.name,
      category = p.category,
      unit = p.unit,
      purchase = numberText(p.purchasePrice),
      sale = numberText(p.salePrice),
      minStock = if (p.minStock == 0.0) "" else numberText(p.minStock),
      barcode = p.barcodes.firstOrNull().orEmpty(),
    )

    /** عدد را برای کادرِ ورودی می‌نویسد: بدونِ اعشارِ بی‌مورد و با رقمِ لاتین */
    private fun numberText(value: Double): String =
      if (value == Math.floor(value) && !value.isInfinite()) value.toLong().toString() else value.toString()
  }
}

@Composable
fun ProductDialog(
  d: ShopData,
  state: ProductFormState,
  onDismiss: () -> Unit,
  onSave: (WarehouseEngine.ProductDraft) -> Unit,
) {
  var form by remember(state.editingId, state.barcode) { mutableStateOf(state) }

  Dialog(onDismissRequest = onDismiss) {
    Surface(color = Shop.colors.surface, shape = RoundedCornerShape(Radius.lg), modifier = Modifier.fillMaxWidth()) {
      Column(Modifier.padding(18.dp).verticalScroll(rememberScrollState())) {
        Text(
          if (form.editingId == null) "کالای تازه" else "ویرایش محصول",
          style = MaterialTheme.typography.titleMedium,
          color = Shop.colors.text,
        )
        Spacer(Modifier.height(14.dp))

        OutlinedTextField(
          value = form.name,
          onValueChange = { form = form.copy(name = it) },
          label = { Text("نام کالا") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          NumberField(
            value = form.purchase,
            onValueChange = { form = form.copy(purchase = it) },
            label = "قیمت خرید",
            modifier = Modifier.weight(1f),
          )
          NumberField(
            value = form.sale,
            onValueChange = { form = form.copy(sale = it) },
            label = "قیمت فروش",
            modifier = Modifier.weight(1f),
          )
        }

        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          NumberField(
            value = form.minStock,
            onValueChange = { form = form.copy(minStock = it) },
            label = "حد کم بودن",
            modifier = Modifier.weight(1f),
          )
          OutlinedTextField(
            value = form.barcode,
            onValueChange = { form = form.copy(barcode = it) },
            label = { Text("بارکد") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.weight(1f),
          )
        }

        Spacer(Modifier.height(14.dp))
        Picker(
          title = "واحد",
          options = d.productUnits,
          selected = form.unit,
          onSelect = { form = form.copy(unit = it) },
          placeholder = "واحد تازه",
        )

        Spacer(Modifier.height(14.dp))
        Picker(
          title = "دسته‌بندی",
          options = d.productCategories,
          selected = form.category,
          onSelect = { form = form.copy(category = it) },
          placeholder = "دسته‌بندی تازه",
        )

        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("انصراف") }
          Button(
            onClick = {
              onSave(
                WarehouseEngine.ProductDraft(
                  name = form.name,
                  category = form.category,
                  unit = form.unit,
                  purchasePrice = form.purchase.toDoubleOrNull() ?: 0.0,
                  salePrice = form.sale.toDoubleOrNull() ?: -1.0,
                  minStock = form.minStock.toDoubleOrNull() ?: 0.0,
                  barcode = form.barcode,
                )
              )
            },
            modifier = Modifier.weight(1f),
          ) { Text(if (form.editingId == null) "ثبت" else "ذخیره تغییرات") }
        }
      }
    }
  }
}

/* ========================= فرمِ ورودِ کالا ========================= */

@Composable
fun EntryDialog(
  d: ShopData,
  productId: String,
  onDismiss: () -> Unit,
  onSave: (WarehouseEngine.EntryDraft) -> Unit,
) {
  val product = d.products.find { it.id == productId }
  var cartons by remember { mutableStateOf("") }
  var perCarton by remember { mutableStateOf("") }
  var units by remember { mutableStateOf("") }
  var price by remember { mutableStateOf(product?.purchasePrice?.takeIf { it > 0 }?.toLong()?.toString() ?: "") }
  var notes by remember { mutableStateOf("") }
  var unit by remember { mutableStateOf(product?.unit.orEmpty()) }

  /*
   * «۴ کارتن × ۲۵ تا» یعنی ۱۰۰ واحد. حساب کردنش دستِ خودِ برنامه است تا
   * کسی وسطِ تحویلِ جنس ضرب نکند و اشتباه ننویسد — ولی عدد قابلِ عوض
   * کردن می‌ماند، چون کارتنِ ناقص هم پیش می‌آید.
   */
  val computed = (cartons.toDoubleOrNull() ?: 0.0) * (perCarton.toDoubleOrNull() ?: 0.0)
  LaunchedEffect(cartons, perCarton) {
    if (computed > 0) units = if (computed == Math.floor(computed)) computed.toLong().toString() else computed.toString()
  }

  Dialog(onDismissRequest = onDismiss) {
    Surface(color = Shop.colors.surface, shape = RoundedCornerShape(Radius.lg), modifier = Modifier.fillMaxWidth()) {
      Column(Modifier.padding(18.dp).verticalScroll(rememberScrollState())) {
        Text("ثبت ورود کالا", style = MaterialTheme.typography.titleMedium, color = Shop.colors.text)
        if (product != null) {
          Spacer(Modifier.height(4.dp))
          Text(product.name, style = MaterialTheme.typography.bodySmall, color = Shop.colors.muted)
        }

        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          NumberField(cartons, { cartons = it }, "تعداد کارتن", Modifier.weight(1f))
          NumberField(perCarton, { perCarton = it }, "در هر کارتن", Modifier.weight(1f))
        }

        if (computed > 0) {
          Spacer(Modifier.height(6.dp))
          Text(
            "${qty(computed)}${if (unit.isNotBlank()) " $unit" else ""} می‌شود",
            style = MaterialTheme.typography.labelSmall,
            color = Shop.colors.primary,
          )
        }

        Spacer(Modifier.height(10.dp))
        NumberField(units, { units = it }, "تعداد واحد", Modifier.fillMaxWidth())

        Spacer(Modifier.height(10.dp))
        NumberField(price, { price = it }, "قیمت خرید (هر واحد)", Modifier.fillMaxWidth())

        if (units.toDoubleOrNull() != null && price.toDoubleOrNull() != null) {
          Spacer(Modifier.height(6.dp))
          Text(
            "جمع: ${money(units.toDouble() * price.toDouble())} افغانی",
            style = MaterialTheme.typography.labelSmall,
            color = Shop.colors.muted,
          )
        }

        Spacer(Modifier.height(14.dp))
        Picker(
          title = "واحد اندازه‌گیری",
          options = d.productUnits,
          selected = unit,
          onSelect = { unit = it },
          placeholder = "واحد تازه",
        )

        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
          value = notes,
          onValueChange = { notes = it },
          label = { Text("توضیحات (اختیاری)") },
          modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("انصراف") }
          Button(
            onClick = {
              onSave(
                WarehouseEngine.EntryDraft(
                  productId = productId,
                  cartons = cartons.toDoubleOrNull() ?: 0.0,
                  perCarton = perCarton.toDoubleOrNull() ?: 0.0,
                  units = units.toDoubleOrNull() ?: 0.0,
                  unit = unit,
                  price = price.toDoubleOrNull() ?: -1.0,
                  notes = notes.trim(),
                )
              )
            },
            modifier = Modifier.weight(1f),
          ) { Text("ذخیره") }
        }
      }
    }
  }
}

/* ======================== اصلاحِ موجودی ======================== */

@Composable
fun AdjustDialog(
  d: ShopData,
  productId: String,
  onDismiss: () -> Unit,
  onSave: (Double, Boolean, String, WarehouseEngine.AdjustKind) -> Unit,
) {
  val product = d.products.find { it.id == productId }
  var kind by remember { mutableStateOf(WarehouseEngine.AdjustKind.ADJUSTMENT) }
  var increase by remember { mutableStateOf(true) }
  var amount by remember { mutableStateOf("") }
  var reason by remember { mutableStateOf("") }

  Dialog(onDismissRequest = onDismiss) {
    Surface(color = Shop.colors.surface, shape = RoundedCornerShape(Radius.lg), modifier = Modifier.fillMaxWidth()) {
      Column(Modifier.padding(18.dp).verticalScroll(rememberScrollState())) {
        Text(
          if (kind == WarehouseEngine.AdjustKind.SUPPLIER_RETURN) "برگشت به تأمین‌کننده" else "اصلاح موجودی",
          style = MaterialTheme.typography.titleMedium,
          color = Shop.colors.text,
        )
        if (product != null) {
          Spacer(Modifier.height(4.dp))
          Text(product.name, style = MaterialTheme.typography.bodySmall, color = Shop.colors.muted)
        }

        Spacer(Modifier.height(14.dp))
        Segment(
          options = listOf(
            "اصلاح موجودی" to WarehouseEngine.AdjustKind.ADJUSTMENT,
            "برگشت به تأمین‌کننده" to WarehouseEngine.AdjustKind.SUPPLIER_RETURN,
          ),
          selected = kind,
          onSelect = { kind = it },
        )

        Spacer(Modifier.height(12.dp))
        Segment(
          options = listOf("زیاد شد" to true, "کم شد" to false),
          selected = increase,
          onSelect = { increase = it },
        )

        Spacer(Modifier.height(12.dp))
        NumberField(amount, { amount = it }, "مقدار", Modifier.fillMaxWidth())

        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
          value = reason,
          onValueChange = { reason = it },
          label = { Text("دلیل") },
          supportingText = {
            Text("بدون دلیل، فردا معلوم نمی‌شود جنس کجا رفته.", style = MaterialTheme.typography.labelSmall)
          },
          modifier = Modifier.fillMaxWidth(),
        )

        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("انصراف") }
          Button(
            onClick = { onSave(amount.toDoubleOrNull() ?: 0.0, increase, reason, kind) },
            modifier = Modifier.weight(1f),
          ) { Text("ثبت") }
        }
      }
    }
  }
}

/* ============================ ریزه‌کاری ============================ */

/**
 * کادرِ عدد.
 *
 * صفحه‌کلیدِ عددی باز می‌شود و فقط رقم و نقطه پذیرفته می‌شود — رقمِ فارسی
 * هم به لاتین برمی‌گردد، چون بعضی صفحه‌کلیدها فارسی می‌فرستند و
 * `toDouble` آن را نمی‌شناسد.
 */
@Composable
private fun NumberField(
  value: String,
  onValueChange: (String) -> Unit,
  label: String,
  modifier: Modifier = Modifier,
) {
  OutlinedTextField(
    value = value,
    onValueChange = { raw -> onValueChange(latinDigits(raw).filter { it.isDigit() || it == '.' }) },
    label = { Text(label) },
    singleLine = true,
    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
    modifier = modifier,
  )
}

private fun latinDigits(text: String): String = text.map { c ->
  when (c) {
    in '۰'..'۹' -> '0' + (c - '۰')
    in '٠'..'٩' -> '0' + (c - '٠')
    '٫', '٬' -> '.'
    else -> c
  }
}.joinToString("")

/** انتخاب از فهرست، با امکانِ نوشتنِ مقدارِ تازه */
@Composable
private fun Picker(
  title: String,
  options: List<String>,
  selected: String,
  onSelect: (String) -> Unit,
  placeholder: String,
) {
  var adding by remember { mutableStateOf(false) }
  var fresh by remember { mutableStateOf("") }

  Text(title, style = MaterialTheme.typography.labelMedium, color = Shop.colors.muted)
  Spacer(Modifier.height(6.dp))

  Row(
    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
    horizontalArrangement = Arrangement.spacedBy(6.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    // مقدارِ فعلی ممکن است در فهرست نباشد (از نسخهٔ قبلی آمده)
    val all = if (selected.isNotBlank() && !options.contains(selected)) options + selected else options
    all.forEach { option ->
      FilterChip(
        selected = selected == option,
        onClick = { onSelect(if (selected == option) "" else option) },
        label = { Text(option) },
      )
    }
    AssistChip(onClick = { adding = !adding }, label = { Text("+ تازه") })
  }

  if (adding) {
    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      OutlinedTextField(
        value = fresh,
        onValueChange = { fresh = it },
        placeholder = { Text(placeholder) },
        singleLine = true,
        modifier = Modifier.weight(1f),
      )
      Button(onClick = {
        val v = fresh.trim()
        if (v.isNotEmpty()) {
          onSelect(v)
          fresh = ""
          adding = false
        }
      }) { Text("افزودن") }
    }
  }
}

@Composable
private fun <T> Segment(options: List<Pair<String, T>>, selected: T, onSelect: (T) -> Unit) {
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
          style = MaterialTheme.typography.labelMedium,
          color = if (active) Color.White else Shop.colors.muted,
        )
      }
    }
  }
}
