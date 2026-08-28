package ir.vil3ntec.tohid.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import ir.vil3ntec.tohid.data.CartStore
import ir.vil3ntec.tohid.data.SalesEngine
import ir.vil3ntec.tohid.data.ShopData
import ir.vil3ntec.tohid.data.ShopStore
import ir.vil3ntec.tohid.money
import ir.vil3ntec.tohid.qty
import ir.vil3ntec.tohid.scan.CameraScanner
import ir.vil3ntec.tohid.scan.ScanFeedback
import ir.vil3ntec.tohid.scan.ScanGate
import ir.vil3ntec.tohid.ui.theme.Radius
import ir.vil3ntec.tohid.ui.theme.Shop
import kotlinx.coroutines.launch

/**
 *  فروش (صندوق).
 *
 *  همان چیدمانِ نسخهٔ وب: دوربینِ بالا، سبد پایین، و ثبت با پنجرهٔ تسویه.
 *  سه چیزی که کاربر گزارش کرده بود اینجا درست است:
 *    • دوربین با ورود به این صفحه خودش روشن می‌شود.
 *    • بعد از یک اسکن نمی‌ایستد (فریم‌ها همیشه بسته می‌شوند).
 *    • وقتی دوربین خاموش است، عکسِ بی‌ربط نشان داده نمی‌شود؛ فقط یک
 *      کادرِ ساده با دکمهٔ روشن‌کردن.
 */
@Composable
fun SaleScreen(
  store: ShopStore,
  cartStore: CartStore,
  d: ShopData,
  snackbar: SnackbarHostState,
  onRegisterBarcode: (String) -> Unit,
) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()

  val cart by cartStore.lines.collectAsState()
  val cartDebtorId by cartStore.debtorId.collectAsState()

  // کالای حذف‌شده نباید در سبد بماند
  LaunchedEffect(d.products.size, d.debtors.size) { cartStore.prune(d) }

  var cameraOn by rememberSaveable { mutableStateOf(true) }
  var granted by remember {
    mutableStateOf(
      ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    )
  }
  var status by remember { mutableStateOf("در حال آماده‌سازی دوربین…") }
  var statusError by remember { mutableStateOf(false) }

  val askCamera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
    granted = ok
    if (!ok) {
      status = "اجازهٔ دوربین داده نشد — از تنظیمات گوشی اجازه دهید"
      statusError = true
    }
  }

  // دوربین با باز شدنِ صفحه خودش روشن می‌شود؛ همان چیزی که خواسته شده بود
  LaunchedEffect(Unit) {
    if (!granted) askCamera.launch(Manifest.permission.CAMERA)
  }

  var multiplier by rememberSaveable { mutableStateOf(1) }
  var manual by rememberSaveable { mutableStateOf("") }
  var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
  var picker by rememberSaveable { mutableStateOf(false) }
  var pickDebtor by rememberSaveable { mutableStateOf(false) }
  var checkout by rememberSaveable { mutableStateOf(false) }
  // عکسِ لحظهٔ ثبت نگه داشته می‌شود، نه فقط شناسه: فاکتور باید همان
  // چیزی را نشان دهد که ثبت شد، حتی اگر همان لحظه چیز دیگری عوض شود
  var invoice by remember { mutableStateOf<Pair<ShopData, String>?>(null) }

  val gate = remember { ScanGate() }
  val index = remember(d.products) { ShopStore.barcodeIndex(d) }

  fun toast(text: String) {
    scope.launch { snackbar.showSnackbar(text) }
  }

  /** یک بارکد — چه از دوربین، چه دستی، چه از بارکدخوانِ سخت‌افزاری */
  fun onBarcode(raw: String, skipDedup: Boolean = false) {
    val code = raw.trim()
    if (code.isEmpty()) return
    if (!skipDedup && !gate.accept(code)) return

    val productId = index[code]
    if (productId == null) {
      ScanFeedback.unknown(context)
      // بارکد گم نمی‌شود: هم در کادرِ دستی می‌ماند، هم می‌شود همان‌جا
      // کالای تازه‌اش را ثبت کرد و برگشت
      manual = code
      scope.launch {
        val answer = snackbar.showSnackbar(
          message = "بارکد ناشناس — این کالا هنوز ثبت نشده است",
          actionLabel = "ثبت کالا",
          duration = SnackbarDuration.Long,
        )
        if (answer == SnackbarResult.ActionPerformed) onRegisterBarcode(code)
      }
      return
    }
    val product = d.products.first { it.id == productId }
    ScanFeedback.ok(context)
    // از خودِ انبارهٔ سبد خوانده می‌شود، نه از مقدارِ لحظهٔ ترکیب: دو
    // اسکنِ پشتِ سرِ هم نباید همدیگر را پاک کنند
    cartStore.set(SalesEngine.addToCart(cartStore.lines.value, productId, multiplier.toDouble()))
    selectedId = productId
    toast("${product.name} به سبد اضافه شد")
  }

  Box(Modifier.fillMaxSize()) {
    LazyColumn(
      Modifier.fillMaxSize(),
      contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, if (cart.isEmpty()) 24.dp else 200.dp),
    ) {
      item {
        Row(
          Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.SpaceBetween,
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Column(Modifier.weight(1f)) {
            Text("فروش جدید", style = MaterialTheme.typography.headlineMedium, color = Shop.colors.text)
            Text(
              "کالا را جلوی دوربین بگیرید تا خودکار به سبد اضافه شود",
              style = MaterialTheme.typography.bodySmall,
              color = Shop.colors.muted,
            )
          }
          TextButton(onClick = {
            if (cameraOn) {
              cameraOn = false
              status = "دوربین متوقف شد"
              statusError = false
            } else {
              cameraOn = true
              gate.reset()
              if (!granted) askCamera.launch(Manifest.permission.CAMERA)
            }
          }) {
            Text(if (cameraOn) "توقف دوربین" else "شروع دوربین", color = Shop.colors.primary)
          }
        }
        Spacer(Modifier.height(12.dp))
      }

      /* --------------------------- دوربین --------------------------- */
      item {
        Panel {
          ScannerFrame(
            on = cameraOn && granted,
            status = status,
            error = statusError,
            onGrant = { askCamera.launch(Manifest.permission.CAMERA) },
            granted = granted,
            onStart = { cameraOn = true },
            scanner = {
              CameraScanner(
                onCode = { onBarcode(it) },
                onStatus = { text, isError -> status = text; statusError = isError },
                modifier = Modifier.fillMaxSize(),
              )
            },
          )

          Spacer(Modifier.height(12.dp))

          Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
              value = manual,
              onValueChange = { manual = it },
              placeholder = { Text("یا بارکد را دستی وارد کنید") },
              singleLine = true,
              keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Search),
              modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Button(
              onClick = {
                val code = manual.trim()
                if (code.isNotEmpty()) {
                  onBarcode(code, skipDedup = true)
                  if (index.containsKey(code)) manual = ""
                }
              },
            ) { Text("جستجو") }
          }

          Spacer(Modifier.height(12.dp))

          Row(verticalAlignment = Alignment.CenterVertically) {
            Text("هر اسکن:", style = MaterialTheme.typography.labelMedium, color = Shop.colors.muted)
            Spacer(Modifier.width(10.dp))
            listOf(1, 2, 5, 10).forEach { m ->
              MultiplierChip(m, m == multiplier) { multiplier = m }
              Spacer(Modifier.width(6.dp))
            }
          }
        }
        Spacer(Modifier.height(16.dp))
      }

      /* ---------------------------- سبد ---------------------------- */
      item {
        Row(
          Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.SpaceBetween,
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Text("سبد خرید", style = MaterialTheme.typography.titleMedium, color = Shop.colors.text)
          TextButton(onClick = { picker = true }) {
            Icon(Icons.Filled.GridView, contentDescription = null, tint = Shop.colors.primary)
            Spacer(Modifier.width(6.dp))
            Text("انتخاب محصول", color = Shop.colors.primary)
          }
        }
        Spacer(Modifier.height(8.dp))
      }

      if (cart.isEmpty()) {
        item {
          Panel {
            EmptyNote("سبد خرید خالی است.\nبا اسکن اولین کالا، سبد خرید اینجا نمایش داده می‌شود.")
          }
        }
      } else {
        items(cart, key = { it.productId }) { line ->
          val product = d.products.find { it.id == line.productId }
          if (product != null) {
            CartRow(
              name = product.name,
              unit = product.unit,
              quantity = line.quantity,
              lineTotal = product.salePrice * line.quantity,
              unitPrice = product.salePrice,
              selected = selectedId == line.productId,
              onClick = { selectedId = if (selectedId == line.productId) null else line.productId },
              onPlus = {
                cartStore.set(
                  SalesEngine.setCartQty(cart, line.productId, line.quantity + SalesEngine.cartStep(product.unit))
                )
              },
              onMinus = {
                cartStore.set(
                  SalesEngine.setCartQty(cart, line.productId, line.quantity - SalesEngine.cartStep(product.unit))
                )
              },
              onRemove = {
                cartStore.set(SalesEngine.setCartQty(cart, line.productId, 0.0))
                if (selectedId == line.productId) selectedId = null
              },
            )
            Spacer(Modifier.height(8.dp))
          }
        }
      }
    }

    /* ------------------------ نوارِ پایینِ سبد ------------------------ */
    AnimatedVisibility(
      visible = cart.isNotEmpty(),
      enter = slideInVertically(tween(220)) { it } + fadeIn(tween(220)),
      exit = slideOutVertically(tween(180)) { it } + fadeOut(tween(180)),
      modifier = Modifier.align(Alignment.BottomCenter),
    ) {
      CartBar(
        total = SalesEngine.cartTotal(d, cart),
        debtorName = cartDebtorId?.let { id -> d.debtors.find { it.id == id }?.name },
        debtorNote = cartDebtorId?.let { id -> debtStateText(d, id) },
        onPickDebtor = { pickDebtor = true },
        onClearDebtor = { cartStore.setDebtor(null) },
        onFinalize = { checkout = true },
      )
    }
  }

  /* --------------------------- پنجره‌ها --------------------------- */

  if (picker) {
    ProductPicker(
      d = d,
      cart = cart,
      onClose = { picker = false },
      onAdd = { productId ->
        cartStore.set(SalesEngine.addToCart(cart, productId, 1.0))
        selectedId = productId
      },
      onSetQty = { productId, q -> cartStore.set(SalesEngine.setCartQty(cart, productId, q)) },
    )
  }

  if (pickDebtor) {
    DebtorPicker(
      d = d,
      selected = cartDebtorId,
      onClose = { pickDebtor = false },
      onPick = { id -> cartStore.setDebtor(id); pickDebtor = false },
    )
  }

  if (checkout) {
    CheckoutDialog(
      d = d,
      cart = cart,
      presetDebtorId = cartDebtorId,
      onDismiss = { checkout = false },
      onConfirm = { options ->
        when (val result = SalesEngine.record(
          d, cart, options,
          today = ir.vil3ntec.tohid.todayIso(),
          now = System.currentTimeMillis(),
          newId = ::newId,
        )) {
          is SalesEngine.Result.Failed -> toast(result.message)
          is SalesEngine.Result.Ok -> {
            scope.launch { store.save(result.data) }
            cartStore.clear()
            selectedId = null
            checkout = false
            ScanFeedback.ok(context)
            toast("فروش به مبلغ ${money(result.data.sales.last().finalTotal)} افغانی ثبت شد")
            invoice = result.data to result.saleId
          }
        }
      },
    )
  }

  invoice?.let { (snapshot, id) ->
    val sale = snapshot.sales.find { it.id == id }
    if (sale == null) invoice = null
    else InvoiceDialog(d = snapshot, sale = sale, onDismiss = { invoice = null }, onMessage = ::toast)
  }
}

/** شناسهٔ یکتا — همان شکلِ `uid()` نسخهٔ وب تا داده بینِ دو نسخه یکدست بماند */
fun newId(): String =
  "id" + java.lang.Long.toString(System.currentTimeMillis(), 36) +
    java.lang.Long.toString((Math.random() * 1_000_000_000).toLong(), 36).take(6)

/** حالِ حسابِ یک قرض‌دار، با همان جمله‌های نسخهٔ وب */
fun debtStateText(d: ShopData, debtorId: String): String {
  val amount = ShopStore.debt(d, debtorId)
  return when {
    amount > 0 -> "${money(amount)} افغانی بدهکار"
    amount < 0 -> "${money(-amount)} افغانی موجودی دارد"
    else -> "حساب صاف است"
  }
}

/* ============================ تکه‌های رابط ============================ */

/**
 *  کادرِ دوربین.
 *
 *  وقتی دوربین خاموش است هیچ تصویری اینجا نیست — فقط یک کادرِ هم‌رنگِ
 *  برنامه با یک دکمه. عکسِ پیش‌فرضی که قبلاً می‌آمد حذف شد.
 */
@Composable
private fun ScannerFrame(
  on: Boolean,
  status: String,
  error: Boolean,
  granted: Boolean,
  onGrant: () -> Unit,
  onStart: () -> Unit,
  scanner: @Composable () -> Unit,
) {
  Box(
    Modifier
      .fillMaxWidth()
      .height(240.dp)
      .clip(RoundedCornerShape(Radius.md))
      .background(if (on) Color.Black else Shop.colors.surface2)
      .border(1.dp, Shop.colors.border, RoundedCornerShape(Radius.md)),
    contentAlignment = Alignment.Center,
  ) {
    if (on) {
      scanner()
      // کادرِ راهنما، همان .scanner-guide
      Box(
        Modifier
          .fillMaxWidth(0.72f)
          .height(110.dp)
          .border(2.dp, Color.White.copy(alpha = 0.85f), RoundedCornerShape(Radius.sm))
      )
      Box(
        Modifier
          .align(Alignment.BottomCenter)
          .fillMaxWidth()
          .background(Color.Black.copy(alpha = 0.45f))
          .padding(horizontal = 12.dp, vertical = 8.dp),
      ) {
        Text(
          status,
          style = MaterialTheme.typography.labelMedium,
          color = if (error) Color(0xFFFFB4AE) else Color.White,
          textAlign = TextAlign.Center,
          modifier = Modifier.fillMaxWidth(),
        )
      }
    } else {
      Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(
          Icons.Filled.PhotoCamera,
          contentDescription = null,
          tint = Shop.colors.muted2,
          modifier = Modifier.size(34.dp),
        )
        Spacer(Modifier.height(8.dp))
        Text(
          if (granted) "دوربین خاموش است" else "برای اسکن، اجازهٔ دوربین لازم است",
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
        Spacer(Modifier.height(10.dp))
        Button(onClick = { if (granted) onStart() else onGrant() }) {
          Text(if (granted) "روشن کردن دوربین" else "اجازه دادن")
        }
      }
    }
  }
}

@Composable
private fun MultiplierChip(value: Int, active: Boolean, onClick: () -> Unit) {
  Box(
    Modifier
      .clip(RoundedCornerShape(Radius.sm))
      .background(if (active) Shop.colors.primary else Shop.colors.surface2)
      .border(1.dp, if (active) Shop.colors.primary else Shop.colors.border, RoundedCornerShape(Radius.sm))
      .clickable(onClick = onClick)
      .padding(horizontal = 14.dp, vertical = 8.dp),
  ) {
    Text(
      "×${ir.vil3ntec.tohid.plain(value)}",
      style = MaterialTheme.typography.labelLarge,
      color = if (active) Color.White else Shop.colors.text,
    )
  }
}

@Composable
private fun CartRow(
  name: String,
  unit: String,
  quantity: Double,
  unitPrice: Double,
  lineTotal: Double,
  selected: Boolean,
  onClick: () -> Unit,
  onPlus: () -> Unit,
  onMinus: () -> Unit,
  onRemove: () -> Unit,
) {
  Column(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(Radius.md))
      .background(Shop.colors.surface)
      .border(
        1.dp,
        if (selected) Shop.colors.primary else Shop.colors.border,
        RoundedCornerShape(Radius.md),
      )
      .clickable(onClick = onClick)
      .padding(14.dp),
  ) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(name, style = MaterialTheme.typography.titleSmall, color = Shop.colors.text)
        Spacer(Modifier.height(3.dp))
        Text(
          "${qty(quantity)}${if (unit.isNotBlank()) " $unit" else ""} × ${money(unitPrice)}",
          style = MaterialTheme.typography.bodySmall,
          color = Shop.colors.muted,
        )
      }
      Text(
        "${money(lineTotal)} افغانی",
        style = MaterialTheme.typography.titleSmall,
        color = Shop.colors.text,
      )
    }

    AnimatedVisibility(visible = selected) {
      Row(
        Modifier.fillMaxWidth().padding(top = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        OutlinedButton(onClick = onMinus, modifier = Modifier.weight(1f)) { Text("−") }
        OutlinedButton(onClick = onPlus, modifier = Modifier.weight(1f)) { Text("+") }
        OutlinedButton(
          onClick = onRemove,
          colors = ButtonDefaults.outlinedButtonColors(contentColor = Shop.colors.danger),
        ) {
          Icon(Icons.Filled.DeleteOutline, contentDescription = "حذف از سبد")
        }
      }
    }
  }
}

@Composable
private fun CartBar(
  total: Double,
  debtorName: String?,
  debtorNote: String?,
  onPickDebtor: () -> Unit,
  onClearDebtor: () -> Unit,
  onFinalize: () -> Unit,
) {
  Surface(
    color = Shop.colors.surface,
    tonalElevation = 0.dp,
    shadowElevation = 12.dp,
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(Modifier.padding(14.dp)) {
      Row(
        Modifier
          .fillMaxWidth()
          .clip(RoundedCornerShape(Radius.sm))
          .background(if (debtorName != null) Shop.colors.primaryTint else Shop.colors.surface2)
          .clickable(onClick = onPickDebtor)
          .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Icon(
          Icons.Filled.PersonOutline,
          contentDescription = null,
          tint = if (debtorName != null) Shop.colors.primary else Shop.colors.muted,
        )
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
          Text(
            if (debtorName != null) "به حساب: $debtorName" else "به حساب قرض‌دار بگذار",
            style = MaterialTheme.typography.titleSmall,
            color = Shop.colors.text,
          )
          Text(
            debtorNote ?: "برای فروش نسیه، قرض‌دار را انتخاب کنید",
            style = MaterialTheme.typography.labelSmall,
            color = Shop.colors.muted,
          )
        }
        if (debtorName != null) {
          IconButton(onClick = onClearDebtor) {
            Icon(Icons.Filled.Close, contentDescription = "حذف قرض‌دار", tint = Shop.colors.muted)
          }
        }
      }

      Spacer(Modifier.height(10.dp))

      Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Text("مجموع", style = MaterialTheme.typography.labelSmall, color = Shop.colors.muted)
          Text(
            "${money(total)} افغانی",
            style = MaterialTheme.typography.headlineSmall,
            color = Shop.colors.text,
            fontWeight = FontWeight.Bold,
          )
        }
        Button(onClick = onFinalize) {
          Text(if (debtorName != null) "ثبت نسیه" else "ثبت فروش")
        }
      }
    }
  }
}
