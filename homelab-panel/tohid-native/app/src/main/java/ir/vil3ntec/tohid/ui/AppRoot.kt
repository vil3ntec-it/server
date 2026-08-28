package ir.vil3ntec.tohid.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ir.vil3ntec.tohid.data.CartStore
import ir.vil3ntec.tohid.data.ShopStore
import ir.vil3ntec.tohid.ui.screens.*
import ir.vil3ntec.tohid.ui.theme.Shop
import kotlinx.coroutines.launch

private data class Tab(val id: String, val label: String, val icon: ImageVector)

private val TABS = listOf(
  Tab("dashboard", "داشبورد", Icons.Filled.GridView),
  Tab("sale", "فروش", Icons.Filled.PointOfSale),
  Tab("debtors", "قرض‌داران", Icons.Filled.Groups),
  Tab("warehouse", "انبار", Icons.Filled.Inventory2),
  Tab("expenses", "مصارف", Icons.Filled.BarChart),
  Tab("more", "بیشتر", Icons.Filled.MoreHoriz),
)


@Composable
fun AppRoot(
  store: ShopStore,
  theme: ir.vil3ntec.tohid.ui.theme.ThemeChoice,
  onTheme: (ir.vil3ntec.tohid.ui.theme.ThemeChoice) -> Unit,
) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val data by store.data.collectAsState()
  val cartStore = remember { CartStore(context) }
  var tab by rememberSaveable { mutableStateOf("dashboard") }
  var migration by remember { mutableStateOf<String?>(null) }
  // بارکدی که در فروش خوانده شد ولی کالایش ثبت نبود
  var pendingBarcode by remember { mutableStateOf<String?>(null) }
  // صفحهٔ فرعیِ باز، اگر باز باشد
  var sub by rememberSaveable { mutableStateOf<String?>(null) }

  // یک بار، هنگام اولین اجرا: دفترِ دکان از نسخهٔ قبلی آورده می‌شود
  LaunchedEffect(Unit) {
    if (store.hasData()) return@LaunchedEffect
    val legacy = runCatching { ir.vil3ntec.tohid.data.Migration.readLegacyData(context) }.getOrNull()
    if (legacy.isNullOrBlank()) return@LaunchedEffect
    store.importJson(legacy)
      .onSuccess { migration = "اطلاعات نسخهٔ قبلی آورده شد" }
      .onFailure { migration = "اطلاعات نسخهٔ قبلی خوانده نشد" }
  }

  // دکمهٔ برگشتِ گوشی از صفحهٔ فرعی برمی‌گردد، نه اینکه برنامه را ببندد
  BackHandler(enabled = sub != null) { sub = null }

  val snackbar = remember { SnackbarHostState() }
  LaunchedEffect(migration) {
    migration?.let { scope.launch { snackbar.showSnackbar(it) } }
  }

  Scaffold(
    containerColor = Shop.colors.bg,
    snackbarHost = { SnackbarHost(snackbar) },
    bottomBar = {
      NavigationBar(containerColor = Shop.colors.surface, tonalElevation = 0.dp) {
        TABS.forEach { t ->
          NavigationBarItem(
            selected = tab == t.id && sub == null,
            onClick = { tab = t.id; sub = null },
            icon = { Icon(t.icon, contentDescription = t.label) },
            label = { Text(t.label, style = MaterialTheme.typography.labelSmall) },
            colors = NavigationBarItemDefaults.colors(
              selectedIconColor = Shop.colors.primary,
              selectedTextColor = Shop.colors.primary,
              unselectedIconColor = Shop.colors.muted,
              unselectedTextColor = Shop.colors.muted,
              indicatorColor = Shop.colors.primaryTint,
            ),
          )
        }
      }
    },
  ) { padding ->
    Box(
      Modifier
        .padding(padding)
        .fillMaxSize()
        .background(Shop.colors.bg)
    ) {
      when (sub ?: tab) {
        "purchasing" -> PurchasingScreen(store, data, snackbar)
        "sales" -> SalesHistoryScreen(store, data, snackbar)
        "reports" -> ReportsScreen(data)
        "receipts" -> ReceiptsScreen(data)
        "audit" -> AuditLogScreen(data)
        "settings" -> SettingsScreen(store, data, snackbar, theme, onTheme)
        "expenses" -> ExpensesScreen(store, data, snackbar)
        "dashboard" -> DashboardScreen(data)
        "sale" -> SaleScreen(store, cartStore, data, snackbar) { code ->
          pendingBarcode = code
          tab = "warehouse"
        }
        "debtors" -> DebtorsScreen(store, data, snackbar)
        "warehouse" -> WarehouseScreen(
          store = store,
          d = data,
          snackbar = snackbar,
          newBarcode = pendingBarcode,
          onConsumed = { pendingBarcode = null },
        )
        "more" -> MoreScreen(store, data) { sub = it }
      }
    }
  }
}
