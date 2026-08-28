package ir.vil3ntec.tohid.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ir.vil3ntec.tohid.data.Product
import ir.vil3ntec.tohid.data.ShopData
import ir.vil3ntec.tohid.data.ShopStore
import ir.vil3ntec.tohid.data.WarehouseEngine
import ir.vil3ntec.tohid.formatDate
import ir.vil3ntec.tohid.money
import ir.vil3ntec.tohid.plain
import ir.vil3ntec.tohid.qty
import ir.vil3ntec.tohid.toFaDigits
import ir.vil3ntec.tohid.todayIso
import ir.vil3ntec.tohid.ui.theme.Radius
import ir.vil3ntec.tohid.ui.theme.Shop
import kotlinx.coroutines.launch

/**
 *  انبار.
 *
 *  فهرستِ کالاها با موجودیِ همان لحظه، ورودِ جنس، اصلاحِ موجودی و ثبتِ
 *  کالای تازه. موجودی هیچ‌جا ذخیره نمی‌شود؛ همیشه از «آنچه وارد شده منهای
 *  آنچه فروخته شده» حساب می‌شود — همان‌طور که نسخهٔ وب می‌کرد. عددی که
 *  جداگانه نگه داشته شود، بالاخره یک روز با واقعیت نمی‌خواند.
 */
@Composable
fun WarehouseScreen(
  store: ShopStore,
  d: ShopData,
  snackbar: SnackbarHostState,
  openProductId: String? = null,
  newBarcode: String? = null,
  onConsumed: () -> Unit = {},
) {
  val scope = rememberCoroutineScope()

  var search by rememberSaveable { mutableStateOf("") }
  var category by rememberSaveable { mutableStateOf<String?>(null) }
  var expanded by rememberSaveable { mutableStateOf<String?>(null) }

  var productForm by remember { mutableStateOf<ProductFormState?>(null) }
  var entryFor by remember { mutableStateOf<String?>(null) }
  var adjustFor by remember { mutableStateOf<String?>(null) }
  var confirmDelete by remember { mutableStateOf<Product?>(null) }
  var movementsFor by remember { mutableStateOf<Product?>(null) }

  fun toast(text: String) {
    scope.launch { snackbar.showSnackbar(text) }
  }

  /** یک نتیجه را می‌نویسد یا دلیلِ ردش را می‌گوید */
  fun apply(result: WarehouseEngine.Result, done: String, after: () -> Unit = {}) {
    when (result) {
      is WarehouseEngine.Result.Failed -> toast(result.message)
      is WarehouseEngine.Result.Ok -> {
        scope.launch { store.save(result.data) }
        toast(done)
        after()
      }
    }
  }

  // بارکدِ ناشناسی که در صفحهٔ فروش خوانده شد، همین‌جا کالای تازه می‌شود
  LaunchedEffect(newBarcode) {
    if (!newBarcode.isNullOrBlank()) {
      productForm = ProductFormState(barcode = newBarcode)
      onConsumed()
    }
  }
  LaunchedEffect(openProductId) {
    if (openProductId != null) {
      expanded = openProductId
      onConsumed()
    }
  }

  val shown = d.products.filter { p ->
    (category == null || p.category == category) &&
      (search.isBlank() || p.name.contains(search.trim(), ignoreCase = true) ||
        p.barcodes.any { it.contains(search.trim()) })
  }
  val summary = WarehouseEngine.summary(d)

  Box(Modifier.fillMaxSize()) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 96.dp)) {
      item {
        Text("انبار", style = MaterialTheme.typography.headlineMedium, color = Shop.colors.text)
        Text(
          "موجودی کالاهای فروشگاه",
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
        Spacer(Modifier.height(14.dp))
      }

      /* ------------------------- خلاصه ------------------------- */
      item {
        Row(
          Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
          horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
          Chip("قلم کالا", plain(summary.products))
          Chip("کارتن", qty(summary.cartons))
          Chip("واحد", qty(summary.units))
          Chip("ارزش تقریبی", "${money(summary.value)} افغانی")
        }
        Spacer(Modifier.height(10.dp))
        if (summary.low > 0 || summary.out > 0) {
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (summary.out > 0) StatusPill("${plain(summary.out)} تمام‌شده", Shop.colors.danger, Shop.colors.dangerTint)
            if (summary.low > 0) StatusPill("${plain(summary.low)} موجودی کم", Shop.colors.warning, Shop.colors.warningTint)
          }
          Spacer(Modifier.height(10.dp))
        }
      }

      /* ------------------------- جستجو و فیلتر ------------------------- */
      item {
        OutlinedTextField(
          value = search,
          onValueChange = { search = it },
          placeholder = { Text("جستجوی کالا یا بارکد…") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth(),
        )
        if (d.productCategories.isNotEmpty()) {
          Spacer(Modifier.height(8.dp))
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
        Spacer(Modifier.height(14.dp))
      }

      /* ------------------------- فهرستِ کالاها ------------------------- */
      if (d.products.isEmpty()) {
        item {
          Panel {
            EmptyNote("هنوز اطلاعاتی ثبت نشده.\nکالاهای انبار فروشگاه پس از ثبت، در همین صفحه نمایش داده می‌شوند.")
            Button(onClick = { productForm = ProductFormState() }, modifier = Modifier.fillMaxWidth()) {
              Text("ثبت کالای تازه")
            }
          }
        }
      } else if (shown.isEmpty()) {
        item { Panel { EmptyNote("کالایی مطابق با این جستجو یا فیلتر پیدا نشد.") } }
      } else {
        items(shown, key = { it.id }) { p ->
          ProductRow(
            d = d,
            product = p,
            open = expanded == p.id,
            onClick = { expanded = if (expanded == p.id) null else p.id },
            onEdit = { productForm = ProductFormState.of(p) },
            onEntry = { entryFor = p.id },
            onAdjust = { adjustFor = p.id },
            onDelete = { confirmDelete = p },
            onMovements = { movementsFor = p },
          )
          Spacer(Modifier.height(8.dp))
        }
      }
    }

    ExtendedFloatingActionButton(
      onClick = { productForm = ProductFormState() },
      containerColor = Shop.colors.primary,
      contentColor = Color.White,
      modifier = Modifier.align(Alignment.BottomStart).padding(16.dp),
      icon = { Icon(Icons.Filled.Add, contentDescription = null) },
      text = { Text("کالای تازه") },
    )
  }

  /* ---------------------------- پنجره‌ها ---------------------------- */

  productForm?.let { form ->
    ProductDialog(
      d = d,
      state = form,
      onDismiss = { productForm = null },
      onSave = { draft ->
        val result = if (form.editingId == null) {
          WarehouseEngine.addProduct(d, draft, System.currentTimeMillis(), ::newId)
        } else {
          WarehouseEngine.editProduct(d, form.editingId, draft, todayIso(), System.currentTimeMillis(), ::newId)
        }
        apply(result, if (form.editingId == null) "کالا ثبت شد" else "با موفقیت ویرایش شد") {
          productForm = null
          // کالای تازه بدونِ ورودِ انبار موجودی ندارد؛ همان‌جا پیشنهاد می‌شود
          if (form.editingId == null) entryFor = (result as WarehouseEngine.Result.Ok).id
        }
      },
    )
  }

  entryFor?.let { productId ->
    EntryDialog(
      d = d,
      productId = productId,
      onDismiss = { entryFor = null },
      onSave = { draft ->
        apply(
          WarehouseEngine.addEntry(d, draft, todayIso(), System.currentTimeMillis(), ::newId),
          "ورود کالا ثبت شد",
        ) { entryFor = null }
      },
    )
  }

  adjustFor?.let { productId ->
    AdjustDialog(
      d = d,
      productId = productId,
      onDismiss = { adjustFor = null },
      onSave = { quantity, increase, reason, kind ->
        apply(
          WarehouseEngine.adjustStock(
            d, productId, quantity, increase, reason, kind,
            todayIso(), System.currentTimeMillis(), ::newId,
          ),
          "با موفقیت ثبت شد",
        ) { adjustFor = null }
      },
    )
  }

  confirmDelete?.let { p ->
    AlertDialog(
      onDismissRequest = { confirmDelete = null },
      containerColor = Shop.colors.surface,
      title = { Text("حذف محصول؟", color = Shop.colors.text) },
      text = {
        Text(
          WarehouseEngine.deleteWarning(d, p.id),
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
      },
      confirmButton = {
        TextButton(onClick = {
          apply(
            WarehouseEngine.deleteProduct(d, p.id, todayIso(), System.currentTimeMillis(), ::newId),
            "با موفقیت حذف شد",
          ) { confirmDelete = null; expanded = null }
        }) { Text("حذف", color = Shop.colors.danger) }
      },
      dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("انصراف") } },
    )
  }

  movementsFor?.let { p ->
    MovementsDialog(d = d, product = p, onDismiss = { movementsFor = null })
  }
}

/* ============================ تکه‌های رابط ============================ */

@Composable
private fun Chip(label: String, value: String) {
  Column(
    Modifier
      .clip(RoundedCornerShape(Radius.sm))
      .background(Shop.colors.surface)
      .border(1.dp, Shop.colors.border, RoundedCornerShape(Radius.sm))
      .padding(horizontal = 14.dp, vertical = 10.dp)
  ) {
    Text(label, style = MaterialTheme.typography.labelSmall, color = Shop.colors.muted)
    Spacer(Modifier.height(3.dp))
    Text(value, style = MaterialTheme.typography.titleSmall, color = Shop.colors.text)
  }
}

@Composable
private fun StatusPill(text: String, tint: Color, background: Color) {
  Box(
    Modifier
      .clip(RoundedCornerShape(999.dp))
      .background(background)
      .padding(horizontal = 12.dp, vertical = 6.dp)
  ) {
    Text(text, style = MaterialTheme.typography.labelSmall, color = tint)
  }
}

@Composable
private fun ProductRow(
  d: ShopData,
  product: Product,
  open: Boolean,
  onClick: () -> Unit,
  onEdit: () -> Unit,
  onEntry: () -> Unit,
  onAdjust: () -> Unit,
  onDelete: () -> Unit,
  onMovements: () -> Unit,
) {
  val stock = ShopStore.stock(d, product.id)
  val status = ShopStore.stockStatus(d, product)
  val tint = when (status) {
    "out" -> Shop.colors.danger
    "low" -> Shop.colors.warning
    else -> Shop.colors.success
  }
  val label = when (status) {
    "out" -> "تمام‌شده"
    "low" -> "موجودی کم"
    else -> "موجودی کافی"
  }

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
        Text(product.name, style = MaterialTheme.typography.titleSmall, color = Shop.colors.text)
        Spacer(Modifier.height(3.dp))
        Text(
          buildString {
            append("${money(product.salePrice)} افغانی")
            if (product.category.isNotBlank()) append(" — ${product.category}")
          },
          style = MaterialTheme.typography.labelSmall,
          color = Shop.colors.muted,
        )
      }
      Column(horizontalAlignment = Alignment.End) {
        Text(
          "${qty(stock)}${if (product.unit.isNotBlank()) " ${product.unit}" else ""}",
          style = MaterialTheme.typography.titleSmall,
          color = tint,
          fontWeight = FontWeight.Bold,
        )
        Text(label, style = MaterialTheme.typography.labelSmall, color = tint)
      }
    }

    AnimatedVisibility(visible = open) {
      Column(Modifier.padding(top = 12.dp)) {
        DetailRow("قیمت خرید", "${money(product.purchasePrice)} افغانی")
        DetailRow("حد کم بودن", qty(product.minStock))
        if (product.barcodes.isNotEmpty()) {
          DetailRow("بارکد", product.barcodes.joinToString("، ") { it.toFaDigits() })
        }

        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          Button(onClick = onEntry, modifier = Modifier.weight(1f)) { Text("ورود کالا") }
          OutlinedButton(onClick = onAdjust) { Icon(Icons.Filled.Tune, contentDescription = "اصلاح موجودی") }
          OutlinedButton(onClick = onEdit) { Icon(Icons.Filled.Edit, contentDescription = "ویرایش") }
          OutlinedButton(
            onClick = onDelete,
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Shop.colors.danger),
          ) { Icon(Icons.Filled.DeleteOutline, contentDescription = "حذف") }
        }
        Spacer(Modifier.height(4.dp))
        TextButton(onClick = onMovements) { Text("حرکات انبار", color = Shop.colors.primary) }
      }
    }
  }
}

@Composable
private fun DetailRow(label: String, value: String) {
  Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.SpaceBetween) {
    Text(label, style = MaterialTheme.typography.bodySmall, color = Shop.colors.muted)
    Text(value, style = MaterialTheme.typography.bodySmall, color = Shop.colors.text)
  }
}

/** حرکاتِ یک کالا — چه وارد شده، چه فروخته، چه اصلاح */
@Composable
private fun MovementsDialog(d: ShopData, product: Product, onDismiss: () -> Unit) {
  val moves = d.stockMovements.filter { it.productId == product.id }.sortedByDescending { it.createdAt }

  androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
    Surface(color = Shop.colors.surface, shape = RoundedCornerShape(Radius.lg), modifier = Modifier.fillMaxWidth()) {
      Column(Modifier.padding(16.dp).heightIn(max = 520.dp)) {
        Text("حرکات انبار — ${product.name}", style = MaterialTheme.typography.titleMedium, color = Shop.colors.text)
        Spacer(Modifier.height(12.dp))

        if (moves.isEmpty()) {
          EmptyNote("هنوز حرکتی برای این کالا ثبت نشده")
        } else {
          LazyColumn(Modifier.weight(1f, fill = false)) {
            items(moves, key = { it.id }) { m ->
              val positive = m.qty >= 0
              Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                  Text(movementLabel(m.type), style = MaterialTheme.typography.bodyMedium, color = Shop.colors.text)
                  Text(
                    "${formatDate(m.date)}${if (m.notes.isNotBlank()) " — ${m.notes}" else ""}",
                    style = MaterialTheme.typography.labelSmall,
                    color = Shop.colors.muted,
                  )
                }
                Text(
                  "${if (positive) "+" else "−"}${qty(kotlin.math.abs(m.qty))}",
                  style = MaterialTheme.typography.titleSmall,
                  color = if (positive) Shop.colors.success else Shop.colors.danger,
                )
              }
              HorizontalDivider(color = Shop.colors.border)
            }
          }
        }

        Spacer(Modifier.height(12.dp))
        Button(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) { Text("بستن") }
      }
    }
  }
}

/** همان برچسب‌های STOCK_MOVEMENT_LABELS نسخهٔ وب */
private fun movementLabel(type: String): String = when (type) {
  "purchase_in" -> "ورود خرید"
  "sale" -> "فروش"
  "customer_return" -> "مرجوعی مشتری"
  "supplier_return" -> "برگشت به تأمین‌کننده"
  "adjustment" -> "اصلاح موجودی"
  else -> type
}
